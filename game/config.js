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

  // ---- The arsenal (M3: four weapons). Key order here is only the panel's
  // section order — what you CARRY is loadout.slots below (classic carry-2);
  // the other two live on the weapon wall in the range (E to take one).
  // Spec §5 starting weapons are sidearm/SMG/rifle/sniper; the M3 user brief
  // is AR + Thermal Rifle (from M2) + SMG + Shotgun. Each weapon is a full,
  // self-contained block — copy-tune, not refactor.

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

    // SMG — the close-range bracket UNDER the AR median (spec §5: "SMG about
    // 0.65 s close range" body TTK). 12 dmg x 750 rpm = 150 DPS -> 9 body
    // shots on 100 hp = 0.64 s up close, vs the AR's 0.80 s. It pays for that
    // with a much wider move cone (1.6 moveSpread: 1.43 deg at full run vs the
    // AR's 0.88) and a harder falloff (floor 0.55 at 45 m vs 0.75 at 70 m), so
    // past ~35 m the AR wins again — the median stays the median.
    smg: {
      name: 'SMG',
      canScope: false, // [SPEC §5] ADS only on sniper rifles

      rpm: 750, // [GAP] 0.080 s between shots
      damage: 12, // [GAP] chosen for the 0.64 s close TTK (spec target "about 0.65 s")
      headshotMult: 1.5, // [SPEC §5] low global multiplier protects the long TTK
      legMult: 0.75, // [GAP] matches the AR

      magSize: 32, // [GAP]
      reserveAmmo: 9999, // [GAP] it's a range
      reloadTime: 1.8, // [GAP] fast — the SMG's job is pressure

      // Spread — spec §5 model verbatim; tuned so running spray falls apart
      // at range but crouch discipline tightens it right up.
      baseSpread: 0.55, // [GAP] wider than the AR at rest — it is a close cone
      stanceSpreadStand: 1.0, // [SPEC §5] shared stance table
      stanceSpreadCrouch: 0.55, // [SPEC §5]
      stanceSpreadAir: 3.0, // [SPEC §5]
      moveSpread: 1.6, // [GAP] running = 2.6x cone; punishes spray-and-strafe at distance
      moveSpreadCurveExp: 1.5, // [SPEC §5]
      tightenRate: 8, // [SPEC §5]
      loosenRate: 18, // [SPEC §5]
      stanceMultSmoothRate: 10, // [GAP]

      moveRecoil: 0.6, // [GAP]
      recoilRecoveryRate: 16, // [GAP] settles fast between bursts — a close weapon
      patternResetTime: 0.35, // [GAP]

      // Range model — the close bracket: full to 14 m, slides hard to 0.55 by
      // 45 m. At 45 m a body shot is 6.6 -> 16 shots, 1.28 s TTK (AR: 1.0 s).
      falloffStartDist: 14, // [GAP]
      falloffEndDist: 45, // [GAP]
      falloffMinMult: 0.55, // [GAP]
      maxRange: 200, // [GAP]

      // Fixed spray shape: a light, fast W-wiggle — four shallow yaw swings
      // (right, left, right, left) under a 3.0 deg total climb. Deliberately
      // NOT the AR's one long S: this one chatters. Data, not sliders.
      recoilPattern: [
        [0.14, 0.02], [0.14, 0.03], [0.14, 0.04], [0.14, 0.05], [0.14, 0.06], [0.14, 0.06], [0.14, 0.05], [0.14, 0.04],
        [0.10, 0.02], [0.10, 0.00], [0.10, -0.02], [0.10, -0.03], [0.10, -0.04], [0.10, -0.05], [0.10, -0.05], [0.10, -0.04],
        [0.08, -0.02], [0.08, 0.00], [0.08, 0.02], [0.08, 0.03], [0.08, 0.04], [0.08, 0.05], [0.08, 0.05], [0.08, 0.04],
        [0.06, 0.02], [0.06, 0.00], [0.06, -0.02], [0.06, -0.03], [0.06, -0.04], [0.06, -0.04], [0.06, -0.03], [0.06, -0.02],
      ],

      tracerTime: 0.05, // [GAP]
      muzzleTime: 0.04, // [GAP]
      impactMarkSize: 0.03, // [GAP]
    },

    // Shotgun — the burst bracket. The user brief: strong up close but FAIR,
    // no "instant death zone that turns to confetti two meters later", and
    // genuinely strong at midrange. Three mechanics do that together:
    //
    // 1) PER-PELLET CAP: 8 pellets x 12 damage = 96 on a full body blast — one
    //    pellet SHORT of the 100 hp kill. Point blank NEVER one-shots a body;
    //    the second pump (0.8 s later) finishes. A one-shot needs a close aim
    //    at the HEAD (e.g. 7 head + 1 body = 138 at 8 m) — a deliberate skill
    //    shot, not a zone you walk into.
    // 2) STAIRCASE PELLET LAYOUT: pellets sit at 8 different radii of the
    //    spread cone (pelletLayout below), x-dominant so each one exits the
    //    0.56 m-wide body box at its own distance (~14.5 / 18 / 23 / 30 / 39.5 /
    //    54 / 79 m at the default 1.35° cone) — the blast loses pellets ONE AT
    //    A TIME as range grows. A uniform-disc blast (the meme) holds every
    //    pellet to one cliff distance and falls from 96 to ~7 in a single step;
    //    this one walks down the stairs.
    // 3) HIGH FALLOFF FLOOR: every pellet keeps 55% of its damage forever —
    //    distant pellets CHIP, they never become confetti. "Genuinely strong
    //    midrange" = 2-blast kills to ~23 m, 3-blast to ~30 m; the AR still
    //    out-TTKs it flat past that, which is the fair part.
    //
    // Aim-at-body-center, jitter-0 blast table (the verify script pins these
    // exactly; live play with the default 0.25 jitter blurs the steps):
    //   8 m: 8 pellets -> 96.0 | 13 m: 8 -> 91.9 | 16 m: 7 -> 76.7 | 19 m: 6 -> 62.5
    //   25 m: 5 -> 46.7 | 32 m: 4 -> 32.3 | 45 m: 3 -> 19.8 | 60 m: 2 -> 13.2 | 90 m: 1 -> 6.6
    shotgun: {
      name: 'Shotgun',
      canScope: false, // [SPEC §5] hip fire; the crosshair mirrors the live cone

      rpm: 75, // [GAP] 0.8 s pump — missing up close is punishable; that IS the fairness lever
      damage: 12, // [GAP] PER PELLET (x 8) — see the cap math above
      headshotMult: 1.5, // [SPEC §5] low global multiplier (2+ close head pellets can one-shot)
      legMult: 0.75, // [GAP] matches the AR

      magSize: 6, // [GAP]
      reserveAmmo: 9999, // [GAP] it's a range
      reloadTime: 2.6, // [GAP] long enough that running dry mid-fight stings

      // Spread — the §5 model still drives the CONE (stance/move widen it
      // live); pelletLayout places the pellets inside it.
      baseSpread: 1.35, // [GAP] cone radius the layout scales to
      stanceSpreadStand: 1.0, // [SPEC §5] shared stance table
      stanceSpreadCrouch: 0.55, // [SPEC §5] crouching tightens the core -> better midrange (real synergy)
      stanceSpreadAir: 3.0, // [SPEC §5]
      moveSpread: 0.9, // [GAP] running widens the blast but the core still lands
      moveSpreadCurveExp: 1.5, // [SPEC §5]
      tightenRate: 8, // [SPEC §5]
      loosenRate: 18, // [SPEC §5]
      stanceMultSmoothRate: 10, // [GAP]

      moveRecoil: 0.5, // [GAP]
      recoilRecoveryRate: 12, // [GAP] the 3.4 deg kick recovers in ~0.28 s, inside the 0.8 s pump
      patternResetTime: 0.6, // [GAP]

      // Range model — PER PELLET, by that pellet's own hit distance: full to
      // 10 m, slide to the 0.55 floor at 40 m, flat after (the no-confetti floor).
      falloffStartDist: 10, // [GAP]
      falloffEndDist: 40, // [GAP]
      falloffMinMult: 0.55, // [GAP] the anti-meme floor
      maxRange: 120, // [GAP] pellets stop past the practical fog range (deep fog is sniper country)

      // Fixed blast layout: each pellet's [x=right, y=up] offset in UNIT-CONE
      // coordinates, scaled by the live spread cone. Radii stair-step
      // 0 / .16 / .24 / .32 / .44 / .57 / .73 / .90 with x dominant, so one
      // pellet exits the body box per distance band (the staircase above).
      // Pellet 1 is dead center — a chip hit at ANY range, so a distant blast
      // is never zero.
      pelletLayout: [
        [0.0, 0.0], [0.15, 0.05], [-0.22, 0.1], [0.3, -0.12],
        [-0.4, 0.18], [0.52, -0.24], [-0.66, 0.3], [0.82, -0.38],
      ],
      pelletJitter: 0.25, // [GAP] seeded wobble as a fraction of the cone radius (0 = pure layout)

      // Fixed kick: one 3.4 deg punch drifting half a degree right.
      recoilPattern: [[3.4, 0.55]], // data — reshape here, not in the panel

      tracerTime: 0.05, // [GAP] per pellet — a blast reads as a fan
      muzzleTime: 0.05, // [GAP]
      impactMarkSize: 0.028, // [GAP] per pellet
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

  // The classic carry-2 system: TWO slots, both carried from spawn. `slots`
  // names which weapons start carried (ids must exist in weapons above); the
  // rest live on the range's weapon wall — walk up, E takes one into the slot
  // in hand (fresh ammo; if the other slot already carries it, E just draws
  // it instead). Switching holsters the old gun mid-reload (progress lost, no
  // ammo wasted — reserve only deducts at completion).
  loadout: {
    slots: ['ar', 'sniper'], // [BRIEF] M2 carry-2 default: the median + its long bracket
    switchTime: 0.45, // [GAP] s lower + raise; fire and scope are blocked during it
    equipRadius: 2.2, // [GAP] m from a wall station's center where E works
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

  // ---- VS BOTS (M3b): the player in the round map. Bots use the same pool.
  player: {
    hp: 100, // [SPEC §5]
    hitFlashTime: 0.3, // [GAP] s the damage vignette stays after a hit
    spectateCycleKeys: true, // LMB cycles the follow-cam while dead (bool, not a slider)
  },

  // ---- Capture and Bomb round loop (spec §6, basic M3b fidelity: one bomb,
  // one carrier, hold-E plant/defuse, no respawns in-round, halftime swap).
  round: {
    phase1Time: 90, // [SPEC §6] capture-phase timer
    phase2Time: 100, // [SPEC §6] bomb-phase round timer (stops once planted)
    fuseTime: 40, // [SPEC §6] bomb fuse
    captureTime: 12, // [GAP] s for attackers alone in the zone to fill the bar
    drainTime: 12, // [GAP] s for defenders alone in the zone to drain it back (the retake lever)
    plantTime: 4, // [GAP] s holding E in a site to plant
    defuseTime: 7, // [GAP] s holding E at the bomb to defuse
    freezeTime: 3, // [GAP] round-start freeze (read the banner, bots walk to spawns)
    roundEndTime: 6, // [GAP] s the round-result banner holds before the next round
    halftimeRound: 6, // [SPEC §6] sides swap after this round number
    roundsToWin: 7, // [SPEC §6] first to this many round wins takes the match
    bombPickupRadius: 1.6, // [GAP] m — walk over the dropped bomb to take it
    defuseRadius: 2.2, // [GAP] m — E works at this range from the planted bomb
    captureHeight: 2.2, // [GAP] m — zone counts feet inside it (jumping over doesn't hold)
    postPlantElimWins: false, // [SPEC §6 ambiguity] false = classic reading: after a plant the bomb
    //  stays live even if every attacker dies (defenders must defuse). true = literal spec
    //  list reading ("elimination of attackers wins for defenders" applies post-plant too).
  },

  // Team sizes / match shape.
  match: {
    teamSize: 3, // [GAP] you + (teamSize-1) bot teammates vs teamSize bots
  },

  // Bots — spec §2: "basic, for playtesting only... Do not design systems
  // around bots." They run the SAME deterministic movement/weapon sims as the
  // player (same spread, recoil, falloff, ammo), so tuning a bot means tuning
  // the gun. Everything here is their BRAIN, kept deliberately dumb.
  bots: {
    sightDist: 85, // [GAP] ~ the fog's practical visibility at density 0.02 (spec §8: bots don't out-see players)
    scanHz: 10, // [GAP] perception ticks per second (LOS rays are the expensive part)
    reactionTime: 0.35, // [GAP] s from spotting to first shot
    aimErrorDeg: 4.0, // [GAP] aim error on acquire
    aimErrorMinDeg: 0.8, // [GAP] error after settling on a target
    aimSettleTime: 1.2, // [GAP] s the error takes to tighten
    aimTrackRate: 3.5, // [GAP] rad/s the bot's view swings toward the target
    turnRate: 5.0, // [GAP] rad/s body turns while navigating
    waypointReach: 0.7, // [GAP] m before the next waypoint is taken
    repathTime: 4, // [GAP] s between SAFETY repaths (objective changes repath instantly)
    stuckTime: 1.5, // [GAP] s below stuckSpeed = teleport-free repath nudge
    stuckSpeed: 0.15, // [GAP] m/s that counts as stuck
    combatStrafeHz: 0.9, // [GAP] side-to-side pace while shooting (0 = stand)
    combatStrafeM: 1.6, // [GAP] m amplitude of that pace
    spreadJitterM: 0.45, // [GAP] per-bot offset inside a group so stacks break up
    // weapon pools per side, cycled by bot index (arrays — not sliders, like recoil patterns)
    attackerWeapons: ['ar', 'smg', 'shotgun'],
    defenderWeapons: ['ar', 'sniper', 'smg'],
    fireRangeMult: 0.75, // [GAP] bots hold fire past this fraction of sightDist (their falloff sense)
    fireConeDeg: 2.5, // [GAP] aim must be within this of the target before the trigger pulls
    scopeDist: 15, // [GAP] m — sniper bots settle behind the scope past this range
    loseTargetTime: 1.5, // [GAP] s without sight before a bot gives up its target
  },

  // The first-person gun mesh layer (M3b: meshes are back). FEEL numbers are
  // designer-tunable here; per-weapon placement (offset/length) is art data in
  // client/viewmodel.js, scene.js precedent.
  viewmodel: {
    fovDeg: 60, // [GAP] dedicated viewmodel camera FOV — zoom/sliders don't resize the gun
    swayLag: 9, // [GAP] 1/s — how fast the gun chases look rotation (lower = lazier)
    swayMaxDeg: 2.2, // [GAP] cap on look-lag swing
    bobHz: 9.2, // [GAP] walk cycle frequency at run speed
    bobAmount: 0.014, // [GAP] m vertical bob amplitude at run speed
    kickScale: 0.012, // [GAP] m backward punch per degree of the weapon's recoil kick
    kickSnap: 14, // [GAP] 1/s kick spring toward rest
    reloadDip: 0.12, // [GAP] m the gun sinks while reloading
    switchDip: 0.28, // [GAP] m the gun sinks while raising after a swap
    lowerScope: 0.25, // [GAP] m the gun sinks while scoping (out of the scope picture)
  },

  // Fog — spec §8: gradual exponential fog, client render effect ONLY. Hit
  // registration never sees it (a fogged-out target can still be shot).
  fog: {
    // [SPEC §8 start 0.012 — raised per the M3 request "increase fog strength so
    // it kicks in sooner"]: noticeable haze from ~25 m, the 75 m board is a ghost,
    // the 100 m board is gone. Scoped (x scope.fogMult = 0.15) the 150 m board
    // still reads clearly — the fog loop the Thermal Rifle exists to prove.
    density: 0.02,
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
  'weapons.smg.rpm': [200, 1500, 10],
  'weapons.smg.damage': [1, 40, 0.5],
  'weapons.smg.headshotMult': [1, 3, 0.05],
  'weapons.smg.legMult': [0.1, 1.5, 0.05],
  'weapons.smg.magSize': [5, 100, 1],
  'weapons.smg.reserveAmmo': [0, 9999, 1],
  'weapons.smg.reloadTime': [0.3, 5, 0.05],
  'weapons.smg.baseSpread': [0, 4, 0.01],
  'weapons.smg.stanceSpreadStand': [0.2, 3, 0.05],
  'weapons.smg.stanceSpreadCrouch': [0.1, 1.5, 0.05],
  'weapons.smg.stanceSpreadAir': [1, 8, 0.1],
  'weapons.smg.moveSpread': [0, 5, 0.05],
  'weapons.smg.moveSpreadCurveExp': [0.5, 4, 0.1],
  'weapons.smg.tightenRate': [0.5, 40, 0.5],
  'weapons.smg.loosenRate': [0.5, 60, 0.5],
  'weapons.smg.stanceMultSmoothRate': [1, 40, 0.5],
  'weapons.smg.moveRecoil': [0, 3, 0.05],
  'weapons.smg.recoilRecoveryRate': [0, 60, 0.5],
  'weapons.smg.patternResetTime': [0, 2, 0.05],
  'weapons.smg.falloffStartDist': [0, 100, 1],
  'weapons.smg.falloffEndDist': [10, 200, 1],
  'weapons.smg.falloffMinMult': [0.1, 1, 0.01],
  'weapons.smg.maxRange': [20, 1000, 10],
  'weapons.smg.tracerTime': [0, 0.3, 0.005],
  'weapons.smg.muzzleTime': [0, 0.3, 0.005],
  'weapons.smg.impactMarkSize': [0.005, 0.15, 0.005],
  'weapons.shotgun.rpm': [10, 300, 5],
  'weapons.shotgun.damage': [1, 40, 0.5],
  'weapons.shotgun.headshotMult': [1, 3, 0.05],
  'weapons.shotgun.legMult': [0.1, 1.5, 0.05],
  'weapons.shotgun.magSize': [1, 20, 1],
  'weapons.shotgun.reserveAmmo': [0, 9999, 1],
  'weapons.shotgun.reloadTime': [0.5, 8, 0.05],
  'weapons.shotgun.baseSpread': [0, 6, 0.01],
  'weapons.shotgun.stanceSpreadStand': [0.2, 3, 0.05],
  'weapons.shotgun.stanceSpreadCrouch': [0.1, 1.5, 0.05],
  'weapons.shotgun.stanceSpreadAir': [1, 8, 0.1],
  'weapons.shotgun.moveSpread': [0, 5, 0.05],
  'weapons.shotgun.moveSpreadCurveExp': [0.5, 4, 0.1],
  'weapons.shotgun.tightenRate': [0.5, 40, 0.5],
  'weapons.shotgun.loosenRate': [0.5, 60, 0.5],
  'weapons.shotgun.stanceMultSmoothRate': [1, 40, 0.5],
  'weapons.shotgun.moveRecoil': [0, 3, 0.05],
  'weapons.shotgun.recoilRecoveryRate': [0, 60, 0.5],
  'weapons.shotgun.patternResetTime': [0, 2, 0.05],
  'weapons.shotgun.falloffStartDist': [0, 100, 1],
  'weapons.shotgun.falloffEndDist': [10, 200, 1],
  'weapons.shotgun.falloffMinMult': [0.1, 1, 0.01],
  'weapons.shotgun.maxRange': [20, 1000, 10],
  'weapons.shotgun.pelletJitter': [0, 1, 0.05],
  'weapons.shotgun.tracerTime': [0, 0.3, 0.005],
  'weapons.shotgun.muzzleTime': [0, 0.3, 0.005],
  'weapons.shotgun.impactMarkSize': [0.005, 0.15, 0.005],
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
  'loadout.equipRadius': [1, 5, 0.1],
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
  'player.hp': [1, 500, 5],
  'player.hitFlashTime': [0, 1.5, 0.05],
  'round.phase1Time': [10, 300, 5],
  'round.phase2Time': [10, 300, 5],
  'round.fuseTime': [5, 120, 1],
  'round.captureTime': [2, 60, 0.5],
  'round.drainTime': [2, 60, 0.5],
  'round.plantTime': [0.5, 15, 0.5],
  'round.defuseTime': [0.5, 20, 0.5],
  'round.freezeTime': [0, 15, 0.5],
  'round.roundEndTime': [1, 20, 0.5],
  'round.halftimeRound': [1, 24, 1],
  'round.roundsToWin': [1, 24, 1],
  'round.bombPickupRadius': [0.5, 5, 0.1],
  'round.defuseRadius': [0.5, 6, 0.1],
  'round.captureHeight': [0.5, 6, 0.1],
  'match.teamSize': [1, 6, 1],
  'bots.sightDist': [10, 200, 5],
  'bots.scanHz': [1, 30, 1],
  'bots.reactionTime': [0, 2, 0.05],
  'bots.aimErrorDeg': [0, 15, 0.25],
  'bots.aimErrorMinDeg': [0, 6, 0.1],
  'bots.aimSettleTime': [0.1, 5, 0.1],
  'bots.aimTrackRate': [0.5, 12, 0.25],
  'bots.turnRate': [0.5, 12, 0.25],
  'bots.waypointReach': [0.2, 2, 0.05],
  'bots.repathTime': [0.2, 6, 0.1],
  'bots.stuckTime': [0.3, 5, 0.1],
  'bots.stuckSpeed': [0.05, 1, 0.05],
  'bots.combatStrafeHz': [0, 3, 0.05],
  'bots.combatStrafeM': [0, 4, 0.1],
  'bots.spreadJitterM': [0, 1.5, 0.05],
  'bots.fireRangeMult': [0.2, 1, 0.05],
  'bots.fireConeDeg': [0.5, 10, 0.1],
  'bots.scopeDist': [2, 60, 1],
  'bots.loseTargetTime': [0.2, 6, 0.1],
  'viewmodel.fovDeg': [40, 90, 1],
  'viewmodel.swayLag': [1, 30, 0.5],
  'viewmodel.swayMaxDeg': [0, 8, 0.1],
  'viewmodel.bobHz': [2, 20, 0.2],
  'viewmodel.bobAmount': [0, 0.06, 0.001],
  'viewmodel.kickScale': [0, 0.05, 0.001],
  'viewmodel.kickSnap': [2, 40, 0.5],
  'viewmodel.reloadDip': [0, 0.4, 0.01],
  'viewmodel.switchDip': [0, 0.6, 0.01],
  'viewmodel.lowerScope': [0, 0.5, 0.01],
  'fog.density': [0, 0.06, 0.0005],
}
