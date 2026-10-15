// client/hub-session.js — the M1+M2+M3 range world as a SESSION: movement
// room, firing range, dummies, weapon wall. This is the code that lived
// directly in main.js through M3; it moved behind the session interface when
// the VS-bots door (M3b) made the game multi-map. Behavior is unchanged —
// the range plays exactly as it did. New: the corridor's north door opens
// the pre-match lobby (onOpenLobby) when E is pressed at the portal.

import { CONFIG } from '../config.js'
import {
  createPlayer, stepPlayer, createLoadout, stepLoadout, activeWeapon,
  createTargets, stepTargets, hurtTargets,
} from '../sim/index.js'
import { ROOM } from '../maps/movement-room.js'
import { RANGE } from '../maps/firing-range.js'

const DEG2RAD = Math.PI / 180

export function createHubSession({ services, dummiesFx, onOpenLobby }) {
  const { camera, input, thermal, hud, gun, dbg, scene, viewmodel } = services

  const targets = createTargets(RANGE.targets, CONFIG)
  const world = {
    boxes: [...ROOM.boxes, ...RANGE.boxes],
    targets: RANGE.targets,
    targetActive: (t) => targets.byId[t.id]?.alive !== false,
  }
  const state = createPlayer(ROOM.spawn, CONFIG)
  const loadout = createLoadout(CONFIG)
  input.view.yaw = ROOM.spawn.yaw

  const stations = RANGE.stations || []
  const door = ROOM.vsDoor

  let prev = { x: state.pos.x, y: state.pos.y, z: state.pos.z, eye: state.eyeY }
  let prevInteract = false
  let nearDoor = false

  function nearestStation() {
    let best = null
    let bestD2 = Infinity
    for (const st of stations) {
      const dx = st.pos[0] - state.pos.x
      const dz = st.pos[1] - state.pos.z
      const d2 = dx * dx + dz * dz
      if (d2 < bestD2) {
        bestD2 = d2
        best = st
      }
    }
    const r = CONFIG.loadout.equipRadius
    return best && bestD2 <= r * r ? best : null
  }

  function promptFor(st) {
    const held = loadout.slots[loadout.active]
    const other = loadout.slots[(loadout.active + 1) % loadout.slots.length]
    if (!st || held.id === st.weapon) return null
    const verb = other.id === st.weapon ? 'draw' : 'take'
    return '<b>E</b> — ' + verb + ' ' + CONFIG.weapons[st.weapon].name
  }

  // per-frame, BEFORE the tick loop: weapon-wall equip intents + the VS door.
  function preTick(sample) {
    const station = nearestStation()
    const dx = door.pos[0] - state.pos.x
    const dz = door.pos[1] - state.pos.z
    nearDoor = dx * dx + dz * dz <= door.radius * door.radius
    const interactEdge = sample.interact && !prevInteract
    prevInteract = sample.interact
    sample.equip = interactEdge && station ? station.weapon : null
    if (interactEdge && nearDoor) onOpenLobby()
    // prompt copy (door beats the racks — it's the room's headline)
    const promptEl = document.getElementById('prompt')
    const text = nearDoor
      ? '<b>E</b> — VS BOTS <span class="dim">· capture &amp; bomb</span>'
      : promptFor(station)
    if (text) {
      promptEl.innerHTML = text
      promptEl.hidden = false
    } else {
      promptEl.hidden = true
    }
  }

  function tick(sample, dt) {
    prev = { x: state.pos.x, y: state.pos.y, z: state.pos.z, eye: state.eyeY }
    sample.moveScale = loadout.moveScale
    stepPlayer(state, sample, dt, CONFIG, world)
    const events = stepLoadout(loadout, sample, state, CONFIG, world, dt)
    for (const ev of events) {
      if (ev.type === 'shot') {
        dbg.record(ev)
        gun.onEvent(ev)
        viewmodel.onEvent(ev) // viewmodel kick + shotgun pump cycle
        // damage glue: aggregate the blast's pellets per dummy — ONE hp hit
        // per target per blast (the popup shows the blast total, the zone
        // that caught the most pellets lights up)
        const byTarget = new Map()
        for (const p of ev.pellets) {
          const h = p.hit
          if (!h || h.kind !== 'target') continue
          let agg = byTarget.get(h.targetId)
          if (!agg) {
            agg = { dmg: 0, zones: {} }
            byTarget.set(h.targetId, agg)
          }
          agg.dmg += h.damage
          agg.zones[h.zone] = (agg.zones[h.zone] || 0) + 1
        }
        for (const [id, agg] of byTarget) {
          let zone = 'body'
          let zoneCount = -1
          for (const z in agg.zones) {
            if (agg.zones[z] > zoneCount) {
              zoneCount = agg.zones[z]
              zone = z
            }
          }
          const r = hurtTargets(targets, id, agg.dmg, CONFIG)
          if (r) {
            dummiesFx.onHit(id, zone, agg.dmg, r.hp / Math.max(CONFIG.dummies.hp, 1e-6), ev.aim.x, ev.aim.z)
            if (r.killed) dummiesFx.onKilled(id, ev.aim.x, ev.aim.z)
          }
        }
        continue
      }
      gun.onEvent(ev)
      viewmodel.onEvent(ev) // reload/switch viewmodel feedback too
    }
    for (const ev of stepTargets(targets, CONFIG, dt)) {
      if (ev.type === 'respawn') dummiesFx.onRespawn(ev.id)
    }
  }

  function update(dt, acc, sample) {
    const w = activeWeapon(loadout)

    // camera: interpolate between the last two sim ticks + recoil + sway
    camera.position.set(
      prev.x + (state.pos.x - prev.x) * acc,
      prev.y + (state.pos.y - prev.y) * acc + prev.eye + (state.eyeY - prev.eye) * acc,
      prev.z + (state.pos.z - prev.z) * acc
    )
    camera.rotation.y = input.view.yaw + (w.recoil.yaw + loadout.sway.yaw) * DEG2RAD
    camera.rotation.x = input.view.pitch + (w.recoil.pitch + loadout.sway.pitch) * DEG2RAD

    dummiesFx.tick(dt)
    hud.update(state, sample, loadout, targets)
    thermal.setTargets(RANGE.targets.filter((t) => targets.byId[t.id]?.alive !== false))
  }

  function enter() {
    thermal.setWorld(world.boxes)
    scene.setSunTarget(12, 0, 26)
  }

  // coming back from a match: land in the corridor by the door, facing east
  function returnFromMatch() {
    state.pos.x = door.return.pos[0]
    state.pos.y = door.return.pos[1]
    state.pos.z = door.return.pos[2]
    state.vel.x = state.vel.y = state.vel.z = 0
    input.view.yaw = door.return.yaw
    input.view.pitch = 0
    prev = { x: state.pos.x, y: state.pos.y, z: state.pos.z, eye: state.eyeY }
  }

  return {
    world, state, loadout, targets, stations,
    hasMatch: false,
    isArena: false,
    isDead: () => false,
    preTick, tick, update, enter, returnFromMatch,
  }
}
