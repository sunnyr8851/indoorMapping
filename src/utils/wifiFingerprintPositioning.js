/**
 * WiFi Fingerprint Positioning Service
 * 
 * Phase 2: Real-Time Position Detection
 * - Load saved RSSI mapping data from Phase 1
 * - Scan current WiFi RSSI from predefined APs
 * - Compare top 3 strongest RSSI with saved data
 * - Find closest matching tile/grid location
 */

import { normalizeBssid, getAveragedWifiRSSI } from './wifiScan';

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
 * Find the best matching tile from mapping data based on current RSSI scan.
 * 
 * @param {Object} currentRssi - Current scan { bssid: rssi }
 * @param {Object} mappingData - Loaded Phase 1 mapping data
 * @param {Object} options - Configuration options
 * @param {number} options.topN - Number of top RSSI to compare (default 3)
 * @param {boolean} options.useOnlyPredefined - Filter to predefined APs only (default true)
 * @returns {{ node: Object, distance: number, x: number, y: number } | null}
 */
export function findClosestTile(currentRssi, mappingData, options = {}) {
  const { topN = 3, useOnlyPredefined = true } = options;

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

  let bestMatch = null;
  let bestDistance = Infinity;

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

    if (distance < bestDistance) {
      bestDistance = distance;
      bestMatch = node;
    }
  }

  if (!bestMatch) {
    return null;
  }

  return {
    node: bestMatch,
    distance: bestDistance,
    x: bestMatch.x,
    y: bestMatch.y,
  };
}

/**
 * Scan current WiFi and find position from mapping data.
 * Complete Phase 2 positioning workflow.
 * 
 * @param {Object} mappingData - Loaded Phase 1 mapping data
 * @param {Object} options - Configuration options
 * @param {number} options.scanCount - Number of scans to average (default 3)
 * @param {number} options.delayMs - Delay between scans (default 400)
 * @param {number} options.topN - Number of top RSSI to compare (default 3)
 * @returns {Promise<{ x: number, y: number, node: Object, distance: number, rssi: Object } | null>}
 */
export async function scanAndFindPosition(mappingData, options = {}) {
  const { scanCount = 3, delayMs = 400, topN = 3 } = options;

  // Scan current WiFi RSSI
  console.log('Scanning WiFi for positioning...');
  const currentRssi = await getAveragedWifiRSSI(scanCount, delayMs);

  if (!currentRssi || Object.keys(currentRssi).length === 0) {
    console.warn('WiFi scan returned no results');
    return null;
  }

  console.log(`Scanned ${Object.keys(currentRssi).length} APs`);

  // Find closest tile
  const result = findClosestTile(currentRssi, mappingData, { topN });

  if (!result) {
    return null;
  }

  return {
    ...result,
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
