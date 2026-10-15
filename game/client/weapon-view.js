// client/weapon-view.js — the firing feedback layer: tracers, the muzzle
// flash at a VIRTUAL muzzle point, persistent impact marks, the dynamic
// crosshair (spec §5: hip fire, crosshair reflects live spread), and the hit
// marker.
//
// M3b: gun meshes are back (client/viewmodel.js) — when available, tracers
// and the flash launch from the viewmodel's ACTUAL muzzle (camera-space
// anchor provided by that module), falling back to the virtual-muzzle table
// below until the GLBs finish loading. Remote shooters (bots) pass a WORLD
// muzzle to onEvent: they get tracers and impact marks, never the local
// player's hit marker or screen flash.
//
// FX amplitudes below are art-direction constants (scene.js precedent);
// every gameplay number this file touches lives in config.js.

import * as THREE from 'three'
import { CONFIG } from '../config.js'

const DEG2RAD = Math.PI / 180

// presentation constants — art direction (M6), not gameplay tunables
const FX = {
  muzzleFlashSize: 0.17,
  muzzleLightColor: 0xffcf9e,
  muzzleLightIntensity: 7,
  tracerColor: 0xe8c9a0,
  tracerWidth: 0.014,
  markColor: 0x26241f,
  markLift: 0.004, // lift marks off the surface so they don't z-fight
}

// Virtual muzzle: where tracers and the flash launch from, in CAMERA space
// (right, up, forward) — roughly where a carried weapon's barrel would sit.
// No model renders there; it only anchors the FX so shots visibly leave the
// player instead of the eye point. Per-weapon so a shotgun blast fans out
// from a slightly different anchor than an SMG burst.
const MUZZLE = {
  ar: [0.22, -0.18, -0.55],
  smg: [0.2, -0.16, -0.5],
  shotgun: [0.24, -0.2, -0.62],
  sniper: [0.24, -0.2, -0.85],
}

const TRACER_POOL = 24
const MARK_POOL = 160 // ~16 s of full-auto history — enough to read a grouping

export function createWeaponView({ scene, camera, viewmodel }) {
  // muzzle flash: two crossed additive quads, shown for the firing weapon's
  // muzzleTime. Lives in the MAIN scene at the virtual muzzle (billboarded to
  // the camera each frame) — with no viewmodel pass left, the main scene is
  // the only place it can glow.
  const flashMat = new THREE.MeshBasicMaterial({
    color: 0xffd9a0,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  })
  const flashA = new THREE.Mesh(new THREE.PlaneGeometry(FX.muzzleFlashSize, FX.muzzleFlashSize), flashMat)
  const flashB = flashA.clone()
  flashB.rotation.z = Math.PI / 4
  const flashGroup = new THREE.Object3D()
  flashGroup.add(flashA, flashB)
  flashGroup.visible = false
  scene.add(flashGroup)

  // muzzle light (main scene) so the flash still spills onto nearby walls
  const muzzleLight = new THREE.PointLight(FX.muzzleLightColor, 0, 8)
  scene.add(muzzleLight)

  // ---- tracers (main scene)
  const tracers = []
  for (let i = 0; i < TRACER_POOL; i++) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(FX.tracerWidth, FX.tracerWidth, 1),
      new THREE.MeshBasicMaterial({
        color: FX.tracerColor,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    )
    mesh.visible = false
    scene.add(mesh)
    tracers.push({ mesh, t: 0, time: 1 })
  }
  let tracerNext = 0

  // ---- impact marks: persistent dark discs (ring buffer) so you can read
  //      your grouping on the wall after a burst
  const marks = []
  for (let i = 0; i < MARK_POOL; i++) {
    const mesh = new THREE.Mesh(
      new THREE.CircleGeometry(1, 10),
      new THREE.MeshBasicMaterial({
        color: FX.markColor,
        transparent: true,
        opacity: 0.85,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      })
    )
    mesh.visible = false
    scene.add(mesh)
    marks.push(mesh)
  }
  let markNext = 0

  // ---- DOM: crosshair ticks + hit marker
  const xhair = document.getElementById('xhair')
  xhair.innerHTML = '<div class="dot"></div><i class="tk tk-u"></i><i class="tk tk-d"></i><i class="tk tk-l"></i><i class="tk tk-r"></i>'
  const ticks = {
    u: xhair.querySelector('.tk-u'),
    d: xhair.querySelector('.tk-d'),
    l: xhair.querySelector('.tk-l'),
    r: xhair.querySelector('.tk-r'),
  }
  const hitmark = document.getElementById('hitmark')

  // ---- animation state
  let flashT = 0
  let flashTime = 0.05
  let hitT = 0
  const pending = [] // shots waiting for a fresh camera pose (spawned in update)
  const tmpV = new THREE.Vector3()
  const tmpOff = new THREE.Vector3()
  const tmpEnd = new THREE.Vector3()

  function onEvent(ev, muzzleWorld) {
    // shots queue until the camera is posed for this frame; the per-pellet
    // FX (tracer/mark/hitmarker) spawn in update where the pose is fresh.
    // muzzleWorld (bots) marks the shot REMOTE: feedback only, no HUD marks.
    if (ev.type === 'shot') pending.push({ ev, muzzle: muzzleWorld || null })
    // reload / dry-fire feedback is the HUD's job
  }

  function update(dt, ctx) {
    const { loadout } = ctx
    const w = loadout.slots[loadout.active]
    const W = CONFIG.weapons[w.id] // live — panel edits apply immediately

    // body.scoped drives the CSS swap: crosshair out, red dot in (the scope
    // tube + thermal treatment are thermal.js's passes)
    document.body.classList.toggle('scoped', loadout.scoped)

    // spawn queued shots now that the camera is posed for this frame.
    // M3: a shot carries PELLETS (one for most guns, eight for the shotgun) —
    // each pellet draws its own tracer + impact mark; the hit marker fires
    // ONCE per blast (head-colored if any pellet caught a head).
    for (const job of pending) {
      const ev = job.ev
      const remote = !!job.muzzle
      const evW = CONFIG.weapons[ev.weapon] || W
      if (remote) {
        tmpOff.set(job.muzzle.x, job.muzzle.y, job.muzzle.z)
      } else {
        const vmMuzzle = viewmodel && viewmodel.muzzleCamSpace(ev.weapon)
        const off = vmMuzzle || MUZZLE[ev.weapon] || MUZZLE.ar
        tmpOff.set(off.x ?? off[0], off.y ?? off[1], off.z ?? off[2]).applyQuaternion(camera.quaternion).add(camera.position)
      }
      let anyTarget = false
      let anyHead = false
      for (const p of ev.pellets) {
        if (p.hit) {
          tmpEnd.set(p.hit.point.x, p.hit.point.y, p.hit.point.z)
          spawnMark(p.hit.point, p.hit.normal, evW.impactMarkSize)
        } else {
          tmpEnd.set(
            ev.origin.x + p.dir.x * evW.maxRange,
            ev.origin.y + p.dir.y * evW.maxRange,
            ev.origin.z + p.dir.z * evW.maxRange
          )
        }
        if (tmpOff.distanceTo(tmpEnd) > 0.5) spawnTracer(tmpOff, tmpEnd, evW.tracerTime)
        if (p.hit && p.hit.kind === 'target') {
          anyTarget = true
          if (p.hit.zone === 'head') anyHead = true
        }
      }
      if (anyTarget && !remote) {
        hitT = 1
        hitmark.classList.toggle('head', anyHead)
      }
      if (evW.muzzleTime > 0 && !remote) {
        flashT = evW.muzzleTime
        flashTime = evW.muzzleTime
        flashGroup.position.copy(tmpOff)
        flashGroup.rotation.z = Math.random() * Math.PI // presentation-only random
        muzzleLight.position.copy(tmpOff)
      }
    }
    pending.length = 0

    // muzzle flash + light decay; the quads ride the camera orientation so
    // they always face the viewer
    if (flashT > 0) {
      flashT = Math.max(0, flashT - dt)
      const f = flashTime > 0 ? flashT / flashTime : 0
      flashGroup.visible = flashT > 0
      flashGroup.quaternion.copy(camera.quaternion)
      flashMat.opacity = Math.min(1, f * 1.6)
      muzzleLight.intensity = FX.muzzleLightIntensity * f
    } else {
      flashGroup.visible = false
      muzzleLight.intensity = 0
    }

    // tracer fade
    for (const t of tracers) {
      if (t.t <= 0) continue
      t.t -= dt
      const f = Math.max(0, t.t / Math.max(t.time, 1e-4))
      t.mesh.material.opacity = f * 0.9
      if (t.t <= 0) t.mesh.visible = false
    }

    // hit marker fade
    if (hitT > 0) {
      hitT = Math.max(0, hitT - dt / 0.18)
      hitmark.style.opacity = hitT.toFixed(3)
    }

    // crosshair: gap in pixels from the live spread cone at the current FOV
    // (hidden by CSS while scoped — the red dot replaces it)
    const rad = w.spread * DEG2RAD
    const halfFov = (camera.fov * 0.5) * DEG2RAD
    const px2 = Math.max(5, (Math.tan(rad) / Math.tan(halfFov)) * (window.innerHeight / 2))
    ticks.u.style.transform = `translate(-50%, -50%) translateY(${-px2}px)`
    ticks.d.style.transform = `translate(-50%, -50%) translateY(${px2}px)`
    ticks.l.style.transform = `translate(-50%, -50%) translateX(${-px2}px)`
    ticks.r.style.transform = `translate(-50%, -50%) translateX(${px2}px)`
  }

  function spawnTracer(from, to, time) {
    const t = tracers[tracerNext]
    tracerNext = (tracerNext + 1) % tracers.length
    const len = from.distanceTo(to)
    t.mesh.position.copy(from).add(to).multiplyScalar(0.5)
    t.mesh.lookAt(to)
    t.mesh.scale.set(1, 1, len)
    t.mesh.visible = true
    t.time = time
    t.t = time
    t.mesh.material.opacity = 0.9
  }

  function spawnMark(point, normal, size) {
    if (size <= 0) return
    const mesh = marks[markNext]
    markNext = (markNext + 1) % marks.length
    mesh.position.set(
      point.x + normal.x * FX.markLift,
      point.y + normal.y * FX.markLift,
      point.z + normal.z * FX.markLift
    )
    mesh.lookAt(point.x + normal.x, point.y + normal.y, point.z + normal.z)
    mesh.scale.setScalar(size)
    mesh.visible = true
  }

  // no renderOver anymore — with the viewmodel gone there is no second pass;
  // main.js just renders the world (then the thermal composite while scoping)
  return { onEvent, update }
}
