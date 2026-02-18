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
import Svg, { Rect, Circle, Text as SvgText } from 'react-native-svg';

import { gyroscope, setUpdateIntervalForType, SensorTypes } from 'react-native-sensors';
import {
  fetchAllAccessPoints,
  getAveragedWifiRSSI,
} from '../utils/wifiScan';
import { requestLocationPermission, getDeviceLocation } from '../utils/locationService';
import { saveFieldMapToFile, exportToCodebase } from '../utils/fieldMappingService';
import DeviceInfoSection from './DeviceInfoSection';
import { OFFICE_GRID, OFFICE_LOCATIONS, COLS, ROWS, TILE } from '../data/officeGridData';

const TILE_SIZE_FT = 3;
const RSSI_SCAN_COUNT = 3;
const RSSI_SCAN_DELAY_MS = 400;

export default function FieldMapperPanel({ onTileChange, selectedAPs: externalAPs }) {

  const [floor, setFloor] = useState(1);
  const [startX, setStartX] = useState(0);
  const [startY, setStartY] = useState(0);

  const [mapping, setMapping] = useState(null);
  const [currentTileX, setCurrentTileX] = useState(0);
  const [currentTileY, setCurrentTileY] = useState(0);

  const [isRecording, setIsRecording] = useState(false);
  const [savedPath, setSavedPath] = useState(null);
  const [log, setLog] = useState([]);

  // Phase 1: Predefined access points for mapping
  const [predefinedAPs, setPredefinedAPs] = useState([]);
  const [fetchedAPs, setFetchedAPs] = useState([]);
  const [selectedAPs, setSelectedAPs] = useState(new Set()); // Selected AP bssids
  const [fetchingAPs, setFetchingAPs] = useState(false);

  // Sync with external APs from AP Manager
  useEffect(() => {
    if (externalAPs && externalAPs.length > 0) {
      setPredefinedAPs(externalAPs);
      console.log(`Received ${externalAPs.length} APs from AP Manager`);
    }
  }, [externalAPs]);

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
      accessPoints: predefinedAPs.map((ap) => ({ bssid: ap.bssid, ssid: ap.ssid })),
      nodes: [],
    };

    setMapping(session);
    setCurrentTileX(localStartX);
    setCurrentTileY(localStartY);
    setSavedPath(null);

    addLog(`Started mapping at (${localStartX}, ${localStartY})`);

    if (onTileChange) onTileChange(localStartX, localStartY);

  }, [floor, startX, startY, predefinedAPs]);

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
      // Scan all APs
      const averaged = await getAveragedWifiRSSI(RSSI_SCAN_COUNT, RSSI_SCAN_DELAY_MS);
      
      // Convert to array format
      let rssiList = Object.entries(averaged)
        .map(([bssid, rssi]) => ({ bssid, rssi }))
        .sort((a, b) => b.rssi - a.rssi);

      // If predefined APs are selected, filter to only those
      // Otherwise, store ALL detected APs (no top N restriction)
      const predefinedBssids = predefinedAPs.map((ap) => ap.bssid.toLowerCase());
      if (predefinedBssids.length > 0) {
        rssiList = rssiList.filter(r => 
          predefinedBssids.includes(r.bssid.toLowerCase())
        );
        addLog(`Filtered to ${rssiList.length} predefined APs`);
      } else {
        addLog(`Storing all ${rssiList.length} APs`);
      }

      const loc = await getDeviceLocation();
      const headingDeg = (headingRef.current * 180) / Math.PI;

      setMapping(prev => {

        const prevNode = prev.nodes[prev.nodes.length - 1];

        const newNode = {
          id: prev.nodes.length + 1,
          x: currentTileX,
          y: currentTileY,
          heading: headingDeg,
          rssis: rssiList,
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

  }, [mapping, currentTileX, currentTileY, isRecording, predefinedAPs]);

  /* ---------------- EXPORT ---------------- */

  const exportPath = useCallback(async () => {
    if (!mapping) return;
    addLog("Export started");
    // const result = await exportToCodebase(mapping);
    const path = await saveFieldMapToFile(mapping);
    setSavedPath(path);
    addLog("Export successful");
  }, [mapping]);

  const handleFetchAccessPoints = useCallback(async () => {
    setFetchingAPs(true);
    addLog("Requesting permission...");

    const granted = await requestLocationPermission();
    if (!granted) {
      addLog("Permission denied");
      setFetchingAPs(false);
      return;
    }

    addLog("Fetching access points...");
    try {
      const list = await fetchAllAccessPoints();
      // Sort by RSSI descending (strongest signal first)
      const sorted = list.sort((a, b) => b.rssi - a.rssi);
      setFetchedAPs(sorted);
      setSelectedAPs(new Set()); // Clear selection
      addLog(`Found ${sorted.length} AP(s)`);
    } catch (e) {
      addLog("Fetch APs failed");
    } finally {
      setFetchingAPs(false);
    }
  }, []);

  const toggleAPSelection = useCallback((bssid) => {
    setSelectedAPs(prev => {
      const newSet = new Set(prev);
      if (newSet.has(bssid)) {
        newSet.delete(bssid);
      } else {
        newSet.add(bssid);
      }
      return newSet;
    });
  }, []);

  const handleUseAsPredefined = useCallback(() => {
    if (selectedAPs.size === 0) {
      addLog("Select at least one AP");
      return;
    }
    const selected = fetchedAPs
      .filter((ap) => selectedAPs.has(ap.bssid))
      .map((ap) => ({ bssid: ap.bssid, ssid: ap.ssid }));
    setPredefinedAPs(selected);
    addLog(`Set ${selected.length} AP(s) as predefined`);
  }, [fetchedAPs, selectedAPs]);

  useEffect(() => {
    console.log("UPDATED MAPPING:", mapping);
  }, [mapping]);

  useEffect(() => {
    return () => stopHeadingSubscription();
  }, []);

  /* ---------------- UI ---------------- */

  return (
    <View style={styles.container}>

      <DeviceInfoSection />

      {/* Phase 1: Access point mapping */}
      <Text style={styles.sectionTitle}>Access points (Phase 1)</Text>
      <Text style={styles.hint}>
        Fetch APs, then set them as predefined. Mapping will store top 3 RSSI per tile.
      </Text>
      <TouchableOpacity
        style={[styles.btn, styles.fetchApBtn]}
        onPress={handleFetchAccessPoints}
        disabled={fetchingAPs}
      >
        {fetchingAPs ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.btnText}>Fetch access points (RSSI)</Text>
        )}
      </TouchableOpacity>
      {predefinedAPs.length > 0 && (
        <Text style={styles.predefinedCount}>Predefined APs: {predefinedAPs.length}</Text>
      )}
      {fetchedAPs.length > 0 && (
        <>
          <Text style={styles.apListTitle}>
            Scanned ({fetchedAPs.length}) - Selected: {selectedAPs.size}
          </Text>
          <Text style={styles.hint}>Tap to select APs for mapping</Text>
          <ScrollView style={styles.apList} nestedScrollEnabled>
            {fetchedAPs.map((ap, i) => {
              const isSelected = selectedAPs.has(ap.bssid);
              return (
                <TouchableOpacity
                  key={i}
                  style={[styles.apRowContainer, isSelected && styles.apRowSelected]}
                  onPress={() => toggleAPSelection(ap.bssid)}
                >
                  <Text style={styles.checkbox}>{isSelected ? '☑' : '☐'}</Text>
                  <Text style={[styles.apRow, isSelected && styles.apRowTextSelected]}>
                    {ap.rssi} dBm · {ap.ssid || 'Hidden'} · {ap.bssid}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          <TouchableOpacity
            style={[styles.btn, styles.usePredefinedBtn, selectedAPs.size === 0 && styles.btnDisabled]}
            onPress={handleUseAsPredefined}
            disabled={selectedAPs.size === 0}
          >
            <Text style={styles.btnText}>
              Use selected ({selectedAPs.size}) as predefined APs
            </Text>
          </TouchableOpacity>
        </>
      )}

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

          {/* Office Map Visualization (mirrored: exit gate on left) */}
          <View style={styles.mapContainer}>
            <Svg width={COLS * 30} height={ROWS * 30} viewBox={`0 0 ${COLS * 30} ${ROWS * 30}`}>
              {/* Grid tiles */}
              {OFFICE_GRID.map((row, rowIdx) =>
                row.map((tileType, colIdx) => {
                  let fill = '#2d4a3e'; // walkable
                  if (tileType === TILE.OBSTACLE) fill = '#333';
                  if (tileType === TILE.BLOCKED) fill = '#4a1a1a';
                  
                  // Check if this tile has been recorded
                  const hasNode = mapping.nodes.some(
                    n => n.x === colIdx && n.y === rowIdx
                  );
                  if (hasNode) fill = '#1a4d7a';
                  
                  return (
                    <Rect
                      key={`${colIdx}-${rowIdx}`}
                      x={(COLS - 1 - colIdx) * 30}
                      y={(ROWS - 1 - rowIdx) * 30}
                      width={29}
                      height={29}
                      fill={fill}
                      stroke="#16213e"
                      strokeWidth={1}
                    />
                  );
                })
              )}
              
              {/* Location labels */}
              {OFFICE_LOCATIONS.map((loc, i) => (
                <SvgText
                  key={loc.id}
                  x={(COLS - 1 - loc.col) * 30 + 15}
                  y={(ROWS - 1 - loc.row) * 30 + 18}
                  fill="#888"
                  fontSize={6}
                  textAnchor="middle"
                >
                  {loc.name.slice(0, 8)}
                </SvgText>
              ))}
              
              {/* Current position indicator */}
              <Circle
                cx={(COLS - 1 - currentTileX) * 30 + 15}
                cy={(ROWS - 1 - currentTileY) * 30 + 15}
                r={10}
                fill="#00ff88"
                opacity={0.9}
              />
              <SvgText
                x={(COLS - 1 - currentTileX) * 30 + 15}
                y={(ROWS - 1 - currentTileY) * 30 + 18}
                fill="#000"
                fontSize={8}
                fontWeight="bold"
                textAnchor="middle"
              >
                ●
              </SvgText>
            </Svg>
            
            {/* Legend */}
            <View style={styles.mapLegend}>
              <View style={styles.legendItem}>
                <View style={[styles.legendBox, { backgroundColor: '#2d4a3e' }]} />
                <Text style={styles.legendText}>Walkable</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendBox, { backgroundColor: '#333' }]} />
                <Text style={styles.legendText}>Obstacle</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendBox, { backgroundColor: '#4a1a1a' }]} />
                <Text style={styles.legendText}>Blocked</Text>
              </View>
              <View style={styles.legendItem}>
                <View style={[styles.legendBox, { backgroundColor: '#1a4d7a' }]} />
                <Text style={styles.legendText}>Recorded</Text>
              </View>
            </View>
          </View>

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
  },
  title: { color: '#00ff88', fontWeight: 'bold', marginBottom: 10 },
  sectionTitle: { color: '#00ff88', fontWeight: '600', marginBottom: 4, fontSize: 14 },
  hint: { color: '#888', fontSize: 11, marginBottom: 8 },
  predefinedCount: { color: '#4a69bd', fontSize: 12, marginBottom: 8 },
  apListTitle: { color: '#aaa', fontSize: 11, marginBottom: 4 },
  apList: { maxHeight: 180, marginBottom: 8 },
  apRowContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 8,
    marginBottom: 2,
    borderRadius: 4,
    backgroundColor: '#1a1a2e',
  },
  apRowSelected: {
    backgroundColor: '#2d4a3e',
    borderWidth: 1,
    borderColor: '#00ff88',
  },
  checkbox: {
    color: '#00ff88',
    fontSize: 16,
    marginRight: 8,
    width: 20,
  },
  apRow: { color: '#ccc', fontSize: 10, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', flex: 1 },
  apRowTextSelected: { color: '#fff' },
  fetchApBtn: { backgroundColor: '#1a4d7a' },
  usePredefinedBtn: { backgroundColor: '#2d5a87', marginBottom: 12 },
  btnDisabled: { opacity: 0.5 },
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
  // Map styles
  mapContainer: {
    alignItems: 'center',
    marginBottom: 16,
    backgroundColor: '#0d1b2a',
    borderRadius: 8,
    padding: 12,
  },
  mapLegend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    marginTop: 10,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 12,
    marginBottom: 4,
  },
  legendBox: {
    width: 12,
    height: 12,
    borderRadius: 2,
    marginRight: 4,
  },
  legendText: {
    color: '#888',
    fontSize: 10,
  },
});
