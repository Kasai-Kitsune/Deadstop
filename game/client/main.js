// client/main.js — boot + game loop. The sim runs at a fixed tick (64 Hz start);
// rendering is rAF with the camera interpolated between the last two sim states,
// so a 64 Hz sim still looks smooth on high-refresh displays.
//
// M2: the weapon sim ticks right after the player sim (it reads fresh speed,
// stance, and eye position), and its events drive the firing FX, target
// flashes, and the F3 overlay. Recoil lives in the sim and is added to the
// camera here — the crosshair stays screen-center, so it always marks where
// shots actually go.
//
// M2+: the weapon is a LOADOUT (carry-2, switching, scope state, sway — sway is
// sim-side so the dot, the camera, and the shot all agree), dummies are killable
// sim state mirrored into topple/respawn FX, and scoped rendering runs the
// thermal post pass (fog density x scope.fogMult, heat mask, green ramp). No
// viewmodels: weapon-view.js is pure firing FX (no gun models requested yet).

import { CONFIG, TUNING_RANGES } from '../config.js'
import {
  createPlayer,
  stepPlayer,
  createLoadout,
  stepLoadout,
  activeWeapon,
  createTargets,
  stepTargets,
  hurtTargets,
} from '../sim/index.js'
import { ROOM } from '../maps/movement-room.js'
import { RANGE } from '../maps/firing-range.js'
import { createScene, buildRoom } from './scene.js'
import { buildSigns } from './signs.js'
import { buildDummies } from './dummies.js'
import { createThermal } from './thermal.js'
import { createHud } from './hud.js'
import { createPanel } from './panel.js'
import { createInput } from './input.js'
import { createWeaponView } from './weapon-view.js'
import { createDebugOverlay } from './debug-overlay.js'

const DEG2RAD = Math.PI / 180
const MAX_FRAME_DT = 0.1 // stability clamp (spiral-of-death guard) — engine plumbing, not a tunable
const MAX_CATCHUP_TICKS = 8

const scene = createScene(document.getElementById('app'))
buildRoom(scene.scene, ROOM)
buildRoom(scene.scene, RANGE)
buildSigns(scene.scene, RANGE.signs)
const dummiesFx = buildDummies(scene.scene, RANGE.targets)

// one world for the whole sim: M1 room + M2 range; targets ride along as
// hitboxes (hit by rays, never blocking movement — they're board targets),
// and targetActive pulls them out of hitreg while they're down
const targets = createTargets(RANGE.targets, CONFIG)
const WORLD = {
  boxes: [...ROOM.boxes, ...RANGE.boxes],
  targets: RANGE.targets,
  targetActive: (t) => targets.byId[t.id]?.alive !== false,
}

const state = createPlayer(ROOM.spawn, CONFIG)
const loadout = createLoadout(CONFIG)
const hud = createHud()
const panel = createPanel({ config: CONFIG, ranges: TUNING_RANGES })
const gun = createWeaponView({ scene: scene.scene, camera: scene.camera })
const thermal = createThermal({
  renderer: scene.renderer,
  camera: scene.camera,
  targetDefs: RANGE.targets,
  worldBoxes: WORLD.boxes,
})
const dbgOverlay = createDebugOverlay({ getLoadout: () => loadout })

const overlay = document.getElementById('overlay')
const overlayNote = document.getElementById('overlay-note')

let paused = true // begins on the click-to-enter card
const input = createInput({
  canvas: scene.renderer.domElement,
  onLockChange: refreshChrome,
  onFallback: refreshChrome,
  onEscapeFallback: pause,
})
input.view.yaw = ROOM.spawn.yaw

window.addEventListener('keydown', (e) => {
  if (e.target.closest?.('textarea')) return
  if (e.code === 'Backquote') {
    e.preventDefault()
    panel.toggle()
    refreshChrome()
  } else if (e.code === 'F3' || e.code === 'KeyV') {
    e.preventDefault()
    dbgOverlay.toggle()
  }
})
overlay.addEventListener('click', () => {
  paused = false
  if (!input.isFallback()) input.tryLock()
  refreshChrome()
})
// Safety net for Ctrl+W: browsers never let a page block it, but they do let a
// page ask "Leave site?" before the tab closes. Only while actually playing.
window.addEventListener('beforeunload', (e) => {
  if (!paused) {
    e.preventDefault()
    e.returnValue = ''
  }
})
window.addEventListener('resize', () => {
  scene.resize()
  thermal.resize(window.innerWidth, window.innerHeight)
})

// E2E / tuning hook: exposes live handles for scripted checks (agent-browser)
window.__game = {
  input, state, loadout, targets,
  weapon: () => activeWeapon(loadout),
  scene: scene.scene, camera: scene.camera, CONFIG,
}

function pause() {
  paused = true
  refreshChrome()
}

// one place that decides what chrome (overlay card) is on screen
function refreshChrome() {
  if (!paused && (input.isLocked() || input.isFallback())) {
    overlay.hidden = true
    return
  }
  if (panel.isOpen()) {
    overlay.hidden = true
    return
  }
  overlay.hidden = false
  overlayNote.textContent = input.isFallback()
    ? 'Pointer lock unavailable here — drag to look (Esc pauses).'
    : ''
}

// -- interpolation state (render-only; the sim itself stays pure)
let prev = { x: state.pos.x, y: state.pos.y, z: state.pos.z, eye: state.eyeY }
let acc = 0
let last = performance.now()
let lastSample = input.sample()

function frame(t) {
  const dt = Math.min(Math.max((t - last) / 1000, 0), MAX_FRAME_DT)
  last = t

  // one input sample per frame; every tick within the frame uses it.
  // While paused (enter card up) the weapon stays holstered — clicking the
  // card must not fire a round behind it.
  lastSample = input.sample()
  if (paused) {
    lastSample.fire = false
    lastSample.reload = false
    lastSample.scope = false
    lastSample.switchTo = null
  }
  const tick = 1 / CONFIG.sim.tickRate
  acc = Math.min(acc + dt, tick * MAX_CATCHUP_TICKS)

  while (acc >= tick) {
    prev = { x: state.pos.x, y: state.pos.y, z: state.pos.z, eye: state.eyeY }
    // scoped slow-walk: the loadout's moveScale from the previous tick (one
    // tick of latency; deterministic and imperceptible at 64 Hz)
    lastSample.moveScale = loadout.moveScale
    stepPlayer(state, lastSample, tick, CONFIG, WORLD)
    const events = stepLoadout(loadout, lastSample, state, CONFIG, WORLD, tick)
    for (const ev of events) {
      if (ev.type === 'shot') {
        dbgOverlay.record(ev)
        gun.onEvent(ev)
        if (ev.hit && ev.hit.kind === 'target') {
          // damage -> dummy HP/death (sim targets module owns health)
          const r = hurtTargets(targets, ev.hit.targetId, ev.hit.damage, CONFIG)
          if (r) {
            dummiesFx.onHit(
              ev.hit.targetId, ev.hit.zone, ev.hit.damage,
              r.hp / Math.max(CONFIG.dummies.hp, 1e-6),
              ev.dir.x, ev.dir.z
            )
            if (r.killed) {
              dummiesFx.onKilled(ev.hit.targetId, ev.dir.x, ev.dir.z)
              thermal.setAlive(ev.hit.targetId, false) // no heat off a corpse
            }
          }
        }
        continue
      }
      gun.onEvent(ev)
    }
    const targetEvents = stepTargets(targets, CONFIG, tick)
    for (const ev of targetEvents) {
      if (ev.type === 'respawn') {
        dummiesFx.onRespawn(ev.id)
        thermal.setAlive(ev.id, true)
      }
    }
    acc -= tick
  }

  const weapon = activeWeapon(loadout)

  // camera: interpolate position + eye height between the last two sim ticks,
  // then add the sim's recoil + scope sway on top (degrees -> radians). The
  // crosshair/red dot stays screen-center, so it always marks where shots go.
  const a = acc / tick
  scene.camera.position.set(
    prev.x + (state.pos.x - prev.x) * a,
    prev.y + (state.pos.y - prev.y) * a + prev.eye + (state.eyeY - prev.eye) * a,
    prev.z + (state.pos.z - prev.z) * a
  )
  scene.camera.rotation.y = input.view.yaw + (weapon.recoil.yaw + loadout.sway.yaw) * DEG2RAD
  scene.camera.rotation.x = input.view.pitch + (weapon.recoil.pitch + loadout.sway.pitch) * DEG2RAD

  // live FOV + fog + far plane (sliders) — only touch state when it changed.
  // FOV lerps into the scope's narrow FOV by scopeT (smoothstep so the zoom
  // accelerates through the middle, like a real sight picture coming up).
  const s = loadout.scopeT
  const sEase = s * s * (3 - 2 * s)
  const wantFov = CONFIG.view.fovDeg + (CONFIG.scope.fovDeg - CONFIG.view.fovDeg) * sEase
  if (Math.abs(scene.camera.fov - wantFov) > 1e-6) {
    scene.camera.fov = wantFov
    scene.camera.updateProjectionMatrix()
  }
  // mouse sensitivity follows the zoom (scope.zoomSens mixes how much)
  input.setZoomScale(1 + (wantFov / CONFIG.view.fovDeg - 1) * CONFIG.scope.zoomSens)
  input.setSlotInfo(loadout.active, loadout.slots.length)
  // fog: density x lerp(1, scope.fogMult, scopeT) — the §8 scope fog cut.
  // Client render effect only; hit registration never sees it.
  const wantFog = CONFIG.fog.density * (1 + (CONFIG.scope.fogMult - 1) * s)
  if (Math.abs(scene.scene.fog.density - wantFog) > 1e-9) scene.scene.fog.density = wantFog
  if (scene.camera.far !== CONFIG.view.cameraFarM) {
    scene.camera.far = CONFIG.view.cameraFarM
    scene.camera.updateProjectionMatrix()
  }

  dummiesFx.tick(dt)
  gun.update(dt, { loadout })
  dbgOverlay.update(state)
  hud.update(state, lastSample, loadout, targets)

  // render passes: world (fogged, zoomed) -> thermal composite while scoping.
  // No viewmodel pass — there are no gun models yet.
  scene.renderer.render(scene.scene, scene.camera)
  if (s > 0.001) thermal.apply(s, t / 1000)
  requestAnimationFrame(frame)
}

refreshChrome()
requestAnimationFrame(frame)
