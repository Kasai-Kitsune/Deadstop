# Worklog

---
Task ID: 1
Agent: Z.ai Code (main agent, solo — the milestone is one tightly-coupled codebase where
spec fidelity matters more than parallel throughput, so no subagents were assigned)

Task: Build Milestone 1 (movement room) of the browser FPS per
`upload/fps-design-spec.md`, using only sections 2, 3, 4. Deliverables: standalone
no-build Three.js project (`sim/` + `client/` + `config.js`), debug panel with live
sliders + JSON export, HUD readout (speed/stance/friction), box test room.

Work Log:
- Read the spec; identified gaps to flag, never altered spec §4 numbers.
- Explored env: Next dev server on :3000, Caddy gateway on :81 with
  `?XTransformPort=<port>` forwarding, network OK. Vendored three@0.186.1 to
  `game/vendor/three/` (three.module.js + three.core.js + LICENSE).
- Wrote `game/` standalone project: config.js (all §4 values + [GAP] placeholders +
  TUNING_RANGES), sim/ (player, move, collide, index — pure, deterministic),
  maps/movement-room.js (data only), client/ (main, input, scene, hud, panel),
  index.html (import map → local three), serve.js (bun static server, :4173).
- Wired into the Next app: `public/game` symlink → `../game` (verified: Next serves
  /game/index.html with correct MIME); replaced src/app/page.tsx with a launcher
  (controls, playtest checklist, run instructions, sticky footer).
- Sim verification under Node (`sim/` imports with zero browser deps — the §2
  contract): found and fixed a height/eye lerp inversion (crouch made the capsule
  TALLER), and a float-noise bug in the uncrouch headroom test (touching a wall read
  as overlap). Verified: run cap 5.5, walk 3.0, glide 5.5→2.2 over ~1.6 m,
  deadstop zero-cross in ~1 tick, jump apex 0.9, stair climb 0.45/1.0 with glued
  descent (0 airborne ticks), 1.0 m walk-off is a real fall, ledge row 0.5/0.9/1.3
  jump-climb, table forces crouch + blocks uncrouch until clear, air steering adds
  no speed, 600-tick determinism bit-identical.
- Lint: excluded `game/**` from eslint (vendored three is not Next code); lint clean.
  Added `allowedDevOrigins` for the preview host after a dev.log warning.
- Browser E2E via agent-browser: launcher → /game/index.html; no page/console errors
  (fixed r186 PCFSoftShadowMap removal); HUD live; walk/run/crouch readouts live
  (friction ramp visible mid-flight); drag-look fallback works when pointer lock is
  refused; panel = 31 sliders / 4 groups / 0 missing ranges, slider edits apply live
  (no reload), export = valid JSON of live values, reset restores defaults; Esc
  pause / click resume; 65 KB screenshot proves a real render; 390×844 responsive.
  Note: agent-browser synthetic key events carry no `code`, so keys were driven via
  eval-dispatched KeyboardEvents with proper codes.

Stage Summary:
- Deliverable complete and verified. Run: `cd game && bun run serve` → :4173, or the
  preview launcher at `/` → "Enter the movement room".
- Key decisions awaiting user confirmation (all flagged [GAP] in config.js):
  friction numbers (ground 6, crouch 5, glide start 0.6, stopSpeed 1.5), stepHeight
  0.3, stairSnap 0.3, jumpBuffer 0.1s, airControl = 0.35 rad/s steering, Quake-style
  friction formula, cylinder approximation for horizontal capsule contacts.
- Servers running: Next :3000 (dev), game static :4173.

---
Task ID: 2
Agent: Z.ai Code (main agent, solo — small coupled tuning pass, no subagents)

Task: User playtest request: "faster direction changing and a lot more mid air
control." Retune M1 defaults accordingly (spec line 3: every §4 number is a
starting placeholder; the request is the tuning authority).

Work Log:
- Read worklog + spec + all sim/client files to map where the values flow
  (config.js -> sim reads cfg live each tick; panel sliders from TUNING_RANGES).
- config.js: groundAccel 45->90, groundFriction 6->9, stopSpeed 1.5->2.0,
  airAccel 12->42, airControl 0.35->4.5 rad/s. Slider ranges widened
  (groundAccel 250, airAccel 120, airControl 10) so defaults sit mid-range.
  Comments keep spec provenance: "[SPEC §4 start X — raised per playtest request]".
- sim/move.js: replaced chord-lerp air rotation with EXACT slerp — the old lerp
  loses several % magnitude per tick at large steering angles (invisible at
  0.35 rad/s, speed-destroying at 4.5). Guards for degenerate angles (aligned
  snap; exactly-opposite input rotates via fixed perpendicular, deterministic).
- sim/move.js + sim/player.js: deadstop fix surfaced by the retune — ground
  accel toward the tapped opposite key ran in the same tick as the counterbrake,
  so a tap left ~1.4 m/s residual bleeding at low glide friction (not the
  "deliberate hard stop" the spec describes). applyDeadstop now returns whether
  it braked and player.js suppresses ground accel for that tick: tap = clean
  stop through zero; hold = stop then reverse at crouch speed.
- Headless sim verification (23/23 PASS, scratch script kept outside the repo):
  ground 180° reversal 0.109 s (was ~0.25 s); stop from run 0.203 s (was ~0.31);
  standstill jump reaches 5.50 m/s in air; mid-air reversal fully reversed by
  landing (vx -5.50), -4 m/s within 0.219 s of apex; 90° air curve in one jump
  with 100% speed retention (5.50 landing, slerp proof); no free air speed
  (cap 5.55 holds); glide carries 5.5->2.2 at ramp end, bleeds <1.0 in 0.44 s
  (W released), settles 2.2 (W held); deadstop tap full stop in 16 ms and stays
  stopped, hold zero-cross 16 ms + reverse in 47 ms; stairs 0.45/1.0 glued
  climb + real walk-off fall; corridor end cap no-tunnel (x=34.650); 64 Hz
  determinism bit-identical.
- Browser E2E via agent-browser: /game/index.html loads with zero page/console
  errors; HUD boots showing friction 9.00; synthetic-key W run reaches 5.50 m/s;
  release->0.00 (crisp stop); jump+A holds 5.50 m/s mid-air while redirecting
  ~90° (landed against the 1.3 ledge, physically consistent); panel 31 sliders
  show new defaults (90/42/4.5/9/2); live slider edit applies (6.0 shown); reset
  restores; export JSON contains new values; 62 KB screenshot proves render;
  launcher / shows the retune copy; :4173 static server serves updated files.
- lint clean; dev.log clean except the pre-existing cosmetic preview-origin
  warning (page serves 200, same as the previously verified session).

Stage Summary:
- Feel targets delivered: direction changes ~2x faster on the ground; mid-air
  authority near ground level (42 m/s² air accel + 258°/s velocity rotation).
- Two latent bugs fixed because the new values exposed them: chord-lerp speed
  loss in air steering, and deadstop polluted by same-tick accel.
- Deliberate design kept: air can steer/rebuild but never gain speed beyond
  max(entry speed, stance target) — no strafe-jump gains (spec "movement with
  weight"). The clamp in airMove is the knob if that ever changes.
- Deadstop is now 2.5 x 90 = 225 m/s² (16 ms full stop) because it scales with
  groundAccel per the spec formula — flagged to the user; counterBrakeMult
  slider is the dial if it feels too snappy.
- All values live-tunable in the ` panel; JSON export round-trips them.

---
Task ID: 3
Agent: Z.ai Code (main agent, solo — M2 is one tightly-coupled codebase; no subagents)

Task: Milestone 2 — the balanced AR (the median all later guns bracket around:
modest DPS, moderately high accuracy, ok at all ranges), plus a firing range
CONNECTED to the M1 map through a doorway on the long corridor, sized so fog is
clearly visible and testable. Keep M1 movement + configs + panel intact.

Work Log:
- Read worklog + spec + all M1 files. Extended config.js with weapon (AR) and
  fog groups, every value provenance-tagged ([SPEC §5/§8], [BRIEF], [GAP]) and
  every numeric wired into TUNING_RANGES (60 sliders total now).
- sim/weapon.js: full-auto cadence with cooldown remainder carry (exact 600 rpm
  at 64 Hz, no tick-rounding loss), 30-mag + reserve reload (R edge, auto on
  empty hold, dry-fire on fresh click), spec §5 spread model verbatim (base x
  stanceMult x (1 + moveSpread x curve^1.5), tighten/loosen rates, planar speed
  only), smoothed stance multiplier scaling a FIXED 30-shot recoil pattern
  (5.30 deg full-mag climb, S-drift), recovery at 14 deg/s, pattern reset.
  Only randomness: seeded mulberry32 stream in weapon state (server-replayable).
- sim/hitscan.js: slab-method ray-vs-AABB + world castRay (walls shield
  targets, nearest zone wins, fog never sees hitreg). Exported for M4.
- maps/firing-range.js: 14 x 160 x 7 m hall off a 3 m doorway cut through the
  corridor south wall (wall split lives here; M1 room file no longer defines
  it; mating faces derived to avoid z-fighting/gaps). 7 dummies (head/body/legs
  zones are both hitboxes and render source) at 10..150 m on 3 lanes, firing
  line + distance signage (client/signs.js canvas plates).
- client/weapon-view.js: box-built GUNGNIR rifle in a SECOND scene/pass (never
  clips walls, never fogged), sway/bob/kick/reload-dip procedural anim, muzzle
  flash + light, pooled tracers, persistent impact marks, dynamic crosshair
  (gap = live cone projected at FOV), hit marker.
- client/hud.js: added spread readout, range telemetry (shots/hits/acc/dmg/
  last-hit zone+damage+dist), ammo block with reload bar; client/debug-overlay.js:
  F3/V overlay (live numbers, recoil pattern plot with next-shot marker, rolling
  48-shot scatter vs current cone); index.html M2 chrome; launcher page.tsx M2
  copy + playtest checklist.
- HEADLESS VERIFICATION (scratch script /home/z/m2-verify.mjs, outside repo):
  58/58 PASS after fixing 12 test-expectation bugs (all game math was already
  exact — e.g. 50 m damage 10.5126 is the front-face dist 49.832 in the
  falloff slide; jump apex 0.947 is discrete Euler 0.9 + v*dt/2). Proves §2
  purity (bare-bun import), exact 600 rpm cadence, spread table 0.40/0.22/
  1.20/0.88 deg, recoil accumulation/recovery/reset/scales, zone + falloff
  damage (12/18/9, 10.5126@50m, 9.0@100m+, 9.0@150m fog-blind), reload state
  machine + reserve math, rayBox primitives, same-seed bit-identical shot logs,
  200-shot cone containment (max 0.3986 <= 0.40, RMS 0.283 = r/sqrt2), doorway
  sightline 161.6 m + walkthrough both directions, M1 regression (run cap 5.5).
- BROWSER E2E (agent-browser + VLM screenshot analysis): found + FIXED a real
  bug — gunCam never mirrored the camera, so the viewmodel sat ~19 m from its
  own camera (far=5) and was frustum-culled every frame (VLM: no gun visible).
  Fix: mirror gunCam with gunRoot (muzzle world positions stay correct for
  tracers). Re-verified: VLM confirms barrel/receiver/stock/mag/sights render.
  Also verified: zero page/console errors; HUD + GUNGNIR 30/30; entry card ->
  fallback; exact headshot burst (3x18=54, recoil 1.70 deg after 7 shots,
  over-climb misses hit the west wall 18.6 m out — geometry consistent);
  recovery to 0; R reload (bar 25%, ammo 30, reserve 9974 exact); doorway walk
  (x pinned, z 0->7.49, grounded, 5.5 m/s); fog visible far down the hall
  (VLM-confirmed); panel 60 sliders / 6 groups / 0 missing ranges, live fog
  slider edit (0.012->0.03 next frame), JSON export carries live values, reset
  restores; F3 overlay renders both graphs (VLM-confirmed); hit marker decays;
  crosshair 5px stand -> 5.775px full run (exact cone math); mobile 390x844;
  launcher M2 copy + 8 playtests + sticky footer (sticks at 1700px viewport,
  pushes naturally when content overflows).
- lint clean (game/** still excluded — vendored three is not Next code).

Stage Summary:
- M2 complete and verified end-to-end. Run: launcher at `/` -> "Enter the
  range", or `cd game && bun run serve` -> :4173.
- THE bug of the session: unmirrored gunCam culled the viewmodel — caught only
  by VLM screenshot review; state-level E2E alone would have passed it.
- AR balance (the median): 12 dmg x 600 rpm = 120 DPS, 9 body shots = 0.80 s
  TTK on 100 hp; spread 0.40 deg base (0.22 crouched / 0.88 running / 1.20
  air); falloff 1.0 to 30 m sliding to 0.75 at 70 m+; head x1.5 / legs x0.75.
- Flagged defaults (all live-tunable, [GAP]-tagged in config.js): legMult 0.75,
  magSize 30 / reload 2.0 s, moveRecoil 0.5, recovery 14 deg/s, patternReset
  0.45 s, falloff band 30-70 m floor 0.75, maxRange 300, fog FogExp2 0.012
  warm dust (#9a948a), reserve 9999 (it's a range).
- Servers: Next :3000 (dev), game static :4173. Scratch verify script kept at
  /home/z/m2-verify.mjs (not in the repo).

---
Task ID: 4
Agent: Z.ai Code (main agent, solo — small, tightly-coupled change set)

Task: M2+ follow-up from the user: (a) rename the guns to plain "AR" and
"Thermal Rifle", (b) REMOVE the gun models (never requested; keep the sniper's
ADS scope), (c) AR recoil: grounded S-drift stays, airborne becomes a snappy
Z-drift — clearly different the moment you jump. Reply to the user in English
from now on.

Work Log:
- config.js: ar.name 'GUNGNIR' -> 'AR'; sniper.name 'SKADI' -> 'Thermal
  Rifle'; comments updated. Added weapons.ar.recoilPatternAir (30 rows,
  [BRIEF]-tagged, [pitchUp, yawRight]): top bar right at full rate, diagonal
  steepest-left row FIRST (sharp corners), bottom bar right again; magnitude
  still rides the shared stance scale (x3 in air). Optional key — weapons
  without it (sniper) fire their ground pattern airborne.
- sim/weapon.js fireOne: pattern = (!player.grounded && W.recoilPatternAir) ?
  recoilPatternAir : recoilPattern. Shared pattern index, no reset on
  ground-state change — ground-only sprays stay bit-identical to M2; jumping
  mid-burst just changes the shape of the next row.
- client/weapon-view.js: stripped BOTH box-built viewmodels, the gun scene /
  second render pass, gunCam, rigs, sway/bob/kick/reload-dip/switch-dip, bolt
  cycle, renderer.autoClear. Kept: tracers, muzzle flash (now billboarded in
  the MAIN scene at a virtual camera-space MUZZLE offset), persistent impact
  marks, dynamic crosshair, hit marker, body.scoped CSS swap. renderOver
  removed; main.js render loop simplified (world -> thermal composite).
- client/debug-overlay.js: pattern plot follows the live pattern (grounded ?
  S : Z) and labels itself S-DRIFT / Z-DRIFT (AIR) in the canvas corner.
- index.html + src/app/page.tsx: all copy renamed (hint line, entry card,
  controls, playtests); new "Recoil: S vs Z" playtest entry; Space control
  line mentions the mid-air swap; launcher notes "no gun models yet".
- HEADLESS VERIFICATION (/home/z/m3-verify.mjs, outside repo): 29/29 PASS
  after fixing 3 test-expectation bugs (tick-count vs ~6.4 ticks/shot cadence;
  wantShots=0 sentinel exiting instantly; epsilon 1e-6 vs stanceMult still
  converging mid-burst). Proves: names, 30/30 rows, Z invariants (right
  +2.76 / left -1.32 / ends +2.16), snappy steps (max |dyaw| 0.86 air vs 0.02
  ground), grounded S bit-identical to M2 (0.78/0.06 exact), air rows x ~3.0
  scale, mid-burst jump switches shape row-by-row (scale-free yaw/pitch ratio
  on all 14 shots, index never resets, landing resumes S at idx 11), sniper
  fallback, same-seed determinism.
- FIRST PATTERN CUT REJECTED BY VLM REVIEW: the initial Z had taper rows at
  the segment joints, so the plotted corners read "smooth, rounded, like an
  S" to a neutral VLM. Sharpened: bars hold full rate into each corner, the
  steepest row lands immediately after the flip. Re-verified: VLM now reads
  "Z-DRIFT (AIR)", "SHARP corners", "zigzag / lightning bolt silhouette".
- BROWSER E2E (agent-browser, entry card -> drag-look fallback as usual):
  zero page/console errors; HUD chips "1 AR" / "2 Thermal Rifle" + name
  switch on 1/2; 15 persistent impact marks after AR bursts (FX layer intact
  through the refactor); scoped: scopeT 1, FOV 18, crosshair hidden, red dot
  visible, VLM confirms thermal green + scanlines + 6 hot orange/red dummies
  through the haze with near-clear/far-hazy gradient; scoped body shots t10
  70+70 -> kill (kills:1) -> respawn (100 hp) — head-time miss diagnosed as
  aim over the head (1.80 m + sway vs 1.85 head top), not a bug; VLM confirms
  NO gun model in scoped, hip, and airborne screenshots; S-DRIFT label
  grounded, Z-DRIFT (AIR) + spread 1.200 deg airborne; live full-mag airborne
  burst (gravity 4 in the 7 m hall via live config, restored + reloaded
  after): yaw walk 0 -> +8.27 (top bar) -> -3.97 (diagonal crossing) -> back
  right — the complete Z in the running client; launcher / has the new copy,
  no old names anywhere (grep clean), footer sticks at 2100 px viewport,
  pushes naturally at 900 px, no horizontal overflow at 390 px.
- lint clean (game/** excluded as before). Both servers up: Next :3000,
  game static :4173.

Stage Summary:
- Names are the user's plain ones; models are gone (scope kept); the AR now
  has two recoil personalities: S-drift grounded, snappy Z-drift airborne,
  ~3x harder per step via the existing air stance scale, switching instantly
  on takeoff and resuming the S on landing without losing pattern position.
- Recoil shape selection lives in the SIM (server-replayable, deterministic),
  as data in config.js, plotted live in the F3 overlay with a shape label.
- Verification stack that caught real issues: VLM screenshot review rejected
  the first "rounded" Z (data fixed), and the headless suite pins every row.
- Scratch verifier kept at /home/z/m3-verify.mjs (outside the repo, like
  m2-verify.mjs). Open defaults to flag in a future pass: air-pattern sweep
  size (12 deg yaw walk over a full airborne mag at x3) is intentionally wild
  and data-tunable; document.title on / is still the scaffold default (cosmetic,
  pre-existing).
