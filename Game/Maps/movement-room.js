// maps/movement-room.js — the M1 test room, pure data. No imports.
// `boxes` are colliders (sim reads only .min/.max). `visuals` render but never collide
// (the corridor distance markers). `color` is a hint for the client; the sim ignores it.
//
// Layout (top view, +X east, +Z south; floor top = 0):
//  - west end: two solid stair flights (rise 0.15 and 0.25) onto platforms 0.45 / 1.0
//  - north wall: ledge row 0.5 / 0.9 / 1.3 — a jump-climb route; 1.3 is unreachable by design
//  - east side: a "table" you must crouch under (1.3 m clearance) and two corner-slide pillars
//  - east wall: a 24 m corridor with 2 m distance markers for judging stopping distance
//
// M2: the corridor's south wall run is supplied by maps/firing-range.js — it is
// split there around a 3 m doorway into the range hall. This file deliberately
// does NOT define that wall anymore.

const B = (min, max, color) => ({ min, max, color })

export const ROOM = {
  boxes: [
    // floor + ceilings
    B([-11.4, -0.4, -7.4], [35.4, 0, 7.4], '#6f6d66'), // iron gray floor, mid tone (spec §9)
    B([-11.4, 4, -7.4], [11.4, 4.4, 7.4], '#55534e'), // main ceiling
    B([11, 3, -1.7], [35.4, 3.4, 1.7], '#55534e'), // corridor ceiling (3.0 m interior)

    // main room walls (0.4 thick) with a 2.6 m doorway on the east side
    B([-11.4, 0, 7], [11.4, 4.4, 7.4], '#9a948a'),
    B([-11.4, 0, -7.4], [11.4, 4.4, -7], '#9a948a'),
    B([-11.4, 0, -7], [-11, 4.4, 7], '#9a948a'),
    B([11, 0, -7], [11.4, 4.4, -1.3], '#9a948a'),
    B([11, 0, 1.3], [11.4, 4.4, 7], '#9a948a'),
    B([11, 3, -1.3], [11.4, 4.4, 1.3], '#9a948a'), // doorway lintel

    // corridor walls + end cap (24 m long, 2.6 wide). The SOUTH wall lives in
    // maps/firing-range.js now — split around the doorway into the range hall.
    B([11, 0, -1.7], [35.4, 3.4, -1.3], '#8a857c'),
    B([35, 0, -1.7], [35.4, 3.4, 1.7], '#8a857c'),

    // stair flight A — rise 0.15, tread 0.4, top 0.45 (solid stack, no gaps to tunnel through)
    B([-9.8, 0, -6.8], [-4.6, 0.15, -3.8], '#96865e'),
    B([-9.4, 0, -6.8], [-4.6, 0.3, -3.8], '#96865e'),
    B([-9.0, 0, -6.8], [-4.6, 0.45, -3.8], '#96865e'),

    // stair flight B — rise 0.25, tread 0.4, top 1.0 (walk-off edge tests the real fall)
    B([-9.8, 0, -3.2], [-4.6, 0.25, -0.2], '#6f7a5d'),
    B([-9.4, 0, -3.2], [-4.6, 0.5, -0.2], '#6f7a5d'),
    B([-9.0, 0, -3.2], [-4.6, 0.75, -0.2], '#6f7a5d'),
    B([-8.6, 0, -3.2], [-4.6, 1.0, -0.2], '#6f7a5d'),

    // ledge row — jump-climb route; from the floor: 0.5 easy, 0.9 frame-perfect, 1.3 blocked
    B([-11, 0, 4.4], [-8, 0.5, 7], '#767d8e'),
    B([-8, 0, 4.4], [-5, 0.9, 7], '#767d8e'),
    B([-5, 0, 4.4], [-2, 1.3, 7], '#767d8e'),

    // crouch table — 1.3 m clearance (crouch capsule is 1.2), top at 2.6 is unreachable.
    // 1.2 m gap to the north wall so you can clear it, stand up, and look back.
    B([6, 1.3, 2.8], [9, 2.6, 5.8], '#6d5b45'),

    // pillars — corner-slide tests for the capsule's rounded horizontal contact
    B([1.6, 0, -2.4], [2.4, 4, -1.6], '#5d5b55'),
    B([5.1, 0, 2.1], [5.9, 4, 2.9], '#5d5b55'),
  ],

  visuals: [
    // corridor start line + 2 m stripes (visual only — they never collide)
    B([12.0, 0, -1.3], [12.3, 0.01, 1.3], '#8a5a44'),
    ...Array.from({ length: 11 }, (_, i) =>
      B([14 + i * 2 - 0.06, 0, -1.3], [14 + i * 2 + 0.06, 0.01, 1.3], '#9a978f')
    ),
  ],

  // facing -X: across the open floor toward the stairs and pillars
  spawn: { pos: [6, 0, 0], yaw: Math.PI / 2 },
}
