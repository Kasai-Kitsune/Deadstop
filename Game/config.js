// config.js — every tunable, grouped and commented.
// Values marked [SPEC §4/§5/§8] come straight from the design spec (do not change without asking).
// Values marked [GAP] have no number in the spec; they are my placeholders — tune or override them.
// Values marked [BRIEF] were derived from a user brief (M2: the balanced AR is the
// median every later gun brackets; M2+: sniper to prove the fog/scope loop,
// classic carry-2 loadout, killable range dummies).

export const CONFIG = {
  // Fixed simulation rate. Server (M4) and client run the same step.
  sim: {
    tickRate: 64, // [SPEC §2] start 64 Hz
  },

  // Client-side view only. Never read by sim/.
  view: {
    fovDeg: 75, // [GAP] placeholder
    mouseSensDegPerPx: 0.12, // [GAP] placeholder
    maxPitchDeg: 89, // [GAP] placeholder — clamp so up/down can't flip
    cameraFarM: 220, // [GAP] just past the fog's practical full-opacity distance (spec §8 culling)
  },

  movement: {
    // Target speeds (m/s), soft caps on acceleration, not hard velocity clamps.
    runSpeed: 5.5, // [SPEC §4]
    walkSpeed: 3.0, // [SPEC §4] hold key
    crouchSpeed: 2.2, // [SPEC §4]

    // Acceleration (m/s^2).
    groundAccel: 90, // [SPEC §4 start 45 — doubled per playtest request: faster direction changes]
    airAccel: 42, // [SPEC §4 start 12 — raised per playtest request: near-ground mid-air authority]
    airControl: 4.5, // [SPEC §4 start 0.35 — rad/s the velocity direction rotates toward input in air (~258 deg/s: hard mid-air redirects)]
    airControlMinSpeed: 0.5, // [GAP] below this horizontal speed, no steering

    // Friction (1/s, Quake-style: decel = friction * max(speed, stopSpeed)).
    // [GAP] the spec describes the friction MODEL but gives no numbers — these are placeholders.
    groundFriction: 9, // [GAP placeholder, was 6 — raised so the old direction dies fast on turns/stops]
    crouchFriction: 5, // steady state while fully crouched
    crouchGlideStartFriction: 0.6, // value friction snaps to the instant crouch is pressed
    stopSpeed: 2.0, // [GAP placeholder, was 1.5 — floor speed for friction math; crisp stops instead of asymptotic]
    crouchRampTime: 0.35, // [SPEC §4] crouchRampTime; friction ramps between stances over this

    // Deadstop skill move.
    counterBrakeMult: 2.5, // [SPEC §4] brake accel = mult * groundAccel while crouched

    // Vertical.
    gravity: 20, // [SPEC §4] m/s^2
    jumpVel: 6.0, // [SPEC §4] m/s -> 0.9 m apex
    jumpBufferTime: 0.1, // [GAP] a press this close before landing still jumps

    // Capsule + stance.
    capsuleRadius: 0.35, // [SPEC §4]
    standHeight: 1.8, // [SPEC §4] capsule height standing
    crouchHeight: 1.2, // [SPEC §4] capsule height crouched
    eyeStand: 1.65, // [SPEC §4]
    eyeCrouch: 1.1, // [SPEC §4]
    stanceTime: 0.15, // [SPEC §4] crouch <-> stand transition (height + eye)
  },

  collision: {
    stepHeight: 0.3, // [GAP] auto-step-up limit; stairs rise 0.25 climb, 0.5 ledges need a jump
    stairSnapDistance: 0.3, // [GAP] glue-down distance when walking off steps; keep >= max stair rise
    maxSubstepDistance: 0.05, // [GAP] per-substep displacement cap; guarantees no tunneling
    maxSubsteps: 50, // [GAP] hard cap on substeps per tick (spiral-of-death guard)
    minHeadroom: 0.02, // [GAP] clearance required above the capsule before uncrouch is allowed
  },

  // ---- The arsenal (M2+). Slot order = key order here: 1 = AR, 2 = Thermal Rifle.
  // Spec §5 starting weapons are sidearm/SMG/rifle/sniper; rifle + sniper come
  // first because they bracket the median (AR) from both ends. Each weapon is a
  // full, self-contained block so M3's SMG/sidearm is a copy-tune, not a refactor.

  weapons: {
    // AR — the balanced rifle (spec §5 "rifle"), the MEDIAN the arsenal gets
    // bracketed around: modest DPS, moderately high accuracy, usable at every
    // range. All hitscan, hip fire only, no ADS (spec §5: "ADS only on sniper
    // rifles"). Every number below is the approved M2 tuning — untouched
    // except the added airborne recoil pattern.
    ar: {
      name: 'AR', // display name (user: "The AR should simply be called AR")
      canScope: false, // [SPEC §5] rifles fire from the hip

      // Cadence + damage. 12 dmg x 600 rpm = 120 DPS; 9 body shots on 100 hp =
      // 0.80 s TTK, exactly the spec §5 rifle target ("about 0.8 s").
      rpm: 600, // [BRIEF] 0.100 s between shots — the median rate
      damage: 12, // [BRIEF] body damage before falloff/multipliers
      headshotMult: 1.5, // [SPEC §5] deliberately low to protect the long TTK
      legMult: 0.75, // [GAP] spec gives no legs multiplier; genre-standard placeholder

      // Sustain.
      magSize: 30, // [GAP]
      reserveAmmo: 9999, // [GAP] effectively unlimited — this is a range, not a round
      reloadTime: 2.0, // [GAP] median reload

      // Spread — spec §5 model, verbatim: target = base * stanceMult * (1 + moveSpread * curve(speed)).
      // No per-shot bloom by design: sustained-fire punishment is the recoil pattern's job.
      baseSpread: 0.4, // [SPEC §5] degrees, standing still
      stanceSpreadStand: 1.0, // [SPEC §5]
      stanceSpreadCrouch: 0.55, // [SPEC §5] crouch tight — synergy with the M1 stance system
      stanceSpreadAir: 3.0, // [SPEC §5] air widest
      moveSpread: 1.2, // [SPEC §5] at full run speed the cone is 2.2x base
      moveSpreadCurveExp: 1.5, // [SPEC §5] curve(x) = x^1.5 — gentle, "can still hit a barn while walking"
      tightenRate: 8, // [SPEC §5] 1/s toward a smaller target spread
      loosenRate: 18, // [SPEC §5] 1/s toward a larger one; a fast stop tightens fast (speed drops)
      stanceMultSmoothRate: 10, // [GAP] 1/s smoothing of the stance multiplier — recoil scale uses the SMOOTHED value (§5)

      // Recoil — deterministic pattern (data below); scale = smoothed stanceMult x (1 + moveRecoil x curve(speed)).
      moveRecoil: 0.5, // [GAP] moving widens the pattern's scale, not its shape
      recoilRecoveryRate: 14, // [GAP] deg/s the view returns toward the start point after firing stops
      patternResetTime: 0.45, // [GAP] s idle before the spray starts over from shot 1

      // Range model — "ok at all ranges" (user brief): full damage to 30 m, a gentle
      // slide to 75% at 70 m, then flat. 100 m kills take 12 body shots instead of 9.
      falloffStartDist: 30, // [GAP]
      falloffEndDist: 70, // [GAP]
      falloffMinMult: 0.75, // [GAP]
      maxRange: 300, // [GAP] hitscan cap; tracers that hit nothing end here, inside the fog

      // Fixed spray shape GROUNDED: per-shot [pitchUp, yawRight] in degrees (spec §5:
      // "deterministic per-weapon pattern", no randomness). Climb hard early, taper,
      // S-drift right/left. Full 30-shot mag = 5.3 deg climb. Data, not a slider.
      recoilPattern: [
        [0.26, 0.0], [0.26, 0.02], [0.26, 0.04], [0.26, 0.05],
        [0.22, 0.06], [0.22, 0.06], [0.22, 0.05], [0.22, 0.04], [0.22, 0.02], [0.22, 0.0],
        [0.18, -0.02], [0.18, -0.04], [0.18, -0.06], [0.18, -0.07], [0.18, -0.07], [0.18, -0.06],
        [0.15, -0.04], [0.15, -0.02], [0.15, 0.0], [0.15, 0.02], [0.15, 0.04], [0.15, 0.05],
        [0.12, 0.04], [0.12, 0.02], [0.12, 0.0], [0.12, -0.02], [0.12, -0.04], [0.12, -0.05], [0.12, -0.04], [0.12, -0.02],
      ],

      // Fixed spray shape AIRBORNE (user: "when jumping it should have a snappy
      // z drift recoil — enough that you can tell it's different when you jump").
      // Same per-shot [pitchUp, yawRight], same 30 length and the same shared
      // pattern index, but the yaw rows trace a Z: a right drift (top bar), a
      // hard left SNAP across center (the diagonal), then right again (bottom
      // bar). "Snappy" = the corners are ABRUPT — each bar holds its full rate
      // right up to the turn and the steepest row lands immediately after it
      // (no taper rows softening the flip; that was VLM-review feedback on the
      // first cut, whose rounded corners read as an S). Shape only: magnitude
      // still comes from the shared scale = stanceMult (x3.0 in air via
      // stanceSpreadAir) x move factor — so each Z snap lands ~3x harder than
      // a ground drift step. Optional key: weapons without it fire their
      // ground pattern in the air (the sniper's single kick needs no variant).
      recoilPatternAir: [
        // top bar — drift right at full rate into the corner
        [0.30, 0.10], [0.30, 0.22], [0.28, 0.30], [0.28, 0.34], [0.26, 0.36], [0.24, 0.36], [0.22, 0.36], [0.20, 0.36], [0.18, 0.36],
        // diagonal — steepest left row FIRST, hold the sweep, still steep at the far corner
        [0.16, -0.50], [0.14, -0.50], [0.12, -0.50], [0.11, -0.48], [0.10, -0.46], [0.09, -0.44], [0.08, -0.42], [0.07, -0.40], [0.06, -0.38],
        // bottom bar — full-rate right immediately, ease only at the mag tail
        [0.05, 0.36], [0.04, 0.36], [0.04, 0.36], [0.04, 0.36], [0.03, 0.34], [0.03, 0.32], [0.03, 0.30], [0.02, 0.28], [0.02, 0.26], [0.02, 0.22], [0.02, 0.18], [0.02, 0.14],
      ],

      // View FX timings (client-only, but designer-tunable).
      tracerTime: 0.06, // [GAP] s a tracer line is visible
      muzzleTime: 0.05, // [GAP] s the muzzle flash lasts
      impactMarkSize: 0.035, // [GAP] m radius of a persistent impact mark
    },

    // Thermal Rifle — the sniper (spec §5 "sniper rifle"; user: "the sniper can
    // just be called Thermal Rifle" — the scope IS its identity). The long-range
    // BRACKET around the AR median: a third of its sustained DPS (58 vs 120) in
    // exchange for a one-shot head and near-zero scoped dispersion. Spec §5 TTK
    // shape: "sniper 2 body shots, 1 headshot" — 70x2 = 140 >= 100 hp body,
    // 70x1.5 = 105 >= 100 head. ADS only exists here (spec §5); the scope is
    // the thermal one from spec §8 and multiplies fog density by scope.fogMult
    // while zoomed.
    sniper: {
      name: 'Thermal Rifle', // display name (user request) — the thermal scope is the gun
      canScope: true, // [SPEC §5] the only ADS in the game

      // Cadence + damage. Bolt action: one shot / 1.2 s. 70 x 50/60 = 58 DPS
      // sustained — the low end of the DPS bracket the AR centers.
      rpm: 50, // [GAP] 1.200 s between shots (bolt cycle)
      damage: 70, // [GAP] chosen so the spec TTK shape holds exactly (see block comment)
      headshotMult: 1.5, // [SPEC §5] same global low multiplier — 105 = one-shot on 100 hp
      legMult: 0.75, // [GAP] matches the AR

      // Sustain.
      magSize: 5, // [GAP] classic sniper mag
      reserveAmmo: 9999, // [GAP] it's a range
      reloadTime: 3.2, // [GAP] long, deliberate

      // Spread — same §5 model, tuned to make hip fire a panic move and the
      // scope the real weapon (scoped cone = hip cone x scope.spreadMult).
      baseSpread: 3.0, // [GAP] degrees standing hip — you will not hip-shot a 150 m head
      stanceSpreadStand: 1.0, // [SPEC §5] shared stance table
      stanceSpreadCrouch: 0.55, // [SPEC §5]
      stanceSpreadAir: 3.0, // [SPEC §5]
      moveSpread: 2.0, // [GAP] running triples the hip cone
      moveSpreadCurveExp: 1.5, // [SPEC §5]
      tightenRate: 8, // [SPEC §5]
      loosenRate: 18, // [SPEC §5]
      stanceMultSmoothRate: 10, // [GAP]

      // Recoil — one fixed bolt kick per shot: up 2.4 deg, drifting 0.3 deg
      // right. Single-entry pattern: every shot is "shot 1" (resets between
      // shots because 2.4 deg at 10 deg/s recovers in 0.24 s, well inside the
      // 1.2 s bolt cycle).
      moveRecoil: 0.6, // [GAP]
      recoilRecoveryRate: 10, // [GAP] deg/s
      patternResetTime: 0.5, // [GAP]
      recoilPattern: [[2.4, 0.3]], // data — reshape here, not in the panel

      // Range model — effectively flat inside the 156 m hall (the front face of
      // the "150 m" dummy is 149.8 m from the firing line, just under the start).
      // A sniper should not fall off where it lives; a whisper of falloff for
      // future longer maps.
      falloffStartDist: 150, // [GAP]
      falloffEndDist: 300, // [GAP]
      falloffMinMult: 0.9, // [GAP]
      maxRange: 400, // [GAP] past the hall's back wall, deep in the fog

      // View FX (client-only): heavier tracer, bigger marks — big-bore feel.
      tracerTime: 0.09, // [GAP]
      muzzleTime: 0.06, // [GAP]
      impactMarkSize: 0.05, // [GAP]
    },
  },

  // The classic carry-2 system: slot 1 + slot 2, both carried from spawn (no
  // pickups in the range). Switching holsters the old gun mid-reload (progress
  // lost, no ammo wasted — reserve only deducts at completion).
  loadout: {
    switchTime: 0.45, // [GAP] s lower + raise; fire and scope are blocked during it
  },

  // The Thermal Rifle scope — spec §8 pulled forward to prove the fog loop: narrow FOV,
  // scope sway, fog density multiplied while scoped, and the shared thermal
  // look ("dark green scanline base, players rendered hot in red and orange").
  // fogMult is a CLIENT render effect only — hit registration stays fog-blind.
  scope: {
    fovDeg: 18, // [GAP] 75 -> 18 is ~4.2x zoom
    zoomSens: 1, // [GAP] 0 = mouse sens ignores zoom, 1 = scales linearly with the FOV ratio
    scopeTime: 0.28, // [GAP] s to reach full scope (and back)
    fogMult: 0.15, // [SPEC §8] scopeFogMult — while scoped, density x 0.15
    spreadMult: 0.01, // [GAP] scoped cone = 1% of the hip cone (0.03 deg standing)
    speedMult: 0.55, // [GAP] scoped movement target speed multiplier
    swayAmpDeg: 0.22, // [GAP] deg of aim wander at full scope, standing still (~58 cm at 150 m)
    swayRate: 0.42, // [GAP] Hz of the primary sway sine (Lissajous pair at 1.0 / 1.27 x this)
    swayMoveMult: 3, // [GAP] moving multiplies sway (x curve^1.5 of speed) — reposition scoped = wobble
    swayCrouchMult: 0.55, // [GAP] crouch steadies the scope (same ratio as the spread stance table)
    heatMix: 1, // [GAP] strength of the red/orange heat overlay on figures
    scanlineFreq: 540, // [SPEC §8 sketch] horizontal scanlines per screen height
    noiseAmt: 0.05, // [SPEC §8 sketch] light sensor noise
    vignette: 0.85, // [SPEC §8 sketch] scope-tube vignette strength (0..1)
  },

  // Range dummies — M2+: they die. HP matches spec §5 player health so TTK
  // targets are testable against them; respawns are fast (user brief) so the
  // range never runs out of targets.
  dummies: {
    hp: 100, // [SPEC §5] "player health 100" — dummies stand in for players
    respawnTime: 2.5, // [BRIEF] "they should respawn fast"
    hitFlashTime: 0.15, // [GAP] s a hit zone stays lit (moved from weapon.* — it is target-side)
  },

  // Fog — spec §8: gradual exponential fog, client render effect ONLY. Hit
  // registration never sees it (a fogged-out target can still be shot).
  fog: {
    density: 0.012, // [SPEC §8] FogExp2 start — enemies mostly lost around 120–150 m
    color: '#9a948a', // [GAP] warm dust haze matching the wall palette (string, not a slider)
  },
}

// Slider ranges for the debug panel: "group.key" or "group.sub.key" -> [min, max, step].
// Panel refuses to start if a numeric config value is missing a range here,
// so new tunables can't silently skip the panel.
export const TUNING_RANGES = {
  'sim.tickRate': [20, 240, 1],
  'view.fovDeg': [50, 110, 1],
  'view.mouseSensDegPerPx': [0.01, 0.5, 0.01],
  'view.maxPitchDeg': [45, 89.9, 0.1],
  'view.cameraFarM': [50, 1000, 10],
  'movement.runSpeed': [0, 12, 0.05],
  'movement.walkSpeed': [0, 8, 0.05],
  'movement.crouchSpeed': [0, 6, 0.05],
  'movement.groundAccel': [0, 250, 0.5],
  'movement.airAccel': [0, 120, 0.5],
  'movement.airControl': [0, 10, 0.05],
  'movement.airControlMinSpeed': [0, 3, 0.05],
  'movement.groundFriction': [0, 20, 0.1],
  'movement.crouchFriction': [0, 20, 0.1],
  'movement.crouchGlideStartFriction': [0, 10, 0.05],
  'movement.stopSpeed': [0.2, 6, 0.05],
  'movement.crouchRampTime': [0.02, 1.5, 0.01],
  'movement.counterBrakeMult': [0, 8, 0.1],
  'movement.gravity': [2, 40, 0.5],
  'movement.jumpVel': [1, 14, 0.1],
  'movement.jumpBufferTime': [0, 0.3, 0.005],
  'movement.capsuleRadius': [0.15, 0.5, 0.01],
  'movement.standHeight': [1.2, 2.6, 0.01],
  'movement.crouchHeight': [0.8, 2.0, 0.01],
  'movement.eyeStand': [0.8, 2.4, 0.01],
  'movement.eyeCrouch': [0.6, 2.0, 0.01],
  'movement.stanceTime': [0.02, 0.8, 0.005],
  'collision.stepHeight': [0, 0.8, 0.01],
  'collision.stairSnapDistance': [0, 0.8, 0.01],
  'collision.maxSubstepDistance': [0.01, 0.2, 0.005],
  'collision.maxSubsteps': [1, 200, 1],
  'collision.minHeadroom': [0, 0.2, 0.005],
  'weapons.ar.rpm': [100, 1500, 10],
  'weapons.ar.damage': [1, 40, 0.5],
  'weapons.ar.headshotMult': [1, 3, 0.05],
  'weapons.ar.legMult': [0.1, 1.5, 0.05],
  'weapons.ar.magSize': [5, 100, 1],
  'weapons.ar.reserveAmmo': [0, 9999, 1],
  'weapons.ar.reloadTime': [0.3, 5, 0.05],
  'weapons.ar.baseSpread': [0, 4, 0.01],
  'weapons.ar.stanceSpreadStand': [0.2, 3, 0.05],
  'weapons.ar.stanceSpreadCrouch': [0.1, 1.5, 0.05],
  'weapons.ar.stanceSpreadAir': [1, 8, 0.1],
  'weapons.ar.moveSpread': [0, 5, 0.05],
  'weapons.ar.moveSpreadCurveExp': [0.5, 4, 0.1],
  'weapons.ar.tightenRate': [0.5, 40, 0.5],
  'weapons.ar.loosenRate': [0.5, 60, 0.5],
  'weapons.ar.stanceMultSmoothRate': [1, 40, 0.5],
  'weapons.ar.moveRecoil': [0, 3, 0.05],
  'weapons.ar.recoilRecoveryRate': [0, 60, 0.5],
  'weapons.ar.patternResetTime': [0, 2, 0.05],
  'weapons.ar.falloffStartDist': [0, 150, 1],
  'weapons.ar.falloffEndDist': [10, 300, 1],
  'weapons.ar.falloffMinMult': [0.1, 1, 0.01],
  'weapons.ar.maxRange': [20, 1000, 10],
  'weapons.ar.tracerTime': [0, 0.3, 0.005],
  'weapons.ar.muzzleTime': [0, 0.3, 0.005],
  'weapons.ar.impactMarkSize': [0.005, 0.15, 0.005],
  'weapons.sniper.rpm': [10, 180, 1],
  'weapons.sniper.damage': [10, 150, 1],
  'weapons.sniper.headshotMult': [1, 3, 0.05],
  'weapons.sniper.legMult': [0.1, 1.5, 0.05],
  'weapons.sniper.magSize': [1, 20, 1],
  'weapons.sniper.reserveAmmo': [0, 9999, 1],
  'weapons.sniper.reloadTime': [0.5, 8, 0.05],
  'weapons.sniper.baseSpread': [0.5, 8, 0.05],
  'weapons.sniper.stanceSpreadStand': [0.2, 3, 0.05],
  'weapons.sniper.stanceSpreadCrouch': [0.1, 1.5, 0.05],
  'weapons.sniper.stanceSpreadAir': [1, 8, 0.1],
  'weapons.sniper.moveSpread': [0, 5, 0.05],
  'weapons.sniper.moveSpreadCurveExp': [0.5, 4, 0.1],
  'weapons.sniper.tightenRate': [0.5, 40, 0.5],
  'weapons.sniper.loosenRate': [0.5, 60, 0.5],
  'weapons.sniper.stanceMultSmoothRate': [1, 40, 0.5],
  'weapons.sniper.moveRecoil': [0, 3, 0.05],
  'weapons.sniper.recoilRecoveryRate': [0, 60, 0.5],
  'weapons.sniper.patternResetTime': [0, 2, 0.05],
  'weapons.sniper.falloffStartDist': [0, 300, 1],
  'weapons.sniper.falloffEndDist': [50, 600, 1],
  'weapons.sniper.falloffMinMult': [0.1, 1, 0.01],
  'weapons.sniper.maxRange': [50, 1000, 10],
  'weapons.sniper.tracerTime': [0, 0.3, 0.005],
  'weapons.sniper.muzzleTime': [0, 0.3, 0.005],
  'weapons.sniper.impactMarkSize': [0.005, 0.2, 0.005],
  'loadout.switchTime': [0.1, 1.5, 0.05],
  'scope.fovDeg': [6, 40, 1],
  'scope.zoomSens': [0, 1, 0.05],
  'scope.scopeTime': [0.05, 1, 0.01],
  'scope.fogMult': [0, 1, 0.01],
  'scope.spreadMult': [0.001, 1, 0.001],
  'scope.speedMult': [0.1, 1, 0.05],
  'scope.swayAmpDeg': [0, 1.5, 0.01],
  'scope.swayRate': [0.05, 2, 0.01],
  'scope.swayMoveMult': [0, 10, 0.1],
  'scope.swayCrouchMult': [0.1, 1, 0.05],
  'scope.heatMix': [0, 2, 0.05],
  'scope.scanlineFreq': [0, 1080, 10],
  'scope.noiseAmt': [0, 0.3, 0.005],
  'scope.vignette': [0, 1, 0.05],
  'dummies.hp': [1, 500, 5],
  'dummies.respawnTime': [0.5, 10, 0.1],
  'dummies.hitFlashTime': [0, 1, 0.01],
  'fog.density': [0, 0.06, 0.0005],
}
