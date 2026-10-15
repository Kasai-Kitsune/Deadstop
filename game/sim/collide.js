// sim/collide.js — swept capsule-vs-box movement. Pure math; no DOM / Three / network.
//
// Player capsule is vertical: bottom sphere center at y + r, top sphere center at y + h - r.
// Position `pos` is the FEET point (bottom of the capsule).
//
// No tunneling, by construction:
//  - every axis move is clamped to the exact first-contact distance (a sweep, not a teleport),
//  - each tick is split into substeps so no single move exceeds cfg.collision.maxSubstepDistance.
//
// Shape model (deliberate approximation):
//  - vertical contacts use the real sphere caps -> forgiving feet on step edges, rounded head nears ceilings;
//  - horizontal contacts use the cylinder of radius r (constant at every height). Exact for the
//    mid-body, slightly conservative within r of the feet/head — where auto step-up takes over anyway.
//    A box in the "overhang band" (its top between pos.y and pos.y + r) acts as BOTH a wall (lateral
//    sweep) and a floor (down sweep): that is what lets the capsule perch on an edge without falling.

const OVERLAP_EPS = 1e-4 // resting contact must not read as penetration
const NUM_EPS = 1e-9

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v
}

// Squared horizontal distance from a point to a box's XZ rectangle.
function rectDist2(b, x, z) {
  const dx = x - clamp(x, b.min[0], b.max[0])
  const dz = z - clamp(z, b.min[2], b.max[2])
  return dx * dx + dz * dz
}

// True if the capsule's y-span overlaps the box enough to matter laterally.
// The EPS on both ends keeps resting-on-floor / resting-on-step out of the wall path.
function yOverlap(y0, y1, b) {
  return y1 > b.min[1] + OVERLAP_EPS && y0 < b.max[1] - OVERLAP_EPS
}

// Allowed movement along one horizontal axis (magnitude returned, 0..|dist|).
// axis: 0 = x, 2 = z. dist is signed. Contact geometry: circle (radius r) vs the box's
// XZ rect — face contact at distance r, corner contact closer by the lateral offset.
export function sweepHorizontal(px, py, pz, h, r, boxes, axis, dist) {
  const dir = dist > 0 ? 1 : -1
  const mag = Math.abs(dist)
  let allowed = mag
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i]
    if (!yOverlap(py, py + h, b)) continue
    const cx = clamp(px, b.min[0], b.max[0])
    const cz = clamp(pz, b.min[2], b.max[2])
    const lead = axis === 0 ? cx - px : cz - pz // box position along the move axis
    if (lead * dir <= 0) continue // not ahead of us in this direction
    const d2 = rectDist2(b, px, pz)
    if (d2 >= r * r) {
      // lateral offset of the path from the rect along the OTHER axis
      const lat = axis === 0 ? Math.abs(pz - cz) : Math.abs(px - cx)
      if (lat >= r) continue // this box never comes within reach of the path
      const back = Math.sqrt(r * r - lat * lat)
      const contact = (axis === 0 ? cx : cz) - dir * back
      const gap = dir > 0 ? contact - (axis === 0 ? px : pz) : (axis === 0 ? px : pz) - contact
      if (gap < allowed) allowed = gap < 0 ? 0 : gap
    } else {
      // already within touch range of a box ahead — fully blocked this axis
      return 0
    }
  }
  return Math.min(allowed, mag)
}

// Distance down to the first supporting surface (Infinity if none). Sphere-cap formula:
// resting on an edge keeps the feet lower than the face — that overhang is intended.
export function sweepDownRaw(px, py, pz, r, boxes) {
  let best = Infinity
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i]
    const top = b.max[1]
    if (top > py + r - OVERLAP_EPS) continue // top face not under the bottom sphere
    const d2 = rectDist2(b, px, pz)
    if (d2 >= r * r) continue
    const gap = py - (top + Math.sqrt(r * r - d2) - r)
    if (gap < best) best = gap < 0 ? 0 : gap
  }
  return best
}

// Distance up to the first ceiling (Infinity if none). Rounded head near slab edges.
export function sweepUpRaw(px, py, pz, h, r, boxes) {
  let best = Infinity
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i]
    const bot = b.min[1]
    if (bot < py + h - r + OVERLAP_EPS) continue // bottom face not above the top sphere
    const d2 = rectDist2(b, px, pz)
    if (d2 >= r * r) continue
    const gap = bot - Math.sqrt(r * r - d2) - h + r - py
    if (gap < best) best = gap < 0 ? 0 : gap
  }
  return best
}

// Uncrouch headroom test: would the FULL standing capsule (plus clearance) fit here?
// Conservative: uses the cylinder (radius r) rather than sphere caps — blocks slightly
// more often than a rounded cap would; safer than allowing a stand-up into geometry.
// Touching (d == r) is NOT overlapping: the slack absorbs float noise from exact
// wall contacts, so you can stand up while resting against a wall face.
export function capsuleFits(px, py, pz, height, r, clearance, boxes) {
  const y1 = py + height + clearance
  for (let i = 0; i < boxes.length; i++) {
    const b = boxes[i]
    if (b.max[1] <= py + OVERLAP_EPS) continue // fully below the feet — floor, not a blocker
    if (b.min[1] >= y1 - OVERLAP_EPS) continue // fully above the required envelope
    if (rectDist2(b, px, pz) < r * r - NUM_EPS) return false
  }
  return true
}

// One horizontal axis move with auto step-up. Order: try the flat sweep; if blocked and
// grounded, retry at +stepHeight and land back down onto the step. Momentum is kept on a
// successful climb (that is the point of stairs feeling like ramps), zeroed on a wall hit.
function stepAxis(state, boxes, cfg, h, r, axis, dist) {
  const p = state.pos
  const a = axis === 0 ? p.x : p.z
  const dir = dist > 0 ? 1 : -1
  const mag = Math.abs(dist)
  const allowed = sweepHorizontal(p.x, p.y, p.z, h, r, boxes, axis, dist)
  if (allowed >= mag) {
    if (axis === 0) p.x += dist
    else p.z += dist
    return
  }
  if (state.grounded && cfg.collision.stepHeight > 0) {
    const step = cfg.collision.stepHeight
    // Sweep again with the capsule raised. Boxes tall enough to still block at +step
    // (taller than stepHeight) simply fail here — ledges need a jump, by design.
    const raised = sweepHorizontal(p.x, p.y + step, p.z, h, r, boxes, axis, dist)
    if (raised > allowed + NUM_EPS) {
      const moved = a + dir * Math.min(mag, raised)
      const nx = axis === 0 ? moved : p.x
      const nz = axis === 2 ? moved : p.z
      const down = sweepDownRaw(nx, p.y + step, nz, r, boxes)
      if (down <= step + OVERLAP_EPS) {
        // support found within stepHeight of the raised position — commit the climb
        if (axis === 0) p.x = moved
        else p.z = moved
        p.y = p.y + step - down
        return
      }
    }
  }
  // Blocked: slide along the wall (the other axis still moves), zero this component.
  if (axis === 0) {
    p.x += dir * allowed
    state.vel.x = 0
  } else {
    p.z += dir * allowed
    state.vel.z = 0
  }
}

// Vertical move for one substep: ceiling clamp, landing, and the stair glue.
// The glue (snap-down) only fires while grounded with non-positive vy, so a jump
// never gets yanked back down and walking off tall ledges still becomes a real fall.
function stepVertical(state, boxes, cfg, h, r, dy) {
  const p = state.pos
  const v = state.vel
  if (dy > 0) {
    const up = sweepUpRaw(p.x, p.y, p.z, h, r, boxes)
    const move = Math.min(dy, up)
    p.y += move
    if (move < dy - NUM_EPS) v.y = 0 // head bonk
  } else if (dy < 0) {
    const down = sweepDownRaw(p.x, p.y, p.z, r, boxes)
    const fall = -dy
    if (down <= fall) {
      p.y -= down
      v.y = 0
      state.grounded = true
    } else if (state.grounded && v.y <= 0) {
      // floor farther than this substep's fall: try to glue down within stairSnapDistance
      if (down <= cfg.collision.stairSnapDistance + OVERLAP_EPS) {
        p.y -= down
        v.y = 0 // stays grounded; vy zeroed so gravity does not accumulate on stairs
      } else {
        p.y += dy // real drop (ledge) — leave the ground
        state.grounded = false
      }
    } else {
      p.y += dy
      state.grounded = false
    }
  }
}

// Entry point: split the tick into substeps (anti-tunneling), then X, Z, Y per substep.
// Horizontal first so step-up can use the grounded flag carried between substeps.
export function moveWithCollisions(state, dt, cfg, world, h, r) {
  const c = cfg.collision
  const v = state.vel
  const speed = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z)
  let n = Math.ceil((speed * dt) / c.maxSubstepDistance)
  if (n < 1) n = 1
  if (n > c.maxSubsteps) n = c.maxSubsteps
  const dts = dt / n
  const boxes = world.boxes
  for (let i = 0; i < n; i++) {
    if (v.x !== 0) stepAxis(state, boxes, cfg, h, r, 0, v.x * dts)
    if (v.z !== 0) stepAxis(state, boxes, cfg, h, r, 2, v.z * dts)
    stepVertical(state, boxes, cfg, h, r, v.y * dts)
  }
}
