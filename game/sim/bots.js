// sim/bots.js — playtest bots (spec §2: "basic, for playtesting only... Do
// not design systems around bots"). Everything a bot DOES mechanically it
// inherits from the real sims: the same stepPlayer movement (inertia, stances,
// swept collision) and the same stepLoadout weapons (spread, recoil, falloff,
// ammo, even scope sway) — so a bot firing an AR is bit-for-bit the AR. Only
// the BRAIN lives here: waypoint pathing (sim/path.js), perception (fog-limited
// LOS rays), aim with error, and simple firing rules. Deterministic: one
// mulberry32 stream per bot, no DOM/Three/network.
//
// The session owns hp/deaths/K-D and spawn placement; this module owns
// per-bot player + loadout state and per-tick inputs. Actors are shared
// objects: [{ id, side, alive, pos (a live reference), interact }] — the
// player is actor id 'player'. Bots read R (the round state) for phases and
// the bomb; the session glues everything in between (see client/arena-session).

import { createPlayer, stepPlayer } from './player.js'
import { createLoadout, stepLoadout, activeWeapon } from './weapon.js'
import { castRay } from './hitscan.js'
import { findPath, nearestNode } from './path.js'
import { mulberry32 } from './rng.js'

const DEG2RAD = Math.PI / 180

// fiction-safe playtest names (spec §3: Norse/Germanic flavor, no franchises)
const NAMES = [
  'Huginn', 'Muninn', 'Geri', 'Freki', 'Sif', 'Bragi',
  'Vidar', 'Gerd', 'Trym', 'Skirnir', 'Hela', 'Njord',
]

function lerp(a, b, t) {
  return a + (b - a) * t
}

// createBots — one call per match. playerSide gets teamSize-1 bots (the
// player fills the squad), the other side gets teamSize. Weapons come from
// the per-side pools in cfg.bots (cycled by that side's bot index).
export function createBots(cfg, { playerSide, teamSize, matchSeed = 0x51ed }) {
  const mkSide = (side, count) => {
    const pool = side === 'attackers' ? cfg.bots.attackerWeapons : cfg.bots.defenderWeapons
    const list = []
    for (let i = 0; i < count; i++) {
      const id = 'b' + list.length + side[0] // b0a / b1a... unique per side
      const seed = (matchSeed + list.length * 0x9e3779b9 + (side === 'attackers' ? 0 : 0x85ebca6b)) >>> 0
      const rng = mulberry32(seed)
      const bot = {
        id,
        name: NAMES[(i + (side === 'attackers' ? 0 : NAMES.length / 2)) % NAMES.length],
        side,
        weapon: pool[i % pool.length],
        siteAssign: i % 2 === 0 ? 'A' : 'B', // attacker push target / defender hold spot
        skill: 0.85 + rng() * 0.3, // ±15% aim error / reaction, per bot
        // live sim state (rebuilt every round by resetBotsForRound)
        player: null,
        loadout: null,
        yaw: 0,
        pitch: 0,
        interact: false,
        // brain
        rng,
        targetId: null,
        seenT: 0,
        lostT: 0,
        scanT: 0,
        errDir: rng() * Math.PI * 2, // aim error bearing, re-rolled each scan
        path: [],
        pathI: 0,
        objective: -1, // node index the bot is currently walking to
        repathT: 0,
        stuckT: 0,
        strafePhase: rng() * Math.PI * 2,
        jitterX: 0,
        jitterZ: 0,
        aimYaw: 0,
        aimPitch: 0,
        seed,
      }
      // per-bot formation offset so squads don't stack on one node
      const j = () => (bot.rng() * 2 - 1) * cfg.bots.spreadJitterM
      bot.jitterX = j()
      bot.jitterZ = j()
      list.push(bot)
    }
    return list
  }

  const enemySide = playerSide === 'attackers' ? 'defenders' : 'attackers'
  const list = [
    ...mkSide(playerSide, Math.max(0, teamSize - 1)),
    ...mkSide(enemySide, teamSize),
  ]
  const byId = {}
  for (const b of list) byId[b.id] = b
  return { list, byId }
}

// Rebuild every bot's sim state at their round spawn (fresh kit, full ammo —
// dead players keep nothing, and there is no economy yet). spawnMap: id ->
// { pos: [x,y,z], yaw }. seedBase shifts per round so streams differ per
// round but replays stay bit-identical.
export function resetBotsForRound(bots, cfg, spawnMap, roundNum) {
  for (const b of bots.list) {
    const sp = spawnMap[b.id] || { pos: [0, 0, 0], yaw: 0 }
    b.player = createPlayer({ pos: sp.pos, yaw: sp.yaw }, cfg)
    b.loadout = createLoadout(cfg, {
      seed: (b.seed + roundNum * 0x2545f491) >>> 0,
      weapons: [b.weapon],
      ownerId: b.id,
    })
    b.yaw = sp.yaw
    b.pitch = 0
    b.aimYaw = sp.yaw
    b.aimPitch = 0
    b.interact = false
    b.targetId = null
    b.seenT = 0
    b.lostT = 0
    b.scanT = b.rng() / cfg.bots.scanHz // stagger scans so not all raycast on one tick
    b.path = []
    b.pathI = 0
    b.objective = -1
    b.arrived = false
    b.repathT = 0
    b.stuckT = 0
  }
}

// which node group is this bot's objective right now? (see maps/arena.js
// `objectives`; groups are arrays of node indices)
function objectiveNode(bot, ctx) {
  const { R, graph, objectives } = ctx
  const bomb = R.bomb
  const groups = objectives
  if (R.phase === 'planted') {
    // everyone converges on the bomb: attackers guard it, defenders defuse it
    return nearestNode(graph, bomb.pos.x, bomb.pos.z, ctx.world)
  }
  if (bot.side === 'attackers') {
    if (R.phase === 'bomb' && bomb.state === 'dropped' && bomb.pos) {
      return nearestNode(graph, bomb.pos.x, bomb.pos.z, ctx.world)
    }
    if (R.phase === 'bomb') {
      const g = bot.siteAssign === 'A' ? groups.siteA : groups.siteB
      return g[Math.abs(hashId(bot.id)) % g.length]
    }
    const g = groups.attack
    return g[Math.abs(hashId(bot.id)) % g.length]
  }
  // defenders: hold near the point in phase 1, split across sites in phase 2
  if (R.phase === 'bomb') {
    const g = bot.siteAssign === 'A' ? groups.siteA : groups.siteB
    return g[Math.abs(hashId(bot.id)) % g.length]
  }
  const g = groups.defend
  return g[Math.abs(hashId(bot.id)) % g.length]
}

// stable tiny string hash so a bot's group slot doesn't reshuffle every tick
function hashId(s) {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0
  return h
}

// stepBots — one tick of every living bot's brain + sims. Returns this tick's
// shot events (each carries pellets/hits — the session applies damage).
// ctx = { cfg, world, graph, objectives, R, actors, watch: {x,z} }
export function stepBots(bots, ctx, dt) {
  const { cfg, world, graph, R, actors } = ctx
  const B = cfg.bots
  const shots = []
  const frozen = R.phase === 'freeze' || R.phase === 'roundEnd' || R.phase === 'matchEnd'

  for (const bot of bots.list) {
    const actor = actors.find((a) => a.id === bot.id)
    if (!actor || !actor.alive || frozen) {
      bot.interact = false
      continue
    }

    const p = bot.player
    const L = bot.loadout
    const w = activeWeapon(L)
    const eyeY = p.eyeY

    // ---------- perception (throttled; the LOS rays are the cost) ----------
    bot.scanT -= dt
    if (bot.scanT <= 0) {
      bot.scanT = 1 / Math.max(B.scanHz, 0.1)
      scanForTarget(bot, ctx, eyeY)
    }
    const target = bot.targetId ? actors.find((a) => a.id === bot.targetId) : null
    const targetLive = target && target.alive
    if (targetLive) {
      bot.seenT += dt
      bot.lostT = 0
    } else if (bot.targetId) {
      bot.lostT += dt
      if (bot.lostT > B.loseTargetTime || !target) bot.targetId = null
    }

    // ---------- aim: swing toward the target (with error) or the watch dir
    let desiredYaw
    let desiredPitch = 0
    const err = lerp(B.aimErrorDeg, B.aimErrorMinDeg, Math.min(1, bot.seenT / B.aimSettleTime)) / bot.skill
    if (targetLive) {
      const dx = target.pos.x - p.pos.x
      const dy = target.pos.y + 1.0 - (p.pos.y + eyeY) // chest height
      const dz = target.pos.z - p.pos.z
      const flat = Math.hypot(dx, dz)
      desiredYaw = Math.atan2(-dx, -dz) + Math.cos(bot.errDir) * err * DEG2RAD
      desiredPitch = Math.atan2(dy, flat) + Math.sin(bot.errDir) * err * DEG2RAD
    } else {
      // idle watch: face the map's center of contention
      const dx = ctx.watch.x - p.pos.x
      const dz = ctx.watch.z - p.pos.z
      desiredYaw = Math.atan2(-dx, -dz)
      bot.seenT = 0
    }
    const maxTurn = B.aimTrackRate * dt
    bot.aimYaw = approachAngle(bot.aimYaw, desiredYaw, maxTurn)
    bot.aimPitch = approach(bot.aimPitch, desiredPitch, maxTurn)

    // ---------- fire discipline ----------
    let fire = false
    let scope = false
    const dist = targetLive ? Math.hypot(target.pos.x - p.pos.x, target.pos.z - p.pos.z) : Infinity
    // weapon-aware engagement range: no shotgun blasts at 40 m — the bot's
    // ceiling is its own weapon's falloff end (x1.25 grace), not just sight
    const W = cfg.weapons[w.id]
    const engageRange = Math.min(B.sightDist * B.fireRangeMult, W.falloffEndDist * 1.25)
    if (targetLive && bot.seenT >= B.reactionTime * bot.skill && dist <= engageRange) {
      // angular error to the TRUE target direction (not the wobbling desired)
      const dx = target.pos.x - p.pos.x
      const dy = target.pos.y + 1.0 - (p.pos.y + eyeY)
      const dz = target.pos.z - p.pos.z
      const trueYaw = Math.atan2(-dx, -dz)
      const truePitch = Math.atan2(dy, Math.hypot(dx, dz))
      const off = Math.abs(angDiff(bot.aimYaw, trueYaw)) / DEG2RAD + Math.abs(bot.aimPitch - truePitch) / DEG2RAD
      if (off <= B.fireConeDeg) fire = true
      // sniper bots settle in behind the scope at range
      if (W.canScope && dist > B.scopeDist) scope = true
    }

    // ---------- movement ----------
    // Bots KEEP WALKING their path while fighting (aim is independent of the
    // legs — attackers push through contact instead of strafing at spawn),
    // and pace side-to-side only when they have nowhere to be.
    let mx = 0
    let mz = 0
    navigate(bot, ctx, dt)
    const node = pathTarget(bot, graph)
    if (node) {
      const dx = node.x - p.pos.x
      const dz = node.z - p.pos.z
      const len = Math.hypot(dx, dz)
      if (len > 0.05) {
        // world direction -> bot-local strafe/forward (input.yaw is the AIM)
        const fx = -Math.sin(bot.aimYaw)
        const fz = -Math.cos(bot.aimYaw)
        const rx = Math.cos(bot.aimYaw)
        const rz = -Math.sin(bot.aimYaw)
        mx = (dx / len) * rx + (dz / len) * rz
        mz = (dx / len) * fx + (dz / len) * fz
      }
    } else if (targetLive && B.combatStrafeM > 0) {
      // in a fight with nowhere to be: pace (0 = planted feet, 2+ = full skate)
      bot.strafePhase += dt * B.combatStrafeHz * Math.PI * 2
      mx = Math.sin(bot.strafePhase) * Math.min(1, B.combatStrafeM / 2)
    }

    // body yaw follows the aim (the viewmodel of a bot is its aim)
    const maxBody = B.turnRate * dt
    bot.yaw = approachAngle(bot.yaw, bot.aimYaw, maxBody)

    // plant / defuse intent: the carrier in a site, or a defender on the bomb
    bot.interact = false
    if (R.phase === 'bomb' && R.bomb.carrierId === bot.id) {
      bot.interact = true // hold E; the round machine checks the zone itself
    } else if (R.phase === 'planted' && bot.side === 'defenders' && R.bomb.pos) {
      bot.interact =
        Math.hypot(p.pos.x - R.bomb.pos.x, p.pos.z - R.bomb.pos.z) <= cfg.round.defuseRadius * 0.8
    }

    // ---------- run the real sims ----------
    const input = {
      mx,
      mz,
      yaw: bot.aimYaw,
      pitch: bot.aimPitch,
      jump: false,
      crouch: false,
      walk: false,
      fire,
      reload: w.ammo === 0,
      scope,
      switchTo: null,
      equip: null,
      moveScale: L.moveScale,
    }
    stepPlayer(p, input, dt, cfg, world)
    const events = stepLoadout(L, input, p, cfg, world, dt)
    for (const ev of events) {
      if (ev.type === 'shot') shots.push({ ...ev, shooterId: bot.id, shooterName: bot.name, weapon: ev.weapon })
    }

    // stuck watchdog: repath (cheap, self-healing)
    const speed = Math.hypot(p.vel.x, p.vel.z)
    if (bot.path.length && speed < B.stuckSpeed) {
      bot.stuckT += dt
      if (bot.stuckT > B.stuckTime) {
        bot.stuckT = 0
        bot.path = []
        bot.arrived = false
        bot.repathT = 0
      }
    } else {
      bot.stuckT = 0
    }
  }
  return shots
}

// scan: nearest VISIBLE enemy becomes the target (sticky if still visible).
// LOS = a chest-height ray; a wall or another body in between blocks sight.
function scanForTarget(bot, ctx, eyeY) {
  const { actors, world, cfg } = ctx
  const B = cfg.bots
  bot.errDir = bot.rng() * Math.PI * 2 // re-roll the wobble bearing
  const o = { x: bot.player.pos.x, y: bot.player.pos.y + eyeY, z: bot.player.pos.z }

  const check = (a) => {
    const dx = a.pos.x - o.x
    const dy = a.pos.y + 1.0 - o.y
    const dz = a.pos.z - o.z
    const d = Math.hypot(dx, dy, dz)
    if (d > B.sightDist || d < 0.01) return false
    const hit = castRay(o, { x: dx / d, y: dy / d, z: dz / d }, world, d, bot.id)
    return !!hit && hit.kind === 'target' && hit.targetId === a.id
  }

  // sticky target first (a tracked enemy keeps priority while visible)
  const cur = bot.targetId ? actors.find((a) => a.id === bot.targetId) : null
  if (cur && cur.alive && cur.side !== bot.side && check(cur)) return

  const enemies = actors
    .filter((a) => a.side !== bot.side && a.alive)
    .sort((a, b) => dist2(a, o) - dist2(b, o))
  for (const e of enemies) {
    if (check(e)) {
      if (bot.targetId !== e.id) bot.seenT = 0
      bot.targetId = e.id
      return
    }
  }
  bot.targetId = null
}

function dist2(a, o) {
  const dx = a.pos.x - o.x
  const dz = a.pos.z - o.z
  return dx * dx + dz * dz
}

// (re)compute the path toward this bot's current objective node. Repaths
// happen on OBJECTIVE CHANGE, an empty path, the stuck watchdog, or a slow
// safety timer — a fast timer here pingpongs bots (each repath re-inserts a
// backward hop to the nearest node, which is how the first playtest carrier
// got stuck orbiting a pillar). After a repath the bot skips path[0]: it is
// by construction the node it already stands next to.
function navigate(bot, ctx, dt) {
  const { graph, world, cfg } = ctx
  const B = cfg.bots
  bot.repathT -= dt
  const want = objectiveNode(bot, ctx)
  // `arrived` freezes repaths while the bot holds its objective (otherwise a
  // holding bot repaths every tick: [node] -> arrive -> empty -> repath ...)
  if (want !== bot.objective || !bot.path.length || (!bot.arrived && bot.repathT <= 0)) {
    bot.objective = want
    bot.arrived = false
    bot.repathT = B.repathTime
    const from = nearestNode(graph, bot.player.pos.x, bot.player.pos.z, world)
    const path = findPath(graph, from, want)
    bot.path = path || []
    bot.pathI = bot.path.length > 1 ? 1 : 0
  }
  // advance along the path
  const node = pathTarget(bot, graph)
  if (node) {
    const dx = node.x - bot.player.pos.x
    const dz = node.z - bot.player.pos.z
    if (Math.hypot(dx, dz) <= B.waypointReach) {
      bot.pathI++
      if (bot.pathI >= bot.path.length) {
        bot.path = [] // arrived — hold
        bot.arrived = true
      }
    }
  } else {
    bot.arrived = true
  }
}

// the node the bot is currently walking to (objective-local, with this bot's
// formation jitter so a squad doesn't pile onto one point)
function pathTarget(bot, graph) {
  if (!bot.path.length || bot.pathI >= bot.path.length) return null
  const n = graph.nodes[bot.path[bot.pathI]]
  return { x: n.x + bot.jitterX, z: n.z + bot.jitterZ }
}

function approach(v, target, maxStep) {
  if (v < target) return Math.min(v + maxStep, target)
  return Math.max(v - maxStep, target)
}

function approachAngle(v, target, maxStep) {
  let d = angDiff(v, target)
  if (Math.abs(d) <= maxStep) return target
  return v + Math.sign(d) * maxStep
}

function angDiff(a, b) {
  let d = (b - a) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return d
}
