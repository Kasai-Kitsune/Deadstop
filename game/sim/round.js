// sim/round.js — the Capture and Bomb round loop (spec §6) at M3b fidelity:
// one bomb, one carrier, hold-E plant/defuse, no respawns in-round, halftime
// side swap, first to N round wins. Pure and deterministic: no DOM, no Three,
// no network, no Math.random, no Date — a server (M4) can own this verbatim.
//
// The module is map-agnostic: the session passes the zone AABBs in ctx
// ({ capture, A, B } — the same {min,max} box convention as map geometry).
// Actors are passed in per tick: [{ id, side, alive, pos:{x,y,z}, interact }]
// (interact = the E key / a bot's plant-defuse intent). Damage, deaths, and
// K/D are the caller's glue — this file only reads `alive` and writes the
// round state machine and its events.
//
// Simplifications vs the full spec (all tunable in config.round, flagged
// [GAP] there): plant/defuse progress resets on interrupt; a dropped bomb is
// picked up by proximity; and post-plant elimination of the attackers does
// NOT end the round (the bomb is live — defenders must defuse). That last
// rule reads §6's win list in its pre-plant sense; config.round.postPlantElimWins
// flips it to the literal reading if the designer wants that instead.

const SIDE = { ATT: 'attackers', DEF: 'defenders' }

export function createRound(cfg) {
  return {
    phase: 'freeze', // freeze -> capture -> bomb -> planted -> roundEnd -> matchEnd
    roundNum: 1,
    scores: { attackers: 0, defenders: 0 }, // per SQUAD (swapped at halftime with the squads)
    halftimeDone: false,
    matchOver: false,
    matchWinner: null, // side name of the winning squad (post-halftime labels)
    // per-phase clocks (s remaining)
    freezeT: 0,
    phaseT: 0,
    fuseT: 0,
    roundEndT: 0,
    lastWinner: null, // { side, reason } of the most recent finished round
    // capture progress 0..1 (also drains after unlock — the retake lever)
    capture: 0,
    unlocked: false,
    // the bomb
    bomb: {
      state: 'carried', // carried | dropped | planted | defused | detonated
      carrierId: null,
      pos: null, // {x,y,z} while dropped/planted
      site: null, // 'A' | 'B'
      plantT: 0, // hold progress
      defuseT: 0,
      defuserId: null,
    },
    events: [], // reused per tick; callers must consume before the next tick
  }
}

// (Re)start a round: reset per-round state and hand the bomb to an attacker —
// the PLAYER if they attack (playtesting the plant loop should be frictionless),
// else the first alive attacker bot. Called by the session on match start and
// after every roundEnd.
export function startRound(R, cfg, actors) {
  R.phase = 'freeze'
  R.freezeT = cfg.round.freezeTime
  R.phaseT = cfg.round.phase1Time
  R.fuseT = 0
  R.roundEndT = 0
  R.capture = 0
  R.unlocked = false
  R.bomb.state = 'carried'
  R.bomb.pos = null
  R.bomb.site = null
  R.bomb.plantT = 0
  R.bomb.defuseT = 0
  R.bomb.defuserId = null
  const attackers = actors.filter((a) => a.side === SIDE.ATT)
  const player = actors.find((a) => a.id === 'player')
  R.bomb.carrierId =
    player && player.side === SIDE.ATT ? 'player' : (attackers.find((a) => a.alive) || {}).id ?? null
  R.events.push({ type: 'roundStart', round: R.roundNum })
}

function inZone(z, p, height) {
  if (!z) return false
  return (
    p.x >= z.min[0] && p.x <= z.max[0] &&
    p.z >= z.min[2] && p.z <= z.max[2] &&
    p.y >= z.min[1] && p.y <= z.min[1] + height
  )
}

// ctx = { cfg, actors, zones: { capture, A, B } }
export function stepRound(R, ctx, dt) {
  R.events.length = 0
  const { cfg, actors, zones } = ctx
  const RD = cfg.round
  const aliveOf = (side) => actors.some((a) => a.side === side && a.alive)
  const byId = (id) => actors.find((a) => a.id === id)

  if (R.phase === 'matchEnd') return R.events

  // ---- round-end banner countdown; one-shot crossing events so the session
  //      can restart the round (or land on the match-end screen) exactly once
  if (R.phase === 'roundEnd') {
    if (R.roundEndT > 0) {
      R.roundEndT -= dt
      if (R.roundEndT <= 0) {
        R.roundEndT = 0
        if (R.matchOver) {
          R.phase = 'matchEnd'
          R.events.push({ type: 'matchOver', side: R.matchWinner })
        } else {
          R.events.push({ type: 'roundEndDone' }) // session: nextRound() + reset + startRound
        }
      }
    }
    return R.events
  }

  // ---- elimination checks (spec §6). Post-plant the bomb stays live unless
  //      postPlantElimWins flips the rule to the literal spec reading.
  if (R.phase !== 'freeze' && R.phase !== 'roundEnd') {
    if (!aliveOf(SIDE.ATT)) {
      if (R.phase !== 'planted' || RD.postPlantElimWins) {
        endRound(R, cfg, SIDE.DEF, 'attackers_dead')
        return R.events
      }
    }
    if (!aliveOf(SIDE.DEF) && R.unlocked) {
      endRound(R, cfg, SIDE.ATT, 'defenders_dead')
      return R.events
    }
  }

  if (R.phase === 'freeze') {
    R.freezeT -= dt
    if (R.freezeT <= 0) {
      R.phase = 'capture'
      R.events.push({ type: 'freezeEnd' })
    }
    return R.events
  }

  if (R.phase === 'capture' || R.phase === 'bomb') {
    // ---- capture point: attackers alone fill, defenders alone drain (retake),
    //      contested or empty freezes. Draining to 0 after unlock closes the
    //      plant window (spec: "defenders may retake... to close the plant window").
    const attIn = actors.some((a) => a.side === SIDE.ATT && a.alive && inZone(zones.capture, a.pos, RD.captureHeight))
    const defIn = actors.some((a) => a.side === SIDE.DEF && a.alive && inZone(zones.capture, a.pos, RD.captureHeight))
    if (attIn && !defIn) R.capture = Math.min(1, R.capture + dt / RD.captureTime)
    else if (defIn && !attIn) R.capture = Math.max(0, R.capture - dt / RD.drainTime)

    if (!R.unlocked && R.capture >= 1) {
      R.unlocked = true
      R.phase = 'bomb'
      R.phaseT = RD.phase2Time
      R.events.push({ type: 'unlock' })
    } else if (R.unlocked && R.bomb.state !== 'planted') {
      // retake: defenders drained the point back to zero before the plant —
      // the plant window closes and the round goes to the defenders
      if (R.capture <= 0) {
        endRound(R, cfg, SIDE.DEF, 'retake')
        return R.events
      }
    }

    // phase timer (stops once planted — the fuse governs then)
    if (R.phase !== 'planted') {
      R.phaseT -= dt
      if (R.phaseT <= 0) {
        endRound(R, cfg, SIDE.DEF, 'timer')
        return R.events
      }
    }
  }

  // ---- the bomb: carried -> dropped -> picked up / planted -> defuse/detonate
  if (R.phase === 'bomb' || R.phase === 'planted') {
    const bomb = R.bomb

    if (bomb.state === 'carried') {
      const carrier = byId(bomb.carrierId)
      if (!carrier || !carrier.alive) {
        bomb.state = 'dropped'
        bomb.pos = carrier ? { ...carrier.pos } : null
        R.events.push({ type: 'bombDrop', pos: bomb.pos, id: bomb.carrierId })
        bomb.carrierId = null
      } else {
        bomb.pos = { ...carrier.pos }
      }
    }

    if (bomb.state === 'dropped') {
      // any alive attacker walking over the bomb takes it (player included —
      // the session passes the player as an ordinary actor)
      const picker = actors.find(
        (a) => a.side === SIDE.ATT && a.alive && bomb.pos &&
          Math.hypot(a.pos.x - bomb.pos.x, a.pos.z - bomb.pos.z) <= RD.bombPickupRadius
      )
      if (picker) {
        bomb.state = 'carried'
        bomb.carrierId = picker.id
        R.events.push({ type: 'bombPickup', id: picker.id })
      }
    }

    if (bomb.state === 'carried' && R.phase === 'bomb') {
      // planting: carrier holds E inside a site. Interrupt = full reset (basic).
      const carrier = byId(bomb.carrierId)
      const site = inZone(zones.A, carrier.pos, RD.captureHeight) ? 'A'
        : inZone(zones.B, carrier.pos, RD.captureHeight) ? 'B' : null
      const holding = carrier.alive && carrier.interact && site !== null
      if (holding) {
        if (bomb.plantT === 0) R.events.push({ type: 'plantStart', id: carrier.id })
        bomb.plantT += dt
        if (bomb.plantT >= RD.plantTime) {
          bomb.state = 'planted'
          bomb.site = site
          bomb.pos = { ...carrier.pos }
          bomb.plantedById = carrier.id
          R.phase = 'planted'
          R.fuseT = RD.fuseTime
          R.events.push({ type: 'planted', id: carrier.id, site })
        }
      } else {
        bomb.plantT = 0
      }
    }

    if (bomb.state === 'planted') {
      R.fuseT -= dt
      if (R.fuseT <= 0) {
        bomb.state = 'detonated'
        endRound(R, cfg, SIDE.ATT, 'detonation')
        return R.events
      }
      // defusing: an alive defender holds E within defuseRadius. Release resets (basic).
      const defuser = actors.find(
        (a) => a.side === SIDE.DEF && a.alive && a.interact && bomb.pos &&
          Math.hypot(a.pos.x - bomb.pos.x, a.pos.z - bomb.pos.z) <= RD.defuseRadius &&
          Math.abs(a.pos.y - bomb.pos.y) <= RD.defuseRadius
      )
      if (defuser) {
        if (bomb.defuseT === 0) R.events.push({ type: 'defuseStart', id: defuser.id })
        bomb.defuseT += dt
        bomb.defuserId = defuser.id
        if (bomb.defuseT >= RD.defuseTime) {
          bomb.state = 'defused'
          endRound(R, cfg, SIDE.DEF, 'defuse')
          return R.events
        }
      } else {
        bomb.defuseT = 0
        bomb.defuserId = null
      }
    }
  }

  return R.events
}

function endRound(R, cfg, side, reason) {
  R.phase = 'roundEnd'
  R.roundEndT = cfg.round.roundEndTime
  R.lastWinner = { side, reason }
  R.scores[side]++
  R.events.push({ type: 'roundEnd', side, reason })
  if (R.scores[side] >= cfg.round.roundsToWin) {
    R.matchOver = true
    R.matchWinner = side
    R.events.push({ type: 'matchEnd', side })
  }
}

// Advance to the next round after the roundEnd banner. Emits 'halftime' when
// the squads swap sides (the caller flips every actor's side on that event;
// recorded scores swap here so they keep following the SQUADS).
export function nextRound(R, cfg) {
  if (R.phase !== 'roundEnd' || R.matchOver) return null
  R.roundNum++
  if (!R.halftimeDone && R.roundNum > cfg.round.halftimeRound) {
    R.halftimeDone = true
    const t = R.scores.attackers
    R.scores.attackers = R.scores.defenders
    R.scores.defenders = t
    R.events.push({ type: 'halftime' })
  }
  return R.roundNum
}
