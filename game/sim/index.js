// sim/index.js — the only module a client or server imports from sim/.
// Contract (spec §2): takes inputs and a time step, returns state.
// Deterministic: no Math.random, no Date, no DOM, no Three.js, no network,
// no module-level mutable state (safe for many players / many matches).
export { createPlayer, stepPlayer } from './player.js'
export { createLoadout, stepLoadout, activeWeapon, dirFrom } from './weapon.js'
export { castRay, rayBox } from './hitscan.js'
export { createTargets, stepTargets, hurtTargets } from './targets.js'
