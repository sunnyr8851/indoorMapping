/**
 * Office map as a tile/grid for pathfinding and validation.
 * Tile types:
 *   WALKABLE (0) = white  - can walk
 *   OBSTACLE  (1) = black - something present (furniture, walls, etc.)
 *   BLOCKED   (2) = light red - no movement allowed
 *
 * Map 18 ft × 36 ft. Each tile = 3 ft × 3 ft. 30 px/ft -> 90 px per tile.
 * Grid 6 cols × 12 rows, viewBox 0 0 540 1080.
 */

export const TILE = {
  WALKABLE: 0,
  OBSTACLE: 1,
  BLOCKED: 2,
};

export const TILE_SIZE = 90;   // 3 ft at 30 px/ft
export const COLS = 6;         // 18 ft / 3 ft
export const ROWS = 12;        // 36 ft / 3 ft
export const MAP_WIDTH = 540;  // 18 ft × 30 px/ft
export const MAP_HEIGHT = 1080; // 36 ft × 30 px/ft

/** Convert map (x,y) to grid (col, row) */
export function toGrid(x, y) {
  const col = Math.floor(x / TILE_SIZE);
  const row = Math.floor(y / TILE_SIZE);
  return { col: Math.max(0, Math.min(col, COLS - 1)), row: Math.max(0, Math.min(row, ROWS - 1)) };
}

/** Convert grid (col, row) to map center (x, y) */
export function toMap(col, row) {
  return {
    x: col * TILE_SIZE + TILE_SIZE / 2,
    y: row * TILE_SIZE + TILE_SIZE / 2,
  };
}

/** Check if (col, row) is in bounds and walkable */
export function isWalkable(grid, col, row) {
  if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return false;
  return grid[row][col] === TILE.WALKABLE;
}

/** Snap (x, y) to the nearest walkable tile center. If current tile walkable, use it; else search outward. */
export function snapToWalkable(grid, x, y) {
  const col = Math.floor(x / TILE_SIZE);
  const row = Math.floor(y / TILE_SIZE);
  if (col >= 0 && col < COLS && row >= 0 && row < ROWS && grid[row][col] === TILE.WALKABLE) {
    return toMap(col, row);
  }
  let best = null;
  let bestDist = Infinity;
  const radius = 3;
  for (let dr = -radius; dr <= radius; dr++) {
    for (let dc = -radius; dc <= radius; dc++) {
      const c = col + dc;
      const r = row + dr;
      if (c < 0 || c >= COLS || r < 0 || r >= ROWS || grid[r][c] !== TILE.WALKABLE) continue;
      const center = toMap(c, r);
      const d = (center.x - x) ** 2 + (center.y - y) ** 2;
      if (d < bestDist) {
        bestDist = d;
        best = center;
      }
    }
  }
  return best || toMap(Math.max(0, Math.min(col, COLS - 1)), Math.max(0, Math.min(row, ROWS - 1)));
}

/**
 * Build the office grid. Map 18 ft × 36 ft, grid 6 cols × 12 rows.
 * Helper sets (col, row) region by inclusive tile indices.
 */
function buildGrid() {
  const grid = Array(ROWS)
    .fill(null)
    .map(() => Array(COLS).fill(TILE.WALKABLE));

  const setRegion = (c1, r1, c2, r2, type) => {
    for (let r = r1; r <= r2; r++) {
      if (r < 0 || r >= ROWS) continue;
      for (let c = c1; c <= c2; c++) {
        if (c >= 0 && c < COLS) grid[r][c] = type;
      }
    }
  };

  // Example obstacles/blocked for 6×12 grid — adjust to your layout.
  setRegion(5, 2, 5, 6, TILE.BLOCKED);//washroom-kitchen
  setRegion(0, 0, 4, 0, TILE.OBSTACLE);//chair-sofa
  setRegion(0, 2, 2, 2, TILE.OBSTACLE);//Tv-screen
  setRegion(0, 1, 0, 1, TILE.OBSTACLE);//coffee machine
  setRegion(5, 0, 5, 1, TILE.OBSTACLE);//exit gate
  setRegion(3, 4, 3, 7, TILE.OBSTACLE);//sunny table
  setRegion(1, 4, 1, 7, TILE.OBSTACLE);//saneer-ameen-ibrahim table
  setRegion(4, 11, 4, 11, TILE.OBSTACLE);//ruhban
  setRegion(2, 11, 2, 11, TILE.OBSTACLE);//meeting table



  return grid;
}

export const OFFICE_GRID = buildGrid();

/**
 * Named locations for search. Each has a display name, type (OBSTACLE/BLOCKED), and (col, row)
 * of a walkable tile to path to (e.g. in front of the place). Pathfinding goes to that tile.
 */
export const OFFICE_LOCATIONS = [
  { id: 'washroom-kitchen', name: 'Washroom / Kitchen', type: 'BLOCKED', col: 4, row: 4 },
  { id: 'sofa', name: 'Sofa / Seating', type: 'OBSTACLE', col: 2, row: 1 },
  { id: 'tv', name: 'TV Screen', type: 'OBSTACLE', col: 3, row: 2 },
  { id: 'coffee', name: 'Coffee Machine', type: 'OBSTACLE', col: 1, row: 1 },
  { id: 'exit', name: 'Exit Gate', type: 'OBSTACLE', col: 4, row: 0 },
  { id: 'sunny-table', name: 'Sunny Table', type: 'OBSTACLE', col: 4, row: 5 },
  { id: 'saneer-table', name: 'Saneer-Ameen-Ibrahim Table', type: 'OBSTACLE', col: 0, row: 5 },
  { id: 'ruhban', name: 'Ruhban', type: 'OBSTACLE', col: 5, row: 11 },
  { id: 'meeting-table', name: 'Meeting Table', type: 'OBSTACLE', col: 3, row: 11 },
];
