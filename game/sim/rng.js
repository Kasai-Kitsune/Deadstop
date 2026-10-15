// sim/rng.js — the seeded PRNG for M3b sim modules (bot brains). Identical
// algorithm to weapon.js's private mulberry32 (kept separate there so the
// pinned M2 weapon streams stay bit-untouched); new code imports this one so
// determinism has a single obvious home going forward.

export function mulberry32(seed) {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
