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
//
// M3b: the corridor's NORTH wall is split here around the VS-BOTS door
// (x 25..28) — a sealed portal alcove. Walking in and pressing E opens the
// pre-match menu (side + starting weapons); launching teleports to the arena
// map (maps/arena.js, ~600 m east in the same world, past the far plane and
// opaque in the fog — the two maps never see each other).

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
    // The NORTH wall is split around the VS-BOTS door (x 25..28, head 2.6).
    B([11, 0, -1.7], [25, 3.4, -1.3], '#8a857c'),
    B([28, 0, -1.7], [35.4, 3.4, -1.3], '#8a857c'),
    B([25, 2.6, -1.7], [28, 3.4, -1.3], '#8a857c'), // VS door lintel (corridor side)
    B([35, 0, -1.7], [35.4, 3.4, 1.7], '#8a857c'),

    // ---- VS-BOTS portal alcove (M3b): a sealed 5x4.4 m room behind the door.
    // The arena is NOT physically behind this door — the lobby teleports you.
    B([24, -0.4, -6.5], [29, 0, -1.3], '#6f6d66'), // alcove floor
    B([24, 3, -6.5], [29, 3.4, -1.3], '#55534e'), // alcove ceiling
    B([24, 0, -6.5], [29, 3.4, -6.1], '#8a857c'), // end wall
    B([23.6, 0, -6.5], [24, 3.4, -1.3], '#8a857c'), // west wall
    B([29, 0, -6.5], [29.4, 3.4, -1.3], '#8a857c'), // east wall
    B([25, 2.6, -6.5], [28, 3.4, -6.1], '#8a857c'), // hall-side lintel

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
    // the VS portal: a dark slab on the alcove's end wall with a rust frame
    B([25.5, 0.1, -6.14], [27.5, 2.3, -6.1], '#141312'),
    B([25.3, 0.02, -6.13], [27.7, 0.08, -6.1], '#a86a4f'),
    B([25.3, 2.3, -6.13], [27.7, 2.4, -6.1], '#a86a4f'),
  ],

  // signage (client/signs.js renders these; the corridor gets the door plate)
  signs: [
    { text: 'VS BOTS', pos: [26.5, 2.9, -1.29], rotY: 0, w: 2.0, h: 0.5 }, // corridor side, above the door
    { text: 'CAPTURE & BOMB', pos: [26.5, 2.6, -6.09], rotY: 0, w: 2.6, h: 0.4 }, // above the portal
  ],

  // VS-door interaction data: E inside the alcove opens the pre-match menu.
  // exit is where you land when a match ends (back in the corridor, facing east).
  vsDoor: {
    pos: [26.5, -4.3], // interaction center [x, z] — deep in the alcove, at the portal
    radius: 2.4, // m — how close the portal you must stand
    return: { pos: [26.5, 0, -0.6], yaw: -Math.PI / 2 }, // back in the corridor facing east
  },

  // facing -X: across the open floor toward the stairs and pillars
  spawn: { pos: [6, 0, 0], yaw: Math.PI / 2 },
}
