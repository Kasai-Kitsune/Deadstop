// maps/arena.js — HOLMGANG, the first real game map (M3b): a compact
// capture-and-bomb arena for VS-bots play. Pure data, same conventions as the
// hub maps: `boxes` collide (sim reads .min/.max), `visuals` render only,
// `zones` are the round machine's AABBs, `waypoints`/`objectives` drive the
// bots, `spawns` place the squads.
//
// The map lives ~600 m east of the hub in the SAME scene/world (one render
// pipeline, one thermal pass) — far past the 220 m far plane and opaque in
// the fog, so the two maps never see each other. The VS door in the hub
// corridor TELEPORTS here (maps/movement-room.js owns the door).
//
// Layout (top view; +X east, +Z south; interior x 602..650, z 84..136):
//
//        z=84  ┌───────────────── north ─────────────────┐
//              │  DEFENDER SPAWN (z 84..88, full width)  │
//   SITE A  x606..616   ┌─ KEEP ─┐        SITE B x636..646
//   z 88..96 │          │ x620.. │                z 88..96
//   (west yard)         │  632   │           (east yard)
//              └──mouth──┴z88-100┴──mouth──┘   z 84..104
//        z=104  ███ 613         632 ███        (mouth walls; 7 m mouths)
//              │   forecourt — CAPTURE ZONE    │
//        z=120 │   x 614..638, z 108..118      │
//              │  ATTACKER SPAWN (low walls)   │
//        z=136  └───────────────── south ──────┘
//
// Routes: west lane → west mouth → Site A; forecourt → either mouth; east
// lane → east mouth → Site B; plus a rotation connector behind the keep
// (z 100..104 between the yards) defenders use to swing A↔B.

const B = (min, max, color) => ({ min, max, color })

export const ARENA = {
  name: 'HOLMGANG',
  mapCenter: [626, 110], // sun + shadow extent anchor for this map

  // ---- collision geometry (walls 5 m, cover 1.1..1.2 m — shoot-over height)
  boxes: [
    // floor (slab, same style as the hub)
    B([601.6, -0.4, 83.6], [650.4, 0, 136.4], '#6f6d66'),

    // perimeter (interior faces: x 602 / 650, z 84 / 136)
    B([601.6, 0, 83.6], [602, 5, 136.4], '#9a948a'), // west
    B([650, 0, 83.6], [650.4, 5, 136.4], '#9a948a'), // east
    B([601.6, 0, 83.6], [650.4, 5, 84], '#9a948a'), // north
    B([601.6, 0, 136], [650.4, 5, 136.4], '#9a948a'), // south

    // the keep — solid block between the sites (no interior; lanes go around)
    B([620, 0, 88], [632, 5, 100], '#8a857c'),

    // mouth walls (z 104 line): 7 m mouths at x 613..620 (west) and 632..639 (east)
    B([602, 0, 104], [613, 5, 104.4], '#767d8e'),
    B([639, 0, 104], [650, 5, 104.4], '#767d8e'),

    // forecourt pillars (tall, thin — mid-zone cover)
    B([622.6, 0, 106.6], [623.4, 5, 107.4], '#5d5b55'),
    B([628.6, 0, 106.6], [629.4, 5, 107.4], '#5d5b55'),

    // forecourt crates (shoot-over)
    B([609.45, 0, 108.45], [610.55, 1.1, 109.55], '#6d5b45'),
    B([641.45, 0, 108.45], [642.55, 1.1, 109.55], '#6d5b45'),
    B([615.45, 0, 116.45], [616.55, 1.1, 117.55], '#6d5b45'),
    B([635.45, 0, 116.45], [636.55, 1.1, 117.55], '#6d5b45'),

    // Site A cover (pushed to the corners so the plant node sits clear)
    B([606.45, 0, 88.95], [607.55, 1.1, 90.05], '#6d5b45'),
    B([614.45, 0, 94.45], [615.55, 1.1, 95.55], '#6d5b45'),
    // Site B cover
    B([644.45, 0, 88.95], [645.55, 1.1, 90.05], '#6d5b45'),
    B([636.45, 0, 94.45], [637.55, 1.1, 95.55], '#6d5b45'),

    // attacker spawn low walls (crouch-cover separating spawn from forecourt)
    B([610, 0, 124], [618, 1.2, 124.4], '#96865e'),
    B([634, 0, 124], [642, 1.2, 124.4], '#96865e'),
  ],

  // ---- render-only: zone plates and lane paint
  visuals: [
    B([612, 0.005, 108], [640, 0.035, 118], '#6f7a5d'), // capture zone (moss)
    B([606, 0.005, 88], [616, 0.03, 96], '#a86a4f'), // site A plate (rust)
    B([636, 0.005, 88], [646, 0.03, 96], '#a86a4f'), // site B plate (rust)
    B([613, 0.004, 103.8], [620, 0.02, 104.2], '#9a978f'), // mouth thresholds
    B([632, 0.004, 103.8], [639, 0.02, 104.2], '#9a978f'),
  ],

  // ---- signage (client/signs.js)
  signs: [
    // site letters, big and readable from the mouths
    { text: 'A', pos: [619.9, 3.2, 94], rotY: -Math.PI / 2, w: 1.6, h: 1.6 }, // keep west face
    { text: 'A', pos: [602.1, 3.2, 94], rotY: Math.PI / 2, w: 1.6, h: 1.6 }, // west wall
    { text: 'B', pos: [632.1, 3.2, 94], rotY: Math.PI / 2, w: 1.6, h: 1.6 }, // keep east face
    { text: 'B', pos: [649.9, 3.2, 94], rotY: -Math.PI / 2, w: 1.6, h: 1.6 }, // east wall
    { text: 'CAPTURE', pos: [623, 3.4, 106.55], rotY: Math.PI, w: 2.0, h: 0.5 }, // pillar face
    { text: 'CAPTURE', pos: [629, 3.4, 106.55], rotY: Math.PI, w: 2.0, h: 0.5 },
    { text: 'ATTACK', pos: [626, 3.6, 135.9], rotY: Math.PI, w: 2.2, h: 0.5 }, // south wall
    { text: 'DEFEND', pos: [626, 3.6, 84.1], rotY: 0, w: 2.2, h: 0.5 }, // north wall
  ],

  // ---- round-machine zones (AABBs; y max is nominal display height).
  // The capture zone spans x 612..640 so the zone-edge waypoints (6/7 at
  // x 613/639) sit INSIDE it — bots holding their objective actually capture.
  zones: {
    capture: { min: [612, 0, 108], max: [640, 2.2, 118] },
    A: { min: [606, 0, 88], max: [616, 2.2, 96] },
    B: { min: [636, 0, 88], max: [646, 2.2, 96] },
  },

  // ---- squad spawns ([x, y, z, yaw]); yaw 0 faces north (-Z, toward the point)
  spawns: {
    attackers: [
      { pos: [626, 0, 131], yaw: 0 },
      { pos: [606, 0, 129], yaw: 0 },
      { pos: [646, 0, 129], yaw: 0 },
      { pos: [616, 0, 132], yaw: 0 },
      { pos: [636, 0, 132], yaw: 0 },
    ],
    defenders: [
      { pos: [626, 0, 85.5], yaw: Math.PI },
      { pos: [610, 0, 86], yaw: Math.PI },
      { pos: [642, 0, 86], yaw: Math.PI },
      { pos: [604, 0, 85.5], yaw: Math.PI },
      { pos: [648, 0, 85.5], yaw: Math.PI },
    ],
  },

  // ---- waypoint graph (see sim/path.js). Nodes sit on lane centerlines and
  // mouth centers; edges were checked against every crate/pillar/wall with
  // capsule clearance. Index-stable: bots hash their id into the groups below.
  waypoints: {
    nodes: [
      [626, 130], //  0 attacker spawn center
      [606, 128], //  1 attacker spawn west
      [646, 128], //  2 attacker spawn east
      [607, 118], //  3 forecourt SW
      [645, 118], //  4 forecourt SE
      [626, 121], //  5 forecourt south center
      [613, 112], //  6 capture west
      [639, 112], //  7 capture east
      [626, 112], //  8 capture center
      [616.5, 104], //  9 west mouth
      [635.5, 104], // 10 east mouth
      [610, 96], // 11 site A north
      [611, 92], // 12 site A center — the PLANT node (inside the zone)
      [641, 92], // 13 site B center — the PLANT node (inside the zone)
      [642, 96], // 14 site B north
      [626, 102], // 15 connector behind the keep
      [626, 86], // 16 defender spawn center
      [610, 86], // 17 defender spawn west
      [642, 86], // 18 defender spawn east
      [606, 112], // 19 forecourt far west lane
      [646, 112], // 20 forecourt far east lane
      [626, 116], // 21 capture south (in-zone objective)
    ],
    edges: [
      [0, 1], [0, 2], [0, 5],
      [1, 3], [2, 4], [5, 3], [5, 4],
      [3, 19], [19, 6], [4, 20], [20, 7],
      [6, 8], [8, 7], [8, 21], [21, 6], [21, 7],
      [6, 9], [7, 10], [8, 9], [8, 10],
      [9, 12], [12, 11], [11, 17],
      [10, 13], [13, 14], [14, 18],
      [15, 9], [15, 10],
      [17, 16], [16, 18],
    ],
  },

  // objective node groups (indices into waypoints.nodes). Attackers hold
  // INSIDE the capture zone (that's how they fill the bar); defenders hold
  // the mouths and site interiors — they shoot the zone, they don't camp it
  // (a parked defender would contest the bar forever and stall the round).
  // siteA/siteB centers (12/13) are the in-zone PLANT nodes — carriers walk
  // straight to them and hold E (the round machine checks the zone itself).
  objectives: {
    attack: [8, 6, 7, 21], // phase 1: spread across the capture zone
    defend: [9, 10, 11, 14], // phase 1: hold the mouths + site interiors
    siteA: [12, 11],
    siteB: [13, 14],
  },

  // where idle bots look (the map's center of contention)
  watch: { x: 626, z: 111 },
}
