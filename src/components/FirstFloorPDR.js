/**
 * FirstFloorPDR - PDR Navigation with Real Floor Map
 * 
 * Integrates the FirstFloorMap SVG with step detection and navigation
 * SVG viewBox: 0 0 597 370 (approximately)
 * 
 * Assuming building is ~120m x 75m based on typical floor plans
 * Scale: ~5 pixels per meter
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Text,
  Platform,
  ScrollView,
  TextInput,
  FlatList,
} from 'react-native';
import Svg, {
  Circle,
  Line,
  Polyline,
  G,
  Text as SvgText,
  Rect,
} from 'react-native-svg';
import {
  PinchGestureHandler,
  PanGestureHandler,
  State,
} from 'react-native-gesture-handler';
import {
  accelerometer,
  gyroscope,
  setUpdateIntervalForType,
  SensorTypes,
} from 'react-native-sensors';

// Import the floor map
import FirstFloorMap from './FirstFloorMap';

// Map dimensions from SVG viewBox
const SVG_WIDTH = 597;
const SVG_HEIGHT = 370;

// Assumed real-world dimensions (adjust based on actual building)
const BUILDING_WIDTH_M = 120;  // meters
const BUILDING_HEIGHT_M = 75;  // meters

// Calculate scale
const PIXELS_PER_METER = SVG_WIDTH / BUILDING_WIDTH_M; // ~4.97 px/m

// Default starting position - RECEPTION (front desk)
// Based on SVG analysis: reception/front area is around x:408, y:198
const DEFAULT_POSITION = { x: 408, y: 198 };

// ============================================================
// SEARCHABLE LOCATIONS
// These are the destinations users can search for
// Positions based on FirstFloorMap.js SVG coordinates
// ============================================================
const LOCATIONS = [
  // The gymnasium has a visible circle at (441.64, 55.7) in the SVG
  { id: 'gym', name: 'Gymnasium', x: 342, y: 236, category: 'Facility' },
  
  // Reception/front desk area
  { id: 'reception', name: 'Reception', x: 408, y: 198, category: 'Admin' },
  
  // Stairs areas (based on stair graphics in SVG)
  { id: 'stairs_west', name: 'Stairs (West)', x: 270, y: 215, category: 'Utility' },
  { id: 'stairs_east', name: 'Stairs (East)', x: 510, y: 215, category: 'Utility' },
  
  // Meeting rooms (based on rectangular room shapes)
  { id: 'meeting_1', name: 'Meeting Room 1', x: 357, y: 224, category: 'Room' },
  { id: 'meeting_2', name: 'Meeting Room 2', x: 370, y: 224, category: 'Room' },
  
  // Office/work areas
  { id: 'office_block', name: 'Office Block', x: 310, y: 250, category: 'Office' },
  
  // Bottom left area (appears to be entrance/lobby based on SVG)
  { id: 'entrance', name: 'Main Entrance', x: 100, y: 280, category: 'Entry' },
  
  // Parking/outdoor area (bottom right)
  { id: 'parking', name: 'Parking Area', x: 450, y: 300, category: 'Facility' },
];

// ============================================================
// NAVIGATION GRAPH - NODES
// These are waypoints where paths intersect or change direction
// User walks from node to node along edges
// ============================================================
const NODES = {
  // Reception - starting point
  reception: { x: 408, y: 198 },
  
  // Main corridor running horizontally
  corridor_1: { x: 350, y: 198 },
  corridor_2: { x: 300, y: 198 },
  corridor_3: { x: 250, y: 198 },
  
  // Junction going up toward gym
  junction_to_gym: { x: 420, y: 150 },
  
  // Gymnasium location
  gym: { x: 442, y: 56 },
  
  // Stairs
  stairs_west: { x: 270, y: 215 },
  stairs_east: { x: 510, y: 215 },
  
  // Meeting room area
  meeting_area: { x: 365, y: 224 },
  
  // Office block
  office: { x: 310, y: 250 },
  
  // Entrance area
  entrance: { x: 100, y: 280 },
  
  // Path to entrance
  corridor_to_entrance: { x: 200, y: 250 },
};

// ============================================================
// NAVIGATION GRAPH - EDGES
// These define which nodes are connected (walkable paths)
// If there's no edge between two nodes, you cannot walk directly
// ============================================================
const EDGES = [
  // From reception along main corridor
  ['reception', 'corridor_1'],
  ['corridor_1', 'corridor_2'],
  ['corridor_2', 'corridor_3'],
  
  // From reception up to gym
  ['reception', 'junction_to_gym'],
  ['junction_to_gym', 'gym'],
  
  // To stairs
  ['corridor_3', 'stairs_west'],
  ['reception', 'stairs_east'],
  
  // To meeting rooms
  ['corridor_1', 'meeting_area'],
  
  // To office
  ['corridor_2', 'office'],
  
  // To entrance
  ['corridor_3', 'corridor_to_entrance'],
  ['corridor_to_entrance', 'entrance'],
];

// Build adjacency list
const GRAPH = (() => {
  const g = {};
  const dist = (a, b) => Math.sqrt((NODES[a].x - NODES[b].x) ** 2 + (NODES[a].y - NODES[b].y) ** 2);
  const add = (from, to) => {
    if (!g[from]) g[from] = [];
    g[from].push({ id: to, weight: dist(from, to) });
  };
  EDGES.forEach(([a, b]) => {
    add(a, b);
    add(b, a);
  });
  return g;
})();

// Simple Dijkstra for pathfinding
const findPath = (fromPos, toPos) => {
  // Find nearest nodes
  const nearestNode = (pos) => {
    let nearest = null;
    let minDist = Infinity;
    Object.entries(NODES).forEach(([id, node]) => {
      const d = Math.sqrt((pos.x - node.x) ** 2 + (pos.y - node.y) ** 2);
      if (d < minDist) {
        minDist = d;
        nearest = id;
      }
    });
    return nearest;
  };

  const startNode = nearestNode(fromPos);
  const endNode = nearestNode(toPos);

  if (!startNode || !endNode || !GRAPH[startNode]) {
    return [fromPos, toPos]; // Direct line if no path
  }

  // Dijkstra
  const dist = {};
  const prev = {};
  const Q = new Set(Object.keys(NODES));

  Object.keys(NODES).forEach(n => dist[n] = Infinity);
  dist[startNode] = 0;

  while (Q.size > 0) {
    let u = null;
    let minD = Infinity;
    for (const n of Q) {
      if (dist[n] < minD) {
        minD = dist[n];
        u = n;
      }
    }
    if (u === null || u === endNode) break;
    Q.delete(u);

    (GRAPH[u] || []).forEach(({ id: v, weight }) => {
      if (Q.has(v)) {
        const alt = dist[u] + weight;
        if (alt < dist[v]) {
          dist[v] = alt;
          prev[v] = u;
        }
      }
    });
  }

  // Reconstruct path
  const path = [toPos];
  let current = endNode;
  while (current && current !== startNode) {
    path.unshift(NODES[current]);
    current = prev[current];
  }
  if (current === startNode) {
    path.unshift(NODES[startNode]);
  }
  path.unshift(fromPos);

  return path;
};

const FirstFloorPDR = () => {
  // Position & heading
  const [position, setPosition] = useState(DEFAULT_POSITION);
  const [heading, setHeading] = useState(0);
  const [stepCount, setStepCount] = useState(0);
  const [totalDistance, setTotalDistance] = useState(0);
  const [isTracking, setIsTracking] = useState(false);

  // Sensor values
  const [accelMag, setAccelMag] = useState(1.0);
  const [baseline, setBaseline] = useState(1.0);
  const [peakState, setPeakState] = useState('waiting');

  // Search & Navigation
  const [searchQuery, setSearchQuery] = useState('');
  const [destination, setDestination] = useState(null);
  const [showResults, setShowResults] = useState(false);
  
  // UI State
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showGraph, setShowGraph] = useState(false); // Debug: show navigation graph
  
  // Zoom & Pan state
  const [scale, setScale] = useState(1);
  const [translateX, setTranslateX] = useState(0);
  const [translateY, setTranslateY] = useState(0);
  const baseScale = useRef(1);
  const baseTranslateX = useRef(0);
  const baseTranslateY = useRef(0);

  // Configuration
  const [stepLength] = useState(0.7);

  // Refs
  const subsRef = useRef([]);
  const posRef = useRef(DEFAULT_POSITION);
  const headingRef = useRef(0);
  const lastStepTimeRef = useRef(0);
  const magHistoryRef = useRef([]);
  const lastGyroTimeRef = useRef(null);
  const peakStateRef = useRef('waiting');
  const currentPeakRef = useRef(0);
  const baselineRef = useRef(1.0);

  // Debug log
  const [log, setLog] = useState([]);
  const logRef = useRef([]);

  const addLog = useCallback((msg) => {
    const t = new Date().toLocaleTimeString();
    logRef.current = [`[${t}] ${msg}`, ...logRef.current.slice(0, 29)];
    setLog([...logRef.current]);
  }, []);

  // Initial log message
  useEffect(() => {
    addLog('Starting at Reception. Search for a location to navigate.');
  }, [addLog]);

  // Search results
  const searchResults = searchQuery.length > 0
    ? LOCATIONS.filter(loc =>
        loc.name.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : [];

  // Calculate path to destination
  const pathPoints = destination
    ? findPath(position, { x: destination.x, y: destination.y })
    : [];
  
  const pathString = pathPoints.length > 1
    ? pathPoints.map(p => `${p.x},${p.y}`).join(' ')
    : '';

  // Distance to destination
  const distanceToDestination = destination
    ? Math.sqrt((position.x - destination.x) ** 2 + (position.y - destination.y) ** 2) / PIXELS_PER_METER
    : 0;

  // Start tracking
  const startTracking = useCallback(() => {
    if (isTracking) return;

    addLog('Starting sensors...');

    try {
      setUpdateIntervalForType(SensorTypes.accelerometer, 30);
      setUpdateIntervalForType(SensorTypes.gyroscope, 30);
    } catch (e) {
      addLog(`Interval error: ${e}`);
    }

    posRef.current = { ...position };
    headingRef.current = heading;
    lastStepTimeRef.current = Date.now();
    magHistoryRef.current = [];
    lastGyroTimeRef.current = null;
    peakStateRef.current = 'waiting';
    currentPeakRef.current = 0;
    baselineRef.current = 1.0;

    const subs = [];

    // Accelerometer - Step detection
    try {
      const sub = accelerometer.subscribe({
        next: (data) => {
          const mag = Math.sqrt(data.x ** 2 + data.y ** 2 + data.z ** 2) / 9.81;
          setAccelMag(mag);

          magHistoryRef.current.push(mag);
          if (magHistoryRef.current.length > 50) magHistoryRef.current.shift();

          const history = magHistoryRef.current;
          const baselineVal = history.reduce((a, b) => a + b, 0) / history.length;
          baselineRef.current = baselineVal;
          setBaseline(baselineVal);

          const now = Date.now();
          const timeSinceStep = now - lastStepTimeRef.current;

          const PEAK_THRESHOLD = 0.15;
          const MIN_PEAK_HEIGHT = 1.1;
          const COOLDOWN_MS = 400;

          const state = peakStateRef.current;

          if (state === 'waiting') {
            if (mag > baselineVal + PEAK_THRESHOLD && mag > MIN_PEAK_HEIGHT) {
              peakStateRef.current = 'rising';
              currentPeakRef.current = mag;
              setPeakState('rising');
            }
          } else if (state === 'rising') {
            if (mag > currentPeakRef.current) {
              currentPeakRef.current = mag;
            } else if (mag < currentPeakRef.current - 0.05) {
              peakStateRef.current = 'falling';
              setPeakState('falling');
            }
          } else if (state === 'falling') {
            if (mag < baselineVal + 0.05) {
              const peakHeight = currentPeakRef.current - baselineVal;

              if (peakHeight >= PEAK_THRESHOLD && timeSinceStep >= COOLDOWN_MS) {
                lastStepTimeRef.current = now;

                const stepPx = stepLength * PIXELS_PER_METER;
                const h = headingRef.current;
                const dx = stepPx * Math.sin(h);
                const dy = -stepPx * Math.cos(h);

                posRef.current = {
                  x: Math.max(10, Math.min(SVG_WIDTH - 10, posRef.current.x + dx)),
                  y: Math.max(10, Math.min(SVG_HEIGHT - 10, posRef.current.y + dy)),
                };

                setPosition({ ...posRef.current });
                setStepCount(prev => prev + 1);
                setTotalDistance(prev => prev + stepLength);

                addLog(`STEP! → (${posRef.current.x.toFixed(0)}, ${posRef.current.y.toFixed(0)})`);
              }

              peakStateRef.current = 'waiting';
              currentPeakRef.current = 0;
              setPeakState('waiting');
            }
          }
        },
        error: (e) => addLog(`Accel err: ${e}`),
      });
      subs.push(sub);
      addLog('Accelerometer OK');
    } catch (e) {
      addLog(`Accel failed: ${e}`);
    }

    // Gyroscope - Heading
    try {
      const sub = gyroscope.subscribe({
        next: (data) => {
          const now = Date.now();
          if (lastGyroTimeRef.current !== null) {
            const dt = (now - lastGyroTimeRef.current) / 1000;
            headingRef.current -= data.z * dt;

            while (headingRef.current < 0) headingRef.current += 2 * Math.PI;
            while (headingRef.current >= 2 * Math.PI) headingRef.current -= 2 * Math.PI;

            setHeading(headingRef.current);
          }
          lastGyroTimeRef.current = now;
        },
        error: (e) => addLog(`Gyro err: ${e}`),
      });
      subs.push(sub);
      addLog('Gyroscope OK');
    } catch (e) {
      addLog(`Gyro failed: ${e}`);
    }

    subsRef.current = subs;
    setIsTracking(true);
    addLog('TRACKING STARTED');
  }, [isTracking, position, heading, stepLength, addLog]);

  // Stop tracking
  const stopTracking = useCallback(() => {
    subsRef.current.forEach(s => { try { s.unsubscribe(); } catch (e) {} });
    subsRef.current = [];
    setIsTracking(false);
    addLog('Stopped');
  }, [addLog]);

  // Reset
  const reset = useCallback(() => {
    stopTracking();
    setPosition(DEFAULT_POSITION);
    posRef.current = DEFAULT_POSITION;
    setHeading(0);
    headingRef.current = 0;
    setStepCount(0);
    setTotalDistance(0);
    setDestination(null);
    setSearchQuery('');
    logRef.current = [];
    setLog([]);
    addLog('Reset');
  }, [stopTracking, addLog]);

  // Cleanup
  useEffect(() => {
    return () => {
      subsRef.current.forEach(s => { try { s.unsubscribe(); } catch (e) {} });
    };
  }, []);

  // Set heading manually
  const setDir = useCallback((deg) => {
    const rad = (deg * Math.PI) / 180;
    setHeading(rad);
    headingRef.current = rad;
    addLog(`Heading → ${deg}°`);
  }, [addLog]);

  // Select destination
  const selectDestination = useCallback((loc) => {
    setDestination(loc);
    setSearchQuery(loc.name);
    setShowResults(false);
    addLog(`Navigate to: ${loc.name}`);
  }, [addLog]);

  // Pinch to zoom handler
  const onPinchGestureEvent = useCallback((event) => {
    const newScale = baseScale.current * event.nativeEvent.scale;
    setScale(Math.max(0.5, Math.min(newScale, 5))); // Limit zoom: 0.5x to 5x
  }, []);

  const onPinchHandlerStateChange = useCallback((event) => {
    if (event.nativeEvent.oldState === State.ACTIVE) {
      baseScale.current = scale;
    }
  }, [scale]);

  // Pan gesture handler
  const onPanGestureEvent = useCallback((event) => {
    setTranslateX(baseTranslateX.current + event.nativeEvent.translationX);
    setTranslateY(baseTranslateY.current + event.nativeEvent.translationY);
  }, []);

  const onPanHandlerStateChange = useCallback((event) => {
    if (event.nativeEvent.oldState === State.ACTIVE) {
      baseTranslateX.current = translateX;
      baseTranslateY.current = translateY;
    }
  }, [translateX, translateY]);

  // Reset zoom
  const resetZoom = useCallback(() => {
    setScale(1);
    setTranslateX(0);
    setTranslateY(0);
    baseScale.current = 1;
    baseTranslateX.current = 0;
    baseTranslateY.current = 0;
  }, []);

  // Center on user position
  const centerOnUser = useCallback(() => {
    // Calculate translation to center on user
    const centerX = SVG_WIDTH / 2;
    const centerY = SVG_HEIGHT / 2;
    const dx = (centerX - position.x) * scale;
    const dy = (centerY - position.y) * scale;
    setTranslateX(dx);
    setTranslateY(dy);
    baseTranslateX.current = dx;
    baseTranslateY.current = dy;
  }, [position, scale]);

  // Arrow for direction
  const headingDeg = (heading * 180) / Math.PI;
  const arrowLen = 15;
  const angle = heading - Math.PI / 2;
  const tipX = position.x + arrowLen * Math.cos(angle);
  const tipY = position.y + arrowLen * Math.sin(angle);

  // Position in meters
  const posMetersX = (position.x / PIXELS_PER_METER).toFixed(1);
  const posMetersY = (position.y / PIXELS_PER_METER).toFixed(1);

  return (
    <View style={styles.container}>
      {/* Compact Header - always visible */}
      {!isFullscreen && (
        <>
          <View style={styles.header}>
            <Text style={styles.title}>
              {isTracking ? '🟢' : '⚪'} Steps: {stepCount} | {totalDistance.toFixed(1)}m | {headingDeg.toFixed(0)}°
              {destination && ` → ${destination.name}`}
            </Text>
          </View>

          {/* Search Bar */}
          <View style={styles.searchContainer}>
            <TextInput
              style={styles.searchInput}
              placeholder="Search location..."
              placeholderTextColor="#888"
              value={searchQuery}
              onChangeText={(text) => {
            setSearchQuery(text);
            setShowResults(text.length > 0);
          }}
          onFocus={() => setShowResults(searchQuery.length > 0)}
        />
        {destination && (
          <TouchableOpacity
            style={styles.clearBtn}
            onPress={() => {
              setDestination(null);
              setSearchQuery('');
            }}
          >
            <Text style={styles.clearBtnText}>✕</Text>
          </TouchableOpacity>
          )}
          </View>

          {/* Search Results */}
          {showResults && searchResults.length > 0 && (
            <View style={styles.resultsContainer}>
              <FlatList
                data={searchResults}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.resultItem}
                    onPress={() => selectDestination(item)}
                  >
                    <Text style={styles.resultName}>{item.name}</Text>
                    <Text style={styles.resultCategory}>{item.category}</Text>
                  </TouchableOpacity>
                )}
              />
            </View>
          )}

          {/* Compact Controls Row */}
          <View style={styles.controlsRow}>
            {!isTracking ? (
              <TouchableOpacity style={[styles.btn, styles.startBtn]} onPress={startTracking}>
                <Text style={styles.btnText}>START</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={[styles.btn, styles.stopBtn]} onPress={stopTracking}>
                <Text style={styles.btnText}>STOP</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={styles.btn} onPress={reset}>
              <Text style={styles.btnText}>RESET</Text>
            </TouchableOpacity>
            {[0, 90, 180, 270].map(d => (
              <TouchableOpacity key={d} style={styles.dirBtn} onPress={() => setDir(d)}>
                <Text style={styles.dirBtnText}>
                  {d === 0 ? '↑' : d === 90 ? '→' : d === 180 ? '↓' : '←'}
                </Text>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.fullscreenBtn} onPress={() => setIsFullscreen(true)}>
              <Text style={styles.dirBtnText}>⛶</Text>
            </TouchableOpacity>
            <TouchableOpacity 
              style={[styles.graphBtn, showGraph && styles.graphBtnActive]} 
              onPress={() => setShowGraph(!showGraph)}
            >
              <Text style={styles.dirBtnText}>🗺</Text>
            </TouchableOpacity>
          </View>
        </>
      )}

      {/* Map Container - Full width with zoom/pan */}
      <View style={[styles.mapContainer, isFullscreen && styles.mapFullscreen]}>
        <PanGestureHandler
          onGestureEvent={onPanGestureEvent}
          onHandlerStateChange={onPanHandlerStateChange}
        >
          <PinchGestureHandler
            onGestureEvent={onPinchGestureEvent}
            onHandlerStateChange={onPinchHandlerStateChange}
          >
            <View style={styles.mapInner}>
              <Svg
                width="100%"
                height="100%"
                viewBox={`0 0 ${SVG_WIDTH} ${SVG_HEIGHT}`}
                preserveAspectRatio="xMidYMid slice"
              >
                {/* Transform group for zoom/pan */}
                <G
                  transform={`translate(${translateX / scale}, ${translateY / scale}) scale(${scale})`}
                  origin={`${SVG_WIDTH / 2}, ${SVG_HEIGHT / 2}`}
                >
                  {/* Floor Map as background */}
                  <G>
                    <FirstFloorMap width={SVG_WIDTH} height={SVG_HEIGHT} />
                  </G>

                  {/* DEBUG: Show navigation graph (edges and nodes) */}
                  {showGraph && (
                    <G>
                      {/* Draw all edges (walkable paths) */}
                      {EDGES.map(([from, to], i) => (
                        <Line
                          key={`edge-${i}`}
                          x1={NODES[from].x}
                          y1={NODES[from].y}
                          x2={NODES[to].x}
                          y2={NODES[to].y}
                          stroke="#FFD700"
                          strokeWidth={3 / scale}
                          strokeDasharray={`${6 / scale},${3 / scale}`}
                          opacity={0.8}
                        />
                      ))}
                      {/* Draw all nodes (waypoints) */}
                      {Object.entries(NODES).map(([id, node]) => (
                        <G key={`node-${id}`}>
                          <Circle
                            cx={node.x}
                            cy={node.y}
                            r={8 / scale}
                            fill="#FFD700"
                            stroke="#000"
                            strokeWidth={1 / scale}
                          />
                          <Rect
                            x={node.x + 10 / scale}
                            y={node.y - 6 / scale}
                            width={id.length * 5 / scale}
                            height={12 / scale}
                            fill="rgba(0,0,0,0.7)"
                            rx={2 / scale}
                          />
                          <SvgText
                            x={node.x + 12 / scale}
                            y={node.y + 3 / scale}
                            fontSize={8 / scale}
                            fill="#FFD700"
                            fontWeight="bold"
                          >
                            {id}
                          </SvgText>
                        </G>
                      ))}
                      {/* Draw all searchable locations */}
                      {LOCATIONS.map((loc) => (
                        <G key={`loc-${loc.id}`}>
                          <Circle
                            cx={loc.x}
                            cy={loc.y}
                            r={5 / scale}
                            fill="#FF69B4"
                            stroke="#fff"
                            strokeWidth={1 / scale}
                          />
                        </G>
                      ))}
                    </G>
                  )}

                  {/* Navigation Path */}
                  {pathString && (
                    <Polyline
                      points={pathString}
                      fill="none"
                      stroke="#00ff88"
                      strokeWidth={4 / scale}
                      strokeDasharray={`${8 / scale},${4 / scale}`}
                      opacity={0.8}
                    />
                  )}

                  {/* Destination Marker */}
                  {destination && (
                    <>
                      <Circle cx={destination.x} cy={destination.y} r={12 / scale} fill="rgba(255,59,48,0.3)" />
                      <Circle cx={destination.x} cy={destination.y} r={6 / scale} fill="#FF3B30" />
                    </>
                  )}

                  {/* Direction Arrow */}
                  <Line
                    x1={position.x}
                    y1={position.y}
                    x2={tipX}
                    y2={tipY}
                    stroke="#FF3B30"
                    strokeWidth={3 / scale}
                    strokeLinecap="round"
                  />

                  {/* User Position */}
                  <Circle cx={position.x} cy={position.y} r={12 / scale} fill="rgba(0,122,255,0.3)" />
                  <Circle cx={position.x} cy={position.y} r={6 / scale} fill="#007AFF" stroke="#fff" strokeWidth={2 / scale} />
                </G>
              </Svg>
            </View>
          </PinchGestureHandler>
        </PanGestureHandler>

        {/* Zoom controls */}
        <View style={styles.zoomControls}>
          <TouchableOpacity style={styles.zoomBtn} onPress={() => setScale(s => Math.min(5, s * 1.5))}>
            <Text style={styles.zoomBtnText}>+</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.zoomBtn} onPress={() => setScale(s => Math.max(0.5, s / 1.5))}>
            <Text style={styles.zoomBtnText}>−</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.zoomBtn} onPress={resetZoom}>
            <Text style={styles.zoomBtnText}>⟲</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.zoomBtn} onPress={centerOnUser}>
            <Text style={styles.zoomBtnText}>◎</Text>
          </TouchableOpacity>
        </View>

        {/* Zoom level indicator */}
        <View style={styles.zoomIndicator}>
          <Text style={styles.zoomText}>{scale.toFixed(1)}x</Text>
        </View>

        {/* Fullscreen overlay controls */}
        {isFullscreen && (
          <View style={styles.fullscreenOverlay}>
            <View style={styles.overlayHeader}>
              <Text style={styles.overlayStats}>
                {isTracking ? '🟢' : '⚪'} {stepCount} steps | {totalDistance.toFixed(1)}m | {headingDeg.toFixed(0)}°
                {destination && ` | To: ${distanceToDestination.toFixed(0)}m`}
              </Text>
              <TouchableOpacity style={styles.closeBtn} onPress={() => setIsFullscreen(false)}>
                <Text style={styles.closeBtnText}>✕</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.overlayControls}>
              {!isTracking ? (
                <TouchableOpacity style={[styles.overlayBtn, styles.startBtn]} onPress={startTracking}>
                  <Text style={styles.btnText}>START</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity style={[styles.overlayBtn, styles.stopBtn]} onPress={stopTracking}>
                  <Text style={styles.btnText}>STOP</Text>
                </TouchableOpacity>
              )}
              {[0, 90, 180, 270].map(d => (
                <TouchableOpacity key={d} style={styles.overlayDirBtn} onPress={() => setDir(d)}>
                  <Text style={styles.overlayDirText}>
                    {d === 0 ? '↑N' : d === 90 ? '→E' : d === 180 ? '↓S' : '←W'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        )}
      </View>

      {/* Debug Log - only when not fullscreen */}
      {!isFullscreen && (
        <View style={styles.logContainer}>
          <ScrollView style={styles.logScroll} nestedScrollEnabled>
            {log.map((entry, i) => (
              <Text key={i} style={styles.logEntry}>{entry}</Text>
            ))}
          </ScrollView>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  header: { backgroundColor: '#16213e', padding: 4, paddingTop: Platform.OS === 'ios' ? 44 : 4 },
  title: { color: '#00ff88', fontSize: 12, fontWeight: 'bold', textAlign: 'center' },
  
  searchContainer: { flexDirection: 'row', padding: 4, backgroundColor: '#0f3460' },
  searchInput: { flex: 1, backgroundColor: '#1a1a2e', color: '#fff', paddingHorizontal: 10, paddingVertical: 5, borderRadius: 6, fontSize: 12 },
  clearBtn: { backgroundColor: '#ff3b30', paddingHorizontal: 8, marginLeft: 4, borderRadius: 6, justifyContent: 'center' },
  clearBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 11 },
  
  resultsContainer: { maxHeight: 100, backgroundColor: '#16213e', borderBottomWidth: 1, borderBottomColor: '#333' },
  resultItem: { flexDirection: 'row', justifyContent: 'space-between', padding: 8, borderBottomWidth: 1, borderBottomColor: '#333' },
  resultName: { color: '#fff', fontSize: 12 },
  resultCategory: { color: '#888', fontSize: 10 },
  
  // Compact controls row
  controlsRow: { flexDirection: 'row', padding: 3, backgroundColor: '#0f3460', alignItems: 'center' },
  btn: { paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#4a69bd', borderRadius: 5, marginHorizontal: 2 },
  startBtn: { backgroundColor: '#00ff88' },
  stopBtn: { backgroundColor: '#ff3b30' },
  btnText: { color: '#1a1a2e', fontSize: 11, fontWeight: 'bold' },
  dirBtn: { backgroundColor: '#533483', paddingHorizontal: 8, paddingVertical: 6, borderRadius: 5, marginHorizontal: 1 },
  dirBtnText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  fullscreenBtn: { backgroundColor: '#007AFF', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 5, marginLeft: 4 },
  graphBtn: { backgroundColor: '#FFD700', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 5, marginLeft: 2 },
  graphBtnActive: { backgroundColor: '#FF6B6B' },
  
  // Map container - takes remaining space
  mapContainer: { flex: 1, backgroundColor: '#661813', margin: 0, overflow: 'hidden' },
  mapFullscreen: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 100 },
  mapInner: { flex: 1 },
  
  // Zoom controls
  zoomControls: {
    position: 'absolute', right: 10, top: '50%', marginTop: -80,
    backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 8, padding: 4,
  },
  zoomBtn: {
    width: 36, height: 36, backgroundColor: 'rgba(255,255,255,0.2)',
    borderRadius: 6, marginVertical: 2, justifyContent: 'center', alignItems: 'center',
  },
  zoomBtnText: { color: '#fff', fontSize: 20, fontWeight: 'bold' },
  zoomIndicator: {
    position: 'absolute', left: 10, bottom: 10,
    backgroundColor: 'rgba(0,0,0,0.6)', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4,
  },
  zoomText: { color: '#fff', fontSize: 11, fontWeight: 'bold' },
  
  // Fullscreen overlay controls
  fullscreenOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  overlayHeader: { 
    position: 'absolute', top: Platform.OS === 'ios' ? 44 : 10, left: 10, right: 10,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)', padding: 8, borderRadius: 8 
  },
  overlayStats: { color: '#fff', fontSize: 12, fontWeight: 'bold' },
  closeBtn: { backgroundColor: '#ff3b30', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6 },
  closeBtnText: { color: '#fff', fontWeight: 'bold', fontSize: 14 },
  overlayControls: { 
    position: 'absolute', bottom: 20, left: 10, right: 10,
    flexDirection: 'row', justifyContent: 'center', alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)', padding: 10, borderRadius: 8 
  },
  overlayBtn: { paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8, marginHorizontal: 4 },
  overlayDirBtn: { backgroundColor: '#533483', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 8, marginHorizontal: 2 },
  overlayDirText: { color: '#fff', fontSize: 14, fontWeight: 'bold' },
  
  // Debug log
  logContainer: { backgroundColor: '#1a1a2e', maxHeight: 40, borderTopWidth: 1, borderTopColor: '#333' },
  logScroll: { padding: 2 },
  logEntry: { color: '#888', fontSize: 8, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
});

export default FirstFloorPDR;
