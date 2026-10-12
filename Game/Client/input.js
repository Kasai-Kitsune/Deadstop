// client/input.js — key/mouse sampling, pointer lock, and a drag-look fallback
// for hosts that refuse pointer lock (some embedded previews). Look angles are
// client-owned; yaw + pitch are handed to the sim as part of the sampled input
// (the weapon needs both to aim, and the M4 server will receive them too).
//
// M2+: RMB is the sniper's scope hold, 1/2/Q/mouse-wheel switch weapons, and
// mouse sensitivity scales with the current FOV while scoped (main sets the
// scale each frame) so 4x zoom doesn't turn into 4x turn speed.

import { CONFIG } from '../config.js'

const DEG2RAD = Math.PI / 180

export function createInput(events) {
  const keys = new Set()
  const view = { yaw: 0, pitch: 0 }
  let locked = false
  let fallback = false
  let dragging = false
  let mouse0 = false // left button held (fire)
  let mouse2 = false // right button held (scope)
  let pendingWheel = 0 // signed wheel steps not yet consumed by a sample
  let slotActive = 0 // mirrored from the loadout so wheel cycling knows where it is
  let slotCount = 2 // classic carry-2
  let zoomScale = 1 // 1 = unscoped; main sets lerp(1, fov/baseFov, scope.zoomSens)

  const clampPitch = () => {
    const lim = CONFIG.view.maxPitchDeg * DEG2RAD
    if (view.pitch > lim) view.pitch = lim
    if (view.pitch < -lim) view.pitch = -lim
  }

  const applyLook = (mx, my) => {
    const s = CONFIG.view.mouseSensDegPerPx * DEG2RAD * zoomScale
    view.yaw -= mx * s
    view.pitch -= my * s
    clampPitch()
  }

  const onKeyDown = (e) => {
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault()
    if (e.repeat) return
    keys.add(e.code)
    if (e.code === 'Escape' && fallback && !e.target.closest?.('textarea')) events.onEscapeFallback()
  }
  const onKeyUp = (e) => keys.delete(e.code)

  const onMouseMove = (e) => {
    if (locked || (fallback && dragging)) applyLook(e.movementX, e.movementY)
  }
  const onMouseDown = (e) => {
    if (e.button === 0) {
      mouse0 = true
      if (fallback) dragging = true
    } else if (e.button === 2) {
      mouse2 = true
    }
  }
  const onMouseUp = (e) => {
    if (e.button === 0) {
      mouse0 = false
      dragging = false
    } else if (e.button === 2) {
      mouse2 = false
    }
  }
  const onWheel = (e) => {
    if (locked || fallback) pendingWheel += Math.sign(e.deltaY)
  }
  // keep the context menu from popping while scoping with RMB
  events.canvas.addEventListener('contextmenu', (e) => e.preventDefault())

  const onLockChange = () => {
    locked = document.pointerLockElement === events.canvas
    events.onLockChange(locked)
  }

  // window-level so the game reacts even when the canvas lacks focus
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  window.addEventListener('mousemove', onMouseMove)
  window.addEventListener('mouseup', onMouseUp)
  window.addEventListener('wheel', onWheel, { passive: true })
  events.canvas.addEventListener('mousedown', onMouseDown)
  document.addEventListener('pointerlockchange', onLockChange)

  return {
    view,
    isLocked: () => locked,
    isFallback: () => fallback,
    isDragging: () => dragging,

    // main mirrors the loadout each frame so wheel cycling starts from the gun in hand
    setSlotInfo(active, count) {
      slotActive = active
      slotCount = Math.max(1, count)
    },
    // main sets this every frame: lerp(1, currentFov / baseFov, scope.zoomSens)
    setZoomScale(v) {
      zoomScale = v > 0.01 ? v : 0.01
    },

    // one sample per rendered frame; every sim tick within that frame uses it
    sample() {
      // weapon switching intent: wheel > explicit slot > toggle-last (Q)
      let switchTo = null
      if (pendingWheel !== 0) {
        switchTo = (slotActive + (pendingWheel > 0 ? 1 : -1) + slotCount) % slotCount
        pendingWheel = 0
      } else if (keys.has('Digit1')) {
        switchTo = 0
      } else if (keys.has('Digit2')) {
        switchTo = 1
      } else if (keys.has('KeyQ')) {
        switchTo = 'toggle'
      }
      return {
        mx: (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0),
        mz: (keys.has('KeyW') ? 1 : 0) - (keys.has('KeyS') ? 1 : 0),
        yaw: view.yaw,
        pitch: view.pitch,
        jump: keys.has('Space'),
        // C is the safe crouch key; Ctrl also works but Ctrl+W is reserved by browsers
        crouch: keys.has('KeyC') || keys.has('ControlLeft') || keys.has('ControlRight'),
        walk: keys.has('ShiftLeft') || keys.has('ShiftRight'),
        // fire while the left button is held: pointer-locked normally; in the
        // drag-look fallback the same hold both looks and fires (degraded but testable)
        fire: mouse0 && (locked || (fallback && dragging)),
        reload: keys.has('KeyR'),
        // RMB holds the scope (sniper only — the sim decides if the gun can)
        scope: mouse2 && (locked || fallback),
        switchTo,
      }
    },

    tryLock() {
      const canvas = events.canvas
      const p = canvas.requestPointerLock()
      if (p && typeof p.catch === 'function') {
        p.catch(() => enableFallback())
      }
      // some hosts fail silently: if no lock event arrives, fall back
      setTimeout(() => {
        if (!locked && !fallback) enableFallback()
      }, 600)
    },

    enableFallback,
    destroy() {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      window.removeEventListener('wheel', onWheel)
      events.canvas.removeEventListener('mousedown', onMouseDown)
      document.removeEventListener('pointerlockchange', onLockChange)
    },
  }

  function enableFallback() {
    if (fallback) return
    fallback = true
    events.onFallback()
  }
}
