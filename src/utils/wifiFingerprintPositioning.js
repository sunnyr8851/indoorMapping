/**
 * WiFi Fingerprint Positioning Service
 * 
 * Phase 2: Real-Time Position Detection
 * - Load saved RSSI mapping data from Phase 1
 * - Scan current WiFi RSSI from predefined APs
 * - Compare top 3 strongest RSSI with saved data
 * - Find closest matching tile/grid location
 * - Position stabilization to prevent fluctuation
 * - Kalman filter for smooth temporal tracking
 */

import { normalizeBssid, getAveragedWifiRSSI } from './wifiScan';
import { getKalmanFilter, resetKalmanFilter as resetKalman, getKalmanStats } from './KalmanPositionFilter';

// ============================================
// POSITION STABILIZER - Prevents Fluctuation
// ============================================

/**
 * Position Stabilizer to prevent jumping between tiles
 * Uses multiple strategies:
 * 1. Distance threshold - reject sudden jumps
 * 2. Confidence filtering - reject weak matches
 * 3. History voting - use recent position history
 * 4. EMA smoothing - smooth position transitions
 */
class PositionStabilizer {
  constructor(options = {}) {
    this.historySize = options.historySize || 5;       // Keep last N positions
    this.maxJumpDistance = options.maxJumpDistance || 3; // Max tiles to jump in one scan
    this.minConfidence = options.minConfidence || 8;   // Max RSSI distance to accept
    this.emaAlpha = options.emaAlpha || 0.3;           // EMA smoothing factor (0.1-0.5)
    
    this.positionHistory = [];
    this.lastStablePosition = null;
    this.smoothedPosition = null;
  }

  /**
   * Calculate grid distance between two positions
   */
  gridDistance(pos1, pos2) {
    if (!pos1 || !pos2) return Infinity;
    return Math.sqrt(Math.pow(pos1.x - pos2.x, 2) + Math.pow(pos1.y - pos2.y, 2));
  }

  /**
   * Get most frequent position from history (voting)
   */
  getMostFrequentPosition() {
    if (this.positionHistory.length === 0) return null;
    
    const counts = {};
    this.positionHistory.forEach(pos => {
      const key = `${pos.x},${pos.y}`;
      counts[key] = (counts[key] || 0) + 1;
    });

    let maxCount = 0;
    let mostFrequent = null;
    Object.entries(counts).forEach(([key, count]) => {
      if (count > maxCount) {
        maxCount = count;
        const [x, y] = key.split(',').map(Number);
        mostFrequent = { x, y, frequency: count };
      }
    });

    return mostFrequent;
  }

  /**
   * Stabilize a raw position result
   * @param {Object} rawResult - Result from findClosestTile
   * @returns {Object} - Stabilized position
   */
  stabilize(rawResult) {
    if (!rawResult) {
      // No result - return last stable position if available
      return this.lastStablePosition;
    }

    const rawPos = { x: rawResult.x, y: rawResult.y };
    const rssiDistance = rawResult.distance;

    // Strategy 1: Confidence filtering - reject weak matches
    if (rssiDistance > this.minConfidence) {
      console.log(`[Stabilizer] Rejected: Low confidence (distance=${rssiDistance.toFixed(2)} > ${this.minConfidence})`);
      return this.lastStablePosition || rawResult;
    }

    // Strategy 2: Jump distance filtering
    if (this.lastStablePosition) {
      const jumpDist = this.gridDistance(rawPos, this.lastStablePosition);
      if (jumpDist > this.maxJumpDistance) {
        console.log(`[Stabilizer] Rejected: Jump too large (${jumpDist.toFixed(1)} tiles > ${this.maxJumpDistance})`);
        // Add to history anyway for voting
        this.positionHistory.push(rawPos);
        if (this.positionHistory.length > this.historySize) {
          this.positionHistory.shift();
        }
        // Check if history shows consistent new position
        const frequent = this.getMostFrequentPosition();
        if (frequent && frequent.frequency >= 3) {
          // Multiple scans agree - accept the new position
          console.log(`[Stabilizer] History voting accepted: (${frequent.x}, ${frequent.y}) appeared ${frequent.frequency} times`);
          this.lastStablePosition = { x: frequent.x, y: frequent.y };
          return { ...rawResult, x: frequent.x, y: frequent.y, stabilized: true };
        }
        return this.lastStablePosition;
      }
    }

    // Add to history
    this.positionHistory.push(rawPos);
    if (this.positionHistory.length > this.historySize) {
      this.positionHistory.shift();
    }

    // Strategy 3: EMA smoothing (for gradual movement)
    if (this.smoothedPosition) {
      this.smoothedPosition = {
        x: this.smoothedPosition.x + this.emaAlpha * (rawPos.x - this.smoothedPosition.x),
        y: this.smoothedPosition.y + this.emaAlpha * (rawPos.y - this.smoothedPosition.y),
      };
    } else {
      this.smoothedPosition = { ...rawPos };
    }

    // Round to nearest tile
    const stablePos = {
      x: Math.round(this.smoothedPosition.x),
      y: Math.round(this.smoothedPosition.y),
    };

    this.lastStablePosition = stablePos;

    return {
      ...rawResult,
      x: stablePos.x,
      y: stablePos.y,
      rawX: rawPos.x,
      rawY: rawPos.y,
      stabilized: true,
    };
  }

  /**
   * Reset the stabilizer (e.g., when starting new tracking session)
   */
  reset() {
    this.positionHistory = [];
    this.lastStablePosition = null;
    this.smoothedPosition = null;
  }
}

// Global stabilizer instance
let positionStabilizer = new PositionStabilizer();

/**
 * Get or create position stabilizer with custom options
 */
export function getPositionStabilizer(options) {
  if (options) {
    positionStabilizer = new PositionStabilizer(options);
  }
  return positionStabilizer;
}

/**
 * Reset position stabilizer (call when starting new tracking)
 */
export function resetPositionStabilizer() {
  positionStabilizer.reset();
}

/**
 * Calculate Euclidean distance between two RSSI vectors.
 * Only considers BSSIDs present in both vectors.
 * @param {Object} rssi1 - { bssid: rssi } mapping
 * @param {Object} rssi2 - { bssid: rssi } mapping
 * @returns {number} - Distance (lower = more similar)
 */
function rssiEuclideanDistance(rssi1, rssi2) {
  const keys1 = Object.keys(rssi1).map(normalizeBssid);
  const keys2 = Object.keys(rssi2).map(normalizeBssid);
  const commonKeys = keys1.filter(k => keys2.includes(k));

  if (commonKeys.length === 0) return Infinity;

  let sumSqDiff = 0;
  for (const key of commonKeys) {
    const v1 = rssi1[key] ?? rssi1[Object.keys(rssi1).find(k => normalizeBssid(k) === key)];
    const v2 = rssi2[key] ?? rssi2[Object.keys(rssi2).find(k => normalizeBssid(k) === key)];
    sumSqDiff += Math.pow(v1 - v2, 2);
  }

  // Normalize by number of common keys
  return Math.sqrt(sumSqDiff) / Math.sqrt(commonKeys.length);
}

/**
 * Get top N strongest RSSI from an RSSI object.
 * @param {Object} rssiObj - { bssid: rssi }
 * @param {number} topN - Number of top entries to return
 * @returns {Object} - Filtered object with top N entries
 */
function getTopNRssi(rssiObj, topN = 3) {
  const entries = Object.entries(rssiObj)
    .map(([bssid, rssi]) => ({ bssid: normalizeBssid(bssid), rssi }))
    .sort((a, b) => b.rssi - a.rssi) // Strongest (less negative) first
    .slice(0, topN);

  const result = {};
  entries.forEach(({ bssid, rssi }) => {
    result[bssid] = rssi;
  });
  return result;
}

/**
 * Filter RSSI to only include predefined APs.
 * @param {Object} rssiObj - { bssid: rssi }
 * @param {string[]} predefinedBssids - List of allowed BSSIDs
 * @returns {Object} - Filtered object
 */
function filterToPredefinedAPs(rssiObj, predefinedBssids) {
  const normalizedPredefined = new Set(predefinedBssids.map(normalizeBssid));
  const result = {};

  Object.entries(rssiObj).forEach(([bssid, rssi]) => {
    const normalized = normalizeBssid(bssid);
    if (normalizedPredefined.has(normalized)) {
      result[normalized] = rssi;
    }
  });

  return result;
}

/**
 * Find the best matching position using Weighted Centroid algorithm.
 * 
 * Algorithm:
 * 1. Calculate RSSI distance from current scan to ALL mapped tiles
 * 2. Select top K closest tiles (default 3)
 * 3. Convert distances to weights: w_i = 1 / (distance_i + epsilon)
 * 4. Normalize weights: w'_i = w_i / sum(w)
 * 5. Compute weighted average: x = sum(w'_i * x_i), y = sum(w'_i * y_i)
 * 
 * @param {Object} currentRssi - Current scan { bssid: rssi }
 * @param {Object} mappingData - Loaded Phase 1 mapping data
 * @param {Object} options - Configuration options
 * @param {number} options.topN - Number of top RSSI to compare (default 3)
 * @param {number} options.topK - Number of closest tiles for weighted centroid (default 3)
 * @param {number} options.epsilon - Small value to avoid division by zero (default 0.1)
 * @param {boolean} options.useOnlyPredefined - Filter to predefined APs only (default true)
 * @returns {{ x: number, y: number, distance: number, topTiles: Array, weights: Array } | null}
 */
export function findClosestTile(currentRssi, mappingData, options = {}) {
  const { topN = 3, topK = 3, epsilon = 0.1, useOnlyPredefined = true } = options;

  if (!mappingData || !mappingData.nodes || mappingData.nodes.length === 0) {
    console.warn('No mapping data available');
    return null;
  }

  if (!currentRssi || Object.keys(currentRssi).length === 0) {
    console.warn('No current RSSI data');
    return null;
  }

  // Get predefined APs from mapping data
  const predefinedBssids = mappingData.accessPoints
    ? mappingData.accessPoints.map(ap => ap.bssid)
    : [];

  // Filter current RSSI to predefined APs if available and requested
  let filteredCurrent = currentRssi;
  if (useOnlyPredefined && predefinedBssids.length > 0) {
    filteredCurrent = filterToPredefinedAPs(currentRssi, predefinedBssids);
  }

  // Get top N from current scan
  const currentTopN = getTopNRssi(filteredCurrent, topN);

  if (Object.keys(currentTopN).length === 0) {
    console.warn('No matching APs found in current scan');
    return null;
  }

  // ============================================
  // STEP 1: Calculate distance to ALL tiles
  // ============================================
  const allDistances = [];

  for (const node of mappingData.nodes) {
    // Node rssis can be object { bssid: rssi } or array [{ bssid, rssi }]
    let nodeRssi = node.rssis;

    // Convert array format to object if needed
    if (Array.isArray(nodeRssi)) {
      const obj = {};
      nodeRssi.forEach(({ bssid, rssi }) => {
        obj[normalizeBssid(bssid)] = rssi;
      });
      nodeRssi = obj;
    }

    if (!nodeRssi || Object.keys(nodeRssi).length === 0) continue;

    // Filter node RSSI to predefined APs if available
    let filteredNode = nodeRssi;
    if (useOnlyPredefined && predefinedBssids.length > 0) {
      filteredNode = filterToPredefinedAPs(nodeRssi, predefinedBssids);
    }

    // Get top N from stored data
    const nodeTopN = getTopNRssi(filteredNode, topN);

    // Calculate distance
    const distance = rssiEuclideanDistance(currentTopN, nodeTopN);

    if (distance < Infinity) {
      allDistances.push({
        node,
        distance,
        x: node.x,
        y: node.y,
      });
    }
  }

  if (allDistances.length === 0) {
    return null;
  }

  // ============================================
  // STEP 1 (continued): Select top K closest tiles
  // ============================================
  allDistances.sort((a, b) => a.distance - b.distance);
  const topTiles = allDistances.slice(0, topK);

  // ============================================
  // STEP 2: Convert distance to weight
  // w = 1 / (distance + epsilon)
  // ============================================
  const weights = topTiles.map(tile => 1 / (tile.distance + epsilon));

  // ============================================
  // STEP 3: Calculate total weight
  // W = w1 + w2 + w3
  // ============================================
  const W = weights.reduce((sum, w) => sum + w, 0);

  // ============================================
  // STEP 4 & 5: Calculate final X and Y coordinates
  // x = (w1 * x1 + w2 * x2 + w3 * x3) / W
  // y = (w1 * y1 + w2 * y2 + w3 * y3) / W
  // ============================================
  let sumWX = 0;
  let sumWY = 0;

  for (let i = 0; i < topTiles.length; i++) {
    sumWX += weights[i] * topTiles[i].x;
    sumWY += weights[i] * topTiles[i].y;
  }

  const finalX = sumWX / W;
  const finalY = sumWY / W;

  // Log for debugging
  console.log('Weighted Centroid Calculation:');
  topTiles.forEach((tile, i) => {
    console.log(`  Tile (${tile.x}, ${tile.y}): d=${tile.distance.toFixed(2)}, w=${weights[i].toFixed(3)}`);
  });
  console.log(`  Total Weight W = ${W.toFixed(3)}`);
  console.log(`  x = (${topTiles.map((t, i) => `${weights[i].toFixed(2)}*${t.x}`).join(' + ')}) / ${W.toFixed(2)} = ${finalX.toFixed(2)}`);
  console.log(`  y = (${topTiles.map((t, i) => `${weights[i].toFixed(2)}*${t.y}`).join(' + ')}) / ${W.toFixed(2)} = ${finalY.toFixed(2)}`);

  return {
    // Weighted centroid position (can be fractional)
    x: finalX,
    y: finalY,
    
    // Round to nearest tile for display
    tileX: Math.round(finalX),
    tileY: Math.round(finalY),
    
    // Average distance of top K tiles (confidence metric)
    distance: topTiles.reduce((sum, t) => sum + t.distance, 0) / topTiles.length,
    
    // Closest tile (for reference)
    closestNode: topTiles[0].node,
    closestDistance: topTiles[0].distance,
    
    // Debug info
    topTiles: topTiles.map((t, i) => ({
      x: t.x,
      y: t.y,
      distance: t.distance,
      weight: weights[i] / W,
    })),
    weights: weights.map(w => w / W),
  };
}

/**
 * Scan current WiFi and find position from mapping data.
 * Complete Phase 2 positioning workflow with stabilization.
 * 
 * @param {Object} mappingData - Loaded Phase 1 mapping data
 * @param {Object} options - Configuration options
 * @param {number} options.scanCount - Number of scans to average (default 3)
 * @param {number} options.delayMs - Delay between scans (default 400)
 * @param {number} options.topN - Number of top RSSI to compare (default 3)
 * @param {boolean} options.stabilize - Enable position stabilization (default true)
 * @returns {Promise<{ x: number, y: number, node: Object, distance: number, rssi: Object } | null>}
 */
export async function scanAndFindPosition(mappingData, options = {}) {
  const { scanCount = 5, delayMs = 800, topN = 3, stabilize = true } = options;

  // Scan current WiFi RSSI
  console.log('Scanning WiFi for positioning...');
  const currentRssi = await getAveragedWifiRSSI(scanCount, delayMs);

  if (!currentRssi || Object.keys(currentRssi).length === 0) {
    console.warn('WiFi scan returned no results');
    return null;
  }

  console.log(`Scanned ${Object.keys(currentRssi).length} APs`);

  // Find closest tile (raw result)
  const rawResult = findClosestTile(currentRssi, mappingData, { topN });

  if (!rawResult) {
    // If no match, return last stable position
    if (stabilize) {
      const lastStable = positionStabilizer.lastStablePosition;
      if (lastStable) {
        console.log('[Stabilizer] No match - returning last stable position');
        return { ...lastStable, rssi: currentRssi, noMatch: true };
      }
    }
    return null;
  }

  // Apply stabilization to prevent fluctuation
  let finalResult;
  if (stabilize) {
    finalResult = positionStabilizer.stabilize(rawResult);
    if (finalResult !== rawResult) {
      console.log(`[Stabilizer] Position: raw(${rawResult.x},${rawResult.y}) → stable(${finalResult.x},${finalResult.y})`);
    }
  } else {
    finalResult = rawResult;
  }

  return {
    ...finalResult,
    rssi: currentRssi,
  };
}

/**
 * Get all tiles sorted by similarity to current RSSI.
 * Useful for showing multiple possible positions or debugging.
 * 
 * @param {Object} currentRssi - Current scan { bssid: rssi }
 * @param {Object} mappingData - Loaded Phase 1 mapping data
 * @param {number} topN - Number of results to return
 * @returns {Array<{ node: Object, distance: number, x: number, y: number }>}
 */
export function findClosestTiles(currentRssi, mappingData, topN = 5) {
  if (!mappingData || !mappingData.nodes || mappingData.nodes.length === 0) {
    return [];
  }

  const results = [];

  for (const node of mappingData.nodes) {
    let nodeRssi = node.rssis;

    if (Array.isArray(nodeRssi)) {
      const obj = {};
      nodeRssi.forEach(({ bssid, rssi }) => {
        obj[normalizeBssid(bssid)] = rssi;
      });
      nodeRssi = obj;
    }

    if (!nodeRssi || Object.keys(nodeRssi).length === 0) continue;

    const distance = rssiEuclideanDistance(
      getTopNRssi(currentRssi, 3),
      getTopNRssi(nodeRssi, 3)
    );

    results.push({
      node,
      distance,
      x: node.x,
      y: node.y,
    });
  }

  return results
    .filter(r => r.distance < Infinity)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, topN);
}

// ============================================
// KALMAN FILTER INTEGRATION
// ============================================

// Configure Kalman for WiFi positioning (~4 second scan intervals)
const KALMAN_CONFIG = {
  processNoise: 0.3,      // How much position changes between scans
  measurementNoise: 2.0,  // WiFi RSSI noise level
  dt: 4.0,                // ~4 seconds between position updates
};

let kalmanEnabled = false;
let lastScanTime = null;

/**
 * Enable or disable Kalman filter
 * @param {boolean} enabled
 */
export function setKalmanEnabled(enabled) {
  kalmanEnabled = enabled;
  console.log(`[Kalman] ${enabled ? 'Enabled' : 'Disabled'}`);
}

/**
 * Check if Kalman filter is enabled
 * @returns {boolean}
 */
export function isKalmanEnabled() {
  return kalmanEnabled;
}

/**
 * Reset Kalman filter state (call when starting new tracking session)
 */
export function resetKalmanFilter() {
  resetKalman();
  lastScanTime = null;
  console.log('[Kalman] Filter reset');
}

/**
 * Get Kalman filter statistics for debugging
 * @returns {Object|null}
 */
export { getKalmanStats };

/**
 * Apply Kalman filter to weighted centroid result.
 * Calculates RSSI confidence from distance and uses real dt.
 * 
 * @param {Object} centroidResult - Result from findClosestTile
 * @returns {Object} - Kalman-filtered position with metadata
 */
export function applyKalmanFilter(centroidResult) {
  if (!centroidResult) return null;
  
  const kalman = getKalmanFilter(KALMAN_CONFIG);
  
  // Calculate real dt from time between scans
  const now = Date.now();
  if (lastScanTime !== null) {
    const realDt = (now - lastScanTime) / 1000; // Convert to seconds
    if (realDt > 0.5 && realDt < 30) {
      // Only use realistic dt values (0.5s - 30s)
      kalman.setTimeStep(realDt);
    }
  }
  lastScanTime = now;
  
  // Calculate RSSI confidence (0-1) from distance
  // Distance 0-3 → high confidence (0.8-1.0)
  // Distance 3-8 → medium confidence (0.5-0.8)
  // Distance 8-15 → low confidence (0.3-0.5)
  const rssiDistance = centroidResult.closestDistance || centroidResult.distance || 5;
  const rssiConfidence = Math.max(0.3, Math.min(1.0, 1 - (rssiDistance / 15)));
  
  // Apply Kalman filter to weighted centroid position
  const kalmanResult = kalman.update(centroidResult.x, centroidResult.y, rssiConfidence);
  
  return {
    // Kalman-filtered position (fractional)
    x: kalmanResult.rawX,
    y: kalmanResult.rawY,
    
    // Rounded to nearest tile
    tileX: kalmanResult.x,
    tileY: kalmanResult.y,
    
    // Original weighted centroid position
    centroidX: centroidResult.x,
    centroidY: centroidResult.y,
    
    // Distance/confidence metrics
    distance: centroidResult.distance,
    closestDistance: centroidResult.closestDistance,
    rssiConfidence: rssiConfidence,
    
    // Kalman filter metadata
    kalmanApplied: true,
    kalmanGain: (kalmanResult.kalmanGainX + kalmanResult.kalmanGainY) / 2,
    kalmanConfidence: kalmanResult.confidence,
    velocity: {
      vx: kalmanResult.velocityX,
      vy: kalmanResult.velocityY,
    },
    
    // Original data for reference
    topTiles: centroidResult.topTiles,
    weights: centroidResult.weights,
    closestNode: centroidResult.closestNode,
  };
}

/**
 * Find position with optional Kalman filtering.
 * Combines weighted centroid + Kalman for smooth tracking.
 * 
 * @param {Object} currentRssi - Current WiFi scan { bssid: rssi }
 * @param {Object} mappingData - Loaded Phase 1 mapping data
 * @param {Object} options - Configuration options
 * @param {boolean} options.useKalman - Apply Kalman filter (default: use global setting)
 * @returns {Object|null} - Position result with Kalman metadata if applied
 */
export function findPositionWithKalman(currentRssi, mappingData, options = {}) {
  const { useKalman = kalmanEnabled, topN = 3, topK = 3 } = options;
  
  // Step 1: Weighted centroid positioning
  const centroidResult = findClosestTile(currentRssi, mappingData, { topN, topK });
  
  if (!centroidResult) return null;
  
  // Step 2: Apply Kalman if enabled
  if (useKalman) {
    return applyKalmanFilter(centroidResult);
  }
  
  // Return centroid result without Kalman
  return {
    ...centroidResult,
    kalmanApplied: false,
  };
}
