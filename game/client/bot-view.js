// client/bot-view.js — the playtest bots rendered as simple box humanoids
// (characters are an M6 art milestone; this is deliberately basic). Built to
// MATCH the sim's hitboxes (legs 0..0.9, body 0.9..1.55, head 1.55..1.85 —
// what you see is what you hit), tinted per side (attackers rust, defenders
// slate — spec §9 palette), with a name tag, a weapon-length prop, a walk
// cycle driven by real speed, an aim-driven body yaw, and the dummies.js
// topple on death. All presentation; every gameplay number lives in sim/.

import * as THREE from 'three'
import { CONFIG } from '../config.js'

const SIDE_COLORS = { attackers: '#a86a4f', defenders: '#767d8e' }
const ZONE_TINT = { head: '#c2b9a5', body: '#8a857c', legs: '#5d5b55' }

// presentation constants (art direction, M6 replaces this whole file)
const BOT = {
  legW: 0.15, legH: 0.9, legGap: 0.11,
  torsoW: 0.5, torsoH: 0.62, torsoD: 0.28, torsoY: 1.21,
  headSize: 0.24, headY: 1.67,
  armW: 0.09, armH: 0.46, armGap: 0.31, armY: 1.27,
  walkSwingRad: 0.55,
  propLens: { ar: 0.75, smg: 0.55, shotgun: 0.8, sniper: 1.05 },
  tagW: 1.15, tagH: 0.3, tagY: 2.12,
  toppleTime: 0.5, riseTime: 0.3,
  flashTime: 0.18,
}

const UP = new THREE.Vector3(0, 1, 0)
const _q1 = new THREE.Quaternion()
const _q2 = new THREE.Quaternion()
const _axis = new THREE.Vector3()

function fallAxis(dirX, dirZ) {
  _axis.set(dirX, 0, dirZ)
  const len = _axis.length()
  if (len < 1e-6) return new THREE.Vector3(1, 0, 0)
  _axis.divideScalar(len)
  const a = new THREE.Vector3().crossVectors(UP, _axis).normalize()
  return a.lengthSq() < 1e-8 ? new THREE.Vector3(1, 0, 0) : a
}

function makeTag(name, color) {
  const canvas = document.createElement('canvas')
  canvas.width = 256
  canvas.height = 64
  const ctx = canvas.getContext('2d')
  const tex = new THREE.CanvasTexture(canvas)
  tex.colorSpace = THREE.SRGBColorSpace
  const spr = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }))
  spr.scale.set(BOT.tagW, BOT.tagH, 1)
  const draw = (n, c) => {
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.font = '700 34px ui-monospace, Menlo, Consolas, monospace'
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#141312'
    ctx.fillText(n, canvas.width / 2 + 2, canvas.height / 2 + 3)
    ctx.fillStyle = c
    ctx.fillText(n, canvas.width / 2, canvas.height / 2)
    tex.needsUpdate = true
  }
  draw(name, color)
  return { spr, draw }
}

export function buildBotViews(scene, botsList) {
  const views = []
  const byId = {}

  for (const bot of botsList) {
    const sideColor = SIDE_COLORS[bot.side] || '#9a978f'
    const group = new THREE.Group()
    scene.add(group)
    const body = new THREE.Group() // everything that topples/animates
    group.add(body)

    const mat = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9, metalness: 0.02 })
    const parts = {}
    const zones = {}

    // legs + arms pivot at the hip/shoulder (geometry translated down)
    const limb = (w, h, x, y) => {
      const g = new THREE.BoxGeometry(w, h, w)
      g.translate(0, -h / 2, 0)
      const m = new THREE.Mesh(g, mat(ZONE_TINT.legs))
      m.position.set(x, y, 0)
      m.castShadow = true
      body.add(m)
      return m
    }
    parts.legL = limb(BOT.legW, BOT.legH, -BOT.legGap, BOT.legH)
    parts.legR = limb(BOT.legW, BOT.legH, BOT.legGap, BOT.legH)
    parts.armL = limb(BOT.armW, BOT.armH, -BOT.armGap, BOT.armY + BOT.armH / 2)
    parts.armR = limb(BOT.armW, BOT.armH, BOT.armGap, BOT.armY + BOT.armH / 2)

    // torso (team color) + head (bone) + team band
    const torso = new THREE.Mesh(new THREE.BoxGeometry(BOT.torsoW, BOT.torsoH, BOT.torsoD), mat(sideColor))
    torso.position.y = BOT.torsoY
    torso.castShadow = true
    body.add(torso)
    zones.body = { mat: torso.material, flash: 0 }
    const head = new THREE.Mesh(new THREE.BoxGeometry(BOT.headSize, BOT.headSize, BOT.headSize), mat(ZONE_TINT.head))
    head.position.y = BOT.headY
    head.castShadow = true
    body.add(head)
    zones.head = { mat: head.material, flash: 0 }
    const band = new THREE.Mesh(new THREE.BoxGeometry(BOT.headSize + 0.02, 0.06, BOT.headSize + 0.02), mat(sideColor))
    band.position.y = BOT.headY + BOT.headSize / 2 - 0.03
    body.add(band)

    // weapon prop at the hands, pitched with the aim (cosmetic)
    const propLen = BOT.propLens[bot.weapon] || 0.7
    const prop = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.08, propLen),
      new THREE.MeshStandardMaterial({ color: 0x232527, roughness: 0.5, metalness: 0.5 })
    )
    const hands = new THREE.Group()
    hands.position.set(BOT.armGap * 0.55, BOT.armY, -0.12)
    hands.add(prop)
    prop.position.set(0, 0, -propLen / 2 + 0.08)
    body.add(hands)

    const tag = makeTag(bot.name, sideColor)
    tag.spr.position.y = BOT.tagY
    body.add(tag.spr)

    const view = {
      bot,
      group,
      body,
      parts,
      hands,
      tag,
      torsoMat: torso.material,
      bandMat: band.material,
      zones,
      walkPhase: 0,
      toppleT: 0,
      rising: false,
      dead: false,
      fallAxis: new THREE.Vector3(1, 0, 0),
    }
    views.push(view)
    byId[bot.id] = view
  }

  return {
    byId,
    // halftime side swap: re-tint a bot to its new side
    setSide(id, side) {
      const v = byId[id]
      if (!v) return
      const color = new THREE.Color(SIDE_COLORS[side] || '#9a978f')
      v.torsoMat.color.copy(color)
      v.bandMat.color.copy(color)
      v.tag.draw(v.bot.name, SIDE_COLORS[side] || '#9a978f')
    },
    // damage feedback: zone flash (the session calls this per hit)
    onHit(id, zone) {
      const v = byId[id]
      if (v && v.zones[zone]) v.zones[zone].flash = 1
    },
    onKilled(id, dirX, dirZ) {
      const v = byId[id]
      if (!v) return
      v.dead = true
      v.rising = false
      v.fallAxis = fallAxis(dirX, dirZ)
      for (const z in v.zones) v.zones[z].flash = 1
    },
    // round restart: stand everyone back up
    onRoundReset() {
      for (const v of views) {
        v.dead = false
        v.rising = true
        v.toppleT = Math.min(v.toppleT, 1)
      }
    },
    tick(dt) {
      for (const v of views) {
        const b = v.bot
        const p = b.player
        if (!p) continue
        v.group.position.set(p.pos.x, p.pos.y, p.pos.z)

        // stance: compress the whole figure with the crouch amount
        const squash = 1 - 0.3 * p.crouch
        v.body.scale.set(1, squash, 1)

        // face the aim; the gun prop pitches with it
        v.body.rotation.y = b.yaw
        v.hands.rotation.x = -b.pitch

        // walk cycle by real planar speed
        const speed = Math.hypot(p.vel.x, p.vel.z)
        const sf = Math.min(1, speed / CONFIG.movement.runSpeed)
        v.walkPhase += dt * 9 * Math.max(sf, 0.001)
        const swing = Math.sin(v.walkPhase) * BOT.walkSwingRad * sf
        v.parts.legL.rotation.x = swing
        v.parts.legR.rotation.x = -swing
        v.parts.armL.rotation.x = -swing * 0.6 - 0.55 // arms stay on the gun
        v.parts.armR.rotation.x = -0.75

        // hit flashes
        for (const z in v.zones) {
          const zn = v.zones[z]
          if (zn.flash > 0) {
            zn.flash = Math.max(0, zn.flash - dt / BOT.flashTime)
            zn.mat.emissive.setRGB(0.95 * zn.flash, 0.8 * zn.flash, 0.55 * zn.flash)
          }
        }

        // topple / rise (dummies.js pattern)
        if (v.dead && v.toppleT < 1) v.toppleT = Math.min(1, v.toppleT + dt / BOT.toppleTime)
        if (v.rising && v.toppleT > 0) {
          v.toppleT = Math.max(0, v.toppleT - dt / BOT.riseTime)
          if (v.toppleT === 0) v.rising = false
        }
        const ang = (Math.PI / 2) * v.toppleT * v.toppleT
        _q1.setFromAxisAngle(v.fallAxis, ang)
        v.body.quaternion.copy(_q1).multiply(_q2.identity())

        // tag fades with death, returns on the rise
        const target = v.dead ? 0 : 1
        const o = v.tag.spr.material.opacity
        v.tag.spr.material.opacity = o + (target - o) * Math.min(1, dt * 8)
      }
    },
  }
}
