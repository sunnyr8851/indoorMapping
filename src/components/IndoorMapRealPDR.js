/**
 * Indoor Map with REAL PDR (Pedestrian Dead Reckoning)
 * 
 * Uses actual phone sensors:
 * - Accelerometer: Detects steps from walking motion
 * - Gyroscope: Tracks rotation/turning
 * - Magnetometer: Compass heading (optional calibration)
 * 
 * DEBUG MODE: Shows real-time sensor values so you can see if sensors are working
 */

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Text,
  FlatList,
  Platform,
  ScrollView,
  Alert,
} from 'react-native';
import Svg, {
  Rect,
  Text as SvgText,
  Circle,
  G,
  Line,
  Polyline,
  Path,
} from 'react-native-svg';
import {
  PinchGestureHandler,
  PanGestureHandler,
  TapGestureHandler,
  State,
} from 'react-native-gesture-handler';
import { LOCATIONS } from '../data/mapData';
import { getPathFromTo } from '../utils/pathfinding';

// Import sensors
import {
  accelerometer,
  gyroscope,
  magnetometer,
  setUpdateIntervalForType,
  SensorTypes,
} from 'react-native-sensors';

const MAP_WIDTH = 1100;
const MAP_HEIGHT = 900;
const DEFAULT_POSITION = { x: 550, y: 335 };

const IndoorMapRealPDR = () => {
  // Map view state
  const [scale, setScale] = useState(1);
  const [translateX, setTranslateX] = useState(0);
  const [translateY, setTranslateY] = useState(0);

  // Navigation state
  const [searchQuery, setSearchQuery] = useState('');
  const [showResults, setShowResults] = useState(false);
  const [destination, setDestination] = useState(null);
  const [isSettingPosition, setIsSettingPosition] = useState(false);

  // PDR State
  const [position, setPosition] = useState(DEFAULT_POSITION);
  const [heading, setHeading] = useState(0); // radians
  const [stepCount, setStepCount] = useState(0);
  const [totalDistance, setTotalDistance] = useState(0);
  const [isTracking, setIsTracking] = useState(false);

  // Sensor debug values
  const [accelData, setAccelData] = useState({ x: 0, y: 0, z: 0 });
  const [gyroData, setGyroData] = useState({ x: 0, y: 0, z: 0 });
  const [magData, setMagData] = useState({ x: 0, y: 0, z: 0 });
  const [accelMagnitude, setAccelMagnitude] = useState(0);

  // Configuration - MORE SENSITIVE defaults
  const [stepLength, setStepLength] = useState(0.7); // meters
  const [pixelsPerMeter, setPixelsPerMeter] = useState(15); // map scale
  const [stepThreshold, setStepThreshold] = useState(0.15); // DELTA threshold (change in magnitude)
  const [stepCooldown, setStepCooldown] = useState(300); // ms between steps

  // Step detection state
  const [peakValue, setPeakValue] = useState(0);
  const [isAboveMean, setIsAboveMean] = useState(false);

  // Internal refs
  const subscriptionsRef = useRef([]);
  const lastStepTimeRef = useRef(0);
  const lastAccelMagRef = useRef(1.0);
  const lastGyroTimeRef = useRef(null);
  const accelFilteredRef = useRef({ x: 0, y: 0, z: 9.8 });
  const headingRef = useRef(0);
  const positionRef = useRef(DEFAULT_POSITION);
  
  // For peak detection
  const accelHistoryRef = useRef([]);
  const peakDetectedRef = useRef(false);
  const lastPeakValueRef = useRef(1.0);

  // Debug log
  const [debugLog, setDebugLog] = useState([]);
  const logRef = useRef([]);

  const addLog = useCallback((msg) => {
    const time = new Date().toLocaleTimeString();
    const entry = `[${time}] ${msg}`;
    logRef.current = [entry, ...logRef.current.slice(0, 29)];
    setDebugLog([...logRef.current]);
    console.log(entry);
  }, []);

  // Low-pass filter for smoothing
  const lowPassFilter = (current, previous, alpha = 0.2) => ({
    x: alpha * current.x + (1 - alpha) * previous.x,
    y: alpha * current.y + (1 - alpha) * previous.y,
    z: alpha * current.z + (1 - alpha) * previous.z,
  });

  // Start tracking
  const startTracking = useCallback(() => {
    if (isTracking) return;

    addLog('Starting PDR tracking...');

    // Set sensor update intervals
    try {
      setUpdateIntervalForType(SensorTypes.accelerometer, 50);
      setUpdateIntervalForType(SensorTypes.gyroscope, 50);
      setUpdateIntervalForType(SensorTypes.magnetometer, 100);
    } catch (e) {
      addLog(`Sensor interval error: ${e.message}`);
    }

    // Reset state
    lastStepTimeRef.current = Date.now();
    lastGyroTimeRef.current = null;
    headingRef.current = heading;
    positionRef.current = { ...position };

    const subs = [];

    // Accelerometer subscription with IMPROVED step detection
    try {
      const accelSub = accelerometer.subscribe({
        next: (data) => {
          setAccelData(data);

          // Low-pass filter for smoothing
          accelFilteredRef.current = lowPassFilter(data, accelFilteredRef.current, 0.4);
          const filtered = accelFilteredRef.current;

          // Calculate magnitude
          const mag = Math.sqrt(filtered.x ** 2 + filtered.y ** 2 + filtered.z ** 2);
          const normalizedMag = mag / 9.81;
          setAccelMagnitude(normalizedMag);

          // Keep history for dynamic threshold
          accelHistoryRef.current.push(normalizedMag);
          if (accelHistoryRef.current.length > 50) {
            accelHistoryRef.current.shift();
          }

          // Calculate dynamic mean
          const history = accelHistoryRef.current;
          const mean = history.length > 0 
            ? history.reduce((a, b) => a + b, 0) / history.length 
            : 1.0;

          // Step detection using PEAK detection algorithm
          const now = Date.now();
          const timeSinceLastStep = now - lastStepTimeRef.current;
          const lastMag = lastAccelMagRef.current;
          
          // Detect if we're going UP (toward peak) or DOWN (past peak)
          const isRising = normalizedMag > lastMag;
          const delta = Math.abs(normalizedMag - mean);
          
          // Update peak tracking
          if (normalizedMag > mean + stepThreshold) {
            // We're above the threshold - track the peak
            if (normalizedMag > lastPeakValueRef.current) {
              lastPeakValueRef.current = normalizedMag;
            }
            peakDetectedRef.current = true;
            setIsAboveMean(true);
            setPeakValue(lastPeakValueRef.current);
          } else if (peakDetectedRef.current && normalizedMag < mean && timeSinceLastStep > stepCooldown) {
            // We've come back below mean after being above - STEP DETECTED!
            peakDetectedRef.current = false;
            lastPeakValueRef.current = 1.0;
            lastStepTimeRef.current = now;
            setIsAboveMean(false);

            const stepPixels = stepLength * pixelsPerMeter;
            const h = headingRef.current;
            const dx = stepPixels * Math.sin(h);
            const dy = -stepPixels * Math.cos(h);

            positionRef.current = {
              x: Math.max(0, Math.min(MAP_WIDTH, positionRef.current.x + dx)),
              y: Math.max(0, Math.min(MAP_HEIGHT, positionRef.current.y + dy)),
            };

            setPosition({ ...positionRef.current });
            setStepCount((prev) => prev + 1);
            setTotalDistance((prev) => prev + stepLength);

            addLog(`STEP! peak=${lastPeakValueRef.current.toFixed(2)} → (${positionRef.current.x.toFixed(0)}, ${positionRef.current.y.toFixed(0)})`);
          } else {
            setIsAboveMean(false);
          }

          lastAccelMagRef.current = normalizedMag;
        },
        error: (err) => addLog(`Accel error: ${err.message}`),
      });
      subs.push(accelSub);
      addLog('Accelerometer connected');
    } catch (e) {
      addLog(`Accelerometer failed: ${e.message}`);
    }

    // Gyroscope subscription
    try {
      const gyroSub = gyroscope.subscribe({
        next: (data) => {
          setGyroData(data);

          const now = Date.now();
          if (lastGyroTimeRef.current !== null) {
            const dt = (now - lastGyroTimeRef.current) / 1000;

            // Integrate z-axis (yaw) rotation
            // Phone orientation matters - assuming portrait mode
            const deltaHeading = -data.z * dt; // Negative for correct direction

            headingRef.current += deltaHeading;

            // Normalize to [0, 2π]
            while (headingRef.current < 0) headingRef.current += 2 * Math.PI;
            while (headingRef.current >= 2 * Math.PI) headingRef.current -= 2 * Math.PI;

            setHeading(headingRef.current);
          }
          lastGyroTimeRef.current = now;
        },
        error: (err) => addLog(`Gyro error: ${err.message}`),
      });
      subs.push(gyroSub);
      addLog('Gyroscope connected');
    } catch (e) {
      addLog(`Gyroscope failed: ${e.message}`);
    }

    // Magnetometer subscription (for reference)
    try {
      const magSub = magnetometer.subscribe({
        next: (data) => setMagData(data),
        error: (err) => addLog(`Mag error: ${err.message}`),
      });
      subs.push(magSub);
      addLog('Magnetometer connected');
    } catch (e) {
      addLog(`Magnetometer failed: ${e.message}`);
    }

    subscriptionsRef.current = subs;
    setIsTracking(true);
    addLog('PDR tracking started!');
  }, [isTracking, heading, position, stepLength, pixelsPerMeter, stepThreshold, stepCooldown, addLog]);

  // Stop tracking
  const stopTracking = useCallback(() => {
    subscriptionsRef.current.forEach((sub) => {
      try {
        sub.unsubscribe();
      } catch (e) {
        console.warn('Unsubscribe error:', e);
      }
    });
    subscriptionsRef.current = [];
    setIsTracking(false);
    addLog('PDR tracking stopped');
  }, [addLog]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      subscriptionsRef.current.forEach((sub) => {
        try {
          sub.unsubscribe();
        } catch (e) {}
      });
    };
  }, []);

  // Reset
  const resetTracking = useCallback(() => {
    stopTracking();
    setPosition(DEFAULT_POSITION);
    positionRef.current = DEFAULT_POSITION;
    setHeading(0);
    headingRef.current = 0;
    setStepCount(0);
    setTotalDistance(0);
    logRef.current = [];
    setDebugLog([]);
    addLog('Reset complete');
  }, [stopTracking, addLog]);

  // Calibrate heading
  const calibrateHeading = useCallback((degrees) => {
    const rad = (degrees * Math.PI) / 180;
    setHeading(rad);
    headingRef.current = rad;
    addLog(`Heading set to ${degrees}°`);
  }, [addLog]);

  // Use compass
  const useCompass = useCallback(() => {
    const compassHeading = Math.atan2(magData.y, magData.x);
    const normalized = compassHeading < 0 ? compassHeading + 2 * Math.PI : compassHeading;
    setHeading(normalized);
    headingRef.current = normalized;
    addLog(`Compass heading: ${((normalized * 180) / Math.PI).toFixed(0)}°`);
  }, [magData, addLog]);

  // Map tap
  const handleMapTap = useCallback(
    (event) => {
      if (!isSettingPosition) return;
      const { x, y } = event.nativeEvent;
      const mapX = Math.max(0, Math.min(MAP_WIDTH, (x - translateX) / scale));
      const mapY = Math.max(0, Math.min(MAP_HEIGHT, (y - translateY) / scale));
      setPosition({ x: mapX, y: mapY });
      positionRef.current = { x: mapX, y: mapY };
      setIsSettingPosition(false);
      addLog(`Position set: (${mapX.toFixed(0)}, ${mapY.toFixed(0)})`);
    },
    [isSettingPosition, scale, translateX, translateY, addLog]
  );

  // Search
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return LOCATIONS;
    const q = searchQuery.trim().toLowerCase();
    return LOCATIONS.filter(
      (loc) => loc.name.toLowerCase().includes(q) || loc.category.toLowerCase().includes(q)
    );
  }, [searchQuery]);

  // Path
  const pathPoints = useMemo(() => {
    if (!destination) return [];
    return getPathFromTo(position, destination.nodeId);
  }, [position, destination]);

  const pathString = pathPoints.length > 0 ? pathPoints.map((p) => `${p.x},${p.y}`).join(' ') : '';

  // Heading arrow
  const headingDegrees = (heading * 180) / Math.PI;
  const arrowPath = useMemo(() => {
    const size = 30;
    const angle = heading - Math.PI / 2;
    const tipX = position.x + size * Math.cos(angle);
    const tipY = position.y + size * Math.sin(angle);
    const headSize = 10;
    const a1 = angle + Math.PI * 0.8;
    const a2 = angle - Math.PI * 0.8;
    return `M ${position.x} ${position.y} L ${tipX} ${tipY} M ${tipX} ${tipY} L ${tipX + headSize * Math.cos(a1)} ${tipY + headSize * Math.sin(a1)} M ${tipX} ${tipY} L ${tipX + headSize * Math.cos(a2)} ${tipY + headSize * Math.sin(a2)}`;
  }, [position, heading]);

  return (
    <View style={styles.container}>
      {/* Status */}
      <View style={styles.statusBar}>
        <Text style={styles.statusTitle}>
          {isTracking ? '🟢 TRACKING' : '⚪ STOPPED'}
        </Text>
        <Text style={styles.statusText}>
          Steps: {stepCount} | Distance: {totalDistance.toFixed(2)}m | Heading: {headingDegrees.toFixed(0)}°
        </Text>
        <Text style={styles.statusText}>
          Pos: ({position.x.toFixed(0)}, {position.y.toFixed(0)}) | Accel: {accelMagnitude.toFixed(2)}g
        </Text>
      </View>

      {/* Sensor Debug */}
      <View style={styles.sensorRow}>
        <View style={[styles.sensorBox, isAboveMean && styles.sensorBoxActive]}>
          <Text style={styles.sensorLabel}>ACCEL</Text>
          <Text style={[styles.sensorMag, isAboveMean && styles.sensorMagHigh]}>
            {accelMagnitude.toFixed(3)}g
          </Text>
          <Text style={styles.sensorValue}>
            {isAboveMean ? '⬆️ PEAK' : '—'}
          </Text>
          <Text style={styles.sensorValue}>peak: {peakValue.toFixed(2)}</Text>
        </View>
        <View style={styles.sensorBox}>
          <Text style={styles.sensorLabel}>GYRO Z</Text>
          <Text style={styles.sensorMag}>{gyroData.z.toFixed(3)}</Text>
          <Text style={styles.sensorValue}>rad/s</Text>
        </View>
        <View style={styles.sensorBox}>
          <Text style={styles.sensorLabel}>STEPS</Text>
          <Text style={[styles.sensorMag, { color: '#00ff88', fontSize: 24 }]}>{stepCount}</Text>
          <Text style={styles.sensorValue}>{totalDistance.toFixed(1)}m</Text>
        </View>
      </View>

      {/* Controls */}
      <View style={styles.controlRow}>
        {!isTracking ? (
          <TouchableOpacity style={[styles.btn, styles.startBtn]} onPress={startTracking}>
            <Text style={styles.btnText}>START</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={[styles.btn, styles.stopBtn]} onPress={stopTracking}>
            <Text style={styles.btnText}>STOP</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.btn} onPress={resetTracking}>
          <Text style={styles.btnText}>RESET</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.btn, isSettingPosition && styles.btnActive]}
          onPress={() => setIsSettingPosition(!isSettingPosition)}>
          <Text style={styles.btnText}>{isSettingPosition ? 'TAP MAP' : 'SET POS'}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.btn} onPress={useCompass}>
          <Text style={styles.btnText}>COMPASS</Text>
        </TouchableOpacity>
      </View>

      {/* Heading presets */}
      <View style={styles.headingRow}>
        <Text style={styles.headingLabel}>Heading:</Text>
        {[0, 90, 180, 270].map((deg) => (
          <TouchableOpacity key={deg} style={styles.headingBtn} onPress={() => calibrateHeading(deg)}>
            <Text style={styles.headingBtnText}>{deg}°</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Sensitivity - IMPORTANT for step detection */}
      <View style={styles.sensitivityRow}>
        <Text style={styles.sensLabel}>Sensitivity:</Text>
        <TouchableOpacity style={styles.sensBtn} onPress={() => setStepThreshold((p) => Math.max(0.05, p - 0.02))}>
          <Text style={styles.sensBtnText}>-</Text>
        </TouchableOpacity>
        <Text style={[styles.sensValue, { backgroundColor: '#1a1a2e' }]}>{stepThreshold.toFixed(2)}</Text>
        <TouchableOpacity style={styles.sensBtn} onPress={() => setStepThreshold((p) => Math.min(0.5, p + 0.02))}>
          <Text style={styles.sensBtnText}>+</Text>
        </TouchableOpacity>
        
        <Text style={styles.sensLabel}>| Move:</Text>
        <TouchableOpacity style={styles.sensBtn} onPress={() => setPixelsPerMeter((p) => Math.max(5, p - 2))}>
          <Text style={styles.sensBtnText}>-</Text>
        </TouchableOpacity>
        <Text style={[styles.sensValue, { backgroundColor: '#1a1a2e' }]}>{pixelsPerMeter}px</Text>
        <TouchableOpacity style={styles.sensBtn} onPress={() => setPixelsPerMeter((p) => Math.min(50, p + 2))}>
          <Text style={styles.sensBtnText}>+</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.sensHint}>
        Lower sensitivity = more steps detected. If no steps: decrease to 0.08-0.10
      </Text>

      {/* Search */}
      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search destination..."
          placeholderTextColor="#888"
          value={searchQuery}
          onChangeText={setSearchQuery}
          onFocus={() => setShowResults(true)}
          onBlur={() => setTimeout(() => setShowResults(false), 200)}
        />
        {destination && (
          <TouchableOpacity style={styles.clearBtn} onPress={() => { setDestination(null); setSearchQuery(''); }}>
            <Text style={styles.clearBtnText}>Clear</Text>
          </TouchableOpacity>
        )}
      </View>
      {showResults && (
        <FlatList
          data={searchResults}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          style={styles.resultsList}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.resultItem}
              onPress={() => { setDestination(item); setSearchQuery(item.name); setShowResults(false); }}>
              <Text style={styles.resultName}>{item.name}</Text>
            </TouchableOpacity>
          )}
        />
      )}

      {/* Map */}
      <View style={styles.mapWrapper}>
        <TapGestureHandler onHandlerStateChange={(e) => e.nativeEvent.state === State.END && handleMapTap(e)}>
          <PanGestureHandler onGestureEvent={(e) => !isSettingPosition && (setTranslateX(e.nativeEvent.translationX), setTranslateY(e.nativeEvent.translationY))}>
            <PinchGestureHandler onGestureEvent={(e) => setScale(Math.max(0.5, Math.min(3, e.nativeEvent.scale)))}>
              <Svg width="100%" height="100%" viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}>
                <G scale={scale} translateX={translateX / scale} translateY={translateY / scale}>
                  <Rect x="0" y="0" width={MAP_WIDTH} height={MAP_HEIGHT} fill="#e8e8e8" />

                  {/* Simplified map */}
                  <Rect x="90" y="300" width={920} height="70" fill="#fff3cd" stroke="#333" strokeWidth="1" />
                  <SvgText x={520} y="342" fontSize="14">Main Corridor</SvgText>

                  <Rect x="20" y="230" width="60" height="420" fill="#fff3cd" stroke="#333" strokeWidth="1" />
                  <Rect x={1000} y="300" width="80" height="350" fill="#fff3cd" stroke="#333" strokeWidth="1" />
                  <Rect x="90" y="760" width={920} height="50" fill="#fff3cd" stroke="#333" strokeWidth="1" />

                  <Rect x="90" y="620" width="350" height="130" fill="#f8d7da" stroke="#333" strokeWidth="1" />
                  <SvgText x="230" y="692" fontSize="14">Indoor Stadium</SvgText>

                  <Rect x="450" y="620" width="460" height="130" fill="#f8d7da" stroke="#333" strokeWidth="1" />
                  <SvgText x="650" y="692" fontSize="14">Auditorium</SvgText>

                  <Rect x="510" y="380" width="400" height="230" fill="#e2d9f3" stroke="#333" strokeWidth="1" />
                  <SvgText x="680" y="500" fontSize="18">Library</SvgText>

                  <Rect x="90" y="380" width="200" height="110" fill="#d4edda" stroke="#333" strokeWidth="1" />
                  <SvgText x="160" y="442" fontSize="12">Computer Lab</SvgText>

                  <Rect x="300" y="380" width="200" height="110" fill="#d4edda" stroke="#333" strokeWidth="1" />
                  <SvgText x="370" y="442" fontSize="12">Electronics Lab</SvgText>

                  {/* Path */}
                  {pathString && (
                    <Polyline points={pathString} fill="none" stroke="#007AFF" strokeWidth="6" strokeLinecap="round" opacity={0.9} />
                  )}

                  {/* Direction arrow */}
                  <Path d={arrowPath} stroke="#FF3B30" strokeWidth="4" strokeLinecap="round" />

                  {/* User dot */}
                  <Circle cx={position.x} cy={position.y} r="28" fill="rgba(0,122,255,0.15)" />
                  <Circle cx={position.x} cy={position.y} r="16" fill="#007AFF" stroke="#fff" strokeWidth="3" />
                </G>
              </Svg>
            </PinchGestureHandler>
          </PanGestureHandler>
        </TapGestureHandler>

        {isSettingPosition && (
          <View style={styles.overlay}>
            <Text style={styles.overlayText}>Tap on map to set position</Text>
          </View>
        )}
      </View>

      {/* Debug Log */}
      <View style={styles.logContainer}>
        <ScrollView style={styles.logScroll} nestedScrollEnabled>
          {debugLog.map((entry, i) => (
            <Text key={i} style={styles.logEntry}>{entry}</Text>
          ))}
        </ScrollView>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  statusBar: { backgroundColor: '#16213e', padding: 8, paddingTop: Platform.OS === 'ios' ? 50 : 8 },
  statusTitle: { color: '#00ff88', fontSize: 16, fontWeight: 'bold', textAlign: 'center' },
  statusText: { color: '#fff', fontSize: 11, textAlign: 'center', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  sensorRow: { flexDirection: 'row', backgroundColor: '#0f3460', padding: 4 },
  sensorBox: { flex: 1, alignItems: 'center', padding: 4, borderRadius: 4 },
  sensorBoxActive: { backgroundColor: '#ff3b30' },
  sensorLabel: { color: '#00ff88', fontSize: 9, fontWeight: 'bold' },
  sensorValue: { color: '#fff', fontSize: 9, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  sensorMag: { color: '#ff0', fontSize: 10, fontWeight: 'bold', marginTop: 2 },
  sensorMagHigh: { color: '#ff3b30' },
  controlRow: { flexDirection: 'row', padding: 6, backgroundColor: '#0f3460' },
  btn: { flex: 1, marginHorizontal: 2, paddingVertical: 10, backgroundColor: '#4a69bd', borderRadius: 6, alignItems: 'center' },
  startBtn: { backgroundColor: '#00ff88' },
  stopBtn: { backgroundColor: '#ff3b30' },
  btnActive: { backgroundColor: '#ffd32a' },
  btnText: { color: '#1a1a2e', fontSize: 12, fontWeight: 'bold' },
  headingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 4, backgroundColor: '#16213e' },
  headingLabel: { color: '#fff', fontSize: 11, marginRight: 8 },
  headingBtn: { backgroundColor: '#533483', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 4, marginHorizontal: 3 },
  headingBtnText: { color: '#fff', fontSize: 11, fontWeight: '600' },
  sensitivityRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 4, backgroundColor: '#16213e' },
  sensLabel: { color: '#fff', fontSize: 10, marginHorizontal: 4 },
  sensBtn: { backgroundColor: '#e94560', width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginHorizontal: 2 },
  sensBtnText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },
  sensValue: { color: '#00ff88', fontSize: 12, fontWeight: 'bold', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 4 },
  sensHint: { color: '#888', fontSize: 9, textAlign: 'center', paddingVertical: 2, backgroundColor: '#16213e' },
  searchRow: { flexDirection: 'row', padding: 6, backgroundColor: '#fff' },
  searchInput: { flex: 1, height: 36, backgroundColor: '#f0f0f0', borderRadius: 6, paddingHorizontal: 10, fontSize: 13 },
  clearBtn: { marginLeft: 6, paddingHorizontal: 10, paddingVertical: 6, backgroundColor: '#ddd', borderRadius: 6 },
  clearBtnText: { fontSize: 11, fontWeight: '600' },
  resultsList: { maxHeight: 120, backgroundColor: '#fff' },
  resultItem: { padding: 10, borderBottomWidth: 1, borderBottomColor: '#eee' },
  resultName: { fontSize: 13, fontWeight: '500' },
  mapWrapper: { flex: 1, position: 'relative' },
  overlay: { position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: 'rgba(255,214,10,0.95)', padding: 10 },
  overlayText: { textAlign: 'center', fontWeight: '600' },
  logContainer: { backgroundColor: '#1a1a2e', maxHeight: 80, borderTopWidth: 1, borderTopColor: '#333' },
  logScroll: { padding: 4 },
  logEntry: { color: '#888', fontSize: 9, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
});

export default IndoorMapRealPDR;
