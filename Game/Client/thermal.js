// client/thermal.js — the sniper scope's thermal post-process (spec §8, pulled
// forward from M7 to prove the fog loop): "dark green scanline base, with
// players rendered hot in red and orange."
//
// Pipeline per scoped frame (main renders the world to the canvas first, with
// fog density already multiplied by scope.fogMult and the FOV zoomed):
//   1. copy the canvas into a texture (display-referred bytes — the composite
//      works on exactly what the normal path shows, so colors can't drift)
//   2. render a HEAT MASK pass to a half-res target: dummies as flat
//      red/orange unlit boxes, walls as black OCCLUDERS (thermal cuts fog,
//      not walls), no fog, no lights
//   3. composite over the canvas: luminance -> green ramp, horizontal
//      scanlines, sensor noise, circular scope-tube vignette, heat on top;
//      blended by scopeT so scoping in/out is continuous
//
// The gadget in M7 reuses this exact look (spec: "shared aesthetic").

import * as THREE from 'three'
import { CONFIG } from '../config.js'

// flat unlit heat colors (spec §8 "red and orange"); head runs hottest
const HEAT_COLORS = { head: '#ff4a1e', body: '#ff8c3a', legs: '#d84f28' }

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`

const FRAG = /* glsl */ `
uniform sampler2D tWorld;
uniform sampler2D tHeat;
uniform float uScope;    // 0..1 blend of the thermal treatment
uniform float uTime;
uniform float uScan;     // scanlines per screen height
uniform float uNoise;    // sensor noise amount
uniform float uVig;      // scope tube vignette strength
uniform float uHeat;     // heat overlay strength
uniform float uAspect;   // w/h, keeps the vignette a circle
varying vec2 vUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  vec3 world = texture2D(tWorld, vUv).rgb;

  // thermal base: world luminance mapped to a dark-green ramp (mid-tone floor
  // kept, spec §9 — never crushed to black)
  float lum = dot(world, vec3(0.299, 0.587, 0.114));
  vec3 green = mix(vec3(0.016, 0.095, 0.045), vec3(0.62, 0.88, 0.60), pow(lum, 0.85));

  // horizontal scanlines (sin(screenY * lineFreq), spec §8 sketch)
  green *= 0.84 + 0.16 * sin(vUv.y * uScan * 6.2831853);

  // light sensor noise
  green += (hash(vUv * vec2(913.7, 541.3) + fract(uTime) * 67.3) - 0.5) * uNoise;

  // circular scope-tube vignette
  vec2 c = vUv - 0.5;
  float r = length(vec2(c.x * uAspect, c.y));
  green *= 1.0 - uVig * smoothstep(0.32, 0.78, r);

  // heat mask on top: figures glow red/orange THROUGH the haze (the point of
  // the scope); the mask already carries per-zone heat colors
  vec3 h = texture2D(tHeat, vUv).rgb;
  float heat = clamp(max(h.r, max(h.g, h.b)) * uHeat, 0.0, 1.0);
  vec3 hot = h * uHeat * vec3(1.35, 1.05, 0.85);
  vec3 thermal = green * (1.0 - heat) + hot;

  gl_FragColor = vec4(mix(world, thermal, uScope), 1.0);
}`

export function createThermal({ renderer, camera, targetDefs, worldBoxes }) {
  // ---- heat scene: dummies hot, walls black occluders, nothing else
  const heatScene = new THREE.Scene()
  const blackMat = new THREE.MeshBasicMaterial({ color: 0x000000, fog: false })
  for (const b of worldBoxes) {
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]),
      blackMat
    )
    mesh.position.set((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2)
    heatScene.add(mesh)
  }
  const heatMats = {}
  for (const zone of ['head', 'body', 'legs']) {
    heatMats[zone] = new THREE.MeshBasicMaterial({ color: HEAT_COLORS[zone], fog: false })
  }
  const heatGroups = {}
  for (const t of targetDefs) {
    const g = new THREE.Group()
    for (const zone of ['head', 'body', 'legs']) {
      const b = t.zones[zone]
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]),
        heatMats[zone]
      )
      mesh.position.set((b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2)
      g.add(mesh)
    }
    heatScene.add(g)
    heatGroups[t.id] = g
  }

  // ---- composite pass
  const postScene = new THREE.Scene()
  const postCam = new THREE.Camera() // vertex shader writes NDC directly
  const uniforms = {
    tWorld: { value: null },
    tHeat: { value: null },
    uScope: { value: 0 },
    uTime: { value: 0 },
    uScan: { value: CONFIG.scope.scanlineFreq },
    uNoise: { value: CONFIG.scope.noiseAmt },
    uVig: { value: CONFIG.scope.vignette },
    uHeat: { value: CONFIG.scope.heatMix },
    uAspect: { value: 1 },
  }
  const quad = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms,
      depthTest: false,
      depthWrite: false,
    })
  )
  quad.frustumCulled = false
  postScene.add(quad)

  // ---- render targets (rebuilt on resize)
  let copyTex = null
  let rtHeat = null
  let w = 0
  let h = 0

  function resize(width, height) {
    if (width === w && height === h) return
    w = width
    h = height
    copyTex?.dispose()
    rtHeat?.dispose()
    // canvas copy: exactly what the normal path put on screen
    copyTex = new THREE.FramebufferTexture(w, h)
    copyTex.minFilter = THREE.LinearFilter
    copyTex.magFilter = THREE.LinearFilter
    copyTex.generateMipmaps = false
    // heat mask at half res: cheaper + a natural soft edge on the hot figures
    rtHeat = new THREE.WebGLRenderTarget(Math.max(1, w >> 1), Math.max(1, h >> 1))
    uniforms.uAspect.value = w / Math.max(1, h)
  }
  resize(window.innerWidth, window.innerHeight)

  return {
    resize,
    // dead dummies leave the heat mask (a toppled board has no signature)
    setAlive(id, alive) {
      const g = heatGroups[id]
      if (g) g.visible = !!alive
    },
    // Call AFTER the world render is on the canvas. Copies it, renders the
    // heat mask, and composites the thermal treatment over everything.
    apply(scopeT, timeSec) {
      // 1. copy the canvas (READ framebuffer is the canvas right now)
      renderer.copyFramebufferToTexture(copyTex)
      // 2. heat mask -> half-res RT (black clear; save/restore the clear color)
      const prevClear = new THREE.Color()
      renderer.getClearColor(prevClear)
      const prevAlpha = renderer.getClearAlpha()
      renderer.setRenderTarget(rtHeat)
      renderer.setClearColor(0x000000, 1)
      renderer.clear(true, true)
      renderer.render(heatScene, camera)
      renderer.setRenderTarget(null)
      renderer.setClearColor(prevClear, prevAlpha)
      // 3. composite over the canvas (opaque quad: overwrites, blends in-shader)
      uniforms.tWorld.value = copyTex
      uniforms.tHeat.value = rtHeat.texture
      uniforms.uScope.value = scopeT
      uniforms.uTime.value = timeSec
      uniforms.uScan.value = CONFIG.scope.scanlineFreq
      uniforms.uNoise.value = CONFIG.scope.noiseAmt
      uniforms.uVig.value = CONFIG.scope.vignette
      uniforms.uHeat.value = CONFIG.scope.heatMix
      renderer.render(postScene, postCam)
    },
  }
}
