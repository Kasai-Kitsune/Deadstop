// client/hud.js — the tune-by-feel readouts. Top-left: movement (M1) + live
// spread. Under it: range telemetry (shots/hits/acc/kills + the last hit's
// damage, zone, and distance — the numbers you balance the guns against).
// Bottom-right: the carry-2 loadout — slot chips (1/2), the weapon in hand,
// ammo, reload bar. All fed straight from the sim's loadout + targets state.

import { CONFIG } from '../config.js'

export function createHud() {
  const root = document.getElementById('hud')
  root.innerHTML = `
    <div class="row"><span class="k">speed</span><span id="hud-speed">0.00 m/s</span></div>
    <div class="row"><span class="k">target</span><span id="hud-target">—</span></div>
    <div class="row"><span class="k">stance</span><span id="hud-stance">stand</span></div>
    <div class="row"><span class="k">friction</span><span id="hud-friction">—</span></div>
    <div class="row"><span class="k">spread</span><span id="hud-spread">—</span></div>
    <div class="row"><span class="k">pos</span><span id="hud-pos">—</span></div>`
  const $ = (id) => root.querySelector('#' + id)
  const el = {
    speed: $('hud-speed'), target: $('hud-target'), stance: $('hud-stance'),
    friction: $('hud-friction'), spread: $('hud-spread'), pos: $('hud-pos'),
  }

  const range = document.getElementById('range-hud')
  range.innerHTML = `
    <div class="row"><span class="k">shots</span><span id="rh-shots">0</span></div>
    <div class="row"><span class="k">hits</span><span id="rh-hits">0</span></div>
    <div class="row"><span class="k">acc</span><span id="rh-acc">—</span></div>
    <div class="row"><span class="k">kills</span><span id="rh-kills">0</span></div>
    <div class="row"><span class="k">dmg</span><span id="rh-dmg">0.0</span></div>
    <div class="row"><span class="k">last</span><span id="rh-last">—</span></div>`
  const rel = {
    shots: range.querySelector('#rh-shots'), hits: range.querySelector('#rh-hits'),
    acc: range.querySelector('#rh-acc'), kills: range.querySelector('#rh-kills'),
    dmg: range.querySelector('#rh-dmg'), last: range.querySelector('#rh-last'),
  }

  // weapon block: slot chips from the loadout's config key order (1 = AR, 2 = sniper)
  const ids = Object.keys(CONFIG.weapons)
  const wroot = document.getElementById('weapon-hud')
  wroot.innerHTML = `
    <div class="slots">${ids.map((id, i) => `<span class="chip" data-slot="${i}">${i + 1} ${CONFIG.weapons[id].name}</span>`).join('')}</div>
    <div class="name" id="wh-name"></div>
    <div class="ammo"><b id="wh-ammo">—</b><span id="wh-mag"></span></div>
    <div class="reload"><div id="wh-bar"></div></div>
    <div class="hint" id="wh-hint"></div>`
  const chips = Array.from(wroot.querySelectorAll('.chip'))
  const wel = {
    name: wroot.querySelector('#wh-name'), ammo: wroot.querySelector('#wh-ammo'),
    mag: wroot.querySelector('#wh-mag'), bar: wroot.querySelector('#wh-bar'),
    hint: wroot.querySelector('#wh-hint'),
  }
  let lastName = ''

  return {
    update(state, input, loadout, targets) {
      const v = state.vel
      const planar = Math.hypot(v.x, v.z)
      el.speed.textContent = planar.toFixed(2) + ' m/s'
      el.target.textContent = state.targetSpeed.toFixed(2) + ' m/s'
      let stance = state.stance
      if (input.walk && state.stance === 'stand') stance += ' · walk'
      if (!state.grounded) stance += ' · air'
      el.stance.textContent = stance
      // the actually-applied value this tick — the number you're tuning by feel
      el.friction.textContent = state.friction.toFixed(2)
      const w = loadout.slots[loadout.active]
      el.spread.textContent = w.spread.toFixed(2) + '\u00b0'
      el.pos.textContent = `${state.pos.x.toFixed(1)}, ${state.pos.y.toFixed(2)}, ${state.pos.z.toFixed(1)}`

      // range telemetry (per weapon in hand — compare the AR's acc to the sniper's)
      rel.shots.textContent = String(w.shots)
      rel.hits.textContent = String(w.hits)
      rel.acc.textContent = w.shots ? Math.round((w.hits / w.shots) * 100) + '%' : '—'
      rel.kills.textContent = String(targets.kills)
      rel.dmg.textContent = w.dmgDealt.toFixed(1)
      const lh = w.lastHit
      if (!lh) rel.last.textContent = '—'
      else if (lh.miss) rel.last.textContent = 'past max range'
      else if (lh.wall) rel.last.textContent = 'wall · ' + lh.dist.toFixed(0) + ' m'
      else rel.last.textContent = `${lh.zone} ${lh.damage.toFixed(1)} · ${lh.dist.toFixed(0)} m`

      // loadout block
      const W = CONFIG.weapons[w.id]
      chips.forEach((c, i) => c.classList.toggle('on', i === loadout.active))
      const name = W.name + (loadout.scoped ? ' · scoped' : '')
      if (name !== lastName) {
        wel.name.textContent = name
        lastName = name
      }
      wel.ammo.textContent = String(w.ammo)
      wel.ammo.classList.toggle('empty', w.ammo === 0)
      wel.mag.textContent = ' / ' + W.magSize
      const reloading = w.reloadT > 0
      wel.bar.style.width = reloading
        ? (100 * (1 - w.reloadT / Math.max(W.reloadTime, 1e-4))).toFixed(1) + '%'
        : '0%'
      if (loadout.switchT > 0) wel.hint.textContent = 'swapping…'
      else if (reloading) wel.hint.textContent = 'reloading…'
      else if (w.ammo === 0) wel.hint.textContent = 'R — reload'
      else if (loadout.scoped) wel.hint.textContent = 'RMB — hold to stay scoped'
      else wel.hint.textContent = ''
    },
  }
}
