// maps/firing-range.js — the M2 range, pure data, CONNECTED to the M1 room (user
// brief: keep the current map; the long corridor gets a doorway to the range).
// Same conventions as movement-room.js: `boxes` collide (sim reads min/max),
// `visuals` render only, `targets` are hitbox zones (hit by rays, walked through).
//
// M3 adds `stations` — the weapon wall: four racks along the west wall behind
// the firing line. Pure data too (weapon id + interaction center [x, z]); the
// client reads them for the E prompt, the sim takes `input.equip` from it.
//
// Layout (top view, +X east, +Z south; floor top = 0):
//  - a 3 m doorway (x 19..22) cut through the corridor's south wall, opening
//    into a 14 m x 160 m x 7 m hall running south
//  - firing line z = 6; dummies at 10/25/50/75/100/125/150 m down three lanes
//    (x 14.5 / 18 / 21.5) so near boards never hide far ones
//  - the hall is deliberately long enough to watch FogExp2 swallow the far
//    targets (density 0.02 now: haze from ~25 m, gone by ~100 m) while hit
//    registration stays fog-blind
//
// Wall mating with M1 (no visible z-fighting):
//  - the corridor south wall is split AROUND the door (this file owns it now)
//  - the hall's north wall (z 1.7..2.1) is back-to-back with that wall
//  - west of the hall entrance the M1 room's own east wall forms the boundary
//    below y 4.4; a filler box plugs the strip above it up to the 7 m ceiling

const B = (min, max, color) => ({ min, max, color })

const LINE = 6 // firing line z; targets stand at LINE + dist
const LANES = [14.5, 18, 21.5]
const DISTS = [10, 25, 50, 75, 100, 125, 150]

// One dummy: three zone boxes (head/body/legs, spec §5 hitboxes) around (x, z).
// Human scale against the 1.8 m player capsule. Zones are hitboxes AND the
// render source — one definition, no drift between what you see and what you hit.
function targetAt(dist) {
  const i = DISTS.indexOf(dist)
  const x = LANES[i % LANES.length]
  const z = LINE + dist
  const zone = (y0, y1, hw, hd) => B([x - hw, y0, z - hd], [x + hw, y1, z + hd])
  return {
    id: 't' + dist,
    dist,
    pos: [x, z],
    zones: {
      legs: zone(0, 0.9, 0.25, 0.15),
      body: zone(0.9, 1.55, 0.28, 0.18),
      head: zone(1.55, 1.85, 0.14, 0.14),
    },
  }
}

const targets = DISTS.map(targetAt)

export const RANGE = {
  firingLine: LINE,
  targets,

  boxes: [
    // ---- corridor south wall, split around the 3 m doorway (x 19..22).
    // West run starts at x 11.4 — the M1 room's east wall already owns
    // x 11..11.4 here, and overlapping coplanar faces would z-fight.
    B([11.4, 0, 1.3], [19, 3.4, 1.7], '#8a857c'),
    B([22, 0, 1.3], [35.4, 3.4, 1.7], '#8a857c'),
    B([19, 2.6, 1.3], [22, 3.4, 1.7], '#8a857c'), // corridor-side lintel (door head 2.6)

    // ---- hall north wall (7 m tall) with the matching opening
    B([10.6, 0, 1.7], [19, 7, 2.1], '#9a948a'),
    B([22, 0, 1.7], [25.4, 7, 2.1], '#9a948a'),
    B([19, 2.6, 1.7], [22, 7, 2.1], '#9a948a'), // hall-side lintel

    // ---- plug above the M1 room's 4.4 m east wall (hall is 7 m tall)
    B([10.6, 4.4, 1.7], [11.4, 7, 7.4], '#9a948a'),

    // ---- hall shell. The floor starts at z 7.4 because the M1 floor slab
    //      already covers z <= 7.4 — coplanar tops would z-fight.
    B([10.6, -0.4, 7.4], [25.4, 0, 162.5], '#6f6d66'), // floor
    B([10.6, 7, 1.7], [25.4, 7.4, 162.5], '#55534e'), // ceiling
    B([10.6, 0, 7.4], [11, 7, 162.1], '#9a948a'), // west wall (face x=11 continues the M1 line)
    B([25, 0, 2.1], [25.4, 7, 162.1], '#9a948a'), // east wall
    B([10.6, 0, 162.1], [25.4, 7, 162.5], '#8a857c'), // back wall — 156 m out, deep in the fog

    // ---- weapon wall (M3): four station racks along the west wall, behind
    // the firing line. Real colliders (you lean over them), 0.55 m deep so
    // the walkway stays clear. Order north -> south: AR, SMG, Shotgun,
    // Thermal Rifle — the two you don't carry wait here (E to take).
    B([11, 0, 4.05], [11.55, 1.05, 4.95], '#5d5b55'), // AR station
    B([11, 0, 7.05], [11.55, 1.05, 7.95], '#5d5b55'), // SMG station
    B([11, 0, 10.05], [11.55, 1.05, 10.95], '#5d5b55'), // Shotgun station
    B([11, 0, 13.05], [11.55, 1.05, 13.95], '#5d5b55'), // Thermal Rifle station
  ],

  visuals: [
    // firing line + one floor stripe per target distance
    B([11, 0, LINE - 0.05], [25, 0.01, LINE + 0.05], '#a86a4f'),
    ...DISTS.map((d) => B([11, 0, LINE + d - 0.03], [25, 0.01, LINE + d + 0.03], '#9a978f')),
    // base plates under the dummies
    ...targets.map((t) =>
      B([t.pos[0] - 0.45, 0, t.pos[1] - 0.35], [t.pos[0] + 0.45, 0.02, t.pos[1] + 0.35], '#55534e')
    ),
  ],

  // text signage (client/signs.js renders these; rotY orients the plane)
  signs: [
    { text: 'RANGE', pos: [20.5, 3.0, 1.29], rotY: Math.PI, w: 1.8, h: 0.5 }, // corridor side, on the lintel
    { text: 'RANGE', pos: [20.5, 3.0, 2.11], rotY: 0, w: 1.8, h: 0.5 }, // hall side
    { text: 'FIRING LINE', pos: [11.02, 2.2, LINE], rotY: Math.PI / 2, w: 2.0, h: 0.5 },
    { text: 'FIRING LINE', pos: [24.98, 2.2, LINE], rotY: -Math.PI / 2, w: 2.0, h: 0.5 },
    ...DISTS.flatMap((d) => [
      { text: d + ' m', pos: [11.02, 2.2, LINE + d], rotY: Math.PI / 2, w: 1.4, h: 0.5 },
      { text: d + ' m', pos: [24.98, 2.2, LINE + d], rotY: -Math.PI / 2, w: 1.4, h: 0.5 },
    ]),
    // weapon wall plates (above the racks; y 1.72 keeps clear of the z 6
    // FIRING LINE plate at y 1.95+ — coplanar signs must never overlap)
    { text: 'AR', pos: [11.02, 1.72, 4.5], rotY: Math.PI / 2, w: 1.0, h: 0.32 },
    { text: 'SMG', pos: [11.02, 1.72, 7.5], rotY: Math.PI / 2, w: 1.0, h: 0.32 },
    { text: 'SHOTGUN', pos: [11.02, 1.72, 10.5], rotY: Math.PI / 2, w: 1.4, h: 0.32 },
    { text: 'THERMAL RIFLE', pos: [11.02, 1.72, 13.5], rotY: Math.PI / 2, w: 1.8, h: 0.32 },
    { text: 'ARMORY — press E at a rack', pos: [11.02, 2.6, 9.0], rotY: Math.PI / 2, w: 3.4, h: 0.4 },
  ],

  // weapon wall interaction data (client reads this; pure data, no imports —
  // display names live in config.js, the strings on the plates above are just
  // paint). pos is the station's interaction center [x, z].
  stations: [
    { weapon: 'ar', pos: [11.3, 4.5] },
    { weapon: 'smg', pos: [11.3, 7.5] },
    { weapon: 'shotgun', pos: [11.3, 10.5] },
    { weapon: 'sniper', pos: [11.3, 13.5] },
  ],
}
