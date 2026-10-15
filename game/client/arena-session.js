// client/arena-session.js — the VS-bots match glue: one Capture & Bomb match
// on HOLMGANG. Owns the actors (player + bots), the round machine's ctx, the
// damage layer (friendly fire OFF but bodies absorb), the bomb prop, the
// player's death → spectate flow, round restarts (respawns, halftime side
// swap), and the match chrome (banners, feed, Tab scoreboard, plant/defuse
// prompts). Everything gameplay-critical runs in the SIM modules; this file
// wires them together and mirrors state into views.
//
// The tick order is the one the headless verifier validated:
//   1. refresh hitboxes (world.targets from live actors)
//   2. player movement + weapon (input gated by alive/freeze)
//   3. bots (they read last tick's round state — one tick of staleness at
//      64 Hz is imperceptible) -> their shots apply damage
//   4. sync plant/defuse intents onto actors
//   5. the round machine runs with fresh interacts
//
// The player's starting weapons come IN as { side, weapons } (the lobby's
// picks) — no global anywhere; when acquisition changes later, only the
// caller that builds this session changes.

import * as THREE from 'three'
import { CONFIG } from '../config.js'
import {
  createPlayer, stepPlayer, createLoadout, stepLoadout, activeWeapon,
  createRound, startRound, stepRound, nextRound,
  createBots, resetBotsForRound, stepBots, buildGraph,
} from '../sim/index.js'
import { ARENA } from '../maps/arena.js'
import { buildBotViews } from './bot-view.js'

const DEG2RAD = Math.PI / 180
const SIDE_NAME = { attackers: 'ATTACKERS', defenders: 'DEFENDERS' }
const REASON_TEXT = {
  detonation: 'the bomb detonated',
  defuse: 'the bomb was defused',
  attackers_dead: 'attackers eliminated',
  defenders_dead: 'defenders eliminated',
  timer: 'time expired',
  retake: 'the point was retaken',
}

export function createArenaSession({ setup, services, onLeave }) {
  const { scene: sceneApi, camera, input, thermal, hud, gun, dbg, scoreboard, viewmodel } = services
  const scene = sceneApi.scene // the THREE.Scene bots and the bomb render into

  // ---- world + graph
  const world = { boxes: ARENA.boxes, targets: [] }
  const graph = buildGraph(ARENA.waypoints)

  // ---- actors: the player + the bots (squad sizes from cfg.match). Bot
  // actors' pos/interact are synced from their bot object EVERY tick (see
  // tick) — the bot's sim state is rebuilt each round, so a captured
  // reference would go stale.
  const player = {
    id: 'player',
    name: 'YOU',
    side: setup.side,
    alive: true,
    hp: CONFIG.player.hp,
    maxHp: CONFIG.player.hp,
    kills: 0,
    deaths: 0,
    hitFlash: 0,
    interact: false,
    pos: null, // live ref, set by spawnPlayer
    state: null, // sim player state
    loadout: null,
    target: makeTarget('player'),
  }

  const bots = createBots(CONFIG, { playerSide: setup.side, teamSize: CONFIG.match.teamSize })
  const actors = [player, ...bots.list.map((b) => ({
    id: b.id, name: b.name, side: b.side, alive: true, hp: CONFIG.player.hp, maxHp: CONFIG.player.hp,
    kills: 0, deaths: 0, interact: false, pos: null, bot: b, target: makeTarget(b.id),
  }))]

  const R = createRound(CONFIG)

  // ---- views
  const botViews = buildBotViews(scene, bots.list)
  const bombView = buildBombView(scene)

  // ---- spectate state (player death)
  let spectateIdx = -1
  let prevFire = false

  // ---- spawn bookkeeping: per side, the PLAYER takes slot 0 (if on that
  //      side) and bots fill the rest. Recomputed every round (halftime swaps).
  function spawnMap() {
    const map = {}
    for (const side of ['attackers', 'defenders']) {
      const spawns = ARENA.spawns[side]
      const squad = actors.filter((a) => a.side === side)
      squad.forEach((a, i) => { map[a.id] = spawns[i % spawns.length] })
    }
    return map
  }

  function spawnPlayer(sp) {
    player.state = createPlayer({ pos: sp.pos, yaw: sp.yaw }, CONFIG)
    player.pos = player.state.pos // live reference for the round machine
    player.loadout = createLoadout(CONFIG, { weapons: setup.weapons, ownerId: 'player' })
    input.view.yaw = sp.yaw
    input.view.pitch = 0
    player.interact = false
    spectateIdx = -1
  }

  function startMatch() {
    const map = spawnMap()
    spawnPlayer(map.player)
    resetBotsForRound(bots, CONFIG, map, 1)
    for (const a of actors) { a.alive = true; a.hp = CONFIG.player.hp; a.kills = 0; a.deaths = 0 }
    startRound(R, CONFIG, actors)
    botViews.onRoundReset()
    consumeRoundEvents(R.events)
  }

  // ---- hitboxes: one reused zone-box set per actor, recomputed per tick
  function refreshTargets() {
    world.targets.length = 0
    for (const a of actors) {
      if (!a.alive) continue
      const src = a.bot ? a.bot.player : player.state
      if (!src) continue
      const p = src.pos
      const s = src.capsuleH / CONFIG.movement.standHeight
      const t = a.target
      const set = (z, y0, y1, hw, hd) => {
        z.min[0] = p.x - hw; z.max[0] = p.x + hw
        z.min[2] = p.z - hd; z.max[2] = p.z + hd
        z.min[1] = p.y + y0 * s; z.max[1] = p.y + y1 * s
      }
      set(t.zones.legs, 0, 0.9, 0.25, 0.15)
      set(t.zones.body, 0.9, 1.55, 0.28, 0.18)
      set(t.zones.head, 1.55, 1.85, 0.14, 0.14)
      world.targets.push(t)
    }
  }

  // ---- the damage layer: aggregate a blast per victim, friendlies absorb,
  //      deaths feed the board + feed.
  function applyShots(shots) {
    for (const ev of shots) {
      const shooter = actors.find((a) => a.id === ev.shooterId)
      if (!shooter || !shooter.alive) continue
      const byTarget = new Map()
      for (const pel of ev.pellets) {
        const h = pel.hit
        if (!h || h.kind !== 'target') continue
        const victim = actors.find((a) => a.id === h.targetId)
        if (!victim || !victim.alive || victim.side === shooter.side) continue
        const agg = byTarget.get(h.targetId) || { dmg: 0, zones: {}, head: false }
        agg.dmg += h.damage
        agg.zones[h.zone] = (agg.zones[h.zone] || 0) + 1
        if (h.zone === 'head') agg.head = true
        byTarget.set(h.targetId, agg)
      }
      for (const [id, agg] of byTarget) {
        const victim = actors.find((a) => a.id === id)
        victim.hp -= agg.dmg
        // zone flash on the victim's view (bots only — the player's is the vignette)
        if (victim.bot) {
          let zone = 'body'
          let best = -1
          for (const z in agg.zones) if (agg.zones[z] > best) { best = agg.zones[z]; zone = z }
          botViews.onHit(id, zone)
        } else {
          player.hitFlash = CONFIG.player.hitFlashTime
        }
        if (victim.hp <= 0) killActor(victim, shooter, ev.weapon, agg.head)
      }
    }
  }

  function killActor(victim, killer, weapon, headshot) {
    victim.alive = false
    victim.hp = 0
    victim.deaths++
    killer.kills++
    // topple direction: from the killer toward the victim (horizontal aim)
    const dir = dirOfActor(killer)
    if (victim.bot) botViews.onKilled(victim.id, dir.x, dir.z)
    scoreboard.onFeed({
      killer: killer.id === 'player' ? 'YOU' : killer.name,
      victim: victim.id === 'player' ? 'YOU' : victim.name,
      killerSide: killer.side,
      weapon, headshot,
    })
    if (!victim.bot) {
      // the player died: start spectating a living teammate
      const mate = actors.find((a) => a.side === player.side && a.alive && a.bot)
      spectateIdx = mate ? actors.indexOf(mate) : -1
    }
  }

  function dirOfActor(a) {
    if (a.bot) {
      return { x: -Math.sin(a.bot.aimYaw), z: -Math.cos(a.bot.aimYaw) }
    }
    return { x: -Math.sin(input.view.yaw), z: -Math.cos(input.view.yaw) }
  }

  // ---- round events -> banners + round flow
  function consumeRoundEvents(events) {
    for (const ev of events) {
      if (ev.type === 'roundStart') {
        scoreboard.banner('ROUND ' + ev.round,
          player.side === 'attackers' ? 'capture the point — then plant at A or B' : 'hold the point — nothing detonates',
          3.5)
      } else if (ev.type === 'unlock') {
        scoreboard.banner('POINT CAPTURED', 'sites open — plant at A or B', 3)
      } else if (ev.type === 'planted') {
        scoreboard.banner('BOMB PLANTED', CONFIG.round.fuseTime + ' s fuse — defenders defuse', 3)
      } else if (ev.type === 'bombDrop') {
        scoreboard.banner('BOMB DROPPED', 'an attacker can pick it up', 2)
      } else if (ev.type === 'roundEnd') {
        scoreboard.banner(SIDE_NAME[ev.side] + ' WIN', REASON_TEXT[ev.reason] || ev.reason, 4)
      } else if (ev.type === 'halftime') {
        // squads swap sides: every actor flips (the player included), and the
        // bot views re-tint to the new side
        for (const a of actors) a.side = a.side === 'attackers' ? 'defenders' : 'attackers'
        for (const b of bots.list) {
          b.side = b.side === 'attackers' ? 'defenders' : 'attackers'
          botViews.setSide(b.id, b.side)
        }
        scoreboard.banner('HALFTIME', 'sides swap — you are now ' + SIDE_NAME[player.side].toLowerCase(), 4)
      } else if (ev.type === 'roundEndDone') {
        const roundNum = nextRound(R, CONFIG)
        if (roundNum) {
          const map = spawnMap()
          spawnPlayer(map.player)
          resetBotsForRound(bots, CONFIG, map, roundNum)
          for (const a of actors) { a.alive = true; a.hp = CONFIG.player.hp }
          startRound(R, CONFIG, actors)
          botViews.onRoundReset()
          // nextRound/startRound push their events (halftime, roundStart)
          // BETWEEN ticks — drain them NOW; the next stepRound clears the
          // buffer before anyone could read them
          consumeRoundEvents(R.events.splice(0))
        }
      } else if (ev.type === 'matchOver') {
        scoreboard.banner('MATCH OVER', SIDE_NAME[ev.side] + ' take the match ' +
          R.scores.attackers + '–' + R.scores.defenders + ' · press M to return', 3600)
      }
    }
  }

  // ---- bomb prop position (carried = hidden, dropped/planted = on the floor)
  function syncBombView(dt) {
    const b = R.bomb
    if (b.state === 'dropped' || b.state === 'planted') {
      bombView.group.visible = true
      bombView.group.position.set(b.pos.x, b.pos.y + 0.12, b.pos.z)
      const urgent = b.state === 'planted' ? Math.max(0, 1 - R.fuseT / Math.max(CONFIG.round.fuseTime, 1)) : 0
      bombView.blink(dt, urgent)
    } else {
      bombView.group.visible = false
    }
  }

  // ---- one sim tick
  function tick(sample, dt) {
    refreshTargets()

    const frozen = R.phase === 'freeze' || R.phase === 'roundEnd' || R.phase === 'matchEnd'
    const alive = player.alive

    // player input gating: dead = no body; frozen = locked in place (the
    // weapon stays holstered exactly like the M1 pause card)
    if (alive && !frozen) {
      sample.moveScale = player.loadout.moveScale
      stepPlayer(player.state, sample, dt, CONFIG, world)
      const events = stepLoadout(player.loadout, sample, player.state, CONFIG, world, dt)
      for (const ev of events) {
        if (ev.type === 'shot') {
          dbg.record(ev)
          gun.onEvent(ev)
          viewmodel.onEvent(ev)
          applyShots([{ ...ev, shooterId: 'player', weapon: ev.weapon }])
        } else {
          gun.onEvent(ev)
          viewmodel.onEvent(ev)
        }
      }
      // spectate cycling is LMB while dead — never while alive
      prevFire = sample.fire
    } else {
      if (!alive) {
        // LMB (rising edge) cycles living teammates
        if (sample.fire && !prevFire) {
          const mates = actors.filter((a) => a.side === player.side && a.alive && a.bot)
          if (mates.length) {
            const at = mates.indexOf(actors[spectateIdx])
            spectateIdx = actors.indexOf(mates[(at + 1) % mates.length])
          }
        }
        prevFire = sample.fire
      }
    }

    // bots (they read R's last-tick state; their interact intents land on the
    // actors right after, before the round machine runs)
    if (!frozen) {
      const shots = stepBots(bots, {
        cfg: CONFIG, world, graph, objectives: ARENA.objectives, R, actors, watch: ARENA.watch,
      }, dt)
      applyShots(shots)
      // remote FX: tracers + impact marks from bot muzzles (no hitmarker, no
      // screen flash — those are the local player's feedback only)
      for (const ev of shots) {
        const bot = bots.byId[ev.shooterId]
        if (!bot || !bot.player) continue
        const p = bot.player.pos
        const c = Math.cos(bot.yaw)
        const s = Math.sin(bot.yaw)
        // hand-held muzzle: right of the body, chest height, forward of the aim
        const mx = p.x + 0.2 * c + 0.45 * -s
        const mz = p.z - 0.2 * s + 0.45 * -c
        gun.onEvent(ev, { x: mx, y: p.y + 1.32, z: mz })
      }
    }
    for (const a of actors) {
      if (a.bot) {
        a.interact = a.bot.interact
        a.pos = a.bot.player.pos // live ref — resetBotsForRound rebuilds these
      }
    }
    player.interact = alive && !frozen && !!sample.interact

    // the round machine
    consumeRoundEvents(stepRound(R, { cfg: CONFIG, actors, zones: ARENA.zones }, dt))
    syncBombView(dt)

    // player damage vignette decay
    if (player.hitFlash > 0) player.hitFlash = Math.max(0, player.hitFlash - dt)

    // interpolation snapshot for the camera
    prevPos = { x: player.state.pos.x, y: player.state.pos.y, z: player.state.pos.z, eye: player.state.eyeY }
  }

  let prevPos = { x: 0, y: 0, z: 0, eye: 1.65 }

  // ---- per-frame: camera, views, HUD
  function update(dt, acc, sample) {
    // camera: alive = interpolated own view; dead = teammate follow-cam
    if (player.alive) {
      const t = acc
      camera.position.set(
        prevPos.x + (player.state.pos.x - prevPos.x) * t,
        prevPos.y + (player.state.pos.y - prevPos.y) * t + prevPos.eye + (player.state.eyeY - prevPos.eye) * t,
        prevPos.z + (player.state.pos.z - prevPos.z) * t
      )
      const w = activeWeapon(player.loadout)
      camera.rotation.y = input.view.yaw + (w.recoil.yaw + player.loadout.sway.yaw) * DEG2RAD
      camera.rotation.x = input.view.pitch + (w.recoil.pitch + player.loadout.sway.pitch) * DEG2RAD
    } else {
      const mate = actors[spectateIdx]
      if (mate && mate.alive && mate.bot) {
        const b = mate.bot
        camera.position.set(b.player.pos.x, b.player.pos.y + b.player.eyeY, b.player.pos.z)
        camera.rotation.y = b.aimYaw
        camera.rotation.x = b.aimPitch
      } // no living teammate: the camera simply stays where death left it
    }

    botViews.tick(dt)
    thermal.setTargets(world.targets)
    hud.update(player.state, sample, player.loadout, { kills: 0 })

    // plant / defuse prompt + progress for the PLAYER
    const b = R.bomb
    let progress = null
    if (player.alive && R.phase === 'bomb' && b.carrierId === 'player') {
      const inA = inZone(ARENA.zones.A, player.state.pos)
      const inB = inZone(ARENA.zones.B, player.state.pos)
      if (b.plantT > 0) progress = ['PLANTING', b.plantT / CONFIG.round.plantTime]
      else if (inA || inB) progress = ['HOLD E — PLANT', 0]
    } else if (player.alive && R.phase === 'planted' && player.side === 'defenders' && b.pos) {
      const near = Math.hypot(player.state.pos.x - b.pos.x, player.state.pos.z - b.pos.z) <= CONFIG.round.defuseRadius
      if (b.defuseT > 0) progress = ['DEFUSING', b.defuseT / CONFIG.round.defuseTime]
      else if (near) progress = ['HOLD E — DEFUSE', 0]
    } else if (player.alive && R.phase === 'bomb' && b.state === 'dropped' && b.pos) {
      const near = Math.hypot(player.state.pos.x - b.pos.x, player.state.pos.z - b.pos.z) <= CONFIG.round.bombPickupRadius
      if (near && player.side === 'attackers') progress = ['WALK OVER THE BOMB', 0]
    }
    scoreboard.setProgress(progress ? progress[0] : null, progress ? progress[1] : 0)

    const mate = !player.alive && actors[spectateIdx] && actors[spectateIdx].alive ? actors[spectateIdx] : null
    scoreboard.update(dt, { R, actors, player, spectating: mate ? { name: mate.name } : (!player.alive ? {} : null), matchName: ARENA.name })
  }

  function inZone(z, p) {
    return p.x >= z.min[0] && p.x <= z.max[0] && p.z >= z.min[2] && p.z <= z.max[2]
  }

  function enter() {
    thermal.setWorld(ARENA.boxes)
    sceneApi.setSunTarget(ARENA.mapCenter[0], ARENA.mapCenter[1], 30)
    bombView.group.visible = false
  }
  function leave() {
    bombView.group.visible = false
    scoreboard.setProgress(null)
    scoreboard.hideBanner()
  }

  return {
    world, R, actors, player, bots,
    // state/loadout are rebuilt every round — expose them as live getters so
    // main.js and the debug overlay always see the current ones
    get state() { return player.state },
    get loadout() { return player.loadout },
    hasMatch: true,
    isArena: true,
    isDead: () => !player.alive,
    start: startMatch,
    spawn: () => ARENA.spawns[player.side][0],
    tick, update, enter, leave,
    leaveMatch: () => onLeave(),
  }
}

// ---- one reused zone-box target per actor (mutated in place per tick)
function makeTarget(id) {
  return {
    id,
    zones: {
      head: { min: [0, 0, 0], max: [0, 0, 0] },
      body: { min: [0, 0, 0], max: [0, 0, 0] },
      legs: { min: [0, 0, 0], max: [0, 0, 0] },
    },
  }
}

// ---- the bomb prop: a small dark case with a blinking light
function buildBombView(scene) {
  const group = new THREE.Group()
  group.visible = false
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.26, 0.14, 0.18),
    new THREE.MeshStandardMaterial({ color: 0x232527, roughness: 0.6, metalness: 0.4 })
  )
  body.castShadow = true
  group.add(body)
  const lightMat = new THREE.MeshStandardMaterial({ color: 0x441111, emissive: 0xff3b2f, emissiveIntensity: 0 })
  const light = new THREE.Mesh(new THREE.SphereGeometry(0.028, 8, 8), lightMat)
  light.position.set(0, 0.08, 0)
  group.add(light)
  scene.add(group)

  let t = 0
  return {
    group,
    blink(dt, urgency) {
      t += dt
      const rate = 3 + urgency * 9 // blinks faster as the fuse runs down
      const on = Math.sin(t * rate * Math.PI * 2) > 0 ? 1 : 0.05
      lightMat.emissiveIntensity = on * 2.2
    },
  }
}
