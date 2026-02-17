/**
 * Get WiFi RSSI list for positioning.
 * - Android: loadWifiList() / reScanAndLoadWifiList() return multiple APs (BSSID + level).
 * - iOS: only current AP (getBSSID + getCurrentSignalStrength).
 *
 * Phase 1: Predefined APs → fetch only those, store top 3 RSSI per tile.
 */

import { Platform } from 'react-native';

let WifiManager;
try {
  WifiManager = require('react-native-wifi-reborn').default;
} catch (e) {
  WifiManager = null;
}

/** Normalize BSSID for consistent matching (lowercase, colons). */
export function normalizeBssid(bssid) {
  if (!bssid || typeof bssid !== 'string') return '';
  return bssid.toLowerCase().replace(/-/g, ':');
}

/**
 * Fetch all visible access points with BSSID, SSID (if available), and RSSI.
 * Use for "Fetch access points" so user can choose which APs to use for mapping.
 * @returns {Promise<Array<{ bssid: string, ssid?: string, rssi: number }>>}
 */
export async function fetchAllAccessPoints() {
  if (!WifiManager) return [];

  try {
    if (Platform.OS === 'android') {
      const list = await WifiManager.reScanAndLoadWifiList();
      console.log(list)
      if (!Array.isArray(list) || list.length === 0) return [];
      return list
        .map((w) => {
          const bssid = normalizeBssid(w.BSSID || w.bssid || '');
          const rssi = w.level ?? w.Level ?? -99;
          const ssid = w.SSID ?? w.ssid ?? '';
          if (!bssid) return null;
          return { bssid, ssid: ssid || undefined, rssi: Number(rssi) };
        })
        .filter(Boolean);
    }
    // iOS: current AP only
    const [bssid, level] = await Promise.all([
      WifiManager.getBSSID().catch(() => null),
      WifiManager.getCurrentSignalStrength().catch(() => null),
    ]);
    if (bssid != null && level != null) {
      return [{ bssid: normalizeBssid(String(bssid)), rssi: Number(level) }];
    }
  } catch (e) {
    console.warn('WiFi fetch APs error:', e.message);
  }
  return [];
}

/**
 * Returns list of { bssid, level } (level = RSSI in dBm).
 * Normalizes BSSID format for matching with wifiAPData.
 */
export async function getWifiRSSIList() {
  if (!WifiManager) return [];

  try {
    if (Platform.OS === 'android') {
      const list = await WifiManager.loadWifiList();
      if (Array.isArray(list) && list.length > 0) {
        return list.map((w) => ({
          bssid: normalizeBssid(w.BSSID || w.bssid || ''),
          level: w.level ?? w.Level ?? -99,
        })).filter((w) => w.bssid);
      }
    }
    const [bssid, level] = await Promise.all([
      WifiManager.getBSSID().catch(() => null),
      WifiManager.getCurrentSignalStrength().catch(() => null),
    ]);
    if (bssid != null && level != null) {
      return [{ bssid: normalizeBssid(String(bssid)), level: Number(level) }];
    }
  } catch (e) {
    console.warn('WiFi scan error:', e.message);
  }
  return [];
}

/** Delay helper */
function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Scan WiFi 3 times and average RSSI per BSSID for better accuracy.
 * Returns object { [bssid]: averagedLevel } suitable for floor map nodes.
 * @param {number} scanCount - Number of scans (default 3)
 * @param {number} delayMs - Delay between scans in ms (default 400)
 * @returns {Promise<Record<string, number>>}
 */
export async function getAveragedWifiRSSI(
  scanCount = 3,
  delayMs = 5000
) {
  if (!WifiManager) return {};

  const accumulator = {};   // { bssid: totalRssi }
  const counts = {};        // { bssid: count }

  for (let i = 0; i < scanCount; i++) {
    console.log(`WiFi Scan ${i + 1}/${scanCount}`);

    const list = await WifiManager.reScanAndLoadWifiList();

    if (Array.isArray(list)) {
      list.forEach((w) => {
        const bssid = normalizeBssid(w.BSSID || w.bssid || '');
        const level = w.level ?? w.Level;

        if (!bssid || level == null) return;

        // OPTIONAL: ignore very weak signals (reduces noise)
        if (level < -90) return;

        if (!accumulator[bssid]) {
          accumulator[bssid] = 0;
          counts[bssid] = 0;
        }

        accumulator[bssid] += level;
        counts[bssid] += 1;
      });
    }

    // wait before next scan (except last)
    if (i < scanCount - 1) {
      await delay(delayMs);
    }
  }

  // Compute final averages
  const averaged = {};

  Object.keys(accumulator).forEach((bssid) => {
    averaged[bssid] = Math.round(
      accumulator[bssid] / counts[bssid]
    );
  });

  console.log("Averaged AP count:", Object.keys(averaged).length);

  return averaged;
}

const TOP_N_RSSI = 3;

/**
 * Get averaged RSSI from only predefined APs, then return top N strongest.
 * Used during Phase 1 mapping: store top 3 RSSI per tile for Phase 2 positioning.
 * @param {string[]} predefinedBssids - List of BSSIDs (normalized) to consider
 * @param {number} scanCount - Number of scans to average (default 3)
 * @param {number} delayMs - Delay between scans (default 400)
 * @param {number} topN - Number of strongest APs to return (default 3)
 * @returns {Promise<Array<{ bssid: string, rssi: number }>>}
 */
export async function getAveragedWifiRSSITopN(
  predefinedBssids,
  scanCount = 3,
  delayMs = 400,
  topN = TOP_N_RSSI
) {
  if (!Array.isArray(predefinedBssids) || predefinedBssids.length === 0) {
    return [];
  }
  const set = new Set(predefinedBssids.map(normalizeBssid).filter(Boolean));
  const averaged = await getAveragedWifiRSSI(scanCount, delayMs);

  const filtered = Object.entries(averaged)
    .filter(([bssid]) => set.has(normalizeBssid(bssid)))
    .map(([bssid, rssi]) => ({ bssid: normalizeBssid(bssid), rssi }))
    .sort((a, b) => b.rssi - a.rssi)
    .slice(0, topN);

  return filtered;
}

