/**
 * Dijkstra shortest path on the indoor map graph.
 * Returns path as array of { x, y } in map coordinates.
 */

import { NODES, GRAPH } from '../data/mapData';

const dist = (a, b) =>
  Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);

/**
 * Find the graph node id closest to a point (e.g. current user position).
 */
export function getNearestNodeId(point) {
  let bestId = null;
  let bestD = Infinity;
  for (const [id, node] of Object.entries(NODES)) {
    const d = dist(point, node);
    if (d < bestD) {
      bestD = d;
      bestId = id;
    }
  }
  return bestId;
}

/**
 * Dijkstra: from startNodeId to endNodeId.
 * Returns array of node ids (path), or [] if no path.
 */
export function dijkstra(startNodeId, endNodeId) {
  if (!GRAPH[startNodeId] || !GRAPH[endNodeId]) return [];

  const cost = {};
  const prev = {};
  const q = new Set(Object.keys(NODES));
  Object.keys(NODES).forEach(id => {
    cost[id] = id === startNodeId ? 0 : Infinity;
    prev[id] = null;
  });

  while (q.size) {
    let u = null;
    let minD = Infinity;
    for (const id of q) {
      if (cost[id] < minD) {
        minD = cost[id];
        u = id;
      }
    }
    if (u == null || u === endNodeId) break;
    q.delete(u);

    const neighbors = GRAPH[u] || [];
    for (const { id: v, weight } of neighbors) {
      if (!q.has(v)) continue;
      const alt = cost[u] + weight;
      if (alt < cost[v]) {
        cost[v] = alt;
        prev[v] = u;
      }
    }
  }

  const path = [];
  let cur = endNodeId;
  while (cur) {
    path.unshift(cur);
    cur = prev[cur];
  }
  return path[0] === startNodeId ? path : [];
}

/**
 * Get path from current position (x, y) to destination location node id.
 * Returns array of { x, y } for drawing on the map.
 * Path starts at fromPoint (user position) so it updates as the user moves.
 */
export function getPathFromTo(fromPoint, toNodeId) {
  const startId = getNearestNodeId(fromPoint);
  const pathIds = dijkstra(startId, toNodeId);
  if (pathIds.length === 0) return [];

  const path = pathIds.map(id => ({ ...NODES[id] }));
  // Prepend actual user position so path line goes from user -> first node -> ... -> destination
  return [{ x: fromPoint.x, y: fromPoint.y }, ...path];
}
