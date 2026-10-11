# FPS Design Spec (working title: TBD)

Source of truth for the coding assistant. If code and this document disagree, ask before changing either. Every number below is a STARTING PLACEHOLDER, not a final value. All of them live in one config object and are tunable at runtime.

## 1. Pillars

1. **Skill over flicks.** Long time to kill (Apex-like) so tracking, positioning, and stance control matter.
2. **Movement with weight.** Momentum and stance change spread and recoil continuously; no sprint slides.
3. **Readable and original.** CS2 style tactical rounds, MW style preselected kits, original fiction (Norse/Germanic aesthetic), no real weapon names or franchise assets.
4. **Gritty, not blocky.** See section 9.

## 2. Tech and architecture

- **Client:** Three.js, pointer lock, plain JS (ES modules), no build step required unless unavoidable.
- **Simulation:** one engine-agnostic module (`sim/`) with no DOM, no Three.js, no networking inside it. It takes inputs and a time step and returns state. Client and server both import it.
- **Server (default):** Node.js WebSocket dedicated server running `sim/` authoritatively. Tick rate in config (start 64 Hz). Hit registration is a server-side ray cast against hitboxes.
- **Client prediction:** client predicts its own movement and reconciles with server snapshots. Add lag compensation only if shots feel wrong.
- **Optional private games:** a transport layer (`send`, `onMessage`, `onConnect`) hides the network. A second transport lets one player's browser run `sim/` in a Web Worker and talk to friends over WebRTC, with the dedicated server doubling as signaling. Gameplay code must not know which transport is in use.
- **Anti-cheat:** not a concern. Do not spend effort on it.
- **Bots:** basic, for playtesting only (waypoint graph pathing, simple aim with error, simple firing rules). Do not design systems around bots.
- **Units:** meters, seconds, degrees. Y is up.

## 3. Config and tuning

- One file, `config.js`, exports every tunable (movement, weapons, economy, fog, vision, timers).
- A debug panel (toggle with a key) exposes sliders for the numeric values and edits them live, with a button to export the current values as JSON.
- No magic numbers in game code; if it is a number the designer might tune, it is in config.

## 4. Movement

Model: inertia based. Velocity is changed by acceleration and friction; stance changes friction and acceleration gradually, never by snapping velocity.

| Value | Start |
|---|---|
| Run speed | 5.5 m/s |
| Walk speed (hold key) | 3.0 m/s |
| Crouch speed | 2.2 m/s |
| Ground acceleration | 45 m/s^2 |
| Air acceleration / air control | 12 m/s^2 / 0.35 |
| Gravity / jump velocity | 20 m/s^2 / 6.0 m/s |
| Capsule | radius 0.35; height 1.8 standing, 1.2 crouched |
| Eye height | 1.65 standing, 1.1 crouched |
| Stance transition time | 0.15 s |

- **Crouch glide:** on crouch, friction starts low and ramps up to its full value over `crouchRampTime` (start 0.35 s), so speed carries and bleeds off instead of stopping.
- **Deadstop (optional skill move):** while crouched, input opposite to current velocity applies a brake acceleration (`counterBrakeMult`, start 2.5x ground acceleration). This allows a deliberate hard stop but is not the default behavior.
- **No slide, no mantle, no sprint** in the first playable. (Open question: whether a sprint is wanted later.)
- Collision: AABB and capsule against map boxes; swept to avoid tunneling.

## 5. Weapons, spread, and recoil

**Kits:** preselected loadouts per role; minimal attachments (none at first). **ADS only on sniper rifles.** Other weapons fire from the hip with an always-visible crosshair that reflects current spread.

**Health and TTK targets:** player health 100; armor absorbs a fraction of damage while its pool lasts. Headshot multiplier low (1.5x) to protect the long TTK. Body-shot time to kill targets: rifle about 0.8 s, SMG about 0.65 s close range, sniper 2 body shots, 1 headshot. Hitboxes: head, body, legs, as simple boxes or capsules.

**Starting weapons (fictional names, placeholders):** sidearm, SMG, rifle, sniper rifle. All hitscan.

**Spread (continuous, driven by real velocity):**

```js
const speedFactor = clamp(speed / runSpeed, 0, 1);
const target = weapon.baseSpread
  * stanceMult[stance]                      // crouch tight, stand wider, air widest
  * (1 + weapon.moveSpread * curve(speedFactor));
const rate = target < spread ? tightenRate : loosenRate;
spread += (target - spread) * (1 - Math.exp(-rate * dt));
```

Starting values: baseSpread 0.4 deg (rifle), stanceMult stand 1.0 / crouch 0.55 / air 3.0, moveSpread 1.2, `curve(x) = x^1.5` (gentle, no "can't hit a barn while walking"), tightenRate 8, loosenRate 18. A fast stop produces a fast spread drop automatically because speed itself drops; that near-snap is intended.

**Recoil:** deterministic per-weapon pattern (array of pitch/yaw offsets per shot). The pattern SHAPE is fixed per weapon; its SCALE is multiplied by the stance multiplier (smoothed) and by `1 + moveRecoil * curve(speedFactor)`. Recovery returns the view toward the start point at a configurable rate after firing stops. No randomness in the pattern; random spread is separate and uses the spread value above.

## 6. Game mode: Capture and Bomb (single round, two phases)

- **Teams:** attackers and defenders. Sides swap at halftime.
- **Phase 1, capture:** attackers must capture and hold a forward control point. Completing capture unlocks the bomb and the plant sites.
- **Phase 2, plant:** attackers carry and plant the bomb at one of two sites; defenders defuse. Defenders may retake the control point during the round to close the plant window if the bomb is not yet planted (exact rule to tune).
- **Win conditions:** detonation wins for attackers; defuse, elimination of attackers, or timer expiry wins for defenders. Elimination of defenders after unlock also wins for attackers.
- **No respawns within a round.** Round timers in config (start: 90 s phase 1 cap, 100 s phase 2 bomb round timer, 40 s fuse).
- **Match:** first to 7 round wins (12 round regulation, halftime after round 6), tunable.
- **Second mode:** Team Deathmatch (respawns, first to 50 kills), same weapons.

## 7. Economy

- Credits carry between rounds; win bonus, loss bonus with a modest loss streak bonus (cap it so losing streaks do not snowball), small kill rewards, objective rewards.
- Credits buy **utility and kit tier** (armor, grenades, a heavier or lighter kit), not individual guns.
- Dead players keep nothing from the round except credits earned.
- Values in config; first playable may stub this with a fixed credit amount.

## 8. Fog and vision

- **Gradual fog caps view distance.** Use exponential fog so objects fade smoothly (start `FogExp2` density 0.012, tuned so enemies are mostly lost around 120 to 150 m). Fog is a client render effect only; hit registration and the server are unaffected, so a distant enemy can still be shot and can still shoot you.
- **Culling:** set the camera far plane just past the fog's full opacity distance to save performance.
- **Bots:** limit their perception to the same effective distance so they do not out-see players.
- **Sniper scopes cut through fog:** while scoped, multiply fog density by `scopeFogMult` (start 0.15), with a narrow FOV and scope sway.
- **Thermal gadget:** a usable item that lets non-sniper weapons also see through fog. Multiplies fog density by `thermalFogMult` (start 0.25) while active. Limited duration, cooldown, narrower peripheral vision, cannot be used while scoped. A balance concern is sniper plus thermal dominance at range; tune duration, cooldown, and sway before adding more.
- **Shared aesthetic:** scopes and the thermal gadget use the same look: dark green scanline base, with players rendered hot in red and orange.

**Implementation sketch (Three.js):** put player meshes on a dedicated layer. When scoped or thermal is active, render a heat mask pass (players as flat red/orange gradient, bloomed) into a render target, then composite in a post-process shader: world luminance mapped to a green ramp, horizontal scanlines (`sin(screenY * lineFreq)`), light noise, vignette, plus the heat mask on top.

## 9. Art direction

**Goal:** gritty, believable, not blocky, not Roblox.

- **Palette (6 to 8 desaturated, earthy hues defined as constants):** slate blue-gray, weathered oak brown, moss green, iron gray, bone, ochre, rust, ash. No pure saturated primaries. Avoid crushed near-black shadows; keep a mid-tone floor so details stay readable.
- **Materials:** PBR (MeshStandardMaterial) with albedo, roughness, metalness, normal, and ambient occlusion maps from CC0 sources (ambientCG, Poly Haven). Add a shared fine grain normal map as a detail layer over everything so surfaces read as grainy.
- **Geometry:** no sharp 90 degree edges on visible silhouettes; use small, varied bevels. Build maps from a modular kit with trim sheets, then break repetition with decals (stains, cracks, wear, scorch marks).
- **Texel density:** consistent across the map (start 256 px per meter), anisotropic filtering on.
- **Lighting and post:** baked or carefully placed lights, fog, ambient occlusion, subtle bloom, color grade, light film grain. Nothing flat-unlit.
- **Weapons:** hard-surface, built from chamfered primitives with metal PBR and wear masks. Weapon animation (sway, recoil kick, reload) is procedural code, not skeletal.
- **Characters:** use a pre-rigged humanoid base (CC0 kits or a Mixamo rig, check terms), retarget idle, run, crouch, shoot, death animations; customize with attached static armor and retextured per team. Custom anthro rigs are out of scope for the first playable.
- **Assets:** CC0 or self-made only. Keep an `ASSETS.md` listing every asset, source, and license.

## 10. Milestones

1. **M1 Movement room:** empty room, inertia movement, stances, jump, config panel with live sliders.
2. **M2 Range:** one weapon with recoil pattern, spread, hit detection, targets, spread and recoil debug overlay.
3. **M3 Round loop vs bots:** four weapons, basic bots, capture and bomb round, scoreboard.
4. **M4 Netcode:** dedicated server, prediction and reconciliation, private-host transport.
5. **M5 Economy and TDM.**
6. **M6 Art pass:** materials, kit, decals, post, characters.
7. **M7 Fog and vision:** fog, scopes, thermal gadget.

## 11. Working rules for the coding assistant

- Keep `sim/` deterministic and free of engine, DOM, and network code.
- Every tunable goes in `config.js`; no magic numbers.
- Small files, clear module boundaries, short comments explaining why.
- After each milestone, provide run instructions and what to playtest.
- Never use real franchise, weapon, or map names or assets.
- Ask before changing anything in sections 1, 4, 5, or 6.
