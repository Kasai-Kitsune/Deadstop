// client/viewmodel.js — the first-person gun meshes are BACK (user request,
// M3b). Three provided GLB assets (client/glb.js parses them — a ~140-line
// subset parser, not vendored GLTFLoader) plus a procedural shotgun built
// from chamfered-ish primitives (spec §9 "hard-surface, built from chamfered
// primitives" — no good GLB was provided for that one, per the user).
//
// Everything procedural per spec §9: "Weapon animation (sway, recoil kick,
// reload) is procedural code, not skeletal." No skeletons, no clips — just
// springs and lerps driven by the sim's loadout state.
//
// Orientation is computed at load, not hardcoded per asset: PCA finds the
// long axis, a thinness test finds the muzzle end (the thin end of a gun is
// always the barrel), and a quaternion swings that axis to -Z (camera
// forward). Swap the GLB for a different export and the math still lands the
// gun barrel-forward. Per-weapon target LENGTH and camera-space POSE are art
// data below (scene.js precedent); the FEEL numbers live in config.viewmodel.
//
// Renders in its OWN scene with its OWN camera (fovDeg, not the world FOV —
// zooming the scope must not scale the gun) as an overlay pass after the
// world: guns never clip into walls. main.js calls render() between the world
// pass and the thermal composite.

import * as THREE from 'three'
import { CONFIG } from '../config.js'
import { loadGLB } from './glb.js'

const DEG2RAD = Math.PI / 180

// per-weapon art data: target length (m) + the camera-space pose of the
// gun's REAR (grip/stock end — [right, up, forward]). Anchoring the rear is
// what makes a viewmodel read right: the receiver sits bottom-right, the
// stock melts off-screen, the barrel points at the horizon. Center-anchoring
// put the receiver 4 cm from the camera and below the frame — invisible.
const POSE = {
  ar: { len: 0.92, pos: [0.26, -0.24, -0.34], rollDeg: 0 },
  smg: { len: 0.72, pos: [0.24, -0.23, -0.3], rollDeg: 0 },
  shotgun: { len: 0.95, pos: [0.27, -0.26, -0.36], rollDeg: 0 },
  sniper: { len: 1.15, pos: [0.26, -0.25, -0.38], rollDeg: 0 },
}

// viewmodel scene lighting (art constants): guns must read even in deep
// shadow — the vm scene has no world geometry to occlude them anyway
const LIGHTS = {
  hemiSky: 0xd8d2c6,
  hemiGround: 0x4a453d,
  hemiIntensity: 1.1,
  keyColor: 0xffeeda,
  keyIntensity: 2.6,
  keyPos: [0.6, 1.2, 0.4],
}

const SHOTGUN_MAT = {
  metal: { color: 0x2b2e30, metalness: 0.6, roughness: 0.42 },
  darkMetal: { color: 0x1d1f21, metalness: 0.5, roughness: 0.5 },
  oak: { color: 0x6d5b45, metalness: 0.04, roughness: 0.78 },
  bead: { color: 0xddd7c9, metalness: 0.1, roughness: 0.35, emissive: 0x332f27 },
}

export function createViewmodel() {
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(CONFIG.viewmodel.fovDeg, 1, 0.01, 5)
  const hemi = new THREE.HemisphereLight(LIGHTS.hemiSky, LIGHTS.hemiGround, LIGHTS.hemiIntensity)
  scene.add(hemi)
  const key = new THREE.DirectionalLight(LIGHTS.keyColor, LIGHTS.keyIntensity)
  key.position.set(...LIGHTS.keyPos)
  scene.add(key)

  // one holder per weapon; only the active one is in the scene
  const guns = {} // id -> { group, muzzleLocal: Vector3, len }
  const rig = new THREE.Group() // animation transforms apply here
  scene.add(rig)
  let currentId = null

  // ---- animation state
  const anim = {
    swayX: 0, swayY: 0, // look-lag rotation (deg)
    lastYaw: 0, lastPitch: 0,
    bobPhase: 0,
    kickZ: 0, kickRot: 0, // recoil punch (m backward, deg up)
    pumpT: 0, // shotgun pump cycle
    reloadT: 0, // 0..1 progress for the dip
    raiseT: 1, // 0..1 switch raise
  }

  // ---- load the three GLB weapons + build the shotgun
  const ready = Promise.all([
    loadGLB('./assets/ar.glb').then((g) => install('ar', g)),
    loadGLB('./assets/smg.glb').then((g) => install('smg', g)),
    loadGLB('./assets/sniper.glb').then((g) => install('sniper', g)),
  ]).then(() => {
    install('shotgun', buildShotgun())
  })

  function install(id, model) {
    const pose = POSE[id] || POSE.ar
    orientForward(model, pose.len)
    const group = new THREE.Group()
    group.add(model)
    // orientForward centered the model on the origin (muzzle at -len/2, rear
    // at +len/2); shift it so the REAR sits at the group's origin — the pose
    // then anchors the grip end and the barrel reaches forward from it
    model.position.z -= pose.len / 2
    group.position.set(pose.pos[0], pose.pos[1], pose.pos[2])
    group.rotation.z = pose.rollDeg * DEG2RAD
    rig.add(group)
    group.visible = false
    guns[id] = { group, len: pose.len }
  }

  // PCA + thinness orientation (see module header). Mutates `model`.
  function orientForward(model, targetLen) {
    model.updateMatrixWorld(true)
    const box = new THREE.Box3().setFromObject(model)
    const center = box.getCenter(new THREE.Vector3())
    // gather centered world verts
    const pts = []
    const v = new THREE.Vector3()
    model.traverse((o) => {
      if (!o.isMesh) return
      const p = o.geometry.attributes.position
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld)
        pts.push(v.x - center.x, v.y - center.y, v.z - center.z)
      }
    })
    // covariance power iteration -> long axis
    const cov = [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
    for (let i = 0; i < pts.length; i += 3) {
      const x = pts[i], y = pts[i + 1], z = pts[i + 2]
      cov[0][0] += x * x; cov[0][1] += x * y; cov[0][2] += x * z
      cov[1][1] += y * y; cov[1][2] += y * z; cov[2][2] += z * z
    }
    cov[1][0] = cov[0][1]; cov[2][0] = cov[0][2]; cov[2][1] = cov[1][2]
    let ax = [1, 0.15, 0.05]
    for (let it = 0; it < 60; it++) {
      const nv = [
        cov[0][0] * ax[0] + cov[0][1] * ax[1] + cov[0][2] * ax[2],
        cov[1][0] * ax[0] + cov[1][1] * ax[1] + cov[1][2] * ax[2],
        cov[2][0] * ax[0] + cov[2][1] * ax[1] + cov[2][2] * ax[2],
      ]
      const l = Math.hypot(...nv) || 1
      ax = [nv[0] / l, nv[1] / l, nv[2] / l]
    }
    const a = new THREE.Vector3(...ax).normalize()
    // thinness per half: the thin side is the muzzle (barrel), the thick side
    // is the stock/grip
    let loR = 0, loN = 0, hiR = 0, hiN = 0
    for (let i = 0; i < pts.length; i += 3) {
      const d = pts[i] * a.x + pts[i + 1] * a.y + pts[i + 2] * a.z
      const px = pts[i] - d * a.x, py = pts[i + 1] - d * a.y, pz = pts[i + 2] - d * a.z
      const r2 = px * px + py * py + pz * pz
      if (d < 0) { loR += r2; loN++ } else { hiR += r2; hiN++ }
    }
    const loRms = loN ? Math.sqrt(loR / loN) : 0
    const hiRms = hiN ? Math.sqrt(hiR / hiN) : 0
    // point `a` toward the MUZZLE (thin end), then swing it to camera forward
    if (hiRms > loRms) a.negate()
    const q = new THREE.Quaternion().setFromUnitVectors(a, new THREE.Vector3(0, 0, -1))
    // extent along the axis, for scale
    let lo = Infinity, hi = -Infinity
    for (let i = 0; i < pts.length; i += 3) {
      const d = pts[i] * a.x + pts[i + 1] * a.y + pts[i + 2] * a.z
      if (d < lo) lo = d
      if (d > hi) hi = d
    }
    const scale = targetLen / Math.max(hi - lo, 1e-6)
    model.applyQuaternion(q)
    model.scale.setScalar(scale)
    model.position.set(0, 0, 0)
    // re-center the scaled model on the origin: after rotation+scale the
    // muzzle sits at about -len/2 and the stock at +len/2
    model.updateMatrixWorld(true)
    const nb = new THREE.Box3().setFromObject(model)
    const nc = nb.getCenter(new THREE.Vector3())
    model.position.set(-nc.x, -nc.y, -nc.z)
    model.updateMatrixWorld(true)
  }

  // ---- the procedural shotgun (no GLB was provided; spec §9 chamfered
  //      primitives + PBR). Barrel forward is -Z, same as the oriented GLBs.
  function buildShotgun() {
    const g = new THREE.Group()
    const mat = (m) => new THREE.MeshStandardMaterial(m)
    const metal = mat(SHOTGUN_MAT.metal)
    const dark = mat(SHOTGUN_MAT.darkMetal)
    const oak = mat(SHOTGUN_MAT.oak)
    const bead = mat(SHOTGUN_MAT.bead)

    const add = (mesh, x, y, z) => { mesh.position.set(x, y, z); g.add(mesh); return mesh }

    // receiver
    add(new THREE.Mesh(new THREE.BoxGeometry(0.062, 0.085, 0.34), metal), 0, 0, 0.1)
    // barrel + under-tube (cylinders along Z)
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.021, 0.021, 0.5, 14), dark)
    barrel.rotation.x = Math.PI / 2
    add(barrel, 0, 0.012, -0.32)
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(0.0155, 0.0155, 0.42, 12), metal)
    tube.rotation.x = Math.PI / 2
    add(tube, 0, -0.032, -0.27)
    // pump slide (animates on the pump cycle)
    const pump = new THREE.Mesh(new THREE.BoxGeometry(0.058, 0.052, 0.17), oak)
    pump.position.set(0, -0.032, -0.3)
    g.add(pump)
    // stock (angled down-back) + pistol grip
    const stock = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.1, 0.26), oak)
    stock.position.set(0, -0.035, 0.38)
    stock.rotation.x = 0.16
    g.add(stock)
    const grip = new THREE.Mesh(new THREE.BoxGeometry(0.048, 0.11, 0.06), dark)
    grip.position.set(0, -0.085, 0.2)
    grip.rotation.x = 0.42
    g.add(grip)
    // sights: front bead + rear notch block
    add(new THREE.Mesh(new THREE.SphereGeometry(0.007, 8, 8), bead), 0, 0.036, -0.55)
    add(new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.018, 0.02), dark), 0, 0.05, -0.02)
    // loading port detail (a shallow darker inset on the receiver bottom)
    add(new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.006, 0.1), dark), 0, -0.044, 0.06)

    g.traverse((o) => { if (o.isMesh) o.castShadow = false })
    g.userData.pump = pump
    return g
  }

  // ---- events from the sim (same stream weapon-view.js consumes)
  function onEvent(ev) {
    if (ev.type === 'shot') {
      const W = CONFIG.weapons[ev.weapon]
      const pat = W.recoilPattern[0] || [2, 0]
      const V = CONFIG.viewmodel
      anim.kickZ = Math.min(anim.kickZ + pat[0] * V.kickScale * 8, 0.14)
      anim.kickRot = Math.min(anim.kickRot + pat[0] * 0.5, 7)
      if (ev.weapon === 'shotgun') anim.pumpT = 0.001 // start the pump cycle
    } else if (ev.type === 'switchStart') {
      anim.raiseT = 0
    }
  }

  // ---- per-frame animation. ctx = { loadout, view: {yaw, pitch}, state, dead? }
  function update(dt, ctx) {
    const { loadout, view, state, dead } = ctx
    const V = CONFIG.viewmodel
    const w = loadout.slots[loadout.active]

    // dead: the gun drops out of frame and stays there
    if (dead) {
      rig.visible = false
      return
    }
    rig.visible = loadout.scopeT < 0.85

    // which gun is in hand (swap meshes the moment the slot flips). This runs
    // EVERY frame, not just on change: the GLBs load asynchronously, so the
    // first update can set currentId before the gun exists — a change-only
    // check would then leave the freshly-installed gun hidden forever.
    if (currentId && currentId !== w.id && guns[currentId]) guns[currentId].group.visible = false
    currentId = w.id
    if (guns[currentId]) guns[currentId].group.visible = true

    // look-lag sway: the gun chases the camera rotation (deg, clamped)
    const dYaw = wrapDeg((view.yaw - anim.lastYaw) / DEG2RAD)
    const dPitch = (view.pitch - anim.lastPitch) / DEG2RAD
    anim.lastYaw = view.yaw
    anim.lastPitch = view.pitch
    const k = 1 - Math.exp(-V.swayLag * dt)
    anim.swayX = anim.swayX + (THREE.MathUtils.clamp(-dYaw * 1.1, -V.swayMaxDeg, V.swayMaxDeg) - anim.swayX) * k
    anim.swayY = anim.swayY + (THREE.MathUtils.clamp(-dPitch * 1.1, -V.swayMaxDeg, V.swayMaxDeg) - anim.swayY) * k

    // walk bob (grounded only, amplitude by planar speed)
    const speed = Math.hypot(state.vel.x, state.vel.z)
    const sf = Math.min(1, speed / CONFIG.movement.runSpeed)
    if (state.grounded) anim.bobPhase += dt * V.bobHz * Math.max(sf, 0.001)
    const bobY = Math.sin(anim.bobPhase * 2) * V.bobAmount * sf
    const bobX = Math.sin(anim.bobPhase) * V.bobAmount * 0.7 * sf

    // recoil kick spring back to rest
    const ks = 1 - Math.exp(-V.kickSnap * dt)
    anim.kickZ += (0 - anim.kickZ) * ks
    anim.kickRot += (0 - anim.kickRot) * ks

    // reload dip (ease in/out over the reload)
    const W = CONFIG.weapons[w.id]
    const reload01 = w.reloadT > 0 ? 1 - w.reloadT / Math.max(W.reloadTime, 1e-4) : -1
    const dip = reload01 >= 0 ? Math.sin(Math.PI * reload01) : 0

    // switch raise (0..1 over switchTime)
    if (loadout.switchT <= 0) anim.raiseT = Math.min(1, anim.raiseT + dt / Math.max(CONFIG.loadout.switchTime, 1e-4))
    const raise = anim.raiseT * anim.raiseT * (3 - 2 * anim.raiseT) // smoothstep

    // scope lower: gun sinks out of the scope picture (and hides at full)
    const s = loadout.scopeT
    const lower = s * V.lowerScope

    rig.position.set(bobX, bobY - dip * V.reloadDip - (1 - raise) * V.switchDip - lower, anim.kickZ)
    rig.rotation.set(
      anim.kickRot * DEG2RAD * -1 + anim.swayY * DEG2RAD + dip * 0.5,
      anim.swayX * DEG2RAD,
      anim.swayX * DEG2RAD * 0.35 + dip * 0.3
    )

    // shotgun pump cycle: yank back and shove forward over ~0.45 s
    const pump = currentId === 'shotgun' ? guns[currentId]?.group.children[0]?.userData.pump : null
    if (anim.pumpT > 0) {
      anim.pumpT += dt
      const t = anim.pumpT / 0.45
      if (t >= 1) {
        anim.pumpT = 0
        if (pump) pump.position.z = -0.3
      } else if (pump) {
        // back 0-40%, forward 40-100%
        const p = t < 0.4 ? t / 0.4 : 1 - (t - 0.4) / 0.6
        pump.position.z = -0.3 + p * 0.11
      }
    }
  }

  // the muzzle point in VIEWMODEL-CAMERA space — the FX layer (weapon-view.js)
  // mirrors it into the main camera so tracers/flash leave the actual barrel.
  // The gun's rear anchors at the group origin, so the muzzle is -len forward.
  function muzzleCamSpace(id) {
    const gun = guns[id || currentId]
    if (!gun) return null
    const m = new THREE.Vector3(0, 0, -gun.len + 0.05)
    gun.group.localToWorld(m)
    return m
  }

  function resize(width, height) {
    camera.aspect = width / Math.max(1, height)
    camera.updateProjectionMatrix()
  }

  // overlay pass: called AFTER the world render, BEFORE the thermal composite
  let lastTriCount = -1
  function render(renderer) {
    renderCount++
    if (!rig.visible || !currentId || !guns[currentId]) return
    camera.fov = CONFIG.viewmodel.fovDeg // live — panel slider
    camera.updateProjectionMatrix()
    const prevAutoClear = renderer.autoClear
    renderer.autoClear = false
    renderer.clearDepth()
    renderer.render(scene, camera)
    renderer.autoClear = prevAutoClear
    drawnCount++
    lastTriCount = renderer.info.render.triangles
  }

  let renderCount = 0
  let drawnCount = 0

  return {
    ready, onEvent, update, render, resize, muzzleCamSpace,
    _debug: () => ({
      rigVisible: rig.visible, currentId, guns: Object.keys(guns),
      renderCount, drawnCount, lastTriCount, aspect: camera.aspect, fov: camera.fov,
      gunVisible: currentId ? guns[currentId].group.visible : false,
      gunPos: currentId ? guns[currentId].group.position.toArray() : null,
      rigPos: rig.position.toArray(), rigRot: rig.rotation.toArray(),
    }),
  }
}

function wrapDeg(d) {
  let x = d % 360
  if (x > 180) x -= 360
  if (x < -180) x += 360
  return x
}
