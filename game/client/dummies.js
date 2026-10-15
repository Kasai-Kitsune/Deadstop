// client/dummies.js — the range dummies, now killable (M2+). Meshes are built
// FROM the sim's own zone boxes (what you see is what you hit), each dummy is
// a Group so it can flinch on hits, topple away from the killing shot, and pop
// back up on respawn. HP bars + damage popups are canvas sprites. All
// gameplay numbers (hp, respawn, flash time) live in config dummies.*; the
// constants below are how that state is PRESENTED (art direction, M6 will
// replace the whole look).

import * as THREE from 'three'
import { CONFIG } from '../config.js'

const DEG2RAD = Math.PI / 180

const ZONE_COLORS = { head: '#a86a4f', body: '#c2b9a5', legs: '#5d5b55' }

// presentation constants — animation feel, not designer tunables
const DUMMY = {
  barW: 0.66, barH: 0.069, barY: 2.12, // health bar sprite above the head
  popY: 1.95, popRise: 0.5, popTime: 0.7, // damage popup: float + fade
  flinchAmpDeg: 4, flinchTime: 0.22, // hit jerk
  toppleTime: 0.45, riseTime: 0.28, // death fall / respawn stand-up
}

const UP = new THREE.Vector3(0, 1, 0)
const _q1 = new THREE.Quaternion()
const _q2 = new THREE.Quaternion()
const _axis = new THREE.Vector3()

// horizontal shot direction -> the axis tipping the dummy away from the shot
function fallAxis(dirX, dirZ) {
  _axis.set(dirX, 0, dirZ)
  const len = _axis.length()
  if (len < 1e-6) return new THREE.Vector3(1, 0, 0)
  _axis.divideScalar(len)
  const a = new THREE.Vector3().crossVectors(UP, _axis).normalize()
  return a.lengthSq() < 1e-8 ? new THREE.Vector3(1, 0, 0) : a
}

function makeSprite(w, h, scaleW, scaleH) {
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false })
  const spr = new THREE.Sprite(mat)
  spr.scale.set(scaleW, scaleH, 1)
  return { canvas, ctx: canvas.getContext('2d'), tex, spr }
}

export function buildDummies(scene, targets) {
  const dummies = []

  for (const t of targets) {
    const group = new THREE.Group()
    group.position.set(t.pos[0], 0, t.pos[1])
    scene.add(group)

    // zone meshes: local offsets from the group's base, built from the same
    // boxes the sim raycasts (one definition, no see/hit drift)
    const zones = {}
    for (const zone of ['head', 'body', 'legs']) {
      const b = t.zones[zone]
      const mat = new THREE.MeshStandardMaterial({ color: ZONE_COLORS[zone], roughness: 0.9, metalness: 0.02 })
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]),
        mat
      )
      mesh.position.set(
        (b.min[0] + b.max[0]) / 2 - t.pos[0],
        (b.min[1] + b.max[1]) / 2,
        (b.min[2] + b.max[2]) / 2 - t.pos[1]
      )
      mesh.castShadow = true
      mesh.receiveShadow = true
      group.add(mesh)
      zones[zone] = { mat, flash: 0 }
    }

    const bar = makeSprite(96, 10, DUMMY.barW, DUMMY.barH)
    bar.spr.position.set(0, DUMMY.barY, 0)
    group.add(bar.spr)

    const pop = makeSprite(128, 64, 0.5, 0.25)
    pop.spr.position.set(0, DUMMY.popY, 0)
    pop.spr.material.opacity = 0
    group.add(pop.spr)

    const d = {
      id: t.id,
      group,
      zones,
      bar,
      pop,
      hpFrac: 1,
      flinch: 0,
      flinchAxis: new THREE.Vector3(1, 0, 0),
      toppleT: 0, // 0 upright .. 1 flat on the floor
      rising: false,
      dead: false,
      fallAxis: new THREE.Vector3(1, 0, 0),
    }
    dummies.push(d)
    drawBar(d)
  }

  const byId = {}
  for (const d of dummies) byId[d.id] = d

  function drawBar(d) {
    const { ctx, canvas, tex } = d.bar
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = 'rgba(23,22,20,0.85)'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.fillStyle = '#3a3835'
    ctx.fillRect(1, 1, canvas.width - 2, canvas.height - 2)
    const w = Math.round((canvas.width - 2) * d.hpFrac)
    if (w > 0) {
      ctx.fillStyle = d.hpFrac > 0.35 ? '#a86a4f' : '#c95f3f' // low hp reads hotter
      ctx.fillRect(1, 1, w, canvas.height - 2)
    }
    tex.needsUpdate = true
  }

  function drawPop(d, text, color) {
    const { ctx, canvas, tex } = d.pop
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.font = '700 40px ui-monospace, Menlo, Consolas, monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#141312' // soft outline for readability at distance
    ctx.fillText(text, canvas.width / 2 + 2, canvas.height / 2 + 3)
    ctx.fillStyle = color
    ctx.fillText(text, canvas.width / 2, canvas.height / 2)
    tex.needsUpdate = true
  }

  return {
    // a live hit: zone flash + flinch away from the shot + hp bar + damage number
    onHit(id, zone, damage, hpFrac, dirX, dirZ) {
      const d = byId[id]
      if (!d) return
      d.zones[zone].flash = 1
      d.flinch = 1
      d.flinchAxis = fallAxis(dirX, dirZ)
      d.hpFrac = Math.max(0, Math.min(1, hpFrac))
      drawBar(d)
      drawPop(d, damage.toFixed(0), zone === 'head' ? '#e08a5f' : '#ddd7c9')
      d.pop.spr.material.opacity = 1
      d.pop.t = 1
      d.pop.spr.position.y = DUMMY.popY
    },
    // hp hit zero: topple away from the killing shot, all zones flash, bar drops
    onKilled(id, dirX, dirZ, damage) {
      const d = byId[id]
      if (!d) return
      d.dead = true
      d.rising = false
      d.fallAxis = fallAxis(dirX, dirZ)
      for (const zone in d.zones) d.zones[zone].flash = 1
      d.hpFrac = 0
      drawBar(d)
      drawPop(d, 'DOWN', '#c95f3f')
      d.pop.spr.material.opacity = 1
      d.pop.t = 1
      d.pop.spr.position.y = DUMMY.popY
    },
    // sim respawn: stand back up, full bar
    onRespawn(id) {
      const d = byId[id]
      if (!d) return
      d.dead = false
      d.rising = true
      d.hpFrac = 1
      drawBar(d)
    },
    tick(dt) {
      const decay = dt / Math.max(CONFIG.dummies.hitFlashTime, 1e-4)
      for (const d of dummies) {
        for (const zone in d.zones) {
          const z = d.zones[zone]
          if (z.flash <= 0) continue
          z.flash = Math.max(0, z.flash - decay)
          // warm bone-white pulse, easing out
          z.mat.emissive.setRGB(0.95 * z.flash, 0.8 * z.flash, 0.55 * z.flash)
        }

        if (d.flinch > 0) d.flinch = Math.max(0, d.flinch - dt / DUMMY.flinchTime)

        // topple (ease-in fall) / rise (the same curve run backwards = ease-out)
        if (d.dead && d.toppleT < 1) d.toppleT = Math.min(1, d.toppleT + dt / DUMMY.toppleTime)
        if (d.rising && d.toppleT > 0) {
          d.toppleT = Math.max(0, d.toppleT - dt / DUMMY.riseTime)
          if (d.toppleT === 0) d.rising = false
        }

        const ang = (Math.PI / 2) * d.toppleT * d.toppleT
        _q1.setFromAxisAngle(d.fallAxis, ang)
        _q2.setFromAxisAngle(d.flinchAxis, DUMMY.flinchAmpDeg * DEG2RAD * d.flinch)
        d.group.quaternion.copy(_q1).multiply(_q2)

        // bar fades out on death, back in on respawn
        const target = d.dead ? 0 : 1
        const o = d.bar.spr.material.opacity
        d.bar.spr.material.opacity = o + (target - o) * Math.min(1, dt * 8)

        // damage popup floats up and fades
        if (d.pop.t > 0) {
          d.pop.t = Math.max(0, d.pop.t - dt / DUMMY.popTime)
          d.pop.spr.position.y = DUMMY.popY + (1 - d.pop.t) * DUMMY.popRise
          d.pop.spr.material.opacity = d.pop.t
        }
      }
    },
  }
}
