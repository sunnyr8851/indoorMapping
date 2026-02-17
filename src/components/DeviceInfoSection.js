/**
 * Device info card – battery, model, OS, storage, etc.
 * Shown on the home page.
 */

import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { getDeviceInfo } from '../utils/deviceInfo';

const Row = ({ label, value }) => (
  <View style={styles.row}>
    <Text style={styles.label}>{label}</Text>
    <Text style={styles.value}>{value ?? '—'}</Text>
  </View>
);

export default function DeviceInfoSection() {
  const [info, setInfo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getDeviceInfo();
      console.log(info)
      setInfo(data);
    } catch (e) {
      setError('Could not load device info');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  if (loading && !info) {
    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Device info</Text>
        <Text style={styles.muted}>Loading…</Text>
      </View>
    );
  }

  if (error && !info) {
    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Device info</Text>
        <Text style={styles.muted}>{error}</Text>
        <TouchableOpacity onPress={load} style={styles.retryBtn}>
          <Text style={styles.retryText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  const batteryPct =
    info.batteryLevel != null
      ? `${Math.round(info.batteryLevel * 100)}%`
      : '—';
  const batteryStatus = info.isCharging ? `${batteryPct} (charging)` : batteryPct;

  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>Device info</Text>
      <Row label="Model" value={info.model} />
      <Row label="Brand" value={info.brand} />
      <Row label="Device ID" value={info.deviceId} />
      <Row label="Device name" value={info.deviceName} />
      <Row label="OS" value={`${info.systemName} ${info.systemVersion}`} />
      <Row label="Battery" value={batteryStatus} />
      <Row label="Total memory" value={info.totalMemory} />
      <Row label="Free storage" value={info.freeDiskStorage} />
      <Row label="Total storage" value={info.totalDiskCapacity} />
      <Row label="App version" value={`${info.appVersion} (${info.buildNumber})`} />
      {info.isEmulator && (
        <Text style={styles.emulator}>Running on emulator</Text>
      )}
      <TouchableOpacity onPress={load} style={styles.refreshBtn}>
        <Text style={styles.refreshText}>Refresh</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#0f3460',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#1a4d7a',
  },
  cardTitle: {
    color: '#00ff88',
    fontWeight: 'bold',
    fontSize: 16,
    marginBottom: 10,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  label: {
    color: '#aaa',
    fontSize: 12,
    marginRight: 8,
  },
  value: {
    color: '#fff',
    fontSize: 12,
    flex: 1,
    textAlign: 'right',
  },
  muted: {
    color: '#888',
    fontSize: 12,
  },
  emulator: {
    color: '#ffa502',
    fontSize: 11,
    marginTop: 6,
  },
  retryBtn: {
    marginTop: 8,
    paddingVertical: 6,
    alignSelf: 'flex-start',
  },
  retryText: {
    color: '#00ff88',
    fontSize: 12,
  },
  refreshBtn: {
    marginTop: 8,
    paddingVertical: 4,
    alignSelf: 'flex-start',
  },
  refreshText: {
    color: '#4a69bd',
    fontSize: 11,
  },
});
