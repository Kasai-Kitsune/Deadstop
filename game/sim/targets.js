// sim/targets.js — killable range dummies (M2+). HP matches spec §5 player
// health so TTK targets are testable; death and fast respawn are SIM state
// (deterministic, server-ownable in M4). The client only mirrors this state
// into topple/rise animations. Pure: no DOM, no Three, no network.

// defs: the map's target definitions (id + zone boxes). cfg read LIVE.
export function createTargets(defs, cfg) {
  const list = defs.map((d) => ({
    id: d.id,
    hp: cfg.dummies.hp,
    alive: true,
    respawnT: 0, // s remaining while dead
  }))
  const byId = {}
  for (const t of list) byId[t.id] = t
  return { list, byId, kills: 0 }
}

// Apply damage to one dummy. Returns { killed, hp } or null when the target
// doesn't exist or is already down (overkill / shooting a corpse = no-op).
// Damage application is the caller's glue (main.js): the weapon sim computes
// the number, this module owns health, death, and respawn.
export function hurtTargets(T, id, amount, cfg) {
  const t = T.byId[id]
  if (!t || !t.alive || amount <= 0) return null
  t.hp -= amount
  if (t.hp <= 0) {
    t.hp = 0
    t.alive = false
    t.respawnT = cfg.dummies.respawnTime
    T.kills++
    return { killed: true, hp: 0 }
  }
  return { killed: false, hp: t.hp }
}

// Respawn timers. Returns this tick's events: [{ type: 'respawn', id }].
// hp refills from LIVE config, so panel edits apply to future respawns.
export function stepTargets(T, cfg, dt) {
  const events = []
  for (const t of T.list) {
    if (t.alive) continue
    t.respawnT -= dt
    if (t.respawnT <= 0) {
      t.alive = true
      t.hp = cfg.dummies.hp
      t.respawnT = 0
      events.push({ type: 'respawn', id: t.id })
    }
  }
  return events
}
