/**
 * Field mapping service: save floor map JSON to device storage.
 *
 * Stored JSON format (matches reference from FieldMapper-style logic):
 * {
 *   floor: number,
 *   originHeading: number,
 *   geoCoordinate: { lat, lng },
 *   tileSizeFeet: 3,
 *   nodes: [
 *     { id, x, y, heading, rssis: { bssid: rssi, ... }, neighbors: [...] }
 *   ]
 * }
 * - (x, y) = tiling position; mapping starts at (0, 0). Each step = one 3×3 ft tile.
 * - RSSI per node is averaged from 3 scans for better accuracy.
 * - geoCoordinate = GPS at session start; nodes may optionally include geoCoordinate per record.
 */

import RNFS from 'react-native-fs';
import { Platform ,PermissionsAndroid} from 'react-native';

/**
 * Save mapping data to JSON file.
 * @param {Object} data - { floor, originHeading, geoCoordinate, tileSizeFeet, nodes }
 * @returns {Promise<string>} - Path where file was saved
 */
async function requestStoragePermission() {
  if (Platform.OS !== 'android') return true;

  if (Platform.Version >= 29) {
    // Android 10+ doesn't need WRITE_EXTERNAL_STORAGE for app-specific dir
    return true;
  }

  const granted = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE
  );

  return granted === PermissionsAndroid.RESULTS.GRANTED;
}

export async function saveFieldMapToFile(data) {
  try {
    const hasPermission = await requestStoragePermission();
    if (!hasPermission) {
      throw new Error('Storage permission denied');
    }

    const fileName = `floor_${data.floor}_map_${Date.now()}.json`;

    const path =
      Platform.OS === 'android'
        ? `${RNFS.DownloadDirectoryPath}/${fileName}`
        : `${RNFS.DocumentDirectoryPath}/${fileName}`;

    await RNFS.writeFile(path, JSON.stringify(data, null, 2), 'utf8');

    console.log('Saved at:', path);

    return path;
  } catch (error) {
    console.log('Save error:', error);
    throw error;
  }
}
/**
 * Get the default path for a floor's map file.
 * @param {number} floor
 * @returns {string}
 */
export function getFieldMapPath(floor) {
  return `${RNFS.DocumentDirectoryPath}/floor_${floor}_map.json`;
}

/** Export server URL: Android emulator uses 10.0.2.2, iOS simulator uses localhost */
// import { Platform } from 'react-native';

function getExportServerUrl() {
  if (Platform.OS === 'android') {
    return 'http://192.168.1.125:3333/export';
  }
  return 'http://localhost:3333/export';
}


/**
 * POST mapping data to dev export server to save in project out/ folder.
 * Run: node scripts/export-server.js
 * @param {Object} data - mapping JSON
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
