// sim/player.js — one player's tick: stance, friction state machine, velocity
// integration (in move.js), jump buffering, gravity, then the swept collision move.
// Everything reads cfg LIVE each tick so runtime config edits apply with no reload.

import {
  airMove,
  applyDeadstop,
  applyFriction,
  frictionEdge,
  frictionTick,
  groundAccelerate,
} from './move.js'
import { capsuleFits, moveWithCollisions } from './collide.js'

const WISH_EPS = 1e-6
const CAPSULE_MARGIN = 0.01 // keep height >= 2r so the capsule is never degenerate

export function createPlayer(spawn, cfg) {
  return {
    pos: { x: spawn.pos[0], y: spawn.pos[1], z: spawn.pos[2] },
    vel: { x: 0, y: 0, z: 0 },
    grounded: false,
    crouch: 0, // 0 = standing, 1 = fully crouched; drives capsule height, eye, target speed
    friction: cfg.movement.groundFriction,
    frictionTarget: cfg.movement.groundFriction,
    frictionRate: 0,
    prevCrouch: false,
    prevJump: false,
    jumpBufferT: 0,
    // derived, refreshed every tick — never cached across ticks:
    eyeY: cfg.movement.eyeStand,
    capsuleH: cfg.movement.standHeight,
    stance: 'stand',
    targetSpeed: cfg.movement.runSpeed,
  }
}

// Input -> world-space wish direction. Yaw 0 faces -Z (matches Three.js cameras),
// so the server can reuse this with a plain number later.
function wishDir(input) {
  const mx = input.mx
  const mz = input.mz
  if (mx === 0 && mz === 0) return null
  const yaw = input.yaw
  const fx = -Math.sin(yaw)
  const fz = -Math.cos(yaw)
  const rx = Math.cos(yaw)
  const rz = -Math.sin(yaw)
  const x = fx * mz + rx * mx
  const z = fz * mz + rz * mx
  const len = Math.hypot(x, z)
  if (len < WISH_EPS) return null
  return { x: x / len, z: z / len }
}

export function stepPlayer(state, input, dt, cfg, world) {
  const m = cfg.movement
  const r = m.capsuleRadius
  const c0 = state.crouch

  // -- stance amount: 0.15s each way; standing back up is headroom-gated so you
  //    stay crouched under low geometry instead of clipping into it.
  const rate = dt / Math.max(m.stanceTime, 1e-4)
  if (input.crouch) {
    state.crouch = Math.min(1, c0 + rate)
  } else if (c0 > 0) {
    if (capsuleFits(state.pos.x, state.pos.y, state.pos.z, m.standHeight, r, cfg.collision.minHeadroom, world.boxes)) {
      state.crouch = Math.max(0, c0 - rate)
    }
  }

  // -- friction ramp (the crouch glide lives here; see move.js for the shape)
  if (input.crouch !== state.prevCrouch) frictionEdge(state, cfg, input.crouch)
  state.prevCrouch = input.crouch
  frictionTick(state, cfg, dt)

  // -- target speed: lerped by crouch amount so stance changes never snap the target.
  //    In air the same table applies (a mid-air walk hold simply aims at walk speed).
  //    moveScale comes from the loadout (scoped slow walk) — optional so this
  //    stays a plain movement sim for M1-style callers.
  const standTarget = input.walk ? m.walkSpeed : m.runSpeed
  const target = (standTarget + (m.crouchSpeed - standTarget) * state.crouch) * (input.moveScale ?? 1)

  const wish = wishDir(input)
  if (state.grounded) {
    applyFriction(state, cfg, dt)
    // Deadstop uses the crouch INTENT (key held), not the amount — the move should
    // respond the instant you commit to it, even mid-transition. While it brakes,
    // ground accel is suppressed: tap = deliberate hard stop (spec §4); once
    // velocity reaches zero, accel resumes, so holding reverses at crouch speed.
    let braking = false
    if (wish && input.crouch) braking = applyDeadstop(state, wish, cfg, dt)
    if (wish && !braking) groundAccelerate(state, wish, target, cfg, dt)
  } else if (wish) {
    airMove(state, wish, target, cfg, dt)
  }

  // -- jump buffer: a press up to jumpBufferTime before landing still fires.
  if (input.jump && !state.prevJump) state.jumpBufferT = m.jumpBufferTime
  state.prevJump = input.jump
  state.jumpBufferT = Math.max(0, state.jumpBufferT - dt)

  // -- gravity, then jump (after gravity so takeoff velocity is exactly jumpVel)
  state.vel.y -= m.gravity * dt
  if (state.grounded && state.jumpBufferT > 0) {
    state.vel.y = m.jumpVel
    state.grounded = false
    state.jumpBufferT = 0
  }

  // -- swept move (substeps, step-up, stair glue)
  //    height lerps stand -> crouch as amount rises; floor at 2r so the capsule never degenerates
  const h = Math.max(m.standHeight + (m.crouchHeight - m.standHeight) * state.crouch, 2 * r + CAPSULE_MARGIN)
  moveWithCollisions(state, dt, cfg, world, h, r)

  // -- derived outputs for the client HUD
  state.eyeY = m.eyeStand + (m.eyeCrouch - m.eyeStand) * state.crouch
  state.capsuleH = h
  state.stance = state.crouch >= 0.5 ? 'crouch' : 'stand'
  state.targetSpeed = target
  return state
}
