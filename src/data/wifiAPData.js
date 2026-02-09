/**
 * Fixed WiFi access point positions on the office map (map pixel coordinates).
 * Add your APs: BSSID (MAC, can be from router or scan), position (x, y) in map pixels.
 * Optional txPower (dBm at 1m) for distance estimation from RSSI; typical -40 to -50.
 */

import { MAP_WIDTH, MAP_HEIGHT } from './officeGridData';

// Format: { id, bssid, ssid?, x, y, txPower? }
// BSSID is often like "aa:bb:cc:dd:ee:ff" (Android) or "AA:BB:CC:DD:EE:FF" (iOS).
// Normalize to lowercase for matching.
export const WIFI_APS = [
  // Example APs – replace with your building’s APs and positions
  { id: 'ap1', bssid: 'aa:bb:cc:dd:ee:01', ssid: 'Office-2.4', x: 270, y: 480, txPower: -45 },
  { id: 'ap2', bssid: 'aa:bb:cc:dd:ee:02', ssid: 'Office-2.4', x: 810, y: 480, txPower: -45 },
  { id: 'ap3', bssid: 'aa:bb:cc:dd:ee:03', ssid: 'Office-2.4', x: 540, y: 960, txPower: -45 },
  { id: 'ap4', bssid: 'aa:bb:cc:dd:ee:04', ssid: 'Office-2.4', x: 270, y: 1440, txPower: -45 },
  { id: 'ap5', bssid: 'aa:bb:cc:dd:ee:05', ssid: 'Office-2.4', x: 810, y: 1440, txPower: -45 },
];

const BSSID_TO_AP = {};
WIFI_APS.forEach((ap) => {
  BSSID_TO_AP[ap.bssid.toLowerCase().replace(/[:-]/g, '')] = ap;
});

export function getAPByBSSID(bssid) {
  if (!bssid) return null;
  const key = String(bssid).toLowerCase().replace(/[:-]/g, '');
  return BSSID_TO_AP[key] || null;
}

export function getAPsInMap() {
  return WIFI_APS;
}
