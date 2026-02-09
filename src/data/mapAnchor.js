/**
 * Map anchor: real-world coordinates for the office map.
 * Used to convert device (lat, lon) to map pixels (x, y).
 *
 * Map is 18 ft x 36 ft; viewBox 0 0 540 1080.
 * Set refLat, refLon to the real-world position of the map CENTER (540, 960).
 */

import { MAP_WIDTH, MAP_HEIGHT } from './officeGridData';

// Real-world coords (degrees) of the map CENTER (MAP_WIDTH/2, MAP_HEIGHT/2).
// Replace with your building's actual coordinates (e.g. from Google Maps).
export const REF_LAT = 25.079700; // example: San Francisco area
export const REF_LON = 55.152855; 

// At this latitude, 1 degree lat ≈ 364000 ft, 1 degree lon ≈ 279000 * cos(lat) ft.
// Map: 18 ft wide = 540 px, 36 ft tall = 1080 px → 30 px/ft.
const FEET_PER_DEGREE_LAT = 364000;
const FEET_PER_DEGREE_LON = 279000 * Math.cos((REF_LAT * Math.PI) / 180);
const PIXELS_PER_FOOT = MAP_WIDTH / 18;

/**
 * Convert (lat, lon) to map pixel (x, y).
 * North = map y decreases; East = map x increases.
 */
export function latLonToMapPixels(lat, lon) {
  const feetEast = (lon - REF_LON) * FEET_PER_DEGREE_LON;
  const feetNorth = (lat - REF_LAT) * FEET_PER_DEGREE_LAT;
  const x = MAP_WIDTH / 2 + feetEast * PIXELS_PER_FOOT;
  const y = MAP_HEIGHT / 2 - feetNorth * PIXELS_PER_FOOT; // north = up = smaller y
  return { x, y };
}
