/**
 * WiFi Access Point Manager
 * 
 * Handles:
 * - Fetching all nearby access points
 * - Filtering based on selected APs
 * - Handling manually added APs
 * - Preparing and exporting filtered JSON
 */

import RNFS from 'react-native-fs';
import { Platform } from 'react-native';
import { fetchAllAccessPoints, normalizeBssid } from './wifiScan';
import { requestLocationPermission } from './locationService';

/**
 * Fetch all nearby access points with permission handling
 * @returns {Promise<Array<{ bssid: string, ssid: string, rssi: number }>>}
 */
export async function fetchAccessPoints() {
  const granted = await requestLocationPermission();
  if (!granted) {
    throw new Error('Location permission denied');
  }

  const list = await fetchAllAccessPoints();
  // Sort by RSSI descending (strongest first)
  return list.sort((a, b) => b.rssi - a.rssi);
}

/**
 * Merge detected APs with manually added APs
 * Manual APs take precedence if BSSID matches
 * @param {Array} detectedAPs - APs from WiFi scan
 * @param {Array} manualAPs - Manually added APs
 * @returns {Array} - Merged list
 */
export function mergeWithManualAPs(detectedAPs, manualAPs) {
  if (!manualAPs || manualAPs.length === 0) {
    return detectedAPs;
  }

  const manualBssids = new Set(manualAPs.map(ap => normalizeBssid(ap.bssid)));
  
  // Filter out detected APs that are already in manual list
  const filteredDetected = detectedAPs.filter(
    ap => !manualBssids.has(normalizeBssid(ap.bssid))
  );

  // Merge: manual APs first, then detected
  return [...manualAPs, ...filteredDetected];
}

/**
 * Filter APs based on selection
 * If selectedBssids is empty, returns all APs
 * Manual APs are always included
 * 
 * @param {Array} allAPs - All available APs
 * @param {Set|Array} selectedBssids - Selected BSSID set/array
 * @param {Array} manualAPs - Manually added APs (always included)
 * @returns {Array} - Filtered APs
 */
export function filterAccessPoints(allAPs, selectedBssids, manualAPs = []) {
  const selectedSet = selectedBssids instanceof Set 
    ? selectedBssids 
    : new Set(selectedBssids || []);

  const manualBssids = new Set(manualAPs.map(ap => normalizeBssid(ap.bssid)));

  // If no selection, return all APs merged with manual
  if (selectedSet.size === 0) {
    return mergeWithManualAPs(allAPs, manualAPs);
  }

  // Filter to selected + manual APs
  const filtered = allAPs.filter(ap => {
    const normalized = normalizeBssid(ap.bssid);
    return selectedSet.has(ap.bssid) || 
           selectedSet.has(normalized) ||
           manualBssids.has(normalized);
  });

  // Add any manual APs that weren't in allAPs
  const filteredBssids = new Set(filtered.map(ap => normalizeBssid(ap.bssid)));
  const missingManual = manualAPs.filter(
    ap => !filteredBssids.has(normalizeBssid(ap.bssid))
  );

  return [...filtered, ...missingManual];
}

/**
 * Create a manual AP entry
 * @param {string} bssidOrSsid - BSSID (MAC) or SSID
 * @param {string} type - 'bssid' or 'ssid'
 * @returns {{ bssid: string, ssid: string, rssi: number, manual: boolean }}
 */
export function createManualAP(bssidOrSsid, type = 'bssid') {
  const normalized = bssidOrSsid.trim();
  
  if (type === 'bssid') {
    return {
      bssid: normalizeBssid(normalized),
      ssid: 'Manual',
      rssi: -50, // Default RSSI for manual AP
      manual: true,
    };
  }
  
  return {
    bssid: '', // Empty BSSID for SSID-based
    ssid: normalized,
    rssi: -50,
    manual: true,
  };
}

/**
 * Filter JSON mapping data to include only specified APs
 * 
 * @param {Object} mappingData - Original mapping JSON
 * @param {Array} selectedAPs - APs to keep (if empty, keeps all)
 * @param {Array} manualAPs - Manual APs to always include
 * @returns {Object} - Filtered mapping data
 */
export function filterMappingJSON(mappingData, selectedAPs = [], manualAPs = []) {
  if (!mappingData || !mappingData.nodes) {
    return mappingData;
  }

  const selectedBssids = new Set(selectedAPs.map(ap => normalizeBssid(ap.bssid)));
  const manualBssids = new Set(manualAPs.map(ap => normalizeBssid(ap.bssid)));
  
  // If no selection and no manual, return as-is
  if (selectedBssids.size === 0 && manualBssids.size === 0) {
    return mappingData;
  }

  // Combine selected + manual
  const allowedBssids = new Set([...selectedBssids, ...manualBssids]);

  // Filter nodes' RSSI data
  const filteredNodes = mappingData.nodes.map(node => {
    let filteredRssis;

    if (Array.isArray(node.rssis)) {
      // Array format: [{ bssid, rssi }]
      filteredRssis = allowedBssids.size === 0 
        ? node.rssis 
        : node.rssis.filter(r => allowedBssids.has(normalizeBssid(r.bssid)));
    } else if (typeof node.rssis === 'object') {
      // Object format: { bssid: rssi }
      filteredRssis = {};
      Object.entries(node.rssis).forEach(([bssid, rssi]) => {
        if (allowedBssids.size === 0 || allowedBssids.has(normalizeBssid(bssid))) {
          filteredRssis[bssid] = rssi;
        }
      });
    } else {
      filteredRssis = node.rssis;
    }

    return {
      ...node,
      rssis: filteredRssis,
    };
  });

  // Update accessPoints list in mapping
  const filteredAccessPoints = selectedAPs.length > 0 || manualAPs.length > 0
    ? [...selectedAPs, ...manualAPs].map(ap => ({ bssid: ap.bssid, ssid: ap.ssid }))
    : mappingData.accessPoints;

  return {
    ...mappingData,
    accessPoints: filteredAccessPoints,
    nodes: filteredNodes,
  };
}

/**
 * Load JSON file from path
 * @param {string} filePath - Path to JSON file
 * @returns {Promise<Object>}
 */
export async function loadJSONFile(filePath) {
  try {
    const content = await RNFS.readFile(filePath, 'utf8');
    return JSON.parse(content);
  } catch (e) {
    throw new Error(`Failed to load JSON: ${e.message}`);
  }
}

/**
 * Save filtered JSON to file
 * @param {Object} data - JSON data to save
 * @param {string} fileName - Output file name
 * @returns {Promise<string>} - Saved file path
 */
export async function saveFilteredJSON(data, fileName = 'filtered_map.json') {
  const dir = Platform.OS === 'android' 
    ? RNFS.DownloadDirectoryPath 
    : RNFS.DocumentDirectoryPath;
  
  const path = `${dir}/${fileName}`;
  
  await RNFS.writeFile(path, JSON.stringify(data, null, 2), 'utf8');
  
  return path;
}

/**
 * List available JSON files in storage
 * @returns {Promise<Array<{ name: string, path: string }>>}
 */
export async function listMappingFiles() {
  const dir = Platform.OS === 'android' 
    ? RNFS.DownloadDirectoryPath 
    : RNFS.DocumentDirectoryPath;

  try {
    const files = await RNFS.readDir(dir);
    return files
      .filter(f => f.name.endsWith('.json') && f.name.includes('floor'))
      .map(f => ({ name: f.name, path: f.path }));
  } catch (e) {
    return [];
  }
}

/**
 * Export server URL for development
 */
function getExportServerUrl() {
  if (Platform.OS === 'android') {
    return 'http://192.168.1.125:3333/export';
  }
  return 'http://localhost:3333/export';
}

/**
 * Export filtered JSON to dev codebase
 * @param {Object} data - Filtered mapping data
 * @returns {Promise<{ ok: boolean, path?: string, error?: string }>}
 */
export async function exportToCodebase(data) {
  try {
    const res = await fetch(getExportServerUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const json = await res.json();
    return json.ok ? { ok: true, path: json.path } : { ok: false, error: json.error };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
