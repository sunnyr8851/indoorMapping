/**
 * WiFi-based positioning: use RSSI from fixed APs to refine or derive position on the map.
 * - RSSI -> estimated distance (path-loss model).
 * - Multiple APs: weighted centroid (stronger signal = closer = higher weight).
 * - Fuse with GPS-derived map position when available.
 */

import { MAP_WIDTH, MAP_HEIGHT } from '../data/officeGridData';
import { getAPByBSSID, getAPsInMap } from '../data/wifiAPData';

// Path-loss exponent (indoor typically 2–4). Higher = signal drops faster with distance.
const PATH_LOSS_EXPONENT = 3;
// Default txPower (dBm) at 1m if AP doesn't specify.
const DEFAULT_TX_POWER = -45;

/**
 * Estimate distance (feet) from AP given RSSI (dBm) and optional txPower (dBm at 1m).
 * d = 10^((txPower - rssi) / (10 * n)) with n = path loss exponent.
 * Using 1m reference: d_m = 10^((txPower - rssi) / (10 * n)); d_ft = d_m * 3.28084.
 */
export function rssiToDistanceFeet(rssi, txPower = DEFAULT_TX_POWER) {
  const n = PATH_LOSS_EXPONENT;
  const dMeters = Math.pow(10, (txPower - rssi) / (10 * n));
  return Math.max(0.5, Math.min(150, dMeters * 3.28084)); // clamp 0.5–150 ft
}

/**
 * Get WiFi scan results (RSSI per BSSID).
 * - Android: use WifiManager.loadWifiList() from react-native-wifi-reborn.
 * - iOS: only current AP (getBSSID + getCurrentSignalStrength).
 * Caller should pass the list; this module doesn't depend on native WiFi.
 *
 * @param rssiList Array<{ bssid: string, level: number }> — level is RSSI in dBm (often negative).
 */
export function positionFromWifiRSSI(rssiList) {
  if (!rssiList || rssiList.length === 0) return null;

  const apData = getAPsInMap();
  const PIXELS_PER_FOOT = MAP_WIDTH / 18;
  let sumX = 0;
  let sumY = 0;
  let totalWeight = 0;

  for (const { bssid, level } of rssiList) {
    const rssi = typeof level === 'number' ? level : parseInt(level, 10);
    if (Number.isNaN(rssi)) continue;

    const ap = getAPByBSSID(bssid);
    if (!ap) continue;

    const distFeet = rssiToDistanceFeet(rssi, ap.txPower ?? DEFAULT_TX_POWER);
    // Weight: closer = higher weight. Use 1/distance or inverse square.
    const weight = 1 / (distFeet * distFeet + 1);
    sumX += ap.x * weight;
    sumY += ap.y * weight;
    totalWeight += weight;
  }

  if (totalWeight <= 0) return null;

  const x = sumX / totalWeight;
  const y = sumY / totalWeight;
  return {
    x: Math.max(0, Math.min(MAP_WIDTH, x)),
    y: Math.max(0, Math.min(MAP_HEIGHT, y)),
    source: 'wifi',
  };
}

/**
 * Fuse GPS-derived map position with WiFi-derived position.
 * When both available: weighted average (configurable). When only one, return it.
 */
export function fusePositions(gpsMapPos, wifiMapPos, wifiWeight = 0.6) {
  if (gpsMapPos && wifiMapPos) {
    const g = 1 - wifiWeight;
    return {
      x: gpsMapPos.x * g + wifiMapPos.x * wifiWeight,
      y: gpsMapPos.y * g + wifiMapPos.y * wifiWeight,
      source: 'fused',
    };
  }
  if (wifiMapPos) return wifiMapPos;
  if (gpsMapPos) return gpsMapPos;
  return null;
}
