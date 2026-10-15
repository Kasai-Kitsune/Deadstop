// client/scoreboard.js — the VS-bots match chrome (M3b "basic scoreboard and
// round function"): the persistent round strip (score, phase, timer, alive
// dots, capture/fuse bars), the hold-Tab scoreboard table, the kill feed,
// transient banners (round start / capture / planted / round end / match
// end), the player's HP bar + damage vignette, and the plant/defuse prompt.
// Pure DOM in the game's muted-earth chrome; all data comes IN per frame —
// this module owns no game state.

const SIDE_LABEL = { attackers: 'ATTACKERS', defenders: 'DEFENDERS' }
const SIDE_CLASS = { attackers: 'att', defenders: 'def' }
const REASON_TEXT = {
  detonation: 'the bomb detonated',
  defuse: 'the bomb was defused',
  attackers_dead: 'the attackers are down',
  defenders_dead: 'the defenders are down',
  timer: 'time expired',
  retake: 'the point was retaken',
}

function fmtTime(t) {
  const s = Math.max(0, Math.ceil(t))
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0')
}

export function createScoreboard() {
  const root = document.getElementById('round-hud')
  root.innerHTML = `
    <div class="score"><span id="rh-att">0</span><span class="dash">:</span><span id="rh-def">0</span></div>
    <div class="mid">
      <div class="alive" id="rh-att-alive"></div>
      <div class="phase">
        <div id="rh-phase">—</div>
        <div id="rh-timer">0:00</div>
      </div>
      <div class="alive" id="rh-def-alive"></div>
    </div>
    <div class="bar"><div id="rh-cap"></div></div>`
  const $ = (id) => root.querySelector('#' + id)
  const el = {
    att: $('rh-att'), def: $('rh-def'),
    attAlive: $('rh-att-alive'), defAlive: $('rh-def-alive'),
    phase: $('rh-phase'), timer: $('rh-timer'), cap: $('rh-cap'),
  }

  // Tab scoreboard
  const board = document.getElementById('scoreboard')
  board.innerHTML = `
    <header><b id="sb-title">HOLMGANG</b><span id="sb-round">round 1</span></div>
    <table id="sb-att"></table>
    <table id="sb-def"></table>
    <p class="tip">hold TAB — killer [weapon] victim</p>`

  // kill feed
  const feed = document.getElementById('feed')

  // center banner
  const banner = document.getElementById('banner')

  // player HP + hit vignette
  const hp = document.getElementById('hp')
  hp.innerHTML = `<div class="hp-bar"><div id="hp-fill"></div></div><b id="hp-num">100</b>`
  const hpFill = hp.querySelector('#hp-fill')
  const hpNum = hp.querySelector('#hp-num')
  const vignette = document.getElementById('vignette')

  // plant/defuse progress + prompt
  const progress = document.getElementById('progress')
  progress.innerHTML = `<div class="p-label" id="p-label"></div><div class="p-bar"><div id="p-fill"></div></div>`
  const pLabel = progress.querySelector('#p-label')
  const pFill = progress.querySelector('#p-fill')

  const spectate = document.getElementById('spectate')

  let bannerT = 0
  const feedItems = []

  function bannerShow(main, sub, seconds) {
    banner.innerHTML = `<b>${main}</b>${sub ? '<span>' + sub + '</span>' : ''}`
    banner.classList.add('show')
    bannerT = seconds
  }

  function hideBanner() {
    bannerT = 0
    banner.classList.remove('show')
  }

  function onFeed(item) {
    feedItems.push({ ...item, t: 6 })
    if (feedItems.length > 5) feedItems.shift()
  }

  function rows(side, actors, R, playerId) {
    const list = actors.filter((a) => a.side === side)
    const trs = list
      .map((a) => {
        const name = a.id === playerId ? 'YOU' : a.name || a.id
        const bomb = R.bomb.carrierId === a.id && R.bomb.state === 'carried' ? ' <i class="bomb">◆</i>' : ''
        const cls = a.id === playerId ? 'you' : a.alive ? '' : 'dead'
        return `<tr${cls ? ' class="' + cls + '"' : ''}><td>${name}${bomb}</td><td>${a.kills || 0}</td><td>${a.deaths || 0}</td></tr>`
      })
      .join('')
    return `<thead><tr><th>${SIDE_LABEL[side]}</th><th>K</th><th>D</th></tr></thead><tbody>${trs}</tbody>`
  }

  function update(dt, ctx) {
    const { R, actors, player, spectating, matchName } = ctx
    if (!R) return
    // -- score strip
    el.att.textContent = R.scores.attackers
    el.def.textContent = R.scores.defenders
    const aliveDots = (side) => {
      const n = actors.filter((a) => a.side === side && a.alive).length
      const total = actors.filter((a) => a.side === side).length
      let s = ''
      for (let i = 0; i < total; i++) s += '<i' + (i < n ? ' class="on"' : '') + '></i>'
      return s
    }
    el.attAlive.innerHTML = aliveDots('attackers')
    el.defAlive.innerHTML = aliveDots('defenders')

    // phase + timer
    let phase = '—'
    let timer = 0
    let timerHot = false
    if (R.phase === 'freeze') { phase = 'ROUND ' + R.roundNum; timer = R.freezeT }
    else if (R.phase === 'capture') { phase = 'CAPTURE'; timer = R.phaseT }
    else if (R.phase === 'bomb') { phase = 'SITES OPEN'; timer = R.phaseT }
    else if (R.phase === 'planted') { phase = 'BOMB LIVE'; timer = R.fuseT; timerHot = true }
    else if (R.phase === 'roundEnd') { phase = 'ROUND OVER'; timer = R.roundEndT }
    else if (R.phase === 'matchEnd') { phase = 'MATCH OVER'; timer = 0 }
    el.phase.textContent = phase
    el.timer.textContent = fmtTime(timer)
    el.timer.classList.toggle('hot', timerHot)

    // capture bar: fills in phase 1, drains on retake, hides when planted
    const showCap = R.phase === 'capture' || R.phase === 'bomb'
    root.classList.toggle('cap-on', showCap)
    if (showCap) el.cap.style.width = (R.capture * 100).toFixed(1) + '%'
    root.classList.toggle('cap-full', R.capture >= 1)

    // -- Tab scoreboard (rebuild only while held — cheap enough at 60 fps)
    if (board.classList.contains('show')) {
      board.querySelector('#sb-round').textContent =
        'round ' + R.roundNum + (matchName ? ' · ' + matchName : '')
      board.querySelector('#sb-att').innerHTML = rows('attackers', actors, R, player.id)
      board.querySelector('#sb-def').innerHTML = rows('defenders', actors, R, player.id)
    }

    // -- kill feed decay
    let html = ''
    for (const it of feedItems) {
      it.t -= dt
      if (it.t <= 0) continue
      const w = FEED_WS[it.weapon] || ''
      html += `<div class="k ${SIDE_CLASS[it.killerSide] || ''}" style="opacity:${Math.min(1, it.t / 1.5).toFixed(2)}">
        <b>${it.killer}</b><span>${w}</span><em>▸</em><b class="v">${it.victim}</b>${it.headshot ? '<i class="hs">✷</i>' : ''}</div>`
    }
    feed.innerHTML = html
    while (feedItems.length && feedItems[0].t <= 0) feedItems.shift()

    // -- banner decay
    if (bannerT > 0) {
      bannerT -= dt
      if (bannerT <= 0) banner.classList.remove('show')
    }

    // -- player HP
    const frac = Math.max(0, Math.min(1, (player.hp || 0) / Math.max(player.maxHp || 100, 1)))
    hpFill.style.width = (frac * 100).toFixed(1) + '%'
    hpNum.textContent = String(Math.ceil(player.hp || 0))
    hpFill.classList.toggle('low', frac <= 0.35)
    vignette.classList.toggle('show', (player.hitFlash || 0) > 0)

    // -- spectate note
    if (spectating) {
      spectate.classList.add('show')
      spectate.innerHTML = `ELIMINATED — spectating <b>${spectating.name}</b> · <i>LMB</i> next`
    } else {
      spectate.classList.remove('show')
    }
  }

  function setProgress(label, frac) {
    if (label === null) {
      progress.classList.remove('show')
      return
    }
    progress.classList.add('show')
    pLabel.textContent = label
    pFill.style.width = (Math.min(1, Math.max(0, frac)) * 100).toFixed(1) + '%'
  }

  return { update, banner: bannerShow, hideBanner, onFeed, setProgress, showScoreboard: (v) => board.classList.toggle('show', v) }
}

// weapon display names for the feed (kept local: presentation strings, not balance)
const FEED_WS = { ar: 'AR', smg: 'SMG', shotgun: 'SG', sniper: 'TR' }
