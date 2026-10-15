// client/lobby.js — the pre-match menu behind the VS-BOTS door (user brief:
// "Before launching the game you can edit a few things through the game's
// intended interface (which weapons to start with and which side you are
// on)"). A modal card in the game's own chrome — NOT the debug panel, NOT a
// global: it hands a plain { side, weapons } setup object to its onLaunch
// callback, so when weapon acquisition changes later (buy menus, pickups)
// only the caller that consumes the setup changes.
//
// Exactly two weapons are chosen (the classic carry-2): toggling a third
// replaces the OLDEST pick, so the pair is always coherent. Defaults mirror
// cfg.loadout.slots (AR + Thermal Rifle).

import { CONFIG } from '../config.js'

const SIDES = [
  { id: 'attackers', label: 'ATTACKERS', sub: 'capture the point · plant the bomb' },
  { id: 'defenders', label: 'DEFENDERS', sub: 'hold the point · defuse' },
]

export function createLobby({ onLaunch, onCancel }) {
  const root = document.getElementById('lobby')
  const ids = Object.keys(CONFIG.weapons)
  let side = 'attackers'
  let picks = (cfgSlots() || ids.slice(0, 2)).filter((id) => CONFIG.weapons[id]).slice(0, 2)

  function cfgSlots() {
    const s = CONFIG.loadout && CONFIG.loadout.slots
    return Array.isArray(s) && s.length ? s : null
  }

  root.innerHTML = `
    <div class="card">
      <h1>VS BOTS <span>— Capture &amp; Bomb</span></h1>
      <p class="sub">one round map (HOLMGANG) · ${CONFIG.match.teamSize}v${CONFIG.match.teamSize} · first to ${CONFIG.round.roundsToWin} round wins · no respawns in-round</p>

      <h2>side</h2>
      <div class="sides"></div>

      <h2>starting weapons <span class="hint">carry-2 — keys 1 / 2 swap</span></h2>
      <div class="weapons"></div>

      <div class="actions">
        <button class="cancel" type="button">back (Esc)</button>
        <button class="launch" type="button">LAUNCH MATCH</button>
      </div>
      <p class="note" id="lobby-note"></p>
    </div>`

  const sidesEl = root.querySelector('.sides')
  const weaponsEl = root.querySelector('.weapons')
  const note = root.querySelector('#lobby-note')
  const launchBtn = root.querySelector('.launch')

  function render() {
    sidesEl.innerHTML = SIDES.map(
      (s) =>
        `<button type="button" class="side ${SIDE_CLASSES[s.id]} ${side === s.id ? 'on' : ''}" data-side="${s.id}">
           <b>${s.label}</b><span>${s.sub}</span></button>`
    ).join('')
    weaponsEl.innerHTML = ids.map((id) => {
      const slot = picks.indexOf(id)
      return `<button type="button" class="weapon ${slot >= 0 ? 'on' : ''}" data-w="${id}">
          <b>${CONFIG.weapons[id].name}</b>
          <span>${slot >= 0 ? 'slot ' + (slot + 1) : weaponBlurb(id)}</span>
        </button>`
    }).join('')

    launchBtn.disabled = picks.length !== 2
    note.textContent =
      picks.length === 2
        ? side === 'attackers'
          ? 'you carry the bomb — plant at A or B after the capture'
          : 'defend the point; the bomb must never detonate'
        : 'pick two weapons'
  }

  root.addEventListener('click', (e) => {
    const sideBtn = e.target.closest('[data-side]')
    if (sideBtn) {
      side = sideBtn.dataset.side
      render()
      return
    }
    const wBtn = e.target.closest('[data-w]')
    if (wBtn) {
      const id = wBtn.dataset.w
      const at = picks.indexOf(id)
      if (at >= 0) picks.splice(at, 1) // toggle off
      else {
        if (picks.length >= 2) picks.shift() // oldest out — carry-2 stays honest
        picks.push(id)
      }
      render()
      return
    }
    if (e.target.closest('.launch')) {
      if (picks.length === 2) {
        close()
        onLaunch({ side, weapons: [...picks] })
      }
    } else if (e.target.closest('.cancel')) {
      close()
      onCancel()
    } else if (e.target === root) {
      close()
      onCancel()
    }
  })

  function open() {
    root.hidden = false
    render()
  }
  function close() {
    root.hidden = true
  }
  return { open, close, isOpen: () => !root.hidden }
}

const SIDE_CLASSES = { attackers: 'att', defenders: 'def' }

// one-line role blurbs (presentation strings, mirrors of config comments)
function weaponBlurb(id) {
  return {
    ar: 'the median — 0.80 s TTK at any range',
    smg: 'close pressure — 0.64 s up close',
    shotgun: 'burst — 2 pumps to ~20 m',
    sniper: 'long — 1 headshot, thermal scope',
  }[id] || ''
}
