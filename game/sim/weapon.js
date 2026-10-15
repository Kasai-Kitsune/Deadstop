// sim/weapon.js — the LOADOUT tick: the classic carry-2 system (slot order =
// config.weapons key order), the switch state machine, the Thermal Rifle's scope
// state + deterministic scope sway, and per-weapon fire/ammo/spread/recoil.
// Pure like the rest of sim/: no DOM, no Three, no network. The ONLY randomness
// in the sim comes from a seeded mulberry32 stream created with each weapon, so
// every session is bit-reproducible and a server (M4) can replay any shot.
//
// AR behavior is bit-identical to M2 on the ground: same model, same seeds, same
// events — everything is parameterized by W = cfg.weapons[w.id] (read LIVE each
// tick). One addition: an optional per-weapon recoilPatternAir — airborne shots
// read rows from it instead of the ground pattern (the AR's S-drift becomes a
// snappy Z-drift the moment you leave the floor; the shared pattern index just
// keeps advancing, so ground sprays that never jump are unchanged).
//
// M3: the arsenal is four weapons but the CARRY stays classic two-hand —
// createLoadout reads cfg.loadout.slots (ids), and `input.equip` (the range's
// weapon wall, E key) swaps the gun in hand for a fresh one mid-match.
// Weapons with a pelletLayout (the shotgun) fire one hitscan ray PER PELLET
// from fixed unit-cone coordinates + seeded jitter, each pellet damage-falloff
// by its own hit distance — the anti-cliff blast curve lives in config data.

import { castRay } from './hitscan.js'

const DEG2RAD = Math.PI / 180
const PITCH_LIMIT = Math.PI / 2 - 0.001 // shots can't pitch past straight up/down (geometry, not a tunable)
const TAU = Math.PI * 2

// mulberry32 — small, fast, seedable. One stream per weapon slot.
function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v
}

function moveToward(v, target, maxStep) {
  if (v < target) return Math.min(v + maxStep, target)
  return Math.max(v - maxStep, target)
}

// View angles -> unit look direction. Yaw 0 faces -Z (same convention as
// sim/player.js wishDir, so the server can reuse this with plain numbers).
export function dirFrom(yaw, pitch) {
  const cp = Math.cos(pitch)
  return { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp }
}

// Rotate v around a unit axis by ang radians (Rodrigues) — exact, no drift.
function rotateAround(v, axis, ang) {
  const c = Math.cos(ang)
  const s = Math.sin(ang)
  const dot = axis.x * v.x + axis.y * v.y + axis.z * v.z
  return {
    x: v.x * c + (axis.y * v.z - axis.z * v.y) * s + axis.x * dot * (1 - c),
    y: v.y * c + (axis.z * v.x - axis.x * v.z) * s + axis.y * dot * (1 - c),
    z: v.z * c + (axis.x * v.y - axis.y * v.x) * s + axis.z * dot * (1 - c),
  }
}

function cross(a, b) {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x }
}
function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z
}
function normalize(v) {
  const l = Math.hypot(v.x, v.y, v.z)
  return l > 1e-9 ? { x: v.x / l, y: v.y / l, z: v.z / l } : { x: 0, y: 0, z: 0 }
}

// The aim axis's tangent basis (right/up) for cone offsets.
function aimBasis(aim) {
  const right = normalize(cross(aim, { x: 0, y: 1, z: 0 }))
  const up = cross(right, aim)
  return { right, up }
}

// Deflect the aim axis by `alpha` rad around the cone axis at angle `theta`.
// Returns the deflected unit dir plus its offset in the aim's tangent plane
// (degrees) so the debug overlay can scatter-plot exactly where the shot went.
function deflectAt(aim, right, up, alpha, theta) {
  const axis = normalize({
    x: right.x * Math.cos(theta) + up.x * Math.sin(theta),
    y: right.y * Math.cos(theta) + up.y * Math.sin(theta),
    z: right.z * Math.cos(theta) + up.z * Math.sin(theta),
  })
  const dir = alpha > 0 ? rotateAround(aim, axis, alpha) : aim
  const d = Math.max(dot(dir, aim), 1e-9)
  return {
    dir,
    offYawDeg: Math.atan2(dot(dir, right), d) / DEG2RAD,
    offPitchDeg: Math.atan2(dot(dir, up), d) / DEG2RAD,
  }
}

// Random spread: uniform disc in the cone of `spreadRad` around the aim axis
// (spec §5: "random spread is separate and uses the spread value above").
// The draw order (theta, then alpha) is load-bearing: the AR/sniper streams
// are pinned bit-identical to M2 by it.
function coneOffset(aim, spreadRad, rng) {
  const { right, up } = aimBasis(aim)
  const theta = rng() * Math.PI * 2
  const alpha = spreadRad * Math.sqrt(rng())
  return deflectAt(aim, right, up, alpha, theta)
}

// Fixed-layout pellet (the shotgun): a unit-cone [x=right, y=up] offset from
// config's pelletLayout, scaled to the LIVE spread cone, plus a seeded jitter
// disc (a fraction of the cone) so repeated blasts differ without ever
// leaving the cone the crosshair shows. jitter 0 = the pure deterministic
// layout (what the verify script pins the blast table against).
// NOTE the -90°: rotating the aim around the `right` axis deflects it toward
// `up`, so to deflect ALONG [vx, vy] the rotation axis must be the layout
// vector's perpendicular — otherwise the whole layout lands rotated 90°.
function layoutOffset(aim, right, up, spreadRad, layoutXY, jitter, rng) {
  let vx = layoutXY[0]
  let vy = layoutXY[1]
  if (jitter > 0) {
    const jt = rng() * TAU
    const jr = jitter * Math.sqrt(rng())
    vx += jr * Math.cos(jt)
    vy += jr * Math.sin(jt)
    const r = Math.hypot(vx, vy)
    if (r > 1) {
      vx /= r
      vy /= r
    }
  }
  const alpha = Math.hypot(vx, vy) * spreadRad
  const theta = Math.atan2(vy, vx) - Math.PI / 2
  return deflectAt(aim, right, up, alpha, theta)
}

// Damage falloff: 1.0 to falloffStartDist, linear to falloffMinMult at
// falloffEndDist, flat after.
function falloffMult(dist, W) {
  if (dist <= W.falloffStartDist) return 1
  if (dist >= W.falloffEndDist) return W.falloffMinMult
  const t = (dist - W.falloffStartDist) / Math.max(W.falloffEndDist - W.falloffStartDist, 1e-6)
  return 1 + (W.falloffMinMult - 1) * t
}

// ---- per-weapon live state ------------------------------------------------
// `id` keys into cfg.weapons, so every property read is LIVE (panel edits apply
// next tick). Telemetry is per weapon: the range HUD shows the gun in hand.
function createWeaponState(id, cfg, seed) {
  const w = cfg.weapons[id]
  return {
    id,
    ammo: w.magSize,
    reserve: w.reserveAmmo,
    cooldown: 0, // s until the next shot (may carry a negative remainder; see stepWeaponState)
    reloadT: 0, // > 0 while reloading (s remaining)
    prevFire: false,
    prevReload: false,
    lastShotT: 1e9, // s since the last shot — drives recovery + pattern reset
    patternIdx: 0,
    recoil: { pitch: 0, yaw: 0 }, // degrees; the client adds this to the view
    spread: w.baseSpread, // degrees, current
    stanceMult: 1, // smoothed stance multiplier — recoil scale reads this (spec §5)
    rng: mulberry32(seed),
    // range telemetry for the HUD / F3 overlay
    shots: 0,
    hits: 0,
    zoneHits: { head: 0, body: 0, legs: 0 },
    dmgDealt: 0,
    lastHit: null,
  }
}

// ---- the loadout -----------------------------------------------------------
// Classic carry-2: which guns start carried comes from opts.weapons (M3b: the
// arena passes the lobby's picks), falling back to cfg.loadout.slots, falling
// back to every weapon in key order for plain M1-style callers. HOW weapons
// are obtained stays the CALLER's decision (wall equips, lobby picks, a future
// buy menu) — the sim only owns them once they're in hand.
// opts: { seed?, weapons?: [id...], ownerId? } (a bare number is read as the
// legacy seed argument). ownerId excludes the shooter's own hitboxes from
// their shots' raycasts (M3b: the arena gives everyone hitboxes).
// Holstered weapons are fully frozen (no cooldown tick, no reload) — switching
// cancels the active reload with no ammo cost (reserve only deducts at completion).
export function createLoadout(cfg, opts = 0) {
  const o = typeof opts === 'number' ? { seed: opts } : opts || {}
  const ids = ((o.weapons && o.weapons.length ? o.weapons : null) ||
    (cfg.loadout && cfg.loadout.slots && cfg.loadout.slots.length ? cfg.loadout.slots : null) ||
    Object.keys(cfg.weapons)
  ).filter((id) => cfg.weapons[id])
  const seed = (o.seed ?? 0x2f6e2b1) >>> 0
  return {
    t: 0, // accumulated sim seconds — drives scope sway deterministically
    seedBase: seed, // equip seeds derive from this + the equip counter
    ownerId: o.ownerId ?? null, // whose hitboxes this loadout's shots must skip
    equipSeq: 0, // how many wall equips have happened (deterministic seeds)
    slots: ids.map((id, i) => createWeaponState(id, cfg, (seed + i * 0x9e3779b9) >>> 0)),
    active: 0, // slot index in hand
    prevSlot: ids.length > 1 ? 1 : 0, // "last weapon" — Q toggles back to it
    switchT: 0, // s remaining in the current switch (0 = settled)
    switchTotal: 0, // switchTime captured at switch start (progress math)
    prevSwitchTo: null, // raw switch input last tick (edge detection)
    prevEquip: null, // weapon id from the last tick's equip input (edge detection)
    scopeT: 0, // 0..1 scope-in progress (sniper only)
    scoped: false, // true once scopeT crosses 0.5
    prevScoped: false,
    sway: { pitch: 0, yaw: 0 }, // degrees; added to the view like recoil so the dot marks true aim
    moveScale: 1, // multiplies the player's target speed (scoped slow walk)
    events: [], // reused per tick; callers must consume before the next tick
  }
}

export function activeWeapon(L) {
  return L.slots[L.active]
}

// input.switchTo semantics: 0/1 = absolute slot, 'toggle' = last weapon, null = none.
function switchTarget(raw, L) {
  if (raw === 'toggle') return L.prevSlot
  if (raw === 0 || raw === 1) return raw % L.slots.length
  return null
}

export function stepLoadout(L, input, player, cfg, world, dt) {
  L.events.length = 0
  L.t += dt
  const LO = cfg.loadout
  const S = cfg.scope

  // -- weapon wall (E at a station): edge-detected like switching. A gun that
  //    already sits in the OTHER slot is simply DRAWN (a plain slot switch);
  //    a new gun REPLACES the one in hand with a fresh state (full mag — range
  //    rules) and pays the same raise time. The replacement seed derives from
  //    the equip counter, so the whole session stays bit-reproducible (spec §2).
  const equipId = input.equip && cfg.weapons[input.equip] ? input.equip : null
  let equipSwitch = null
  if (equipId && equipId !== L.prevEquip) {
    const other = (L.active + 1) % L.slots.length
    if (L.slots[other].id === equipId) {
      equipSwitch = other // draw the other slot
    } else if (L.slots[L.active].id !== equipId) {
      const old = activeWeapon(L)
      if (old.reloadT > 0) old.reloadT = 0 // stowing mid-reload loses progress only
      L.slots[L.active] = createWeaponState(
        equipId,
        cfg,
        (L.seedBase + L.active * 0x9e3779b9 + ++L.equipSeq * 0x85ebca6b) >>> 0
      )
      L.prevSlot = other // Q flips to the untouched gun
      L.switchT = LO.switchTime
      L.switchTotal = LO.switchTime
      L.events.push({ type: 'equipStart', weapon: equipId, slot: L.active })
    }
  }
  L.prevEquip = equipId

  // -- switching: edge-detected intent. `active` flips immediately (the new gun
  //    comes up); switchT just gates firing/scoping until the raise finishes.
  //    An equip-induced draw bypasses the raw-input edge check (E and 1/2/Q
  //    are independent edges that can arrive on the same tick).
  const target = equipSwitch !== null ? equipSwitch : switchTarget(input.switchTo, L)
  if (
    target !== null &&
    target !== L.active &&
    (equipSwitch !== null || input.switchTo !== L.prevSwitchTo)
  ) {
    const old = activeWeapon(L)
    if (old.reloadT > 0) old.reloadT = 0 // holstering cancels the reload, no ammo lost
    L.prevSlot = L.active
    L.active = target
    L.switchT = LO.switchTime
    L.switchTotal = LO.switchTime
    L.events.push({ type: 'switchStart', from: L.prevSlot, to: target })
  }
  L.prevSwitchTo = input.switchTo
  if (L.switchT > 0) {
    L.switchT -= dt
    if (L.switchT <= 0) {
      L.switchT = 0
      L.events.push({ type: 'switchEnd', slot: L.active })
    }
  }

  // -- scope state machine (spec §5: ADS only on sniper rifles; §8: scope cuts
  //    fog). Reload and switching force it down; firing does not (you stay
  //    scoped through the bolt cycle, classic).
  const w = activeWeapon(L)
  const W = cfg.weapons[w.id]
  const wantScope = !!input.scope && !!W.canScope && L.switchT <= 0 && w.reloadT <= 0
  const scopeStep = dt / Math.max(S.scopeTime, 1e-4)
  L.scopeT = clamp(L.scopeT + (wantScope ? scopeStep : -scopeStep), 0, 1)
  L.scoped = L.scopeT >= 0.5
  if (L.scoped !== L.prevScoped) {
    L.events.push({ type: L.scoped ? 'scopeStart' : 'scopeEnd' })
    L.prevScoped = L.scoped
  }

  // -- scope sway (spec §8 "scope sway"): deterministic Lissajous wander from
  //    sim time — a server can replay it exactly. Scaled by scopeT (zero when
  //    unscoped), by stance (crouch steadies) and by speed (repositioning
  //    wobbles). This offsets the SHOT, not just the picture: skill over flicks.
  if (W.canScope) {
    const speed = Math.hypot(player.vel.x, player.vel.z)
    const speedFactor = clamp(speed / cfg.movement.runSpeed, 0, 1)
    const moveMult = 1 + S.swayMoveMult * Math.pow(speedFactor, W.moveSpreadCurveExp)
    const crouchMult = 1 + (S.swayCrouchMult - 1) * player.crouch
    const amp = S.swayAmpDeg * moveMult * crouchMult * L.scopeT
    const ph = L.t * S.swayRate * TAU
    L.sway.pitch = amp * Math.sin(ph)
    L.sway.yaw = amp * 0.7 * Math.sin(ph * 1.27 + 1.3)
  } else {
    L.sway.pitch = 0
    L.sway.yaw = 0
  }

  // -- scoped movement penalty, continuous through the scope-in (the player
  //    sim multiplies its target speed by this; one tick of latency is fine)
  L.moveScale = 1 + (S.speedMult - 1) * L.scopeT

  // -- tick the weapon in hand. Fire + reload are blocked mid-switch; the
  //    holstered gun doesn't tick at all (frozen, deterministic).
  const wi = L.switchT > 0 ? { ...input, fire: false, reload: false } : input
  stepWeaponState(w, wi, player, cfg, world, dt, L.events, L)
  return L.events
}

function startReload(w, W, out) {
  w.reloadT = W.reloadTime
  w.patternIdx = 0
  out.push({ type: 'reloadStart', duration: W.reloadTime, weapon: w.id })
}

function stepWeaponState(w, input, player, cfg, world, dt, out, L) {
  const W = cfg.weapons[w.id] // LIVE reads — panel sliders apply next tick

  // -- smoothed stance multiplier: the raw value snaps on stance/grounding
  //    changes; recoil scale must glide (spec §5 "(smoothed)"). Spread uses the
  //    raw value — its own tighten/loosen rates do the smoothing there.
  const rawMult = player.grounded
    ? W.stanceSpreadStand + (W.stanceSpreadCrouch - W.stanceSpreadStand) * player.crouch
    : W.stanceSpreadAir
  const k = 1 - Math.exp(-W.stanceMultSmoothRate * dt)
  w.stanceMult += (rawMult - w.stanceMult) * k

  // -- spread (spec §5, verbatim model; speed = planar — falling shouldn't
  //    widen the cone, being airborne already does via the stance multiplier),
  //    times the scope factor: the scoped cone collapses to spreadMult of the
  //    hip cone as scopeT rises (smooth, so quick-scopes pass through every
  //    intermediate value — no snapshot exploit).
  const speed = Math.hypot(player.vel.x, player.vel.z)
  const speedFactor = clamp(speed / cfg.movement.runSpeed, 0, 1)
  const curve = Math.pow(speedFactor, W.moveSpreadCurveExp)
  const scopeFactor = W.canScope ? 1 + (cfg.scope.spreadMult - 1) * L.scopeT : 1
  const spreadTarget = W.baseSpread * rawMult * (1 + W.moveSpread * curve) * scopeFactor
  const rate = spreadTarget < w.spread ? W.tightenRate : W.loosenRate
  w.spread += (spreadTarget - w.spread) * (1 - Math.exp(-rate * dt))

  // -- reload: R starts it (rising edge); a fresh mag restarts the pattern.
  if (input.reload && !w.prevReload && w.reloadT <= 0 && w.ammo < W.magSize && w.reserve > 0) {
    startReload(w, W, out)
  }
  w.prevReload = input.reload
  if (w.reloadT > 0) {
    w.reloadT -= dt
    if (w.reloadT <= 0) {
      w.reloadT = 0
      const take = Math.min(W.magSize - w.ammo, w.reserve)
      w.ammo += take
      w.reserve -= take
      out.push({ type: 'reloadEnd', weapon: w.id })
    }
  }

  // -- firing (full-auto cadence; a 1.2 s bolt interval is just slow full-auto).
  //    Cooldown carries its negative remainder across shots so the rpm is the
  //    real rpm over time, not rounded up to tick multiples. The carry is
  //    clamped to ONE tick of credit: enough to preserve exact cadence under
  //    tick quantization, but idle/switch time can no longer bank a "free"
  //    early shot (at 1.2 s per bolt, the old -interval clamp let the SECOND
  //    shot land 0.75 s after the first right off a weapon swap — the sniper
  //    exposed a quirk that was invisible on the 0.1 s AR).
  const interval = 60 / Math.max(W.rpm, 1)
  w.cooldown = Math.max(w.cooldown - dt, -dt)
  const canFire = input.fire && w.reloadT <= 0
  if (canFire && w.cooldown <= 0) {
    if (w.ammo > 0) {
      fireOne(w, input, player, cfg, world, speedFactor, curve, interval, out, L)
    } else if (w.reserve > 0) {
      // holding the trigger on an empty mag reloads (so does a fresh click)
      startReload(w, W, out)
    } else if (!w.prevFire) {
      out.push({ type: 'dryFire', weapon: w.id })
    }
  }
  w.prevFire = input.fire

  // -- recoil recovery: once the burst is over, the view walks back toward the
  //    start point at a fixed rate (spec §5). "Over" must tolerate full-auto
  //    tick jitter: a held trigger can leave up to one tick of gap past the
  //    interval, so recovery waits out interval + dt before engaging.
  w.lastShotT += dt
  if (w.lastShotT > interval + dt && (w.recoil.pitch !== 0 || w.recoil.yaw !== 0)) {
    const step = W.recoilRecoveryRate * dt
    w.recoil.pitch = moveToward(w.recoil.pitch, 0, step)
    w.recoil.yaw = moveToward(w.recoil.yaw, 0, step)
  }
  // idle long enough and the spray starts over from shot 1
  if (w.lastShotT > W.patternResetTime) w.patternIdx = 0
}

function fireOne(w, input, player, cfg, world, speedFactor, curve, interval, out, L) {
  const W = cfg.weapons[w.id]
  w.ammo--
  w.shots++
  w.cooldown += interval
  w.lastShotT = 0

  // aim = view + accumulated recoil + scope sway; the shot leaves the EYE, not
  // the muzzle (hitscan standard — the muzzle is a client-side visual only).
  // Sway lives in the sim so the crosshair/dot, the camera, AND the shot all
  // agree — and so a server (M4) replays the exact same wander.
  const pitch = clamp(input.pitch + (w.recoil.pitch + L.sway.pitch) * DEG2RAD, -PITCH_LIMIT, PITCH_LIMIT)
  const yaw = input.yaw + (w.recoil.yaw + L.sway.yaw) * DEG2RAD
  const aim = dirFrom(yaw, pitch)

  // recoil: fixed pattern shape x scale (spec §5). Scale = smoothed stance
  // multiplier x movement factor — crouch steadies, running and air widen.
  // Airborne shots read the recoilPatternAir rows when the weapon defines them
  // (AR: S-drift -> snappy Z-drift); the pattern INDEX is shared and only
  // resets on idle/reload, so leaving the ground mid-burst just changes the
  // shape of the NEXT row, never the count.
  const pattern = (!player.grounded && W.recoilPatternAir) ? W.recoilPatternAir : W.recoilPattern
  const pat = pattern[w.patternIdx % pattern.length]
  const scale = w.stanceMult * (1 + W.moveRecoil * curve)
  w.recoil.pitch += pat[0] * scale
  w.recoil.yaw += pat[1] * scale
  const patternIdx = w.patternIdx
  w.patternIdx = (w.patternIdx + 1) % pattern.length

  // the actual shot(s): one hitscan ray per pellet. Plain weapons fire a
  // single uniformly-random cone sample (spec §5, unchanged M2 stream order);
  // layout weapons (the shotgun) place pellets from fixed unit-cone
  // coordinates scaled by the LIVE cone, plus seeded jitter. Each pellet
  // takes falloff by ITS OWN hit distance — the blast curve is the layout.
  const origin = { x: player.pos.x, y: player.pos.y + player.eyeY, z: player.pos.z }
  const spreadRad = w.spread * DEG2RAD
  const layout = W.pelletLayout || null
  const count = layout ? layout.length : 1
  const basis = layout ? aimBasis(aim) : null
  const pellets = []

  for (let i = 0; i < count; i++) {
    const cone = layout
      ? layoutOffset(aim, basis.right, basis.up, spreadRad, layout[i], W.pelletJitter, w.rng)
      : coneOffset(aim, spreadRad, w.rng)
    // excludeId: the shooter never hits their own hitboxes (M3b)
    const hit = castRay(origin, cone.dir, world, W.maxRange, L.ownerId)
    let hitOut = null
    if (hit) {
      if (hit.kind === 'target') {
        const mult = hit.zone === 'head' ? W.headshotMult : hit.zone === 'legs' ? W.legMult : 1
        const damage = W.damage * mult * falloffMult(hit.dist, W)
        hitOut = { kind: 'target', targetId: hit.targetId, zone: hit.zone, damage, dist: hit.dist, point: hit.point, normal: hit.normal }
      } else {
        hitOut = { kind: 'wall', dist: hit.dist, point: hit.point, normal: hit.normal }
      }
    }
    pellets.push({ dir: cone.dir, offYawDeg: cone.offYawDeg, offPitchDeg: cone.offPitchDeg, hit: hitOut })
  }

  // blast-level telemetry: `shots` counts TRIGGER PULLS (so acc = the share of
  // blasts that connected), damage sums pellets, zoneHits count PELLETS (a
  // shotgun head count means "pellets that caught the head"), and lastHit
  // describes the whole blast — total damage on the target plus the zone and
  // distance of its hardest pellet. Single-pellet weapons read exactly as before.
  let anyHit = false
  let blastDamage = 0
  let best = null
  for (const p of pellets) {
    const h = p.hit
    if (!h || h.kind !== 'target') continue
    anyHit = true
    w.zoneHits[h.zone]++
    w.dmgDealt += h.damage
    blastDamage += h.damage
    if (!best || h.damage > best.damage) best = h
  }
  if (anyHit) {
    w.hits++
    w.lastHit = { targetId: best.targetId, zone: best.zone, damage: blastDamage, dist: best.dist }
  } else {
    let wall = null
    for (const p of pellets) {
      if (p.hit && p.hit.kind === 'wall' && (!wall || p.hit.dist < wall.dist)) wall = p.hit
    }
    w.lastHit = wall ? { wall: true, dist: wall.dist } : { miss: true } // all past maxRange, into the fog
  }

  out.push({
    type: 'shot',
    weapon: w.id,
    origin,
    aim,
    pellets,
    spreadDeg: w.spread,
    patternIdx,
  })
}
