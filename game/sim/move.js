// sim/move.js — velocity integration only. Pure math, no DOM / Three / network.
// Horizontal plane only; gravity and jumping live in player.js.

// Friction ramp machine: on crouch press, friction snaps LOW then ramps LINEARLY
// to its full value over crouchRampTime (the glide). On release it ramps back
// toward ground friction over the same time — no snap, so uncrouching never
// spikes friction. Rate is fixed at each edge so the ramp is truly linear.
export function frictionEdge(state, cfg, pressed) {
  if (pressed) {
    state.friction = cfg.movement.crouchGlideStartFriction
    state.frictionTarget = cfg.movement.crouchFriction
  } else {
    state.frictionTarget = cfg.movement.groundFriction
  }
  const T = Math.max(cfg.movement.crouchRampTime, 1e-4)
  state.frictionRate = (state.frictionTarget - state.friction) / T
}

export function frictionTick(state, cfg, dt) {
  if (state.friction === state.frictionTarget) return
  const next = state.friction + state.frictionRate * dt
  // Clamp at target so a stale rate can never overshoot.
  const lo = Math.min(state.friction, state.frictionTarget)
  const hi = Math.max(state.friction, state.frictionTarget)
  state.friction = Math.min(Math.max(next, lo), hi)
}

// Quake-style ground friction: decel proportional to speed, floored by stopSpeed
// so the last bit of a stop is fast instead of asymptotic.
export function applyFriction(state, cfg, dt) {
  const v = state.vel
  const speed = Math.hypot(v.x, v.z)
  if (speed <= 0) return
  const control = Math.max(speed, cfg.movement.stopSpeed)
  const drop = control * state.friction * dt
  const scale = Math.max(0, speed - drop) / speed
  v.x *= scale
  v.z *= scale
}

// Deadstop: crouched + grounded + input opposing velocity -> extra brake.
// The min() clamp prevents braking past zero (never reverses velocity).
// Returns true when a brake was applied so the caller can suppress ground
// accel for the tick — a tap means "stop", not "accelerate the other way".
export function applyDeadstop(state, wish, cfg, dt) {
  const v = state.vel
  const speed = Math.hypot(v.x, v.z)
  if (speed <= 0) return false
  const dot = v.x * wish.x + v.z * wish.z
  if (dot >= 0) return false // input is along or across velocity — no deadstop
  const brake = cfg.movement.counterBrakeMult * cfg.movement.groundAccel * dt
  const drop = Math.min(brake, speed)
  v.x -= (v.x / speed) * drop
  v.z -= (v.z / speed) * drop
  return true
}

// Accelerate toward wish direction, capped at the current target speed along
// wish. Never decelerates — that's friction's job. Keeps inertia on turns.
export function groundAccelerate(state, wish, target, cfg, dt) {
  const v = state.vel
  const current = v.x * wish.x + v.z * wish.z
  const add = target - current
  if (add <= 0) return
  const accel = Math.min(cfg.movement.groundAccel * dt, add)
  v.x += wish.x * accel
  v.z += wish.z * accel
}

// Air move: capped acceleration like ground, plus rotation of the velocity
// direction toward input (airControl rad/s), plus a magnitude clamp so air never
// grants speed beyond what you had or the stance target (no strafe-jump gains).
// The rotation is an EXACT slerp: steering re-aims speed without shrinking it.
// (A plain lerp toward wish lands on the chord and loses several percent of
// magnitude per tick — invisible at airControl 0.35, speed-eating at 4.5.)
export function airMove(state, wish, target, cfg, dt) {
  const v = state.vel
  const preSpeed = Math.hypot(v.x, v.z)

  const current = v.x * wish.x + v.z * wish.z
  const add = target - current
  if (add > 0) {
    const accel = Math.min(cfg.movement.airAccel * dt, add)
    v.x += wish.x * accel
    v.z += wish.z * accel
  }

  let speed = Math.hypot(v.x, v.z)
  if (speed > cfg.movement.airControlMinSpeed && speed > 0) {
    const dot = (v.x * wish.x + v.z * wish.z) / speed
    if (dot < 1) {
      const angle = Math.acos(Math.min(1, Math.max(-1, dot)))
      const turn = Math.min(cfg.movement.airControl * dt, angle)
      const sinA = Math.sin(angle)
      if (sinA >= 1e-6) {
        // exact rotation of the velocity direction toward wish by `turn` radians
        const ux = v.x / speed
        const uz = v.z / speed
        const sinT = Math.sin(turn)
        const sinRest = Math.sin(angle - turn)
        v.x = speed * (ux * sinRest + wish.x * sinT) / sinA
        v.z = speed * (uz * sinRest + wish.z * sinT) / sinA
      } else if (dot > 0) {
        // already aligned (angle ~ 0): snapping is exact
        v.x = wish.x * speed
        v.z = wish.z * speed
      } else {
        // input exactly opposite (angle ~ pi): slerp is undefined, so start the
        // turn via a fixed perpendicular — deterministic, and the next tick's
        // angle is off pi so slerp takes over
        const c = Math.cos(turn)
        const s = Math.sin(turn)
        const nx = v.x * c - v.z * s
        const nz = v.x * s + v.z * c
        v.x = nx
        v.z = nz
      }
    }
  }

  // Magnitude clamp: steer freely, never gain.
  speed = Math.hypot(v.x, v.z)
  const cap = Math.max(preSpeed, target)
  if (speed > cap && speed > 0) {
    const s = cap / speed
    v.x *= s
    v.z *= s
  }
}
