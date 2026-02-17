/**
 * WiFi Positioning Panel - Phase 2: Real-Time Position Detection
 * 
 * - Load saved mapping data from Phase 1
 * - Scan nearby predefined Access Points
 * - Compare top 3 strongest RSSI with saved data
 * - Find closest tile and display blue dot on map
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Platform,
  ActivityIndicator,
  Alert,
} from 'react-native';
import Svg, { Rect, Circle, Text as SvgText, G } from 'react-native-svg';
import RNFS from 'react-native-fs';

import { getAveragedWifiRSSI } from '../utils/wifiScan';
import { findClosestTile, findClosestTiles } from '../utils/wifiFingerprintPositioning';

// Constants
const TILE_SIZE_PX = 40; // Pixels per tile for display
const SCAN_INTERVAL_MS = 3000;
const SCAN_COUNT = 2;
const SCAN_DELAY_MS = 300;

export default function WifiPositioningPanel() {
  // Mapping data loaded from Phase 1
  const [mappingData, setMappingData] = useState(null);
  const [loadingData, setLoadingData] = useState(false);

  // Current position
  const [currentPosition, setCurrentPosition] = useState(null);
  const [matchDistance, setMatchDistance] = useState(null);
  const [topMatches, setTopMatches] = useState([]);

  // Scanning state
  const [isScanning, setIsScanning] = useState(false);
  const [isTracking, setIsTracking] = useState(false);
  const trackingRef = useRef(null);

  // Log
  const [log, setLog] = useState([]);
  const logRef = useRef([]);

  const addLog = useCallback((msg) => {
    const t = new Date().toLocaleTimeString();
    logRef.current = [`[${t}] ${msg}`, ...logRef.current.slice(0, 19)];
    setLog([...logRef.current]);
  }, []);

  /* ---------------- LOAD MAPPING DATA ---------------- */

  const loadMappingData = useCallback(async () => {
    setLoadingData(true);
    addLog('Loading mapping data...');

    try {
      // Try to load from default path
      const defaultPath =
        Platform.OS === 'android'
          ? `${RNFS.DownloadDirectoryPath}/floor_1_map.json`
          : `${RNFS.DocumentDirectoryPath}/floor_1_map.json`;

      // Also check the mapping-data folder (dev path)
      const devPaths = [
        defaultPath,
        `${RNFS.MainBundlePath}/mapping-data/floor_1_map.json`,
        `${RNFS.DocumentDirectoryPath}/../mapping-data/floor_1_map.json`,
      ];

      let data = null;

      for (const path of devPaths) {
        try {
          const exists = await RNFS.exists(path);
          if (exists) {
            const content = await RNFS.readFile(path, 'utf8');
            data = JSON.parse(content);
            addLog(`Loaded from: ${path.split('/').pop()}`);
            break;
          }
        } catch (e) {
          // Try next path
        }
      }

      if (!data) {
        // List files in Downloads directory for debugging
        const dir =
          Platform.OS === 'android'
            ? RNFS.DownloadDirectoryPath
            : RNFS.DocumentDirectoryPath;

        const files = await RNFS.readDir(dir);
        const jsonFiles = files
          .filter((f) => f.name.endsWith('.json'))
          .map((f) => f.name);

        if (jsonFiles.length > 0) {
          // Load first JSON file found
          const firstFile = jsonFiles.find((f) => f.includes('floor')) || jsonFiles[0];
          const content = await RNFS.readFile(`${dir}/${firstFile}`, 'utf8');
          data = JSON.parse(content);
          addLog(`Loaded: ${firstFile}`);
        } else {
          addLog('No mapping files found');
          Alert.alert(
            'No Data',
            'No mapping data found. Complete Phase 1 mapping first.',
            [{ text: 'OK' }]
          );
        }
      }

      if (data) {
        setMappingData(data);
        addLog(`Nodes: ${data.nodes?.length || 0}, APs: ${data.accessPoints?.length || 'N/A'}`);
      }
    } catch (e) {
      addLog(`Load error: ${e.message}`);
      console.error(e);
    } finally {
      setLoadingData(false);
    }
  }, [addLog]);

  /* ---------------- SCAN AND POSITION ---------------- */

  const scanAndPosition = useCallback(async () => {
    if (!mappingData) {
      addLog('No mapping data loaded');
      return;
    }

    setIsScanning(true);
    addLog('Scanning WiFi...');

    try {
      // Scan current WiFi RSSI
      const currentRssi = await getAveragedWifiRSSI(SCAN_COUNT, SCAN_DELAY_MS);

      if (!currentRssi || Object.keys(currentRssi).length === 0) {
        addLog('No WiFi signals detected');
        setIsScanning(false);
        return;
      }

      addLog(`Scanned ${Object.keys(currentRssi).length} APs`);

      // Find closest tile
      const result = findClosestTile(currentRssi, mappingData, { topN: 3 });

      if (result) {
        setCurrentPosition({ x: result.x, y: result.y });
        setMatchDistance(result.distance.toFixed(2));
        addLog(`Position: (${result.x}, ${result.y}) | Distance: ${result.distance.toFixed(2)}`);

        // Get top 3 matches for debugging
        const topResults = findClosestTiles(currentRssi, mappingData, 3);
        setTopMatches(topResults);
      } else {
        addLog('Could not determine position');
      }
    } catch (e) {
      addLog(`Scan error: ${e.message}`);
    } finally {
      setIsScanning(false);
    }
  }, [mappingData, addLog]);

  /* ---------------- CONTINUOUS TRACKING ---------------- */

  const startTracking = useCallback(() => {
    if (!mappingData) {
      addLog('Load mapping data first');
      return;
    }

    setIsTracking(true);
    addLog('Started tracking');

    // Initial scan
    scanAndPosition();

    // Set up interval for continuous tracking
    trackingRef.current = setInterval(() => {
      scanAndPosition();
    }, SCAN_INTERVAL_MS);
  }, [mappingData, scanAndPosition, addLog]);

  const stopTracking = useCallback(() => {
    if (trackingRef.current) {
      clearInterval(trackingRef.current);
      trackingRef.current = null;
    }
    setIsTracking(false);
    addLog('Stopped tracking');
  }, [addLog]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (trackingRef.current) {
        clearInterval(trackingRef.current);
      }
    };
  }, []);

  /* ---------------- RENDER MAP GRID ---------------- */

  const renderMapGrid = () => {
    if (!mappingData || !mappingData.nodes || mappingData.nodes.length === 0) {
      return (
        <View style={styles.noMapContainer}>
          <Text style={styles.noMapText}>No mapping data loaded</Text>
        </View>
      );
    }

    // Calculate grid bounds from nodes
    const nodes = mappingData.nodes;
    const minX = Math.min(...nodes.map((n) => n.x));
    const maxX = Math.max(...nodes.map((n) => n.x));
    const minY = Math.min(...nodes.map((n) => n.y));
    const maxY = Math.max(...nodes.map((n) => n.y));

    const cols = maxX - minX + 1;
    const rows = maxY - minY + 1;

    const width = cols * TILE_SIZE_PX + 40;
    const height = rows * TILE_SIZE_PX + 40;

    // Create node lookup
    const nodeMap = {};
    nodes.forEach((n) => {
      nodeMap[`${n.x},${n.y}`] = n;
    });

    return (
      <View style={styles.mapContainer}>
        <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
          {/* Background */}
          <Rect x={0} y={0} width={width} height={height} fill="#1a1a2e" />

          {/* Grid cells */}
          {Array.from({ length: rows }).map((_row, rowIdx) =>
            Array.from({ length: cols }).map((_col, colIdx) => {
              const tileX = minX + colIdx;
              const tileY = minY + rowIdx;
              const key = `${tileX},${tileY}`;
              const hasNode = nodeMap[key];

              const px = 20 + colIdx * TILE_SIZE_PX;
              const py = 20 + rowIdx * TILE_SIZE_PX;

              return (
                <G key={key}>
                  <Rect
                    x={px}
                    y={py}
                    width={TILE_SIZE_PX - 2}
                    height={TILE_SIZE_PX - 2}
                    fill={hasNode ? '#2d4a3e' : '#16213e'}
                    stroke="#333"
                    strokeWidth={1}
                  />
                  {hasNode && (
                    <SvgText
                      x={px + TILE_SIZE_PX / 2}
                      y={py + TILE_SIZE_PX / 2 + 4}
                      fill="#888"
                      fontSize={8}
                      textAnchor="middle"
                    >
                      {tileX},{tileY}
                    </SvgText>
                  )}
                </G>
              );
            })
          )}

          {/* Current position (blue dot) */}
          {currentPosition && (
            <Circle
              cx={20 + (currentPosition.x - minX) * TILE_SIZE_PX + TILE_SIZE_PX / 2}
              cy={20 + (currentPosition.y - minY) * TILE_SIZE_PX + TILE_SIZE_PX / 2}
              r={12}
              fill="#4a9eff"
              stroke="#fff"
              strokeWidth={2}
            />
          )}
        </Svg>
      </View>
    );
  };

  /* ---------------- UI ---------------- */

  return (
    <View style={styles.container}>
      <Text style={styles.title}>WiFi Positioning (Phase 2)</Text>
      <Text style={styles.hint}>
        Load mapping data, then scan to detect your position
      </Text>

      {/* Load Mapping Data */}
      <TouchableOpacity
        style={[styles.btn, styles.loadBtn]}
        onPress={loadMappingData}
        disabled={loadingData}
      >
        {loadingData ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.btnText}>Load Mapping Data</Text>
        )}
      </TouchableOpacity>

      {/* Mapping data info */}
      {mappingData && (
        <View style={styles.infoBox}>
          <Text style={styles.infoText}>Floor: {mappingData.floor}</Text>
          <Text style={styles.infoText}>Nodes: {mappingData.nodes?.length || 0}</Text>
          <Text style={styles.infoText}>
            APs: {mappingData.accessPoints?.length || Object.keys(mappingData.nodes?.[0]?.rssis || {}).length || 'N/A'}
          </Text>
        </View>
      )}

      {/* Map Grid */}
      {renderMapGrid()}

      {/* Position Info */}
      {currentPosition && (
        <View style={styles.positionBox}>
          <Text style={styles.positionText}>
            Current Position: ({currentPosition.x}, {currentPosition.y})
          </Text>
          <Text style={styles.distanceText}>Match Distance: {matchDistance}</Text>
        </View>
      )}

      {/* Top Matches */}
      {topMatches.length > 0 && (
        <View style={styles.matchesBox}>
          <Text style={styles.matchesTitle}>Top Matches:</Text>
          {topMatches.map((m, i) => (
            <Text key={i} style={styles.matchRow}>
              {i + 1}. ({m.x}, {m.y}) - dist: {m.distance.toFixed(2)}
            </Text>
          ))}
        </View>
      )}

      {/* Scan Buttons */}
      <View style={styles.buttonRow}>
        <TouchableOpacity
          style={[styles.btn, styles.scanBtn, !mappingData && styles.btnDisabled]}
          onPress={scanAndPosition}
          disabled={!mappingData || isScanning || isTracking}
        >
          {isScanning ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.btnText}>Scan Once</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.btn,
            isTracking ? styles.stopBtn : styles.trackBtn,
            !mappingData && styles.btnDisabled,
          ]}
          onPress={isTracking ? stopTracking : startTracking}
          disabled={!mappingData}
        >
          <Text style={styles.btnText}>
            {isTracking ? 'Stop Tracking' : 'Start Tracking'}
          </Text>
        </TouchableOpacity>
      </View>

      {/* Log */}
      <ScrollView style={styles.logContainer} nestedScrollEnabled>
        {log.map((l, i) => (
          <Text key={i} style={styles.logEntry}>
            {l}
          </Text>
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
  title: {
    color: '#00ff88',
    fontWeight: 'bold',
    fontSize: 16,
    marginBottom: 4,
  },
  hint: {
    color: '#888',
    fontSize: 11,
    marginBottom: 12,
  },
  btn: {
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 8,
  },
  loadBtn: {
    backgroundColor: '#1a4d7a',
  },
  scanBtn: {
    backgroundColor: '#5c7cfa',
    flex: 1,
    marginRight: 4,
  },
  trackBtn: {
    backgroundColor: '#00ff88',
    flex: 1,
    marginLeft: 4,
  },
  stopBtn: {
    backgroundColor: '#e74c3c',
    flex: 1,
    marginLeft: 4,
  },
  btnDisabled: {
    opacity: 0.5,
  },
  btnText: {
    color: '#000',
    fontWeight: '600',
  },
  infoBox: {
    backgroundColor: '#1a1a2e',
    padding: 8,
    borderRadius: 6,
    marginBottom: 12,
  },
  infoText: {
    color: '#aaa',
    fontSize: 11,
  },
  mapContainer: {
    backgroundColor: '#1a1a2e',
    borderRadius: 8,
    padding: 8,
    marginBottom: 12,
    alignItems: 'center',
  },
  noMapContainer: {
    backgroundColor: '#1a1a2e',
    padding: 40,
    borderRadius: 8,
    marginBottom: 12,
    alignItems: 'center',
  },
  noMapText: {
    color: '#666',
    fontSize: 12,
  },
  positionBox: {
    backgroundColor: '#2d4a3e',
    padding: 10,
    borderRadius: 6,
    marginBottom: 8,
  },
  positionText: {
    color: '#00ff88',
    fontWeight: '600',
    fontSize: 14,
  },
  distanceText: {
    color: '#aaa',
    fontSize: 11,
    marginTop: 4,
  },
  matchesBox: {
    backgroundColor: '#1a1a2e',
    padding: 8,
    borderRadius: 6,
    marginBottom: 12,
  },
  matchesTitle: {
    color: '#888',
    fontSize: 10,
    marginBottom: 4,
  },
  matchRow: {
    color: '#ccc',
    fontSize: 10,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  buttonRow: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  logContainer: {
    maxHeight: 100,
  },
  logEntry: {
    color: '#aaa',
    fontSize: 10,
  },
});
