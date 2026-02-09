/**
 * Office map in tile/grid format with real-time PDR.
 * - White = walkable, Black = obstacle, Light red = blocked
 * - Steps, direction, distance (ft) in header/sensor panel (same as TestRoom)
 * - Tap walkable tile: 1st = start, 2nd = destination → path shown
 * - Blue dot = current PDR position; red arrow = heading
 */

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { View, StyleSheet, Text, TouchableOpacity, Platform, ScrollView } from 'react-native';
import Svg, { Rect, G, Circle, Polyline, Line } from 'react-native-svg';
import {
  TILE,
  TILE_SIZE,
  COLS,
  ROWS,
  MAP_WIDTH,
  MAP_HEIGHT,
  OFFICE_GRID,
  toMap,
  toGrid,
  isWalkable,
  snapToWalkable,
} from '../data/officeGridData';
import { getGridPathFromTo } from '../utils/gridPathfinding';
import { accelerometer, gyroscope, setUpdateIntervalForType, SensorTypes } from 'react-native-sensors';
import { requestLocationPermission, getDeviceLocation, deviceCoordsToMapPixels } from '../utils/locationService';

const TILE_COLORS = {
  [TILE.WALKABLE]: '#ffffff',
  [TILE.OBSTACLE]: '#333333',
  [TILE.BLOCKED]: '#ffb3b3',
};

// Office scale: 18 ft x 36 ft
const PIXELS_PER_FOOT = MAP_WIDTH / 18;

function getDefaultPosition() {
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (OFFICE_GRID[r][c] === TILE.WALKABLE) {
        return toMap(c, r);
      }
    }
  }
  return { x: MAP_WIDTH / 2, y: MAP_HEIGHT / 2 };
}

const DEFAULT_POSITION = getDefaultPosition();

export default function OfficeMap() {
  const [start, setStart] = useState(null);
  const [destination, setDestination] = useState(null);
  const [layout, setLayout] = useState({ width: MAP_WIDTH, height: MAP_HEIGHT });

  // PDR state (same as TestRoom)
  const [position, setPosition] = useState(DEFAULT_POSITION);
  const [heading, setHeading] = useState(0);
  const [stepCount, setStepCount] = useState(0);
  const [totalDistance, setTotalDistance] = useState(0);
  const [isTracking, setIsTracking] = useState(false);
  const [accelMag, setAccelMag] = useState(1.0);
  const [gyroZ, setGyroZ] = useState(0);
  const [minMag, setMinMag] = useState(1.0);
  const [maxMag, setMaxMag] = useState(1.0);
  const [baseline, setBaseline] = useState(1.0);
  const [peakState, setPeakState] = useState('waiting');

  const stepLength = 2.3; // feet (~0.7 m)
  const subsRef = useRef([]);
  const posRef = useRef({ ...DEFAULT_POSITION });
  const headingRef = useRef(0);
  const lastStepTimeRef = useRef(0);
  const magHistoryRef = useRef([]);
  const lastGyroTimeRef = useRef(null);
  const peakStateRef = useRef('waiting');
  const currentPeakRef = useRef(0);
  const baselineRef = useRef(1.0);
  const [log, setLog] = useState([]);
  const logRef = useRef([]);
  const [locationLoading, setLocationLoading] = useState(false);
  const [locationError, setLocationError] = useState(null);

  const addLog = useCallback((msg) => {
    const t = new Date().toLocaleTimeString();
    logRef.current = [`[${t}] ${msg}`, ...logRef.current.slice(0, 49)];
    setLog([...logRef.current]);
  }, []);

  const pathPoints = useMemo(() => {
    const from = isTracking ? position : start;
    if (!from || !destination) return [];
    return getGridPathFromTo(OFFICE_GRID, from.x, from.y, destination.x, destination.y);
  }, [start, destination, position, isTracking]);

  const pathPointsString = pathPoints.length > 0
    ? pathPoints.map(p => `${p.x},${p.y}`).join(' ')
    : '';

  const handleTap = useCallback((event) => {
    const { locationX, locationY } = event.nativeEvent;
    if (locationX == null || locationY == null || layout.width <= 0 || layout.height <= 0) return;
    const scale = Math.min(layout.width / MAP_WIDTH, layout.height / MAP_HEIGHT);
    const offsetX = (layout.width - MAP_WIDTH * scale) / 2;
    const offsetY = (layout.height - MAP_HEIGHT * scale) / 2;
    const viewX = (locationX - offsetX) / scale;
    const viewY = (locationY - offsetY) / scale;
    const col = Math.floor(viewX / TILE_SIZE);
    const row = Math.floor(viewY / TILE_SIZE);
    if (col < 0 || col >= COLS || row < 0 || row >= ROWS) return;
    if (OFFICE_GRID[row][col] !== TILE.WALKABLE) return;
    const { x, y } = toMap(col, row);
    if (!start) {
      setStart({ x, y });
      setPosition({ x, y });
      posRef.current = { x, y };
      setDestination(null);
    } else if (!destination) {
      setDestination({ x, y });
    } else {
      setStart({ x, y });
      setPosition({ x, y });
      posRef.current = { x, y };
      setDestination(null);
    }
  }, [start, destination, layout]);

  const onLayout = useCallback((e) => {
    const { width, height } = e.nativeEvent.layout;
    if (width > 0 && height > 0) setLayout({ width, height });
  }, []);

  const clearPath = () => {
    setStart(null);
    setDestination(null);
  };

  const useDeviceLocation = useCallback(async () => {
    if (isTracking || locationLoading) return;
    setLocationLoading(true);
    setLocationError(null);
    addLog('Fetching GPS location...');
    try {
      const granted = await requestLocationPermission();
      if (!granted) {
        setLocationError('Location permission denied');
        addLog('Location permission denied');
        return;
      }
      const loc = await getDeviceLocation();
      if (loc.error) {
        setLocationError(loc.error);
        addLog(`GPS error: ${loc.error}`);
        return;
      }
      const gpsMap = deviceCoordsToMapPixels(loc.lat, loc.lon);
      addLog(`GPS → map (${gpsMap.x.toFixed(0)}, ${gpsMap.y.toFixed(0)}) acc=${loc.accuracy != null ? loc.accuracy.toFixed(0) : '?'}m`);
      const snapped = snapToWalkable(OFFICE_GRID, gpsMap.x, gpsMap.y);
      setPosition(snapped);
      posRef.current = { ...snapped };
      setLocationError(null);
      addLog(`Position set to (${(snapped.x / PIXELS_PER_FOOT).toFixed(1)}, ${(snapped.y / PIXELS_PER_FOOT).toFixed(1)}) ft`);
    } catch (e) {
      setLocationError(e?.message || 'Location failed');
      addLog(`Error: ${e?.message || e}`);
    } finally {
      setLocationLoading(false);
    }
  }, [isTracking, locationLoading, addLog]);

  const startTracking = useCallback(() => {
    if (isTracking) return;
    addLog('Starting PDR...');
    try {
      setUpdateIntervalForType(SensorTypes.accelerometer, 30);
      setUpdateIntervalForType(SensorTypes.gyroscope, 30);
    } catch (e) {
      addLog(`Interval error: ${e}`);
    }
    // Start from tapped start position if set, otherwise current position
    const startPos = start ? { ...start } : { ...position };
    posRef.current = startPos;
    setPosition(startPos);
    headingRef.current = heading;
    lastStepTimeRef.current = Date.now();
    magHistoryRef.current = [];
    lastGyroTimeRef.current = null;
    peakStateRef.current = 'waiting';
    currentPeakRef.current = 0;
    baselineRef.current = 1.0;

    const subs = [];
    try {
      const subAcc = accelerometer.subscribe({
        next: (data) => {
          const mag = Math.sqrt(data.x ** 2 + data.y ** 2 + data.z ** 2) / 9.81;
          setAccelMag(mag);
          magHistoryRef.current.push(mag);
          if (magHistoryRef.current.length > 50) magHistoryRef.current.shift();
          setMinMag(prev => Math.min(prev, mag));
          setMaxMag(prev => Math.max(prev, mag));
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
            if (mag > currentPeakRef.current) currentPeakRef.current = mag;
            else if (mag < currentPeakRef.current - 0.05) {
              peakStateRef.current = 'falling';
              setPeakState('falling');
            }
          } else if (state === 'falling') {
            if (mag < baselineVal + 0.05) {
              const peakHeight = currentPeakRef.current - baselineVal;
              if (peakHeight >= PEAK_THRESHOLD && timeSinceStep >= COOLDOWN_MS) {
                lastStepTimeRef.current = now;
                const stepPx = stepLength * PIXELS_PER_FOOT;
                const h = headingRef.current;
                const dx = stepPx * Math.sin(h);
                const dy = -stepPx * Math.cos(h);
                let nx = posRef.current.x + dx;
                let ny = posRef.current.y + dy;
                nx = Math.max(TILE_SIZE / 2, Math.min(MAP_WIDTH - TILE_SIZE / 2, nx));
                ny = Math.max(TILE_SIZE / 2, Math.min(MAP_HEIGHT - TILE_SIZE / 2, ny));
                const { col, row } = toGrid(nx, ny);
                if (!isWalkable(OFFICE_GRID, col, row)) {
                  nx = posRef.current.x;
                  ny = posRef.current.y;
                }
                posRef.current = { x: nx, y: ny };
                setPosition({ ...posRef.current });
                setStepCount(prev => prev + 1);
                setTotalDistance(prev => prev + stepLength);
                addLog(`STEP ${stepCount + 1} peak=${currentPeakRef.current.toFixed(2)}g`);
              }
              peakStateRef.current = 'waiting';
              currentPeakRef.current = 0;
              setPeakState('waiting');
            }
          }
        },
        error: (e) => addLog(`Accel err: ${e}`),
      });
      subs.push(subAcc);
    } catch (e) {
      addLog(`Accel failed: ${e}`);
    }

    try {
      const subGyro = gyroscope.subscribe({
        next: (data) => {
          setGyroZ(data.z);
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
      subs.push(subGyro);
    } catch (e) {
      addLog(`Gyro failed: ${e}`);
    }

    subsRef.current = subs;
    setIsTracking(true);
    addLog('TRACKING STARTED');
  }, [isTracking, start, position, heading, stepCount, addLog]);

  const stopTracking = useCallback(() => {
    subsRef.current.forEach(s => { try { s.unsubscribe(); } catch (e) {} });
    subsRef.current = [];
    setIsTracking(false);
    addLog('Stopped');
  }, [addLog]);

  const reset = useCallback(() => {
    stopTracking();
    setPosition(DEFAULT_POSITION);
    posRef.current = { ...DEFAULT_POSITION };
    setHeading(0);
    headingRef.current = 0;
    setStepCount(0);
    setTotalDistance(0);
    setMinMag(1.0);
    setMaxMag(1.0);
    logRef.current = [];
    setLog([]);
    addLog('Reset');
  }, [stopTracking, addLog]);

  const setDir = useCallback((deg) => {
    const rad = (deg * Math.PI) / 180;
    setHeading(rad);
    headingRef.current = rad;
    addLog(`Heading → ${deg}°`);
  }, [addLog]);

  useEffect(() => {
    return () => {
      subsRef.current.forEach(s => { try { s.unsubscribe(); } catch (e) {} });
    };
  }, []);

  const headingDeg = (heading * 180) / Math.PI;
  const arrowLen = 28;
  const angle = heading - Math.PI / 2;
  const tipX = position.x + arrowLen * Math.cos(angle);
  const tipY = position.y + arrowLen * Math.sin(angle);

  return (
    <View style={styles.container}>
      {/* Header - same as TestRoom: steps, distance, heading */}
      <View style={styles.header}>
        <Text style={styles.title}>{isTracking ? '🟢 TRACKING' : '⚪ STOPPED'}</Text>
        <Text style={styles.stats}>
          Steps: {stepCount} | Distance: {totalDistance.toFixed(1)} ft | Heading: {headingDeg.toFixed(0)}°
        </Text>
        <Text style={styles.stats}>
          Position: ({(position.x / PIXELS_PER_FOOT).toFixed(1)} ft, {(position.y / PIXELS_PER_FOOT).toFixed(1)} ft)
        </Text>
      </View>

      {/* Sensor row - accel state, gyro, steps */}
      <View style={styles.sensorRow}>
        <View style={[
          styles.sensorBox,
          peakState === 'rising' && styles.sensorRising,
          peakState === 'falling' && styles.sensorFalling,
        ]}>
          <Text style={styles.sensorLabel}>ACCEL ({peakState})</Text>
          <Text style={styles.sensorValue}>{accelMag.toFixed(3)}g</Text>
          <Text style={styles.sensorSub}>base:{baseline.toFixed(2)}</Text>
        </View>
        <View style={styles.sensorBox}>
          <Text style={styles.sensorLabel}>GYRO</Text>
          <Text style={styles.sensorValue}>{gyroZ.toFixed(2)}</Text>
          <Text style={styles.sensorSub}>Δ{(maxMag - minMag).toFixed(2)}g</Text>
        </View>
        <View style={styles.sensorBox}>
          <Text style={styles.sensorLabel}>STEPS</Text>
          <Text style={[styles.sensorValue, styles.stepsValue]}>{stepCount}</Text>
          <Text style={styles.sensorSub}>{totalDistance.toFixed(1)} ft</Text>
        </View>
      </View>

      {/* Controls */}
      <View style={styles.controls}>
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
        <TouchableOpacity
          style={[styles.btn, styles.locationBtn, locationLoading && styles.btnDisabled]}
          onPress={useDeviceLocation}
          disabled={locationLoading || isTracking}
        >
          <Text style={styles.btnText}>{locationLoading ? '…' : '📍 Location'}</Text>
        </TouchableOpacity>
      </View>
      {locationError ? (
        <Text style={styles.errorText}>{locationError}</Text>
      ) : null}

      {/* Direction buttons */}
      <View style={styles.headingRow}>
        <Text style={styles.headingLabel}>Direction:</Text>
        {[0, 90, 180, 270].map(d => (
          <TouchableOpacity key={d} style={styles.dirBtn} onPress={() => setDir(d)}>
            <Text style={styles.dirBtnText}>{d === 0 ? '↑' : d === 90 ? '→' : d === 180 ? '↓' : '←'} {d}°</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Legend + Clear path */}
      <View style={styles.legend}>
        <View style={styles.legendRow}>
          <View style={[styles.legendSwatch, styles.legendSwatchBorder, { backgroundColor: TILE_COLORS[TILE.WALKABLE] }]} />
          <Text style={styles.legendText}>Walkable</Text>
        </View>
        <View style={styles.legendRow}>
          <View style={[styles.legendSwatch, { backgroundColor: TILE_COLORS[TILE.OBSTACLE] }]} />
          <Text style={styles.legendText}>Obstacle</Text>
        </View>
        <View style={styles.legendRow}>
          <View style={[styles.legendSwatch, { backgroundColor: TILE_COLORS[TILE.BLOCKED] }]} />
          <Text style={styles.legendText}>Blocked</Text>
        </View>
        <TouchableOpacity style={styles.clearBtn} onPress={clearPath}>
          <Text style={styles.clearBtnText}>Clear path</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.hint}>Tap walkable tile: 1st = start, 2nd = destination</Text>

      {/* Map - grid + path + PDR position */}
      <View style={styles.mapWrapper} onLayout={onLayout}>
        <Svg
          width="100%"
          height="100%"
          viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}
          onPress={handleTap}
          preserveAspectRatio="xMidYMid meet"
        >
          <G>
            {OFFICE_GRID.map((row, rowIndex) =>
              row.map((tileType, colIndex) => (
                <Rect
                  key={`${colIndex}-${rowIndex}`}
                  x={colIndex * TILE_SIZE}
                  y={rowIndex * TILE_SIZE}
                  width={TILE_SIZE}
                  height={TILE_SIZE}
                  fill={TILE_COLORS[tileType]}
                  stroke={tileType === TILE.WALKABLE ? '#e0e0e0' : '#666'}
                  strokeWidth={tileType === TILE.WALKABLE ? 0.5 : 1}
                />
              ))
            )}
            {pathPointsString ? (
              <Polyline
                points={pathPointsString}
                fill="none"
                stroke="#007AFF"
                strokeWidth={6}
                strokeLinecap="round"
                strokeLinejoin="round"
                opacity={0.9}
              />
            ) : null}
            {start && !isTracking ? (
              <>
                <Circle cx={start.x} cy={start.y} r={10} fill="#007AFF" stroke="#fff" strokeWidth={2} />
                <Circle cx={start.x} cy={start.y} r={16} fill="rgba(0,122,255,0.3)" />
              </>
            ) : null}
            {destination ? (
              <>
                <Circle cx={destination.x} cy={destination.y} r={10} fill="#FF3B30" stroke="#fff" strokeWidth={2} />
                <Circle cx={destination.x} cy={destination.y} r={14} fill="rgba(255,59,48,0.3)" />
              </>
            ) : null}
            {/* PDR position + direction arrow (always when tracking, or when no start set) */}
            {(isTracking || (!start && !destination)) && (
              <>
                <Line x1={position.x} y1={position.y} x2={tipX} y2={tipY} stroke="#FF3B30" strokeWidth={4} strokeLinecap="round" />
                <Circle cx={position.x} cy={position.y} r={18} fill="rgba(0,122,255,0.2)" />
                <Circle cx={position.x} cy={position.y} r={12} fill="#007AFF" stroke="#fff" strokeWidth={3} />
              </>
            )}
          </G>
        </Svg>
      </View>

      {/* Debug log */}
      <View style={styles.logContainer}>
        <ScrollView style={styles.logScroll} nestedScrollEnabled>
          {log.map((entry, i) => (
            <Text key={i} style={styles.logEntry}>{entry}</Text>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  header: { backgroundColor: '#16213e', padding: 8, paddingTop: Platform.OS === 'ios' ? 50 : 8 },
  title: { color: '#00ff88', fontSize: 18, fontWeight: 'bold', textAlign: 'center' },
  stats: { color: '#fff', fontSize: 12, textAlign: 'center', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  sensorRow: { flexDirection: 'row', backgroundColor: '#0f3460', padding: 6 },
  sensorBox: { flex: 1, alignItems: 'center', padding: 6, borderRadius: 6, marginHorizontal: 2, backgroundColor: '#1a1a2e' },
  sensorRising: { backgroundColor: '#ff9500' },
  sensorFalling: { backgroundColor: '#00ff88' },
  sensorLabel: { color: '#00ff88', fontSize: 10, fontWeight: 'bold' },
  sensorValue: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  sensorSub: { color: '#888', fontSize: 9 },
  stepsValue: { color: '#00ff88', fontSize: 28 },
  controls: { flexDirection: 'row', padding: 8, backgroundColor: '#0f3460' },
  btn: { flex: 1, marginHorizontal: 4, paddingVertical: 14, backgroundColor: '#4a69bd', borderRadius: 8, alignItems: 'center' },
  startBtn: { backgroundColor: '#00ff88' },
  stopBtn: { backgroundColor: '#ff3b30' },
  locationBtn: { backgroundColor: '#5c7cfa' },
  btnDisabled: { opacity: 0.6 },
  errorText: { color: '#ff6b6b', fontSize: 12, textAlign: 'center', paddingVertical: 4 },
  btnText: { color: '#1a1a2e', fontSize: 16, fontWeight: 'bold' },
  headingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 6, backgroundColor: '#16213e' },
  headingLabel: { color: '#fff', fontSize: 12, marginRight: 8 },
  dirBtn: { backgroundColor: '#533483', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, marginHorizontal: 4 },
  dirBtnText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  legend: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#0f3460', gap: 16 },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendSwatch: { width: 16, height: 16, borderRadius: 2 },
  legendSwatchBorder: { borderWidth: 1, borderColor: '#999' },
  legendText: { fontSize: 12, color: '#fff' },
  clearBtn: { marginLeft: 'auto', paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#4a69bd', borderRadius: 8 },
  clearBtnText: { fontSize: 14, color: '#fff', fontWeight: '600' },
  hint: { fontSize: 11, color: '#888', paddingHorizontal: 12, paddingTop: 2 },
  mapWrapper: { flex: 1, minHeight: 200 },
  logContainer: { backgroundColor: '#1a1a2e', maxHeight: 90, borderTopWidth: 1, borderTopColor: '#333' },
  logScroll: { padding: 6 },
  logEntry: { color: '#888', fontSize: 10, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
});
