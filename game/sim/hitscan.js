// sim/hitscan.js — ray vs world geometry. Pure math; no DOM / Three / network.
// This is the exact cast the M4 server will run for hit registration (spec §2/§5),
// so the client and the server will always agree on where a shot lands.

// Ray vs one AABB (slab method). o/d are the ray origin and unit direction,
// b is a map box { min: [x,y,z], max: [x,y,z] } or a target zone box.
// Returns { t, nx, ny, nz } (t >= 0, normal on the entry face) or null.
// A ray that starts inside counts as an immediate hit at t=0 with the normal
// opposing the ray — a muzzle pressed into geometry should still "hit" it.
export function rayBox(ox, oy, oz, dx, dy, dz, b) {
  const o = [ox, oy, oz]
  const d = [dx, dy, dz]
  let tmin = 0
  let tmax = Infinity
  let nAxis = -1
  let nSign = 0
  for (let i = 0; i < 3; i++) {
    if (d[i] === 0) {
      // parallel to this slab: fine only if we are inside its span
      if (o[i] < b.min[i] || o[i] > b.max[i]) return null
      continue
    }
    const inv = 1 / d[i]
    let t1 = (b.min[i] - o[i]) * inv
    let t2 = (b.max[i] - o[i]) * inv
    let s = -1 // entering the min face -> normal points -axis
    if (t1 > t2) {
      const tt = t1
      t1 = t2
      t2 = tt
      s = 1 // entering the max face -> normal points +axis
    }
    if (t1 > tmin) {
      tmin = t1
      nAxis = i
      nSign = s
    }
    if (t2 < tmax) tmax = t2
    if (tmin > tmax) return null
  }
  if (tmax < 0) return null // box entirely behind the ray
  if (nAxis === -1) {
    // origin inside the box: hit now, normal roughly opposing the ray
    return { t: 0, nx: dx < 0 ? 1 : dx > 0 ? -1 : 0, ny: dy < 0 ? 1 : dy > 0 ? -1 : 0, nz: dz < 0 ? 1 : dz > 0 ? -1 : 0 }
  }
  const n = [0, 0, 0]
  n[nAxis] = nSign
  return { t: tmin, nx: n[0], ny: n[1], nz: n[2] }
}

// Cast through the world: map boxes block shots, target zones register hits.
// Whichever surface is nearest wins — a wall shields a target behind it, and
// the nearest zone of a dummy wins over its other zones. Fog never matters
// here (spec §8: fog is a render effect only; hit reg is fog-independent).
// world = { boxes: [...], targets: [{ id, zones: { head, body, legs } }],
//           targetActive?(t) — optional hook: dead dummies stop registering
//           hits (a toppled board is not a hitbox). }
// excludeId (M3b): skip this target id entirely — the shooter's own hitboxes.
// A shot leaving the eye would otherwise hit the shooter's head box at t=0.
export function castRay(o, d, world, maxDist, excludeId = null) {
  let bestT = maxDist
  let best = null

  for (let i = 0; i < world.boxes.length; i++) {
    const h = rayBox(o.x, o.y, o.z, d.x, d.y, d.z, world.boxes[i])
    if (h && h.t < bestT) {
      bestT = h.t
      best = { wall: true, t: h.t, nx: h.nx, ny: h.ny, nz: h.nz }
    }
  }

  const targets = world.targets || []
  for (let i = 0; i < targets.length; i++) {
    const tgt = targets[i]
    if (excludeId !== null && tgt.id === excludeId) continue
    if (world.targetActive && !world.targetActive(tgt)) continue
    for (const zone of ZONE_ORDER) {
      const h = rayBox(o.x, o.y, o.z, d.x, d.y, d.z, tgt.zones[zone])
      if (h && h.t < bestT) {
        bestT = h.t
        best = { wall: false, targetId: tgt.id, zone, t: h.t, nx: h.nx, ny: h.ny, nz: h.nz }
      }
    }
  }

  if (!best) return null
  return {
    kind: best.wall ? 'wall' : 'target',
    targetId: best.targetId,
    zone: best.zone,
    dist: best.t,
    point: { x: o.x + d.x * best.t, y: o.y + d.y * best.t, z: o.z + d.z * best.t },
    normal: { x: best.nx, y: best.ny, z: best.nz },
  }
}

const ZONE_ORDER = ['head', 'body', 'legs']
