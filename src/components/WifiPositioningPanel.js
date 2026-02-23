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
  PermissionsAndroid,
  Alert,
  Linking,
} from 'react-native';
import Svg, { Rect, Circle, Text as SvgText } from 'react-native-svg';
import RNFS from 'react-native-fs';
import { pick, types } from '@react-native-documents/picker';

/**
 * Request storage permission for Android
 * Android 11+ (API 30+) requires different handling
 */
async function requestStoragePermission() {
  if (Platform.OS !== 'android') return true;
  
  try {
    // Check Android version
    const androidVersion = Platform.Version;
    console.log('Android API Level:', androidVersion);
    
    if (androidVersion >= 33) {
      // Android 13+ - READ_MEDIA_* permissions or use app-specific directories
      // For JSON files, we don't need special media permissions
      // Just try to access - will work for app directories and Downloads
      return true;
    } else if (androidVersion >= 30) {
      // Android 11-12 - Check if we have access, if not guide to settings
      const readPermission = await PermissionsAndroid.check(
        PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE
      );
      
      if (!readPermission) {
        // Try requesting anyway (might work on some devices)
        const result = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE,
          {
            title: 'Storage Permission',
            message: 'App needs access to your storage to load JSON mapping files.',
            buttonNeutral: 'Ask Me Later',
            buttonNegative: 'Cancel',
            buttonPositive: 'OK',
          }
        );
        
        if (result !== PermissionsAndroid.RESULTS.GRANTED) {
          // Guide user to enable "All Files Access" manually
          Alert.alert(
            'Permission Required',
            'For Android 11+, please enable "All Files Access" for this app:\n\n' +
            '1. Open Settings\n' +
            '2. Go to Apps → Indoor Mapping\n' +
            '3. Tap Permissions → Files and media\n' +
            '4. Select "Allow management of all files"\n\n' +
            'Or copy your JSON file to the app\'s Download folder.',
            [
              { text: 'Open Settings', onPress: () => Linking.openSettings() },
              { text: 'Continue Anyway', style: 'cancel' }
            ]
          );
          // Return true to continue - app directories should still work
          return true;
        }
      }
      return true;
    } else {
      // Android 10 and below - use legacy permissions
      const granted = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE,
        PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE,
      ]);
      
      const readGranted = granted[PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE] === PermissionsAndroid.RESULTS.GRANTED;
      
      if (!readGranted) {
        Alert.alert(
          'Permission Denied',
          'Storage permission is required. Please grant it in Settings.',
          [
            { text: 'Open Settings', onPress: () => Linking.openSettings() },
            { text: 'Cancel', style: 'cancel' }
          ]
        );
        return false;
      }
      return true;
    }
  } catch (err) {
    console.warn('Permission error:', err);
    // Continue anyway - app directories should work
    return true;
  }
}

import { getAveragedWifiRSSI } from '../utils/wifiScan';
import { findClosestTile, findClosestTiles } from '../utils/wifiFingerprintPositioning';
import { OFFICE_GRID, OFFICE_LOCATIONS, COLS, ROWS, TILE } from '../data/officeGridData';

// Constants
const SCAN_INTERVAL_MS = 4000;  // Interval between position updates
const SCAN_COUNT = 5;           // Number of WiFi scans to average (more = stable)
const SCAN_DELAY_MS = 800;      // Delay between scans (~4 sec total for stability)

/**
 * Check if a tile position is walkable (not an obstacle or blocked)
 * @param {number} x - X coordinate (will be rounded)
 * @param {number} y - Y coordinate (will be rounded)
 * @returns {boolean} - true if walkable
 */
function isTileWalkable(x, y) {
  const tileX = Math.round(x);
  const tileY = Math.round(y);
  
  // Check bounds
  if (tileY < 0 || tileY >= ROWS || tileX < 0 || tileX >= COLS) {
    return false;
  }
  
  // OFFICE_GRID[row][col] - row is Y, col is X
  const tileType = OFFICE_GRID[tileY]?.[tileX];
  
  // TILE.WALKABLE = 0, TILE.OBSTACLE = 1, TILE.BLOCKED = 2
  return tileType === TILE.WALKABLE;
}

/**
 * Find nearest walkable position for fractional coordinates
 * Returns valid position or snaps to closest walkable tile from candidates
 * @param {number} x - Fractional X
 * @param {number} y - Fractional Y
 * @param {Array} topTiles - Fallback tiles (all mapped = all walkable)
 * @returns {{ x: number, y: number, wasAdjusted: boolean }}
 */
function getValidPosition(x, y, topTiles = []) {
  // Check if rounded position is walkable
  if (isTileWalkable(x, y)) {
    return { x, y, wasAdjusted: false };
  }
  
  // Position falls on obstacle - find nearest walkable from top tiles
  // Top tiles are from mapping data, so they're always walkable
  if (topTiles.length > 0) {
    // Return closest tile position (fractional but centered on valid tile)
    const closest = topTiles[0];
    return { 
      x: closest.x, 
      y: closest.y, 
      wasAdjusted: true 
    };
  }
  
  // Last resort: just round and hope
  return { x: Math.round(x), y: Math.round(y), wasAdjusted: true };
}

/**
 * Handle shared file from intent (e.g., from WhatsApp share)
 * Copies the file to app directory and returns the local path
 */
async function handleSharedFile(uri) {
  if (!uri) return null;
  
  try {
    console.log('Received shared file:', uri);
    
    // Generate a unique filename
    const timestamp = Date.now();
    const destPath = `${RNFS.DocumentDirectoryPath}/shared_mapping_${timestamp}.json`;
    
    // If it's a content:// URI, we need to copy it
    if (uri.startsWith('content://')) {
      // Read the content from the URI
      const content = await RNFS.readFile(uri, 'utf8');
      
      // Validate it's JSON
      try {
        JSON.parse(content);
      } catch (e) {
        console.log('Shared file is not valid JSON');
        return null;
      }
      
      // Save to app directory
      await RNFS.writeFile(destPath, content, 'utf8');
      console.log('Shared file saved to:', destPath);
      
      return {
        path: destPath,
        name: `shared_mapping_${timestamp}.json`,
      };
    }
    
    return null;
  } catch (error) {
    console.error('Error handling shared file:', error);
    return null;
  }
}

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

  // Handle shared file when app opens via share intent
  const processSharedFile = useCallback(async (url) => {
    if (!url) return;
    
    addLog('Received shared file...');
    const fileInfo = await handleSharedFile(url);
    
    if (fileInfo) {
      addLog(`Saved: ${fileInfo.name}`);
      
      // Auto-load the shared file
      try {
        const content = await RNFS.readFile(fileInfo.path, 'utf8');
        const data = JSON.parse(content);
        setMappingData(data);
        setSelectedFile(fileInfo);
        addLog(`Loaded: ${data.nodes?.length || 0} nodes, ${data.accessPoints?.length || 0} APs`);
        
        Alert.alert(
          'File Loaded!',
          `Successfully loaded mapping data from shared file.\n\n` +
          `Nodes: ${data.nodes?.length || 0}\n` +
          `Access Points: ${data.accessPoints?.length || 0}`,
          [{ text: 'OK' }]
        );
      } catch (e) {
        addLog(`Error loading shared file: ${e.message}`);
      }
    } else {
      addLog('Could not process shared file');
    }
  }, [addLog]);

  // Check for shared file on mount
  useEffect(() => {
    // Check initial URL (app opened via share)
    Linking.getInitialURL().then((url) => {
      if (url) {
        processSharedFile(url);
      }
    });

    // Listen for incoming shares while app is running
    const subscription = Linking.addEventListener('url', ({ url }) => {
      processSharedFile(url);
    });

    return () => {
      subscription?.remove();
    };
  }, [processSharedFile]);

  /* ---------------- FILE BROWSER HELPERS ---------------- */

  const getStorageDirectories = useCallback(() => {
    if (Platform.OS === 'android') {
      // App directories first (always accessible without permission)
      // Then system directories (may need permission on Android 11+)
      return [
        // App-specific directories (ALWAYS work, no permission needed)
        { name: '📱 App Files', path: RNFS.DocumentDirectoryPath, appDir: true },
        { name: '📱 App External', path: RNFS.ExternalDirectoryPath, appDir: true },
        { name: '📱 App Cache', path: RNFS.CachesDirectoryPath, appDir: true },
        // System directories (may need permission)
        { name: '📥 Downloads', path: RNFS.DownloadDirectoryPath },
        { name: '📥 Internal Download', path: '/storage/emulated/0/Download' },
        { name: '📄 Documents', path: '/storage/emulated/0/Documents' },
        { name: '💾 External Storage', path: RNFS.ExternalStorageDirectoryPath },
        // WhatsApp directories (Android 10 and below)
        { name: '💬 WhatsApp Documents', path: '/storage/emulated/0/WhatsApp/Media/WhatsApp Documents' },
        // WhatsApp directories (Android 11+)
        { name: '💬 WhatsApp (New)', path: '/storage/emulated/0/Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Documents' },
      ];
    }
    return [
      { name: 'Documents', path: RNFS.DocumentDirectoryPath },
      { name: 'Library', path: RNFS.LibraryDirectoryPath },
      { name: 'Cache', path: RNFS.CachesDirectoryPath },
    ];
  }, []);

  const listDirectory = useCallback(async (dirPath) => {
    try {
      const items = await RNFS.readDir(dirPath);
      return items
        // Show all files, not just .json (highlight JSON files differently in UI)
        .filter((f) => f.isDirectory() || 
          f.name.endsWith('.json') || 
          f.name.endsWith('.JSON') ||
          f.name.endsWith('.txt'))  // Also show .txt files (might be renamed JSON)
        .map((f) => ({
          name: f.name,
          path: f.path,
          isDirectory: f.isDirectory(),
          size: f.size || 0,
          isJson: f.name.toLowerCase().endsWith('.json'),
        }))
        .sort((a, b) => {
          // Directories first, then JSON files, then others
          if (a.isDirectory && !b.isDirectory) return -1;
          if (!a.isDirectory && b.isDirectory) return 1;
          if (a.isJson && !b.isJson) return -1;
          if (!a.isJson && b.isJson) return 1;
          return a.name.localeCompare(b.name);
        });
    } catch (e) {
      console.log(`Cannot access directory: ${dirPath}`, e.message);
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

  // Show instructions for copying files to app directory
  const showCopyInstructions = useCallback(() => {
    Alert.alert(
      'How to Load WhatsApp File',
      `📱 For WhatsApp files on Android 11+:\n\n` +
      `EASIEST METHOD:\n` +
      `1. Open WhatsApp\n` +
      `2. Long-press on the JSON file\n` +
      `3. Tap "Share" or ⋮ menu → Share\n` +
      `4. Choose "Files" or "My Files" app\n` +
      `5. Save to "Downloads" folder\n` +
      `6. Come back here and browse Downloads\n\n` +
      `OR use File Manager:\n` +
      `1. Open your file manager app\n` +
      `2. Find the file in WhatsApp folder\n` +
      `3. Copy/Move it to Downloads\n` +
      `4. Browse Downloads here\n\n` +
      `WhatsApp path:\n` +
      `Android/media/com.whatsapp/WhatsApp/Media/WhatsApp Documents/`,
      [{ text: 'OK' }]
    );
  }, []);

  /**
   * Open SYSTEM file picker - can access ANY location (WhatsApp, Downloads, etc.)
   * This is the recommended way to pick files!
   */
  const handleSystemFilePicker = useCallback(async () => {
    try {
      addLog('Opening system file picker...');
      
      // Use the new @react-native-documents/picker API
      const [result] = await pick({
        mode: 'open',
        type: [types.json, types.plainText],
      });
      
      console.log('Selected file:', result);
      addLog(`Selected: ${result.name || 'file'}`);
      
      // Read the file content using the URI
      setLoadingData(true);
      const content = await RNFS.readFile(result.uri, 'utf8');
      const data = JSON.parse(content);
      
      setMappingData(data);
      setSelectedFile({ name: result.name || 'mapping.json', path: result.uri });
      setCurrentPosition(null);
      setTopMatches([]);
      
      addLog(`✅ Loaded: ${data.nodes?.length || 0} nodes, ${data.accessPoints?.length || 0} APs`);
      
      Alert.alert(
        'File Loaded Successfully!',
        `File: ${result.name || 'mapping.json'}\n` +
        `Nodes: ${data.nodes?.length || 0}\n` +
        `Access Points: ${data.accessPoints?.length || 0}`,
        [{ text: 'OK' }]
      );
      
    } catch (err) {
      // Check if user cancelled
      if (err?.message?.includes('cancel') || err?.code === 'DOCUMENT_PICKER_CANCELED') {
        addLog('File selection cancelled');
      } else {
        console.error('File picker error:', err);
        addLog(`Error: ${err.message}`);
        Alert.alert('Error', `Could not load file: ${err.message}`);
      }
    } finally {
      setLoadingData(false);
    }
  }, [addLog]);

  // Keep the old browser as backup option
  const handleOpenFileBrowser = useCallback(async () => {
    // Request storage permission first (Android)
    await requestStoragePermission();
    
    setShowFileBrowser(true);
    
    // Try Downloads first, fall back to app directory if empty/inaccessible
    let startDir = Platform.OS === 'android' 
      ? RNFS.DownloadDirectoryPath 
      : RNFS.DocumentDirectoryPath;
    let startName = 'Downloads';
    
    let contents = await listDirectory(startDir);
    
    // If Downloads is empty or inaccessible, try app's directory
    if (contents.length === 0 && Platform.OS === 'android') {
      startDir = RNFS.DocumentDirectoryPath;
      startName = '📱 App Files';
      contents = await listDirectory(startDir);
      addLog('Downloads empty - showing App Files folder');
      
      // Show hint about copying files
      if (contents.length === 0) {
        showCopyInstructions();
      }
    }
    
    setDirContents(contents);
    setCurrentDir(startDir);
    setBrowsingPath([{ name: startName, path: startDir }]);
    
    const files = await listAllJSONFiles();
    setAvailableFiles(files);
    addLog(`Opened ${startName} (${contents.length} items)`);
  }, [listAllJSONFiles, listDirectory, addLog, showCopyInstructions]);

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

      // Find closest tile using weighted centroid
      const result = findClosestTile(currentRssi, mappingData, { topN: 3, topK: 3 });

      if (result && typeof result.x === 'number' && typeof result.y === 'number' && !isNaN(result.x) && !isNaN(result.y)) {
        // Use FRACTIONAL position for smooth movement
        // But validate it's not on an obstacle
        const validPos = getValidPosition(result.x, result.y, result.topTiles || []);
        
        setCurrentPosition({ x: validPos.x, y: validPos.y });
        setMatchDistance(result.closestDistance?.toFixed(2) || result.distance?.toFixed(2) || 'N/A');
        
        const adjustedMsg = validPos.wasAdjusted ? ' [adjusted - was on obstacle]' : '';
        addLog(`Position: (${validPos.x.toFixed(2)}, ${validPos.y.toFixed(2)})${adjustedMsg} | Dist: ${result.closestDistance?.toFixed(2) || 'N/A'}`);

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
      <Text style={styles.title}>WiFi Positioning (Real-time navigation)</Text>
      <Text style={styles.hint}>
        Load filtered JSON from AP Manager, then scan to detect your position on the office map
      </Text>

      {/* PRIMARY: System File Picker - Works with WhatsApp, Downloads, etc. */}
      <TouchableOpacity
        style={[styles.btn, styles.loadBtn, { backgroundColor: '#4CAF50' }]}
        onPress={handleSystemFilePicker}
        disabled={loadingData}
      >
        {loadingData ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.btnText}>📂 Pick JSON File</Text>
        )}
      </TouchableOpacity>
      
      {/* Alternative: Custom file browser */}
      <TouchableOpacity
        style={[styles.btn, { backgroundColor: '#666', marginTop: 8 }]}
        onPress={handleOpenFileBrowser}
        disabled={loadingData}
      >
        <Text style={[styles.btnText, { fontSize: 12 }]}>Browse App Folders (Backup)</Text>
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

            {/* Action buttons row */}
            <View style={styles.browserActionRow}>
              {/* Back button */}
              {currentDir && (
                <TouchableOpacity style={styles.backBtn} onPress={handleBrowseBack}>
                  <Text style={styles.backBtnText}>← Back</Text>
                </TouchableOpacity>
              )}
              
              {/* Quick access to App Files (always works) */}
              {currentDir && !currentDir.includes('files') && Platform.OS === 'android' && (
                <TouchableOpacity 
                  style={[styles.backBtn, { marginLeft: 8, backgroundColor: '#4CAF50' }]} 
                  onPress={() => handleBrowseDirectory(RNFS.DocumentDirectoryPath, '📱 App Files')}
                >
                  <Text style={styles.backBtnText}>📱 App Files</Text>
                </TouchableOpacity>
              )}
              
              {/* Help button */}
              <TouchableOpacity 
                style={[styles.backBtn, { marginLeft: 'auto', backgroundColor: '#FF9800' }]} 
                onPress={showCopyInstructions}
              >
                <Text style={styles.backBtnText}>❓ Help</Text>
              </TouchableOpacity>
            </View>

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
  browserActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  backBtn: {
    padding: 8,
    paddingHorizontal: 12,
    backgroundColor: '#333',
    borderRadius: 4,
  },
  backBtnText: {
    color: '#fff',
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
