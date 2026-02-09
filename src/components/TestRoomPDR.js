/**
 * TEST ROOM PDR - Simple 30x60 meter room for testing
 * 
 * AGGRESSIVE step detection - should detect most steps
 * Simple map matching your test space
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  TouchableOpacity,
  Text,
  Platform,
  ScrollView,
} from 'react-native';
import Svg, {
  Rect,
  Text as SvgText,
  Circle,
  Line,
} from 'react-native-svg';
import {
  accelerometer,
  gyroscope,
  setUpdateIntervalForType,
  SensorTypes,
} from 'react-native-sensors';

// Room: 30m x 60m, scale: 10 pixels per meter
const ROOM_WIDTH_M = 30;
const ROOM_HEIGHT_M = 60;
const PIXELS_PER_METER = 10;
const MAP_WIDTH = ROOM_WIDTH_M * PIXELS_PER_METER;  // 300px
const MAP_HEIGHT = ROOM_HEIGHT_M * PIXELS_PER_METER; // 600px

const DEFAULT_POSITION = { x: MAP_WIDTH / 2, y: MAP_HEIGHT / 2 }; // Center of room

const TestRoomPDR = () => {
  // Position & heading
  const [position, setPosition] = useState(DEFAULT_POSITION);
  const [heading, setHeading] = useState(0); // radians
  const [stepCount, setStepCount] = useState(0);
  const [totalDistance, setTotalDistance] = useState(0);
  const [isTracking, setIsTracking] = useState(false);

  // Sensor values for display
  const [accelMag, setAccelMag] = useState(1.0);
  const [gyroZ, setGyroZ] = useState(0);
  const [minMag, setMinMag] = useState(1.0);
  const [maxMag, setMaxMag] = useState(1.0);
  const [baseline, setBaseline] = useState(1.0);
  const [peakState, setPeakState] = useState('waiting');

  // Configuration
  const [stepLength] = useState(0.7); // meters per step

  // Refs for step detection
  const subsRef = useRef([]);
  const posRef = useRef(DEFAULT_POSITION);
  const headingRef = useRef(0);
  const lastStepTimeRef = useRef(0);
  const magHistoryRef = useRef([]);
  const lastGyroTimeRef = useRef(null);
  
  // Peak detection state machine
  const peakStateRef = useRef('waiting'); // 'waiting', 'rising', 'falling'
  const currentPeakRef = useRef(0);
  const baselineRef = useRef(1.0);

  // Debug log
  const [log, setLog] = useState([]);
  const logRef = useRef([]);
  
  const addLog = useCallback((msg) => {
    const t = new Date().toLocaleTimeString();
    logRef.current = [`[${t}] ${msg}`, ...logRef.current.slice(0, 49)];
    setLog([...logRef.current]);
  }, []);

  // Start tracking
  const startTracking = useCallback(() => {
    if (isTracking) return;
    
    addLog('Starting...');
    
    try {
      setUpdateIntervalForType(SensorTypes.accelerometer, 30); // 33Hz
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

    // ACCELEROMETER - Proper step detection with peak validation
    // Walking creates peaks around 1.2-1.5g, we need to:
    // 1. Detect a REAL peak (not just noise)
    // 2. Require minimum peak height (0.15g above baseline)
    // 3. Require minimum time between steps (400ms = max 2.5 steps/sec)
    try {
      const sub = accelerometer.subscribe({
        next: (data) => {
          // Calculate magnitude (in g units)
          const mag = Math.sqrt(data.x ** 2 + data.y ** 2 + data.z ** 2) / 9.81;
          setAccelMag(mag);

          // Keep history for baseline calculation (longer window)
          magHistoryRef.current.push(mag);
          if (magHistoryRef.current.length > 50) magHistoryRef.current.shift();

          // Update min/max display
          setMinMag(prev => Math.min(prev, mag));
          setMaxMag(prev => Math.max(prev, mag));

          // Calculate baseline (moving average)
          const history = magHistoryRef.current;
          const baselineVal = history.reduce((a, b) => a + b, 0) / history.length;
          baselineRef.current = baselineVal;
          setBaseline(baselineVal);

          const now = Date.now();
          const timeSinceStep = now - lastStepTimeRef.current;
          
          // Step detection thresholds
          const PEAK_THRESHOLD = 0.15;  // Must be 0.15g above baseline
          const MIN_PEAK_HEIGHT = 1.1;  // Absolute minimum peak (1.1g)
          const COOLDOWN_MS = 400;      // 400ms between steps (max 2.5 steps/sec)
          
          const state = peakStateRef.current;
          
          // State machine for step detection
          if (state === 'waiting') {
            // Look for rising edge - acceleration going UP significantly
            if (mag > baselineVal + PEAK_THRESHOLD && mag > MIN_PEAK_HEIGHT) {
              peakStateRef.current = 'rising';
              currentPeakRef.current = mag;
              setPeakState('rising');
            }
          } else if (state === 'rising') {
            // Track the peak - keep updating if still rising
            if (mag > currentPeakRef.current) {
              currentPeakRef.current = mag;
            } else if (mag < currentPeakRef.current - 0.05) {
              // Started falling - transition to falling state
              peakStateRef.current = 'falling';
              setPeakState('falling');
            }
          } else if (state === 'falling') {
            // Wait for it to drop below baseline to confirm step
            if (mag < baselineVal + 0.05) {
              // Validate this was a real step
              const peakHeight = currentPeakRef.current - baselineVal;
              
              if (peakHeight >= PEAK_THRESHOLD && timeSinceStep >= COOLDOWN_MS) {
                // VALID STEP!
                lastStepTimeRef.current = now;
                
                const stepPx = stepLength * PIXELS_PER_METER;
                const h = headingRef.current;
                const dx = stepPx * Math.sin(h);
                const dy = -stepPx * Math.cos(h);

                posRef.current = {
                  x: Math.max(10, Math.min(MAP_WIDTH - 10, posRef.current.x + dx)),
                  y: Math.max(10, Math.min(MAP_HEIGHT - 10, posRef.current.y + dy)),
                };

                setPosition({ ...posRef.current });
                setStepCount(prev => prev + 1);
                setTotalDistance(prev => prev + stepLength);

                addLog(`STEP! peak=${currentPeakRef.current.toFixed(2)}g base=${baselineVal.toFixed(2)}g`);
              }
              
              // Reset state machine
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

    // GYROSCOPE - heading tracking
    try {
      const sub = gyroscope.subscribe({
        next: (data) => {
          setGyroZ(data.z);
          
          const now = Date.now();
          if (lastGyroTimeRef.current !== null) {
            const dt = (now - lastGyroTimeRef.current) / 1000;
            headingRef.current -= data.z * dt; // Integrate rotation
            
            // Normalize
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

  // Stop
  const stopTracking = useCallback(() => {
    subsRef.current.forEach(s => { try { s.unsubscribe(); } catch(e){} });
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
    setMinMag(1.0);
    setMaxMag(1.0);
    logRef.current = [];
    setLog([]);
    addLog('Reset');
  }, [stopTracking, addLog]);

  // Cleanup
  useEffect(() => {
    return () => {
      subsRef.current.forEach(s => { try { s.unsubscribe(); } catch(e){} });
    };
  }, []);

  // Set heading
  const setDir = useCallback((deg) => {
    const rad = (deg * Math.PI) / 180;
    setHeading(rad);
    headingRef.current = rad;
    addLog(`Heading → ${deg}°`);
  }, [addLog]);

  // Arrow path
  const headingDeg = (heading * 180) / Math.PI;
  const arrowLen = 25;
  const angle = heading - Math.PI / 2;
  const tipX = position.x + arrowLen * Math.cos(angle);
  const tipY = position.y + arrowLen * Math.sin(angle);

  // Position in meters
  const posMetersX = (position.x / PIXELS_PER_METER).toFixed(1);
  const posMetersY = (position.y / PIXELS_PER_METER).toFixed(1);

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>{isTracking ? '🟢 TRACKING' : '⚪ STOPPED'}</Text>
        <Text style={styles.stats}>
          Steps: {stepCount} | Distance: {totalDistance.toFixed(1)}m | Heading: {headingDeg.toFixed(0)}°
        </Text>
        <Text style={styles.stats}>
          Position: ({posMetersX}m, {posMetersY}m) in {ROOM_WIDTH_M}×{ROOM_HEIGHT_M}m room
        </Text>
      </View>

      {/* Sensor Display */}
      <View style={styles.sensorRow}>
        <View style={[
          styles.sensorBox, 
          peakState === 'rising' && styles.sensorRising,
          peakState === 'falling' && styles.sensorFalling
        ]}>
          <Text style={styles.sensorLabel}>ACCEL ({peakState})</Text>
          <Text style={styles.sensorValue}>{accelMag.toFixed(3)}g</Text>
          <Text style={styles.sensorSub}>base:{baseline.toFixed(2)} need:&gt;{(baseline + 0.15).toFixed(2)}</Text>
        </View>
        <View style={styles.sensorBox}>
          <Text style={styles.sensorLabel}>GYRO / RANGE</Text>
          <Text style={styles.sensorValue}>{gyroZ.toFixed(2)}</Text>
          <Text style={styles.sensorSub}>Δ{(maxMag - minMag).toFixed(2)}g ({minMag.toFixed(2)}-{maxMag.toFixed(2)})</Text>
        </View>
        <View style={styles.sensorBox}>
          <Text style={styles.sensorLabel}>STEPS</Text>
          <Text style={[styles.sensorValue, styles.stepsValue]}>{stepCount}</Text>
          <Text style={styles.sensorSub}>{totalDistance.toFixed(1)}m</Text>
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
      </View>

      {/* Heading buttons */}
      <View style={styles.headingRow}>
        <Text style={styles.headingLabel}>Direction:</Text>
        {[0, 90, 180, 270].map(d => (
          <TouchableOpacity key={d} style={styles.dirBtn} onPress={() => setDir(d)}>
            <Text style={styles.dirBtnText}>{d === 0 ? '↑' : d === 90 ? '→' : d === 180 ? '↓' : '←'} {d}°</Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Map - Simple room */}
      <View style={styles.mapContainer}>
        <Svg width="100%" height="100%" viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}>
          {/* Room background */}
          <Rect x="0" y="0" width={MAP_WIDTH} height={MAP_HEIGHT} fill="#f0f0f0" stroke="#333" strokeWidth="2" />
          
          {/* Grid lines every 5 meters */}
          {[...Array(Math.floor(ROOM_WIDTH_M / 5))].map((_, i) => (
            <Line key={`vg${i}`} x1={(i + 1) * 50} y1="0" x2={(i + 1) * 50} y2={MAP_HEIGHT} stroke="#ddd" strokeWidth="1" />
          ))}
          {[...Array(Math.floor(ROOM_HEIGHT_M / 5))].map((_, i) => (
            <Line key={`hg${i}`} x1="0" y1={(i + 1) * 50} x2={MAP_WIDTH} y2={(i + 1) * 50} stroke="#ddd" strokeWidth="1" />
          ))}

          {/* Labels */}
          <SvgText x={MAP_WIDTH / 2} y="20" fontSize="14" textAnchor="middle" fill="#666">
            {ROOM_WIDTH_M}m × {ROOM_HEIGHT_M}m Room
          </SvgText>
          <SvgText x="10" y={MAP_HEIGHT - 10} fontSize="10" fill="#999">
            Grid: 5m
          </SvgText>

          {/* Direction arrow */}
          <Line x1={position.x} y1={position.y} x2={tipX} y2={tipY} stroke="#FF3B30" strokeWidth="4" strokeLinecap="round" />
          
          {/* User dot */}
          <Circle cx={position.x} cy={position.y} r="20" fill="rgba(0,122,255,0.2)" />
          <Circle cx={position.x} cy={position.y} r="12" fill="#007AFF" stroke="#fff" strokeWidth="3" />
        </Svg>
      </View>

      {/* Debug Log */}
      <View style={styles.logContainer}>
        <ScrollView style={styles.logScroll} nestedScrollEnabled>
          {log.map((entry, i) => (
            <Text key={i} style={styles.logEntry}>{entry}</Text>
          ))}
        </ScrollView>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  header: { backgroundColor: '#16213e', padding: 8, paddingTop: Platform.OS === 'ios' ? 50 : 8 },
  title: { color: '#00ff88', fontSize: 18, fontWeight: 'bold', textAlign: 'center' },
  stats: { color: '#fff', fontSize: 12, textAlign: 'center', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  sensorRow: { flexDirection: 'row', backgroundColor: '#0f3460', padding: 6 },
  sensorBox: { flex: 1, alignItems: 'center', padding: 6, borderRadius: 6, marginHorizontal: 2, backgroundColor: '#1a1a2e' },
  sensorRising: { backgroundColor: '#ff9500' },  // Orange when rising to peak
  sensorFalling: { backgroundColor: '#00ff88' }, // Green when falling (step incoming!)
  sensorLabel: { color: '#00ff88', fontSize: 10, fontWeight: 'bold' },
  sensorValue: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  sensorSub: { color: '#888', fontSize: 9 },
  stepsValue: { color: '#00ff88', fontSize: 28 },
  controls: { flexDirection: 'row', padding: 8, backgroundColor: '#0f3460' },
  btn: { flex: 1, marginHorizontal: 4, paddingVertical: 14, backgroundColor: '#4a69bd', borderRadius: 8, alignItems: 'center' },
  startBtn: { backgroundColor: '#00ff88' },
  stopBtn: { backgroundColor: '#ff3b30' },
  btnText: { color: '#1a1a2e', fontSize: 16, fontWeight: 'bold' },
  headingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 6, backgroundColor: '#16213e' },
  headingLabel: { color: '#fff', fontSize: 12, marginRight: 8 },
  dirBtn: { backgroundColor: '#533483', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6, marginHorizontal: 4 },
  dirBtnText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  mapContainer: { flex: 1, backgroundColor: '#fff', margin: 8, borderRadius: 8, overflow: 'hidden' },
  logContainer: { backgroundColor: '#1a1a2e', maxHeight: 100, borderTopWidth: 1, borderTopColor: '#333' },
  logScroll: { padding: 6 },
  logEntry: { color: '#888', fontSize: 10, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
});

export default TestRoomPDR;
