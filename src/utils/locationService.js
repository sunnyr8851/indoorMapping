/**
 * Device location: fetch GPS/network coords and convert to map pixels.
 */

import { Platform, PermissionsAndroid } from 'react-native';
import Geolocation from '@react-native-community/geolocation';
import { latLonToMapPixels } from '../data/mapAnchor';

export async function requestLocationPermission() {
  if (Platform.OS !== 'android') return true;
  const granted = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION,
    {
      title: 'Location permission',
      message: 'This app needs location to place you on the map and use WiFi for better accuracy.',
      buttonNegative: 'Deny',
      buttonPositive: 'Allow',
    }
  );
  return granted === PermissionsAndroid.RESULTS.GRANTED;
}

/**
 * Get current device position (lat, lon, accuracy).
 * Uses network/cell when GPS is slow or unavailable (e.g. indoors).
 * @returns {Promise<{ lat: number, lon: number, accuracy: number } | { error: string }>}
 */
export function getDeviceLocation() {
  return new Promise((resolve) => {
    Geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        resolve({ lat: latitude, lon: longitude, accuracy: accuracy ?? 0 });
      },
      (err) => {
        const msg = err.message || `Error ${err.code}`;
        console.warn('Geolocation error:', err.code, msg);
        resolve({ error: msg });
      },
      {
        enableHighAccuracy: false, // use network/cell for faster fix when GPS is poor (e.g. indoors)
        timeout: 20000,
        maximumAge: 60000, // accept cached position up to 1 min
      }
    );
  });
}

/**
 * Convert device (lat, lon) to map pixel (x, y).
 */
export function deviceCoordsToMapPixels(lat, lon) {
  return latLonToMapPixels(lat, lon);
}
