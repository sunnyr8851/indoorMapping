/**
 * WiFi Positioning Panel - Phase 2: Real-Time Position Detection
 * 
 * - Load filtered mapping data from AP Manager export
 * - Scan nearby Access Points
 * - Compare RSSI with saved fingerprints
 * - Find closest tile and display blue dot on office map
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
  Modal,
} from 'react-native';
import Svg, { Rect, Circle, Text as SvgText } from 'react-native-svg';
import RNFS from 'react-native-fs';

import { getAveragedWifiRSSI } from '../utils/wifiScan';
import { findClosestTile, findClosestTiles } from '../utils/wifiFingerprintPositioning';
import { OFFICE_GRID, OFFICE_LOCATIONS, COLS, ROWS, TILE } from '../data/officeGridData';

// Constants
const SCAN_INTERVAL_MS = 3000;
const SCAN_COUNT = 2;
const SCAN_DELAY_MS = 300;

export default function WifiPositioningPanel() {
  // Mapping data loaded from filtered JSON
  const [mappingData, setMappingData] = useState(null);
  const [loadingData, setLoadingData] = useState(false);
  const [selectedFile, setSelectedFile] = useState(null);

  // File browser state
  const [showFileBrowser, setShowFileBrowser] = useState(false);
  const [availableFiles, setAvailableFiles] = useState([]);
  const [currentDir, setCurrentDir] = useState(null);
  const [dirContents, setDirContents] = useState([]);
  const [browsingPath, setBrowsingPath] = useState([]);

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

  /* ---------------- FILE BROWSER HELPERS ---------------- */

  const getStorageDirectories = useCallback(() => {
    if (Platform.OS === 'android') {
      return [
        { name: 'Downloads', path: RNFS.DownloadDirectoryPath },
        { name: 'Documents', path: RNFS.DocumentDirectoryPath },
        { name: 'External Storage', path: RNFS.ExternalStorageDirectoryPath },
      ];
    }
    return [
      { name: 'Documents', path: RNFS.DocumentDirectoryPath },
      { name: 'Library', path: RNFS.LibraryDirectoryPath },
    ];
  }, []);

  const listDirectory = useCallback(async (dirPath) => {
    try {
      const items = await RNFS.readDir(dirPath);
      return items
        .filter((f) => f.isDirectory() || f.name.endsWith('.json'))
        .map((f) => ({
          name: f.name,
          path: f.path,
          isDirectory: f.isDirectory(),
          size: f.size || 0,
        }))
        .sort((a, b) => {
          if (a.isDirectory && !b.isDirectory) return -1;
          if (!a.isDirectory && b.isDirectory) return 1;
          return a.name.localeCompare(b.name);
        });
    } catch (e) {
      return [];
    }
  }, []);

  const listAllJSONFiles = useCallback(async () => {
    const dirs = getStorageDirectories();
    const allFiles = [];

    for (const dir of dirs) {
      try {
        const files = await RNFS.readDir(dir.path);
        const jsonFiles = files
          .filter((f) => !f.isDirectory() && f.name.endsWith('.json'))
          .map((f) => ({
            name: f.name,
            path: f.path,
            dir: dir.name,
          }));
        allFiles.push(...jsonFiles);
      } catch (e) {
        // Skip inaccessible directories
      }
    }

    return allFiles;
  }, [getStorageDirectories]);

  /* ---------------- FILE BROWSER ---------------- */

  const handleOpenFileBrowser = useCallback(async () => {
    setShowFileBrowser(true);
    
    // Open directly to Downloads folder
    const downloadDir = Platform.OS === 'android' 
      ? RNFS.DownloadDirectoryPath 
      : RNFS.DocumentDirectoryPath;
    
    const contents = await listDirectory(downloadDir);
    setDirContents(contents);
    setCurrentDir(downloadDir);
    setBrowsingPath([{ name: 'Downloads', path: downloadDir }]);
    
    const files = await listAllJSONFiles();
    setAvailableFiles(files);
    addLog(`Opened Downloads folder`);
  }, [listAllJSONFiles, listDirectory, addLog]);

  const handleBrowseDirectory = useCallback(async (dirPath, dirName) => {
    const contents = await listDirectory(dirPath);
    setDirContents(contents);
    setCurrentDir(dirPath);
    setBrowsingPath((prev) => [...prev, { name: dirName, path: dirPath }]);
  }, [listDirectory]);

  const handleBrowseBack = useCallback(() => {
    if (browsingPath.length <= 1) {
      setCurrentDir(null);
      setBrowsingPath([]);
      setDirContents([]);
    } else {
      const newPath = browsingPath.slice(0, -1);
      const parentDir = newPath[newPath.length - 1];
      setBrowsingPath(newPath);
      listDirectory(parentDir.path).then(setDirContents);
      setCurrentDir(parentDir.path);
    }
  }, [browsingPath, listDirectory]);

  const handleSelectFile = useCallback(async (file) => {
    setSelectedFile(file);
    setShowFileBrowser(false);
    setLoadingData(true);
    addLog(`Loading: ${file.name}`);

    try {
      const content = await RNFS.readFile(file.path, 'utf8');
      const data = JSON.parse(content);
      setMappingData(data);
      setCurrentPosition(null);
      setTopMatches([]);
      addLog(`Loaded: ${data.nodes?.length || 0} nodes, ${data.accessPoints?.length || 0} APs`);
    } catch (e) {
      addLog(`Load error: ${e.message}`);
      setMappingData(null);
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

  /* ---------------- RENDER OFFICE MAP ---------------- */

  const renderOfficeMap = () => {
    // Create node lookup from mapping data
    const nodeMap = {};
    if (mappingData?.nodes) {
      mappingData.nodes.forEach((n) => {
        nodeMap[`${n.x},${n.y}`] = n;
      });
    }

    return (
      <View style={styles.mapContainer}>
        <Svg width={COLS * 30} height={ROWS * 30} viewBox={`0 0 ${COLS * 30} ${ROWS * 30}`}>
          {/* Grid tiles */}
          {OFFICE_GRID.map((row, rowIdx) =>
            row.map((tileType, colIdx) => {
              let fill = '#2d4a3e'; // walkable
              if (tileType === TILE.OBSTACLE) fill = '#333';
              if (tileType === TILE.BLOCKED) fill = '#4a1a1a';

              // Check if this tile has fingerprint data
              const hasFingerprintData = nodeMap[`${colIdx},${rowIdx}`];
              if (hasFingerprintData) fill = '#1a4d7a';

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
          {OFFICE_LOCATIONS.map((loc) => (
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

          {/* Current position (blue dot) - from WiFi positioning */}
          {currentPosition && (
            <>
              <Circle
                cx={(COLS - 1 - currentPosition.x) * 30 + 15}
                cy={(ROWS - 1 - currentPosition.y) * 30 + 15}
                r={12}
                fill="#4a9eff"
                stroke="#fff"
                strokeWidth={2}
              />
              <SvgText
                x={(COLS - 1 - currentPosition.x) * 30 + 15}
                y={(ROWS - 1 - currentPosition.y) * 30 + 19}
                fill="#fff"
                fontSize={8}
                fontWeight="bold"
                textAnchor="middle"
              >
                ●
              </SvgText>
            </>
          )}
        </Svg>

        {/* Legend */}
        <View style={styles.mapLegend}>
          <View style={styles.legendItem}>
            <View style={styles.legendWalkable} />
            <Text style={styles.legendText}>Walkable</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={styles.legendObstacle} />
            <Text style={styles.legendText}>Obstacle</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={styles.legendBlocked} />
            <Text style={styles.legendText}>Blocked</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={styles.legendMapped} />
            <Text style={styles.legendText}>Mapped</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={styles.legendPosition} />
            <Text style={styles.legendText}>You</Text>
          </View>
        </View>
      </View>
    );
  };

  /* ---------------- UI ---------------- */

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>WiFi Positioning (Phase 2)</Text>
      <Text style={styles.hint}>
        Load filtered JSON from AP Manager, then scan to detect your position on the office map
      </Text>

      {/* Load Mapping Data Button */}
      <TouchableOpacity
        style={[styles.btn, styles.loadBtn]}
        onPress={handleOpenFileBrowser}
        disabled={loadingData}
      >
        {loadingData ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.btnText}>Browse & Load JSON File</Text>
        )}
      </TouchableOpacity>

      {/* Selected File Info */}
      {selectedFile && (
        <View style={styles.selectedFileBox}>
          <Text style={styles.selectedFileName}>📄 {selectedFile.name}</Text>
          {selectedFile.dir && (
            <Text style={styles.selectedFileDir}>📁 {selectedFile.dir}</Text>
          )}
        </View>
      )}

      {/* Mapping data info */}
      {mappingData && (
        <View style={styles.infoBox}>
          <Text style={styles.infoText}>Floor: {mappingData.floor || 1}</Text>
          <Text style={styles.infoText}>Nodes: {mappingData.nodes?.length || 0}</Text>
          <Text style={styles.infoText}>
            APs per node: {mappingData.nodes?.[0]?.rssis?.length || 0}
          </Text>
        </View>
      )}

      {/* Office Map */}
      {renderOfficeMap()}

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
          <Text style={styles.matchesTitle}>Top 3 Matches:</Text>
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
      <View style={styles.logSection}>
        <Text style={styles.logTitle}>Log</Text>
        <ScrollView style={styles.logContainer} nestedScrollEnabled>
          {log.map((l, i) => (
            <Text key={i} style={styles.logEntry}>
              {l}
            </Text>
          ))}
        </ScrollView>
      </View>

      {/* File Browser Modal */}
      <Modal
        visible={showFileBrowser}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowFileBrowser(false)}
      >
        <View style={styles.fileBrowserOverlay}>
          <View style={styles.fileBrowserModal}>
            <View style={styles.fileBrowserHeader}>
              <Text style={styles.fileBrowserTitle}>Select JSON File</Text>
              <TouchableOpacity
                style={styles.closeBtn}
                onPress={() => setShowFileBrowser(false)}
              >
                <Text style={styles.closeBtnText}>✕</Text>
              </TouchableOpacity>
            </View>

            {/* Back button */}
            {currentDir && (
              <TouchableOpacity style={styles.backBtn} onPress={handleBrowseBack}>
                <Text style={styles.backBtnText}>← Back</Text>
              </TouchableOpacity>
            )}

            {/* Path indicator */}
            {browsingPath.length > 0 && (
              <Text style={styles.currentPath}>
                {browsingPath.map((p) => p.name).join(' / ')}
              </Text>
            )}

            <ScrollView style={styles.fileBrowserList}>
              {/* Storage Directories (root level) */}
              {!currentDir && (
                <>
                  <Text style={styles.browserSectionTitle}>Storage Locations</Text>
                  {getStorageDirectories().map((dir, i) => (
                    <TouchableOpacity
                      key={`dir-${i}`}
                      style={styles.browserRow}
                      onPress={() => handleBrowseDirectory(dir.path, dir.name)}
                    >
                      <Text style={styles.folderIcon}>📁</Text>
                      <Text style={styles.browserItemName}>{dir.name}</Text>
                    </TouchableOpacity>
                  ))}

                  {/* Quick file list */}
                  {availableFiles.length > 0 && (
                    <>
                      <Text style={styles.browserSectionTitleSpaced}>
                        Available JSON Files
                      </Text>
                      {availableFiles.slice(0, 15).map((file, i) => (
                        <TouchableOpacity
                          key={`file-${i}`}
                          style={styles.browserRow}
                          onPress={() => handleSelectFile(file)}
                        >
                          <Text style={styles.fileIcon}>📄</Text>
                          <View style={styles.browserFileInfo}>
                            <Text style={styles.browserFileName}>{file.name}</Text>
                            <Text style={styles.browserFileDir}>{file.dir}</Text>
                          </View>
                        </TouchableOpacity>
                      ))}
                    </>
                  )}
                </>
              )}

              {/* Directory contents */}
              {currentDir &&
                dirContents.map((item, i) => (
                  <TouchableOpacity
                    key={i}
                    style={styles.browserRow}
                    onPress={() =>
                      item.isDirectory
                        ? handleBrowseDirectory(item.path, item.name)
                        : handleSelectFile(item)
                    }
                  >
                    <Text style={item.isDirectory ? styles.folderIcon : styles.fileIcon}>
                      {item.isDirectory ? '📁' : '📄'}
                    </Text>
                    <Text style={styles.browserItemName}>{item.name}</Text>
                  </TouchableOpacity>
                ))}

              {currentDir && dirContents.length === 0 && (
                <Text style={styles.emptyText}>No JSON files found</Text>
              )}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

/* ---------------- STYLES ---------------- */

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
  content: {
    padding: 12,
    paddingBottom: 40,
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
  selectedFileBox: {
    backgroundColor: '#2d4a3e',
    padding: 10,
    borderRadius: 6,
    marginBottom: 12,
  },
  selectedFileName: {
    color: '#00ff88',
    fontSize: 13,
    fontWeight: '600',
  },
  selectedFileDir: {
    color: '#888',
    fontSize: 11,
    marginTop: 4,
  },
  infoBox: {
    backgroundColor: '#16213e',
    padding: 10,
    borderRadius: 6,
    marginBottom: 12,
  },
  infoText: {
    color: '#aaa',
    fontSize: 11,
    marginBottom: 2,
  },
  mapContainer: {
    backgroundColor: '#0d1b2a',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
    alignItems: 'center',
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
  legendWalkable: {
    width: 12,
    height: 12,
    borderRadius: 2,
    marginRight: 4,
    backgroundColor: '#2d4a3e',
  },
  legendObstacle: {
    width: 12,
    height: 12,
    borderRadius: 2,
    marginRight: 4,
    backgroundColor: '#333',
  },
  legendBlocked: {
    width: 12,
    height: 12,
    borderRadius: 2,
    marginRight: 4,
    backgroundColor: '#4a1a1a',
  },
  legendMapped: {
    width: 12,
    height: 12,
    borderRadius: 2,
    marginRight: 4,
    backgroundColor: '#1a4d7a',
  },
  legendPosition: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 4,
    backgroundColor: '#4a9eff',
  },
  legendText: {
    color: '#888',
    fontSize: 10,
  },
  positionBox: {
    backgroundColor: '#2d4a3e',
    padding: 10,
    borderRadius: 6,
    marginBottom: 8,
    borderWidth: 1,
    borderColor: '#00ff88',
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
    backgroundColor: '#16213e',
    padding: 10,
    borderRadius: 6,
    marginBottom: 12,
  },
  matchesTitle: {
    color: '#888',
    fontSize: 11,
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
  logSection: {
    backgroundColor: '#16213e',
    borderRadius: 8,
    padding: 10,
  },
  logTitle: {
    color: '#00ff88',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
  },
  logContainer: {
    maxHeight: 100,
  },
  logEntry: {
    color: '#aaa',
    fontSize: 10,
  },
  // File browser styles
  fileBrowserOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.8)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fileBrowserModal: {
    backgroundColor: '#16213e',
    borderRadius: 12,
    padding: 16,
    width: '90%',
    maxHeight: '80%',
  },
  fileBrowserHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  fileBrowserTitle: {
    color: '#00ff88',
    fontSize: 16,
    fontWeight: 'bold',
  },
  closeBtn: {
    padding: 8,
  },
  closeBtnText: {
    color: '#e74c3c',
    fontSize: 18,
    fontWeight: 'bold',
  },
  backBtn: {
    padding: 8,
    marginBottom: 8,
  },
  backBtnText: {
    color: '#4a69bd',
    fontSize: 14,
  },
  currentPath: {
    color: '#888',
    fontSize: 10,
    marginBottom: 8,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  fileBrowserList: {
    maxHeight: 400,
  },
  browserSectionTitle: {
    color: '#00ff88',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 8,
    marginTop: 8,
  },
  browserSectionTitleSpaced: {
    color: '#00ff88',
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 8,
    marginTop: 16,
  },
  browserRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a2e',
    padding: 12,
    borderRadius: 6,
    marginBottom: 6,
  },
  folderIcon: {
    fontSize: 20,
    marginRight: 12,
  },
  fileIcon: {
    fontSize: 20,
    marginRight: 12,
  },
  browserItemName: {
    color: '#fff',
    fontSize: 13,
    flex: 1,
  },
  browserFileInfo: {
    flex: 1,
  },
  browserFileName: {
    color: '#fff',
    fontSize: 12,
  },
  browserFileDir: {
    color: '#666',
    fontSize: 10,
    marginTop: 2,
  },
  emptyText: {
    color: '#666',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 20,
  },
});
