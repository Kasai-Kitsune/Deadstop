// client/scene.js — Three.js renderer, camera, lights, and room meshes.
// Presentation constants (light levels, shadow settings) live HERE, not in config:
// they're art-direction values (spec §9 / M6), not gameplay tunables.

import * as THREE from 'three'
import { CONFIG } from '../config.js'

const RENDER = {
  toneMappingExposure: 1.05,
  maxPixelRatio: 2,
  shadowMapSize: 2048,
  shadowExtent: 26, // ortho half-extent around the light target
}

const LIGHTS = {
  hemiSky: 0xdad5cb,
  hemiGround: 0x5f594f,
  hemiIntensity: 1.15,
  sunColor: 0xffeeda,
  sunIntensity: 2.3,
  sunPos: [-10, 14, 6],
  // aim at mid-corridor so the whole 46 m floor plan gets shadows
  sunTarget: [12, 0, 0],
  shadowBias: -0.0004,
}

export function createScene(host) {
  const renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, RENDER.maxPixelRatio))
  renderer.setSize(window.innerWidth, window.innerHeight)
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap // r186 dropped PCFSoft; PCF is the close equivalent
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = RENDER.toneMappingExposure
  renderer.outputColorSpace = THREE.SRGBColorSpace
  host.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  // Fog (spec §8): render effect only — hit registration in sim/ never sees it.
  // Background matches the fog so geometry fades into haze, not into a dark box.
  scene.background = new THREE.Color(CONFIG.fog.color)
  scene.fog = new THREE.FogExp2(CONFIG.fog.color, CONFIG.fog.density)

  const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.05, CONFIG.view.cameraFarM)
  camera.rotation.order = 'YXZ'

  const hemi = new THREE.HemisphereLight(LIGHTS.hemiSky, LIGHTS.hemiGround, LIGHTS.hemiIntensity)
  scene.add(hemi)

  const sun = new THREE.DirectionalLight(LIGHTS.sunColor, LIGHTS.sunIntensity)
  sun.position.set(...LIGHTS.sunPos)
  sun.target.position.set(...LIGHTS.sunTarget)
  sun.castShadow = true
  sun.shadow.mapSize.set(RENDER.shadowMapSize, RENDER.shadowMapSize)
  const cam = sun.shadow.camera
  cam.left = -RENDER.shadowExtent
  cam.right = RENDER.shadowExtent
  cam.top = RENDER.shadowExtent
  cam.bottom = -RENDER.shadowExtent
  cam.near = 1
  cam.far = 60
  sun.shadow.bias = LIGHTS.shadowBias
  scene.add(sun)
  scene.add(sun.target)

  return {
    renderer,
    scene,
    camera,
    resize() {
      camera.aspect = window.innerWidth / window.innerHeight
      camera.updateProjectionMatrix()
      renderer.setSize(window.innerWidth, window.innerHeight)
    },
  }
}

// one mesh per box; materials cached by color so the room stays one draw per color
const materialCache = new Map()
function materialFor(color) {
  let mat = materialCache.get(color)
  if (!mat) {
    mat = new THREE.MeshStandardMaterial({ color, roughness: 0.93, metalness: 0.02 })
    materialCache.set(color, mat)
  }
  return mat
}

export function buildRoom(scene, room) {
  const add = (b, castShadow) => {
    const w = b.max[0] - b.min[0]
    const h = b.max[1] - b.min[1]
    const d = b.max[2] - b.min[2]
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), materialFor(b.color))
    mesh.position.set((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2)
    mesh.castShadow = castShadow
    mesh.receiveShadow = true
    scene.add(mesh)
  }
  for (const b of room.boxes) add(b, true)
  for (const b of room.visuals) add(b, false) // markers never cast; they'd stripe the floor
}

// Target dummies (killable, flinching, respawning) live in client/dummies.js —
// they outgrew "static room geometry" in M2+.
