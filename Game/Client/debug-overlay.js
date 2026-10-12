// client/debug-overlay.js — the M2 "spread and recoil debug overlay" (toggle F3
// or V). Reads the LIVE loadout + config, so you can drag sliders in the `
// panel and watch the graphs change with them: live numbers (including scope
// sway), the fixed recoil pattern plot with a marker for the next shot, and a
// rolling scatter of where the last 48 shots actually landed relative to the
// aim axis. All numbers are for the weapon IN HAND.

import { CONFIG } from '../config.js'

const COLORS = {
  grid: '#3a3835',
  path: '#9a978f',
  start: '#6f6d66',
  next: '#ddd7c9',
  live: '#a86a4f',
  spreadRing: '#a86a4f88',
  head: '#a86a4f',
  body: '#ddd7c9',
  legs: '#8a857c',
  wall: '#6f6d66',
  miss: '#4a4844',
}

const SCATTER_WINDOW = 48
const SCATTER_SPAN_DEG = 2.5 // half-extent of the scatter plot in degrees

export function createDebugOverlay({ getLoadout }) {
  const root = document.getElementById('dbg')
  root.innerHTML = `
    <header><b>spread / recoil</b><span class="hint">F3 or V to close</span></header>
    <div class="nums">
      <div><span>weapon</span><b id="dbg-weapon">—</b></div>
      <div><span>spread</span><b id="dbg-spread">—</b></div>
      <div><span>target</span><b id="dbg-target">—</b></div>
      <div><span>stance x</span><b id="dbg-stance">—</b></div>
      <div><span>speed x</span><b id="dbg-speed">—</b></div>
      <div><span>scope x</span><b id="dbg-scope">—</b></div>
      <div><span>recoil P/Y</span><b id="dbg-recoil">—</b></div>
      <div><span>sway P/Y</span><b id="dbg-sway">—</b></div>
      <div><span>pattern idx</span><b id="dbg-idx">—</b></div>
      <div><span>since shot</span><b id="dbg-since">—</b></div>
      <div><span>acc</span><b id="dbg-acc">—</b></div>
      <div><span>scopeT</span><b id="dbg-scopet">—</b></div>
    </div>
    <canvas id="dbg-pattern" width="264" height="150"></canvas>
    <canvas id="dbg-scatter" width="264" height="150"></canvas>
    <div class="nums">
      <div><span>head/body/legs</span><b id="dbg-zones">—</b></div>
      <div><span>dmg dealt</span><b id="dbg-dmg">—</b></div>
    </div>`
  const $ = (id) => root.querySelector('#' + id)
  const el = {
    weapon: $('dbg-weapon'), spread: $('dbg-spread'), target: $('dbg-target'), stance: $('dbg-stance'),
    speed: $('dbg-speed'), scope: $('dbg-scope'), recoil: $('dbg-recoil'), sway: $('dbg-sway'),
    idx: $('dbg-idx'), since: $('dbg-since'), acc: $('dbg-acc'), scopet: $('dbg-scopet'),
    zones: $('dbg-zones'), dmg: $('dbg-dmg'),
  }
  const patternCv = $('dbg-pattern')
  const scatterCv = $('dbg-scatter')

  const shots = [] // {y: yawOff deg, p: pitchOff deg, kind, zone}
  let open = false

  function record(ev) {
    if (ev.type !== 'shot') return
    shots.push({ y: ev.offYawDeg, p: ev.offPitchDeg, kind: ev.hit ? ev.hit.kind : 'miss', zone: ev.hit?.zone })
    if (shots.length > SCATTER_WINDOW) shots.shift()
  }

  // Recoil pattern: cumulative pitch (up) vs yaw (right), scaled to fit.
  // The bone dot is the NEXT shot's offset; the rust cross is the live
  // accumulated recoil (it walks back to 0 during recovery). Weapons with an
  // airborne variant (the AR's snappy Z-drift) plot that one while the player
  // is off the ground, with the shape named in the corner.
  function drawPattern(w, W, airborne) {
    const ctx = patternCv.getContext('2d')
    const pat = (airborne && W.recoilPatternAir) ? W.recoilPatternAir : W.recoilPattern
    let cumY = 0, cumP = 0
    const pts = [[0, 0]]
    let maxY = 0.1, maxP = 0.1
    for (const [p, y] of pat) {
      cumP += p
      cumY += y
      pts.push([cumY, cumP])
      maxY = Math.max(maxY, Math.abs(cumY))
      maxP = Math.max(maxP, cumP)
    }
    const pad = 14
    const sx = (patternCv.width - pad * 2) / (maxY * 2)
    const sy = (patternCv.height - pad * 2) / maxP
    const X = (y) => patternCv.width / 2 + y * sx
    const Y = (p) => patternCv.height - pad - p * sy

    ctx.clearRect(0, 0, patternCv.width, patternCv.height)
    ctx.strokeStyle = COLORS.grid
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(patternCv.width / 2, 0)
    ctx.lineTo(patternCv.width / 2, patternCv.height)
    ctx.stroke()

    ctx.strokeStyle = COLORS.path
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(X(0), Y(0))
    for (const [y, p] of pts) ctx.lineTo(X(y), Y(p))
    ctx.stroke()

    ctx.fillStyle = COLORS.start
    ctx.fillRect(X(0) - 2, Y(0) - 2, 4, 4)

    // next shot position (pattern index already advanced past fired shots)
    const idx = w.patternIdx % pat.length
    ctx.fillStyle = COLORS.next
    ctx.beginPath()
    ctx.arc(X(pts[idx][0]), Y(pts[idx][1]), 3, 0, Math.PI * 2)
    ctx.fill()

    // live accumulated recoil
    ctx.strokeStyle = COLORS.live
    ctx.lineWidth = 1.5
    ctx.beginPath()
    ctx.moveTo(X(w.recoil.yaw) - 5, Y(w.recoil.pitch))
    ctx.lineTo(X(w.recoil.yaw) + 5, Y(w.recoil.pitch))
    ctx.moveTo(X(w.recoil.yaw), Y(w.recoil.pitch) - 5)
    ctx.lineTo(X(w.recoil.yaw), Y(w.recoil.pitch) + 5)
    ctx.stroke()

    // which shape is live: S-drift on the ground, Z-drift (air) off it
    ctx.fillStyle = COLORS.next
    ctx.font = '9px ui-monospace, monospace'
    ctx.textAlign = 'right'
    ctx.fillText(airborne && W.recoilPatternAir ? 'Z-DRIFT (AIR)' : 'S-DRIFT', patternCv.width - 6, 11)
  }

  // Scatter: each recent shot's landing offset from the aim axis (degrees).
  // The rust ring is the CURRENT spread cone — shots should stay inside it.
  function drawScatter(w) {
    const ctx = scatterCv.getContext('2d')
    const cx = scatterCv.width / 2
    const cy = scatterCv.height / 2
    const s = (scatterCv.width / 2 - 10) / SCATTER_SPAN_DEG
    ctx.clearRect(0, 0, scatterCv.width, scatterCv.height)

    ctx.strokeStyle = COLORS.grid
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(cx, 0); ctx.lineTo(cx, scatterCv.height)
    ctx.moveTo(0, cy); ctx.lineTo(scatterCv.width, cy)
    ctx.stroke()

    ctx.strokeStyle = COLORS.spreadRing
    ctx.beginPath()
    ctx.arc(cx, cy, Math.min(w.spread * s, scatterCv.width), 0, Math.PI * 2)
    ctx.stroke()

    for (let i = 0; i < shots.length; i++) {
      const sh = shots[i]
      const age = i / shots.length
      ctx.fillStyle = sh.kind === 'miss' ? COLORS.miss : sh.kind === 'wall' ? COLORS.wall : COLORS[sh.zone] || COLORS.body
      ctx.globalAlpha = 0.35 + 0.65 * age
      ctx.fillRect(cx + sh.y * s - 1.5, cy - sh.p * s - 1.5, 3, 3)
    }
    ctx.globalAlpha = 1
  }

  function update(player) {
    if (!open) return
    const L = getLoadout()
    const w = L.slots[L.active]
    const W = CONFIG.weapons[w.id] // live — sliders mutate CONFIG in place

    const speed = Math.hypot(player.vel.x, player.vel.z)
    const speedFactor = Math.min(1, speed / CONFIG.movement.runSpeed)
    const curve = Math.pow(speedFactor, W.moveSpreadCurveExp)
    const rawMult = player.grounded
      ? W.stanceSpreadStand + (W.stanceSpreadCrouch - W.stanceSpreadStand) * player.crouch
      : W.stanceSpreadAir
    const scopeFactor = W.canScope ? 1 + (CONFIG.scope.spreadMult - 1) * L.scopeT : 1
    const target = W.baseSpread * rawMult * (1 + W.moveSpread * curve) * scopeFactor

    el.weapon.textContent = W.name
    el.spread.textContent = w.spread.toFixed(3) + '\u00b0'
    el.target.textContent = target.toFixed(3) + '\u00b0'
    el.stance.textContent = w.stanceMult.toFixed(2)
    el.speed.textContent = 'x' + (1 + W.moveSpread * curve).toFixed(2)
    el.scope.textContent = 'x' + scopeFactor.toFixed(3)
    el.recoil.textContent = w.recoil.pitch.toFixed(2) + '\u00b0 / ' + w.recoil.yaw.toFixed(2) + '\u00b0'
    el.sway.textContent = L.sway.pitch.toFixed(3) + '\u00b0 / ' + L.sway.yaw.toFixed(3) + '\u00b0'
    el.idx.textContent = String(w.patternIdx % W.recoilPattern.length)
    el.since.textContent = Math.min(w.lastShotT, 99).toFixed(2) + ' s'
    el.acc.textContent = w.shots ? Math.round((w.hits / w.shots) * 100) + '%' : '—'
    el.scopet.textContent = L.scopeT.toFixed(2)
    el.zones.textContent = `${w.zoneHits.head} / ${w.zoneHits.body} / ${w.zoneHits.legs}`
    el.dmg.textContent = w.dmgDealt.toFixed(1)

    drawPattern(w, W, !player.grounded)
    drawScatter(w)
  }

  return {
    record,
    update,
    isOpen: () => open,
    toggle() {
      open = !open
      root.classList.toggle('open', open)
    },
  }
}
