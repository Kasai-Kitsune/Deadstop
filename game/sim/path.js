// sim/path.js — waypoint graph pathing for the playtest bots (spec §2:
// "waypoint graph pathing"). Pure: no DOM, no Three, no network.
//
// The graph is map data (maps/arena.js: nodes as [x, z] pairs, edges as
// [a, b] index pairs, bidirectional). Distances are euclidean node-to-node;
// Dijkstra (not A*) because the graphs are ~30 nodes and the code stays
// trivially auditable. Bots path hop-by-hop; the client never sees this.

import { rayBox } from './hitscan.js'

export function buildGraph(waypoints) {
  const nodes = waypoints.nodes.map((n) => ({ x: n[0], z: n[1] }))
  const adj = nodes.map(() => [])
  const add = (a, b) => {
    const d = Math.hypot(nodes[a].x - nodes[b].x, nodes[a].z - nodes[b].z)
    adj[a].push({ j: b, d })
    adj[b].push({ j: a, d })
  }
  for (const [a, b] of waypoints.edges) {
    if (a >= 0 && a < nodes.length && b >= 0 && b < nodes.length && a !== b) add(a, b)
  }
  return { nodes, adj }
}

// Dijkstra. Returns the node chain [from..to] (inclusive) or null when the
// graph has no route. A path to yourself is [from].
export function findPath(g, from, to) {
  if (from === to) return [from]
  const n = g.nodes.length
  const dist = new Array(n).fill(Infinity)
  const prev = new Array(n).fill(-1)
  const done = new Array(n).fill(false)
  dist[from] = 0
  for (;;) {
    // pick the unfinished node with the smallest dist (n is tiny — linear scan)
    let u = -1
    let best = Infinity
    for (let i = 0; i < n; i++) {
      if (!done[i] && dist[i] < best) {
        best = dist[i]
        u = i
      }
    }
    if (u === -1 || u === to) break
    done[u] = true
    for (const e of g.adj[u]) {
      const nd = dist[u] + e.d
      if (nd < dist[e.j]) {
        dist[e.j] = nd
        prev[e.j] = u
      }
    }
  }
  if (dist[to] === Infinity) return null
  const path = []
  for (let v = to; v !== -1; v = prev[v]) path.push(v)
  path.reverse()
  return path[0] === from ? path : null
}

// Nearest node to (x, z) that the actor can actually WALK a straight line to
// (a chest-height ray that hits no wall first). Falls back to the nearest
// node by distance — a cornered bot should still try, not soft-lock.
export function nearestNode(g, x, z, world, eyeY = 1.2) {
  let bestI = -1
  let bestD2 = Infinity
  let bestVisible = false
  const o = { x, y: eyeY, z }
  for (let i = 0; i < g.nodes.length; i++) {
    const dx = g.nodes[i].x - x
    const dz = g.nodes[i].z - z
    const d2 = dx * dx + dz * dz
    if (d2 >= bestD2) continue
    const d = Math.sqrt(d2)
    if (d < 0.01) return i
    let visible = true
    if (world) {
      const hit = rayFlat(o, { x: dx / d, y: 0, z: dz / d }, world, d)
      visible = !hit
    }
    // prefer visible nodes: a visible node always beats an invisible one,
    // even if a bit further (prevents picking a node through a wall)
    if (bestI === -1 || (visible && !bestVisible) || (visible === bestVisible && d2 < bestD2)) {
      bestI = i
      bestD2 = d2
      bestVisible = visible
    }
  }
  return bestI
}

// thin wrapper so nearestNode can ray against world.boxes without importing
// hitscan's target logic (targets are irrelevant for walkability)
function rayFlat(o, d, world, maxDist) {
  let bestT = maxDist
  let hit = false
  for (let i = 0; i < world.boxes.length; i++) {
    const h = rayBox(o.x, o.y, o.z, d.x, d.y, d.z, world.boxes[i])
    if (h && h.t < bestT) {
      bestT = h.t
      hit = true
    }
  }
  return hit ? { t: bestT } : null
}
