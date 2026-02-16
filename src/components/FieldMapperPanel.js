/**
 * Field Mapper Panel - Floor walking data collection.
 * FULL VERSION:
 * - No reset issue
 * - Correct state updates
 * - Direction buttons included
 * - Stable node linking
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Platform,
  ActivityIndicator,
} from 'react-native';

import { gyroscope, setUpdateIntervalForType, SensorTypes } from 'react-native-sensors';
import { getAveragedWifiRSSI } from '../utils/wifiScan';
import { requestLocationPermission, getDeviceLocation } from '../utils/locationService';
import { saveFieldMapToFile, exportToCodebase } from '../utils/fieldMappingService';

const TILE_SIZE_FT = 3;
const RSSI_SCAN_COUNT = 3;
const RSSI_SCAN_DELAY_MS = 400;

export default function FieldMapperPanel({ onTileChange }) {

  const [floor, setFloor] = useState(1);
  const [startX, setStartX] = useState(0);
  const [startY, setStartY] = useState(0);

  const [mapping, setMapping] = useState(null);
  const [currentTileX, setCurrentTileX] = useState(0);
  const [currentTileY, setCurrentTileY] = useState(0);

  const [isRecording, setIsRecording] = useState(false);
  const [savedPath, setSavedPath] = useState(null);
  const [log, setLog] = useState([]);

  const headingRef = useRef(0);
  const gyroSubRef = useRef(null);
  const logRef = useRef([]);

  /* ---------------- LOG ---------------- */

  const addLog = useCallback((msg) => {
    const t = new Date().toLocaleTimeString();
    logRef.current = [`[${t}] ${msg}`, ...logRef.current.slice(0, 19)];
    setLog([...logRef.current]);
  }, []);

  /* ---------------- GYRO ---------------- */

  const startHeadingSubscription = useCallback(() => {
    try {
      setUpdateIntervalForType(SensorTypes.gyroscope, 50);

      const subscription = gyroscope.subscribe({
        next: (data) => {
          const now = Date.now();

          if (gyroSubRef.current?.lastTime != null) {
            const dt = (now - gyroSubRef.current.lastTime) / 1000;
            headingRef.current -= data.z * dt;

            while (headingRef.current < 0) headingRef.current += 2 * Math.PI;
            while (headingRef.current >= 2 * Math.PI) headingRef.current -= 2 * Math.PI;
          }

          gyroSubRef.current.lastTime = now;
        },
      });

      gyroSubRef.current = { subscription, lastTime: null };
    } catch (e) {
      addLog(`Gyro error`);
    }
  }, []);

  const stopHeadingSubscription = useCallback(() => {
    if (gyroSubRef.current?.subscription) {
      gyroSubRef.current.subscription.unsubscribe();
    }
    gyroSubRef.current = null;
  }, []);

  /* ---------------- START MAPPING ---------------- */

  const startMapping = useCallback(async () => {

    const localStartX = parseInt(startX, 10) || 0;
    const localStartY = parseInt(startY, 10) || 0;
    const localFloor = parseInt(floor, 10) || 1;

    const granted = await requestLocationPermission();
    if (!granted) {
      addLog('Location permission denied');
      return;
    }

    startHeadingSubscription();
    await new Promise(r => setTimeout(r, 300));

    const headingDeg = (headingRef.current * 180) / Math.PI;
    const loc = await getDeviceLocation();

    const session = {
      floor: localFloor,
      originHeading: headingDeg,
      geoCoordinate: loc.error
        ? { lat: 0, lng: 0 }
        : { lat: loc.lat, lng: loc.lon },
      tileSizeFeet: TILE_SIZE_FT,
      nodes: [],
    };

    setMapping(session);
    setCurrentTileX(localStartX);
    setCurrentTileY(localStartY);
    setSavedPath(null);

    addLog(`Started mapping at (${localStartX}, ${localStartY})`);

    if (onTileChange) onTileChange(localStartX, localStartY);

  }, [floor, startX, startY]);

  /* ---------------- MOVE TILE ---------------- */

  const moveTile = useCallback((dx, dy) => {
    if (!mapping) return;

    setCurrentTileX(prev => {
      const nx = prev + dx;
      if (onTileChange) onTileChange(nx, currentTileY);
      return nx;
    });

    setCurrentTileY(prev => prev + dy);

  }, [mapping, currentTileY]);

  /* ---------------- RECORD NODE ---------------- */

  const recordNode = useCallback(async () => {
    if (!mapping || isRecording) return;

    setIsRecording(true);
    addLog("Recording node...");

    try {

      const [rssis, loc] = await Promise.all([
        getAveragedWifiRSSI(RSSI_SCAN_COUNT, RSSI_SCAN_DELAY_MS),
        getDeviceLocation(),
      ]);

      const headingDeg = (headingRef.current * 180) / Math.PI;

      setMapping(prev => {

        const prevNode = prev.nodes[prev.nodes.length - 1];

        const newNode = {
          id: prev.nodes.length + 1,
          x: currentTileX,
          y: currentTileY,
          heading: headingDeg,
          rssis,
          neighbors: prevNode ? [prevNode.id] : [],
          geoCoordinate: loc.error ? null : { lat: loc.lat, lng: loc.lon },
        };

        const updatedNodes = [...prev.nodes];

        if (prevNode) {
          updatedNodes[updatedNodes.length - 1] = {
            ...prevNode,
            neighbors: [...(prevNode.neighbors || []), newNode.id],
          };
        }

        updatedNodes.push(newNode);

        return {
          ...prev,
          nodes: updatedNodes,
        };
      });

      addLog(`Node saved at (${currentTileX}, ${currentTileY})`);

    } catch (e) {
      addLog("Record failed");
    } finally {
      setIsRecording(false);
    }

  }, [mapping, currentTileX, currentTileY, isRecording]);

  /* ---------------- EXPORT ---------------- */

  const exportPath = useCallback(async () => {
    if (!mapping) return;

    // const result = await exportToCodebase(mapping);
    const path = await saveFieldMapToFile(mapping);
setSavedPath(path);
addLog("Export successful");

  }, [mapping]);

  useEffect(() => {
    console.log("UPDATED MAPPING:", mapping);
  }, [mapping]);

  useEffect(() => {
    return () => stopHeadingSubscription();
  }, []);

  /* ---------------- UI ---------------- */

  return (
    <View style={styles.container}>

      <Text style={styles.title}>Field Mapping (3×3 ft)</Text>

      {/* Inputs */}
      <View style={styles.row}>
        <Text style={styles.label}>Start X:</Text>
        <TextInput
          value={String(startX)}
          onChangeText={t => setStartX(parseInt(t) || 0)}
          keyboardType="numeric"
          style={styles.input}
          editable={!mapping}
        />
        <Text style={[styles.label, { marginLeft: 10 }]}>Start Y:</Text>
        <TextInput
          value={String(startY)}
          onChangeText={t => setStartY(parseInt(t) || 0)}
          keyboardType="numeric"
          style={styles.input}
          editable={!mapping}
        />
      </View>

      <TouchableOpacity style={[styles.btn, styles.startBtn]} onPress={startMapping}>
        <Text style={styles.btnText}>Start Mapping</Text>
      </TouchableOpacity>

      {mapping && (
        <>
          <Text style={styles.tileLabel}>
            Current Tile: ({currentTileX}, {currentTileY})
          </Text>

          {/* Direction Grid */}
          <View style={styles.dirGrid}>

            <View style={styles.dirRow}>
              <View style={styles.spacer} />
              <TouchableOpacity style={styles.dirBtn} onPress={() => moveTile(0, 1)}>
                <Text style={styles.dirText}>▲ Top</Text>
              </TouchableOpacity>
              <View style={styles.spacer} />
            </View>

            <View style={styles.dirRow}>
              <TouchableOpacity style={styles.dirBtn} onPress={() => moveTile(-1, 0)}>
                <Text style={styles.dirText}>◀ Left</Text>
              </TouchableOpacity>

              <View style={[styles.dirBtn, { backgroundColor: '#0f3460' }]}>
                <Text style={styles.dirText}>({currentTileX},{currentTileY})</Text>
              </View>

              <TouchableOpacity style={styles.dirBtn} onPress={() => moveTile(1, 0)}>
                <Text style={styles.dirText}>Right ▶</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.dirRow}>
              <View style={styles.spacer} />
              <TouchableOpacity style={styles.dirBtn} onPress={() => moveTile(0, -1)}>
                <Text style={styles.dirText}>▼ Bottom</Text>
              </TouchableOpacity>
              <View style={styles.spacer} />
            </View>

          </View>

          <TouchableOpacity
            style={[styles.btn, styles.recordBtn]}
            onPress={recordNode}
            disabled={isRecording}
          >
            {isRecording
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.btnText}>Record Node</Text>}
          </TouchableOpacity>

          <TouchableOpacity style={[styles.btn, styles.exportBtn]} onPress={exportPath}>
            <Text style={styles.btnText}>Export JSON</Text>
          </TouchableOpacity>

          <Text style={styles.count}>Nodes: {mapping.nodes.length}</Text>

          {savedPath && <Text style={styles.pathText}>{savedPath}</Text>}
        </>
      )}

      <ScrollView style={{ maxHeight: 100 }}>
        {log.map((l, i) => (
          <Text key={i} style={styles.logEntry}>{l}</Text>
        ))}
      </ScrollView>

    </View>
  );
}

/* ---------------- STYLES ---------------- */

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#16213e',
    padding: 12,
    borderRadius: 8,
    margin: 8,
    marginTop:35
  },
  title: { color: '#00ff88', fontWeight: 'bold', marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  label: { color: '#fff', marginRight: 8 },
  input: {
    borderWidth: 1,
    borderColor: '#4a69bd',
    color: '#fff',
    padding: 6,
    width: 60,
    borderRadius: 4,
  },
  btn: {
    padding: 10,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 8,
  },
  startBtn: { backgroundColor: '#00ff88' },
  recordBtn: { backgroundColor: '#5c7cfa' },
  exportBtn: { backgroundColor: '#6c5ce7' },
  btnText: { color: '#000', fontWeight: '600' },
  tileLabel: { color: '#fff', marginBottom: 10, textAlign: 'center' },
  dirGrid: { marginBottom: 12 },
  dirRow: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', marginVertical: 4 },
  spacer: { width: 80 },
  dirBtn: {
    width: 80,
    paddingVertical: 8,
    backgroundColor: '#533483',
    borderRadius: 6,
    alignItems: 'center',
    marginHorizontal: 4,
  },
  dirText: { color: '#fff', fontSize: 12 },
  count: { color: '#00ff88', marginBottom: 4 },
  pathText: { color: '#aaa', fontSize: 10 },
  logEntry: { color: '#aaa', fontSize: 10 },
});
