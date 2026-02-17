/**
 * Device info utility – battery, model, OS, storage, etc.
 * Uses react-native-device-info when available; falls back to Platform.
 */

import { Platform } from 'react-native';

let DeviceInfo = null;
try {
  DeviceInfo = require('react-native-device-info').default;
} catch (_) {
  // not linked yet
}

function formatBytes(bytes) {
  if (bytes == null || bytes < 0) return '—';
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  const mb = bytes / (1024 * 1024);
  return `${mb.toFixed(0)} MB`;
}

/**
 * @returns {Promise<{
 *   model: string,
 *   brand: string,
 *   systemName: string,
 *   systemVersion: string,
 *   deviceId: string,
 *   deviceName: string,
 *   batteryLevel: number | null,
 *   batteryState: string,
 *   isCharging: boolean,
 *   totalMemory: string,
 *   freeDiskStorage: string,
 *   totalDiskCapacity: string,
 *   isEmulator: boolean,
 *   appVersion: string,
 *   buildNumber: string
 * }>}
 */
export async function getDeviceInfo() {
  const fallback = {
    model: Platform.OS === 'ios' ? 'Simulator' : 'Unknown',
    brand: Platform.OS === 'ios' ? 'Apple' : 'Unknown',
    systemName: Platform.OS === 'ios' ? 'iOS' : 'Android',
    systemVersion: String(Platform.Version ?? ''),
    deviceId: '—',
    deviceName: '—',
    batteryLevel: null,
    batteryState: 'unknown',
    isCharging: false,
    totalMemory: '—',
    freeDiskStorage: '—',
    totalDiskCapacity: '—',
    isEmulator: false,
    appVersion: '—',
    buildNumber: '—',
  };

  if (!DeviceInfo) return fallback;

  try {
    const [
      model,
      brand,
      systemName,
      systemVersion,
      deviceId,
      deviceName,
      batteryLevel,
      powerState,
      totalMemory,
      freeDiskStorage,
      totalDiskCapacity,
      isEmulator,
    ] = await Promise.all([
      Promise.resolve(DeviceInfo.getModel()),
      Promise.resolve(DeviceInfo.getBrand()),
      Promise.resolve(DeviceInfo.getSystemName()),
      Promise.resolve(DeviceInfo.getSystemVersion()),
      Promise.resolve(DeviceInfo.getDeviceId()),
      DeviceInfo.getDeviceName(),
      DeviceInfo.getBatteryLevel(),
      DeviceInfo.getPowerState(),
      DeviceInfo.getTotalMemory().catch(() => -1),
      DeviceInfo.getFreeDiskStorage().catch(() => -1),
      DeviceInfo.getTotalDiskCapacity().catch(() => -1),
      DeviceInfo.isEmulator(),
    ]);

    const batteryState = powerState?.batteryState ?? 'unknown';
    const isCharging =
      batteryState === 'charging' || powerState?.batteryState === 'full';

    return {
      model: model || fallback.model,
      brand: brand || fallback.brand,
      systemName: systemName || fallback.systemName,
      systemVersion: systemVersion || fallback.systemVersion,
      deviceId: deviceId || fallback.deviceId,
      deviceName: deviceName || fallback.deviceName,
      batteryLevel: batteryLevel != null && batteryLevel >= 0 ? batteryLevel : null,
      batteryState,
      isCharging,
      totalMemory: formatBytes(totalMemory),
      freeDiskStorage: formatBytes(freeDiskStorage),
      totalDiskCapacity: formatBytes(totalDiskCapacity),
      isEmulator: !!isEmulator,
      appVersion: DeviceInfo.getVersion() || fallback.appVersion,
      buildNumber: DeviceInfo.getBuildNumber() || fallback.buildNumber,
    };
  } catch (e) {
    return fallback;
  }
}
