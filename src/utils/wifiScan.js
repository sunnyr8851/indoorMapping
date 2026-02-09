/**
 * Get WiFi RSSI list for positioning.
 * - Android: loadWifiList() returns multiple APs (BSSID + level).
 * - iOS: only current AP (getBSSID + getCurrentSignalStrength).
 */

import { Platform } from 'react-native';

let WifiManager;
try {
  WifiManager = require('react-native-wifi-reborn').default;
} catch (e) {
  WifiManager = null;
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
          bssid: w.BSSID || w.bssid || '',
          level: w.level ?? w.Level ?? -99,
        })).filter((w) => w.bssid);
      }
    }
    // iOS (or Android fallback): current AP only
    const [bssid, level] = await Promise.all([
      WifiManager.getBSSID().catch(() => null),
      WifiManager.getCurrentSignalStrength().catch(() => null),
    ]);
    if (bssid != null && level != null) {
      return [{ bssid: String(bssid), level: Number(level) }];
    }
  } catch (e) {
    console.warn('WiFi scan error:', e.message);
  }
  return [];
}
