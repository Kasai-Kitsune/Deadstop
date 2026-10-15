// client/main.js — boot + shared services + the session switch + the loop.
// The sim runs at a fixed tick (64 Hz start); rendering is rAF with the camera
// interpolated between the last two sim states.
//
// M3b: the game is MULTI-MAP now. Two sessions sit behind one interface —
//   hub-session.js   the movement room + range (M1–M3 behavior, unchanged)
//   arena-session.js a VS-bots Capture & Bomb match on HOLMGANG
// main owns everything SHARED (scene, input, HUD chrome, the debug panel,
// the viewmodel pass, the thermal composite) and swaps sessions when the
// player launches a match from the corridor's VS door (lobby.js) or leaves
// one (M key / the pause card). All map statics are built once at boot —
// the arena sits ~600 m east of the hub, past the far plane and opaque in
// the fog, so the two maps never see each other.

import { CONFIG, TUNING_RANGES } from '../config.js'
import { activeWeapon } from '../sim/index.js'
import { ROOM } from '../maps/movement-room.js'
import { RANGE } from '../maps/firing-range.js'
import { ARENA } from '../maps/arena.js'
import { createScene, buildRoom } from './scene.js'
import { buildSigns } from './signs.js'
import { buildDummies } from './dummies.js'
import { createThermal } from './thermal.js'
import { createHud } from './hud.js'
import { createPanel } from './panel.js'
import { createInput } from './input.js'
import { createWeaponView } from './weapon-view.js'
import { createViewmodel } from './viewmodel.js'
import { createDebugOverlay } from './debug-overlay.js'
import { createScoreboard } from './scoreboard.js'
import { createLobby } from './lobby.js'
import { createHubSession } from './hub-session.js'
import { createArenaSession } from './arena-session.js'

const DEG2RAD = Math.PI / 180
const MAX_FRAME_DT = 0.1 // stability clamp (spiral-of-death guard) — engine plumbing, not a tunable
const MAX_CATCHUP_TICKS = 8

// ---- boot: one scene, every map's statics
const scene = createScene(document.getElementById('app'))
buildRoom(scene.scene, ROOM)
buildSigns(scene.scene, ROOM.signs)
buildRoom(scene.scene, RANGE)
buildSigns(scene.scene, RANGE.signs)
buildRoom(scene.scene, ARENA)
buildSigns(scene.scene, ARENA.signs)
const dummiesFx = buildDummies(scene.scene, RANGE.targets)

// ---- shared services (every session gets these)
const viewmodel = createViewmodel()
viewmodel.resize(window.innerWidth, window.innerHeight) // aspect at boot, not just on resize
const thermal = createThermal({ renderer: scene.renderer, camera: scene.camera })
const hud = createHud()
const panel = createPanel({ config: CONFIG, ranges: TUNING_RANGES })
const input = createInput({
  canvas: scene.renderer.domElement,
  onLockChange: refreshChrome,
  onFallback: refreshChrome,
  onEscapeFallback: () => pause(),
})
const gun = createWeaponView({ scene: scene.scene, camera: scene.camera, viewmodel })
const dbgOverlay = createDebugOverlay({ getLoadout: () => session.loadout })
const scoreboard = createScoreboard()

const services = {
  scene, camera: scene.camera, input, thermal, hud, gun, dbg: dbgOverlay, scoreboard, viewmodel,
}

// ---- sessions
const hub = createHubSession({ services, dummiesFx, onOpenLobby: openLobby })
let session = hub
let lobby = null
hub.enter()

function switchSession(next) {
  session.leave?.()
  session = next
  session.enter()
  document.body.classList.toggle('in-match', !!session.hasMatch)
}

function openLobby() {
  if (session.isArena || (lobby && lobby.isOpen())) return
  if (document.pointerLockElement) document.exitPointerLock()
  if (!lobby) lobby = createLobby({ onLaunch, onCancel: () => refreshChrome() })
  lobby.open()
  refreshChrome()
}

function onLaunch(setup) {
  lobby.close()
  const arena = createArenaSession({ setup, services, onLeave: leaveMatch })
  switchSession(arena)
  arena.start()
  paused = false
  if (!input.isFallback()) input.tryLock()
  refreshChrome()
}

function leaveMatch() {
  if (!session.isArena) return
  switchSession(hub)
  hub.returnFromMatch()
  pause() // the card lets the player re-lock at their own click
}

// ---- pause + chrome (the one place that decides what's on screen)
const overlay = document.getElementById('overlay')
const overlayNote = document.getElementById('overlay-note')
const leaveBtn = document.getElementById('leave-match')
let paused = true // begins on the click-to-enter card

leaveBtn.addEventListener('click', (e) => {
  e.stopPropagation()
  leaveMatch()
})

function pause() {
  paused = true
  refreshChrome()
}

function refreshChrome() {
  const busy = (lobby && lobby.isOpen()) || panel.isOpen()
  if (!paused && !busy && (input.isLocked() || input.isFallback())) {
    overlay.hidden = true
    return
  }
  if (busy) {
    overlay.hidden = true
    return
  }
  overlay.hidden = false
  leaveBtn.hidden = !session.isArena
  overlayNote.textContent = input.isFallback()
    ? 'Pointer lock unavailable here — drag to look (Esc pauses).'
    : session.isArena
      ? 'Match paused — the round keeps running for the bots.'
      : ''
}

window.addEventListener('keydown', (e) => {
  if (e.target.closest?.('textarea')) return
  if (e.code === 'Backquote') {
    e.preventDefault()
    panel.toggle()
    refreshChrome()
  } else if (e.code === 'F3' || e.code === 'KeyV') {
    e.preventDefault()
    dbgOverlay.toggle()
  } else if (e.code === 'KeyM' && session.isArena) {
    leaveMatch()
  }
})
overlay.addEventListener('click', () => {
  paused = false
  if (!input.isFallback()) input.tryLock()
  refreshChrome()
})
window.addEventListener('resize', () => {
  scene.resize()
  thermal.resize(window.innerWidth, window.innerHeight)
  viewmodel.resize(window.innerWidth, window.innerHeight)
})

// E2E / tuning hook: exposes live handles for scripted checks (agent-browser)
window.__game = {
  input,
  CONFIG,
  scene: scene.scene,
  camera: scene.camera,
  viewmodel,
  session: () => session,
  hub: () => hub,
  arena: () => (session.isArena ? session : null),
  lobby: () => lobby,
  scoreboard,
  state: () => session.state,
  loadout: () => session.loadout,
  weapon: () => activeWeapon(session.loadout),
  targets: () => session.targets || null,
  dummies: () => (session.targets ? session.targets : null),
  leaveMatch,
}

// ---- the loop
let acc = 0
let last = performance.now()

function frame(t) {
  const dt = Math.min(Math.max((t - last) / 1000, 0), MAX_FRAME_DT)
  last = t

  // one input sample per frame; every tick within the frame uses it.
  // While paused (enter card / lobby) the weapons stay holstered — clicking
  // through chrome must never fire a round behind it.
  const sample = input.sample()
  const busy = paused || (lobby && lobby.isOpen())
  if (busy) {
    sample.fire = false
    sample.reload = false
    sample.scope = false
    sample.switchTo = null
    sample.equip = null
    sample.interact = false
    if (paused) document.getElementById('prompt').hidden = true
  } else {
    session.preTick?.(sample)
  }

  const tick = 1 / CONFIG.sim.tickRate
  acc = Math.min(acc + dt, tick * MAX_CATCHUP_TICKS)
  while (acc >= tick) {
    // one bad tick must not brick the loop: log it (the E2E trap reads it),
    // skip the catch-up backlog, keep rendering
    try {
      session.tick(sample, tick)
    } catch (err) {
      window.__errs?.push('TICK ' + (err && err.message ? err.message : err))
      acc = 0
      break
    }
    acc -= tick
  }

  session.update(dt, acc / tick, sample)

  // ---- shared view state (scope zoom, fog cut, far plane) from the active
  // session's loadout — the hub and the arena read identically here
  const loadout = session.loadout
  const s = loadout.scopeT
  const sEase = s * s * (3 - 2 * s)
  const wantFov = CONFIG.view.fovDeg + (CONFIG.scope.fovDeg - CONFIG.view.fovDeg) * sEase
  if (Math.abs(scene.camera.fov - wantFov) > 1e-6) {
    scene.camera.fov = wantFov
    scene.camera.updateProjectionMatrix()
  }
  input.setZoomScale(1 + (wantFov / CONFIG.view.fovDeg - 1) * CONFIG.scope.zoomSens)
  input.setSlotInfo(loadout.active, loadout.slots.length)
  const wantFog = CONFIG.fog.density * (1 + (CONFIG.scope.fogMult - 1) * s)
  if (Math.abs(scene.scene.fog.density - wantFog) > 1e-9) scene.scene.fog.density = wantFog
  if (scene.camera.far !== CONFIG.view.cameraFarM) {
    scene.camera.far = CONFIG.view.cameraFarM
    scene.camera.updateProjectionMatrix()
  }

  // local-player chrome: dead hides the crosshair; Tab holds the scoreboard
  document.body.classList.toggle('dead', !!session.isDead?.())
  scoreboard.showScoreboard(!!session.hasMatch && input.isDown('Tab'))

  gun.update(dt, { loadout })
  viewmodel.update(dt, { loadout, view: input.view, state: session.state, dead: !!session.isDead?.() })
  dbgOverlay.update(session.state)

  // render passes: world (fogged, zoomed) -> viewmodel overlay (no wall
  // clipping) -> thermal composite while scoping
  scene.renderer.render(scene.scene, scene.camera)
  viewmodel.render(scene.renderer)
  if (s > 0.001) thermal.apply(s, t / 1000)
  requestAnimationFrame(frame)
}

document.body.classList.toggle('in-match', false)
refreshChrome()
requestAnimationFrame(frame)
