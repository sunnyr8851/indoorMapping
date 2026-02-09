/**
 * A* pathfinding on a tile grid.
 * Only WALKABLE tiles are traversable; OBSTACLE and BLOCKED are not.
 */

import { TILE, COLS, ROWS, toGrid, toMap, isWalkable } from '../data/officeGridData';

const NEIGHBORS = [
  { dc: 0, dr: -1 },  // up
  { dc: 1, dr: 0 },   // right
  { dc: 0, dr: 1 },   // down
  { dc: -1, dr: 0 },  // left
  { dc: 1, dr: -1 },  // up-right
  { dc: 1, dr: 1 },   // down-right
  { dc: -1, dr: 1 },  // down-left
  { dc: -1, dr: -1 }, // up-left
];

function heuristic(col1, row1, col2, row2) {
  const dx = Math.abs(col1 - col2);
  const dy = Math.abs(row1 - row2);
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * A* from (startCol, startRow) to (endCol, endRow) on grid.
 * Returns array of { col, row } or [] if no path.
 */
export function findPathOnGrid(grid, startCol, startRow, endCol, endRow) {
  if (!isWalkable(grid, startCol, startRow) || !isWalkable(grid, endCol, endRow)) {
    return [];
  }

  const open = [{ col: startCol, row: startRow, g: 0, h: heuristic(startCol, startRow, endCol, endRow) }];
  const cameFrom = {};
  const gScore = { [`${startCol},${startRow}`]: 0 };
  open[0].f = open[0].g + open[0].h;

  while (open.length > 0) {
    open.sort((a, b) => a.f - b.f);
    const current = open.shift();
    const key = `${current.col},${current.row}`;

    if (current.col === endCol && current.row === endRow) {
      const path = [];
      let cur = current;
      while (cur) {
        path.unshift({ col: cur.col, row: cur.row });
        cur = cameFrom[`${cur.col},${cur.row}`];
      }
      return path;
    }

    for (const { dc, dr } of NEIGHBORS) {
      const nc = current.col + dc;
      const nr = current.row + dr;
      if (!isWalkable(grid, nc, nr)) continue;

      const moveCost = dc !== 0 && dr !== 0 ? 1.414 : 1;
      const tentativeG = (gScore[key] ?? Infinity) + moveCost;
      const nkey = `${nc},${nr}`;
      if (tentativeG >= (gScore[nkey] ?? Infinity)) continue;

      cameFrom[nkey] = current;
      gScore[nkey] = tentativeG;
      const h = heuristic(nc, nr, endCol, endRow);
      open.push({ col: nc, row: nr, g: tentativeG, h, f: tentativeG + h });
    }
  }

  return [];
}

/**
 * Get path from map point (x, y) to destination map point (x, y).
 * Returns array of { x, y } in map coordinates for drawing.
 */
export function getGridPathFromTo(grid, fromX, fromY, toX, toY) {
  const start = toGrid(fromX, fromY);
  const end = toGrid(toX, toY);
  const pathCells = findPathOnGrid(grid, start.col, start.row, end.col, end.row);
  if (pathCells.length === 0) return [];

  const path = pathCells.map(({ col, row }) => toMap(col, row));
  return [{ x: fromX, y: fromY }, ...path];
}
