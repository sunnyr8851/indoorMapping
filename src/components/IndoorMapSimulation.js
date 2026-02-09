/**
 * Indoor Map with SIMULATION MODE
 * 
 * This component uses SIMULATED sensor data to test the navigation logic
 * without relying on real sensors.
 * 
 * FEATURES:
 * - Dummy compass: Rotate heading with buttons or slider
 * - Dummy step: Tap button to simulate a step (moves forward by stepLength)
 * - Auto-walk: Toggle to auto-simulate walking
 * - Debug logs: See position changes in real-time
 * 
 * Use this to verify:
 * 1. Blue dot moves correctly when steps are taken
 * 2. Red arrow rotates with heading changes
 * 3. Distance calculation is accurate
 * 4. Path recalculates as position changes
 */

import React, { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  View,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Text,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Modal,
  ScrollView,
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

const MAP_WIDTH = 1100;
const MAP_HEIGHT = 900;

// Default starting position (main corridor center)
const DEFAULT_POSITION = { x: 550, y: 335 };

const IndoorMapSimulation = () => {
  // Map view state
  const [scale, setScale] = useState(1);
  const [translateX, setTranslateX] = useState(0);
  const [translateY, setTranslateY] = useState(0);

  // Search & navigation state
  const [searchQuery, setSearchQuery] = useState('');
  const [showResults, setShowResults] = useState(false);
  const [destination, setDestination] = useState(null);

  // Position setting mode
  const [isSettingPosition, setIsSettingPosition] = useState(false);

  // Settings modal
  const [showSettings, setShowSettings] = useState(false);

  // ========== SIMULATION STATE ==========
  const [position, setPosition] = useState(DEFAULT_POSITION);
  const [heading, setHeading] = useState(0); // degrees: 0 = up, 90 = right
  const [stepCount, setStepCount] = useState(0);
  const [totalDistance, setTotalDistance] = useState(0);
  const [stepLength, setStepLength] = useState(0.65); // meters
  const [pixelsPerMeter, setPixelsPerMeter] = useState(10);
  const [isAutoWalking, setIsAutoWalking] = useState(false);
  const [autoWalkSpeed, setAutoWalkSpeed] = useState(500); // ms between steps

  // Debug log
  const [debugLog, setDebugLog] = useState([]);
  const logRef = useRef([]);

  // Add debug message
  const addLog = useCallback((message) => {
    const timestamp = new Date().toLocaleTimeString();
    const entry = `[${timestamp}] ${message}`;
    logRef.current = [entry, ...logRef.current.slice(0, 19)]; // Keep last 20
    setDebugLog([...logRef.current]);
    console.log(entry);
  }, []);

  // ========== SIMULATION CONTROLS ==========

  // Take a step forward in current heading direction
  const takeStep = useCallback(() => {
    const stepPixels = stepLength * pixelsPerMeter;
    const headingRad = (heading * Math.PI) / 180;
    
    // Calculate new position
    // heading 0 = up (negative y), 90 = right (positive x)
    const dx = stepPixels * Math.sin(headingRad);
    const dy = -stepPixels * Math.cos(headingRad);
    
    setPosition(prev => {
      const newX = Math.max(0, Math.min(MAP_WIDTH, prev.x + dx));
      const newY = Math.max(0, Math.min(MAP_HEIGHT, prev.y + dy));
      addLog(`Step! Δ(${dx.toFixed(1)}, ${dy.toFixed(1)}) → (${newX.toFixed(0)}, ${newY.toFixed(0)})`);
      return { x: newX, y: newY };
    });
    
    setStepCount(prev => prev + 1);
    setTotalDistance(prev => prev + stepLength);
  }, [heading, stepLength, pixelsPerMeter, addLog]);

  // Rotate heading
  const rotateHeading = useCallback((degrees) => {
    setHeading(prev => {
      let newHeading = (prev + degrees) % 360;
      if (newHeading < 0) newHeading += 360;
      addLog(`Rotate ${degrees > 0 ? '+' : ''}${degrees}° → Heading: ${newHeading.toFixed(0)}°`);
      return newHeading;
    });
  }, [addLog]);

  // Set heading directly
  const setHeadingDirect = useCallback((degrees) => {
    const newHeading = ((degrees % 360) + 360) % 360;
    setHeading(newHeading);
    addLog(`Set heading: ${newHeading.toFixed(0)}°`);
  }, [addLog]);

  // Reset position
  const resetSimulation = useCallback(() => {
    setPosition(DEFAULT_POSITION);
    setHeading(0);
    setStepCount(0);
    setTotalDistance(0);
    setIsAutoWalking(false);
    logRef.current = [];
    setDebugLog([]);
    addLog('Simulation reset');
  }, [addLog]);

  // Auto-walk effect
  useEffect(() => {
    if (!isAutoWalking) return;
    
    const interval = setInterval(() => {
      takeStep();
    }, autoWalkSpeed);
    
    return () => clearInterval(interval);
  }, [isAutoWalking, autoWalkSpeed, takeStep]);

  // ========== SEARCH & NAVIGATION ==========

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return LOCATIONS;
    const q = searchQuery.trim().toLowerCase();
    return LOCATIONS.filter(
      loc =>
        loc.name.toLowerCase().includes(q) ||
        loc.category.toLowerCase().includes(q)
    );
  }, [searchQuery]);

  const pathPoints = useMemo(() => {
    if (!destination) return [];
    return getPathFromTo(position, destination.nodeId);
  }, [position, destination]);

  const pathPointsString =
    pathPoints.length > 0
      ? pathPoints.map(p => `${p.x},${p.y}`).join(' ')
      : '';

  const onSelectDestination = useCallback(loc => {
    setDestination(loc);
    setSearchQuery(loc.name);
    setShowResults(false);
    addLog(`Destination: ${loc.name}`);
  }, [addLog]);

  const clearDestination = useCallback(() => {
    setDestination(null);
    setSearchQuery('');
    addLog('Destination cleared');
  }, [addLog]);

  // Handle tap on map to set position
  const handleMapTap = useCallback(
    event => {
      if (!isSettingPosition) return;

      const { x, y } = event.nativeEvent;
      const mapX = (x - translateX) / scale;
      const mapY = (y - translateY) / scale;
      const clampedX = Math.max(0, Math.min(MAP_WIDTH, mapX));
      const clampedY = Math.max(0, Math.min(MAP_HEIGHT, mapY));

      setPosition({ x: clampedX, y: clampedY });
      setIsSettingPosition(false);
      addLog(`Position set: (${clampedX.toFixed(0)}, ${clampedY.toFixed(0)})`);
    },
    [isSettingPosition, scale, translateX, translateY, addLog]
  );

  // Direction indicator arrow
  const arrowPath = useMemo(() => {
    const size = 25;
    const headingRad = ((heading - 90) * Math.PI) / 180;
    const tipX = position.x + size * Math.cos(headingRad);
    const tipY = position.y + size * Math.sin(headingRad);
    
    // Create arrow head
    const arrowHeadSize = 8;
    const angle1 = headingRad + Math.PI * 0.8;
    const angle2 = headingRad - Math.PI * 0.8;
    const head1X = tipX + arrowHeadSize * Math.cos(angle1);
    const head1Y = tipY + arrowHeadSize * Math.sin(angle1);
    const head2X = tipX + arrowHeadSize * Math.cos(angle2);
    const head2Y = tipY + arrowHeadSize * Math.sin(angle2);
    
    return `M ${position.x} ${position.y} L ${tipX} ${tipY} M ${tipX} ${tipY} L ${head1X} ${head1Y} M ${tipX} ${tipY} L ${head2X} ${head2Y}`;
  }, [position, heading]);

  return (
    <View style={styles.container}>
      {/* Status bar */}
      <View style={styles.statusBar}>
        <Text style={styles.statusTitle}>SIMULATION MODE</Text>
        <Text style={styles.statusText}>
          Steps: {stepCount} | Distance: {totalDistance.toFixed(2)}m | Heading: {Math.round(heading)}°
        </Text>
        <Text style={styles.statusText}>
          Position: ({Math.round(position.x)}, {Math.round(position.y)}) | Step: {stepLength}m × {pixelsPerMeter}px
        </Text>
      </View>

      {/* Simulation Controls */}
      <View style={styles.simControlsContainer}>
        {/* Heading Controls */}
        <View style={styles.headingRow}>
          <Text style={styles.controlLabel}>Heading:</Text>
          <TouchableOpacity style={styles.rotateBtn} onPress={() => rotateHeading(-45)}>
            <Text style={styles.rotateBtnText}>-45°</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.rotateBtn} onPress={() => rotateHeading(-15)}>
            <Text style={styles.rotateBtnText}>-15°</Text>
          </TouchableOpacity>
          <View style={styles.headingDisplay}>
            <Text style={styles.headingValue}>{Math.round(heading)}°</Text>
          </View>
          <TouchableOpacity style={styles.rotateBtn} onPress={() => rotateHeading(15)}>
            <Text style={styles.rotateBtnText}>+15°</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.rotateBtn} onPress={() => rotateHeading(45)}>
            <Text style={styles.rotateBtnText}>+45°</Text>
          </TouchableOpacity>
        </View>

        {/* Quick Heading Presets */}
        <View style={styles.presetRow}>
          <TouchableOpacity style={styles.presetBtn} onPress={() => setHeadingDirect(0)}>
            <Text style={styles.presetBtnText}>↑ 0°</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.presetBtn} onPress={() => setHeadingDirect(90)}>
            <Text style={styles.presetBtnText}>→ 90°</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.presetBtn} onPress={() => setHeadingDirect(180)}>
            <Text style={styles.presetBtnText}>↓ 180°</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.presetBtn} onPress={() => setHeadingDirect(270)}>
            <Text style={styles.presetBtnText}>← 270°</Text>
          </TouchableOpacity>
        </View>

        {/* Step & Walk Controls */}
        <View style={styles.stepRow}>
          <TouchableOpacity style={styles.stepBtn} onPress={takeStep}>
            <Text style={styles.stepBtnText}>TAKE STEP</Text>
          </TouchableOpacity>
          <TouchableOpacity 
            style={[styles.autoWalkBtn, isAutoWalking && styles.autoWalkBtnActive]}
            onPress={() => setIsAutoWalking(!isAutoWalking)}
          >
            <Text style={styles.autoWalkBtnText}>
              {isAutoWalking ? 'STOP AUTO' : 'AUTO WALK'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.resetBtn} onPress={resetSimulation}>
            <Text style={styles.resetBtnText}>RESET</Text>
          </TouchableOpacity>
        </View>

        {/* Other Controls */}
        <View style={styles.otherRow}>
          <TouchableOpacity
            style={[styles.smallBtn, isSettingPosition && styles.smallBtnActive]}
            onPress={() => setIsSettingPosition(!isSettingPosition)}>
            <Text style={styles.smallBtnText}>
              {isSettingPosition ? 'Tap Map...' : 'Set Pos'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.smallBtn} onPress={() => setShowSettings(true)}>
            <Text style={styles.smallBtnText}>Settings</Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Search bar */}
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
          <TouchableOpacity style={styles.clearBtn} onPress={clearDestination}>
            <Text style={styles.clearBtnText}>Clear</Text>
          </TouchableOpacity>
        )}
      </View>
      {showResults && (
        <View style={styles.resultsContainer}>
          <FlatList
            data={searchResults}
            keyExtractor={item => item.id}
            keyboardShouldPersistTaps="handled"
            style={styles.resultsList}
            renderItem={({item}) => (
              <TouchableOpacity
                style={styles.resultItem}
                onPress={() => onSelectDestination(item)}>
                <Text style={styles.resultName}>{item.name}</Text>
                <Text style={styles.resultCategory}>{item.category}</Text>
              </TouchableOpacity>
            )}
          />
        </View>
      )}

      {/* Map */}
      <View style={styles.mapWrapper}>
        <TapGestureHandler
          onHandlerStateChange={e => {
            if (e.nativeEvent.state === State.END) {
              handleMapTap(e);
            }
          }}>
          <PanGestureHandler
            onGestureEvent={e => {
              if (!isSettingPosition) {
                setTranslateX(e.nativeEvent.translationX);
                setTranslateY(e.nativeEvent.translationY);
              }
            }}>
            <PinchGestureHandler
              onGestureEvent={e => {
                setScale(Math.max(0.5, Math.min(e.nativeEvent.scale, 3)));
              }}>
              <Svg
                width="100%"
                height="100%"
                viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}>
                <G
                  scale={scale}
                  translateX={translateX / scale}
                  translateY={translateY / scale}>
                  <Rect x="0" y="0" width={MAP_WIDTH} height={MAP_HEIGHT} fill="#e8e8e8" />

                  {/* Map elements (same as before) */}
                  {[0, 1, 2, 3].map(i => (
                    <React.Fragment key={`r1-${i}`}>
                      <Rect x={20 + i * 180} y={20} width={160} height={95} fill="#cce5ff" stroke="#333" strokeWidth="1" />
                      <SvgText x={60 + i * 180} y={72} fontSize="12">Room {101 + i}</SvgText>
                    </React.Fragment>
                  ))}
                  {[0, 1, 2, 3].map(i => (
                    <React.Fragment key={`r2-${i}`}>
                      <Rect x={20 + i * 180} y={125} width={160} height={95} fill="#cce5ff" stroke="#333" strokeWidth="1" />
                      <SvgText x={60 + i * 180} y={177} fontSize="12">Room {105 + i}</SvgText>
                    </React.Fragment>
                  ))}

                  <Rect x="20" y="230" width="60" height="420" fill="#fff3cd" stroke="#333" strokeWidth="1" />
                  <SvgText x="28" y={440} fontSize="10" transform="rotate(-90 50 440)">Wing A</SvgText>

                  <Rect x="90" y="300" width={920} height="70" fill="#fff3cd" stroke="#333" strokeWidth="1" />
                  <SvgText x={520} y="342" fontSize="14">Main Corridor</SvgText>

                  <Rect x={1000} y="300" width="80" height="350" fill="#fff3cd" stroke="#333" strokeWidth="1" />
                  <SvgText x={1025} y={470} fontSize="10" transform="rotate(-90 1040 470)">Wing B</SvgText>

                  <Rect x="90" y="20" width="200" height="130" fill="#e2f0ff" stroke="#333" strokeWidth="1" />
                  <Rect x="90" y="155" width="95" height="70" fill="#ffeaa7" stroke="#333" strokeWidth="1" />
                  <Rect x="195" y="155" width="95" height="70" fill="#ffeaa7" stroke="#333" strokeWidth="1" />
                  <SvgText x="155" y="55" fontSize="13">Reception</SvgText>
                  <SvgText x="115" y="198" fontSize="11">Office A</SvgText>
                  <SvgText x="220" y="198" fontSize="11">Office B</SvgText>

                  <Rect x="300" y="20" width="70" height="130" fill="#dfe6e9" stroke="#333" strokeWidth="1" />
                  <Rect x="380" y="20" width="70" height="130" fill="#b2bec3" stroke="#333" strokeWidth="1" />
                  <SvgText x="315" y="82" fontSize="11">Stairs</SvgText>
                  <SvgText x="395" y="82" fontSize="11">Elevator</SvgText>

                  <Rect x="460" y="20" width="100" height="130" fill="#d5dbdb" stroke="#333" strokeWidth="1" />
                  <Rect x="570" y="20" width="100" height="130" fill="#d5dbdb" stroke="#333" strokeWidth="1" />
                  <SvgText x="485" y="82" fontSize="11">Restroom</SvgText>
                  <SvgText x="595" y="82" fontSize="11">Restroom</SvgText>
                  <SvgText x="495" y="95" fontSize="9">(M)</SvgText>
                  <SvgText x="605" y="95" fontSize="9">(F)</SvgText>

                  <Rect x="680" y="20" width="140" height="65" fill="#d5f5e3" stroke="#333" strokeWidth="1" />
                  <Rect x="680" y="85" width="140" height="65" fill="#d5f5e3" stroke="#333" strokeWidth="1" />
                  <SvgText x="725" y="58" fontSize="11">Meeting 1</SvgText>
                  <SvgText x="725" y="123" fontSize="11">Meeting 2</SvgText>

                  <Rect x="830" y="20" width="170" height="130" fill="#fadbd8" stroke="#333" strokeWidth="1" />
                  <SvgText x="885" y="82" fontSize="13">Cafeteria</SvgText>

                  <Rect x="90" y="380" width="200" height="110" fill="#d4edda" stroke="#333" strokeWidth="1" />
                  <Rect x="300" y="380" width="200" height="110" fill="#d4edda" stroke="#333" strokeWidth="1" />
                  <Rect x="90" y="500" width="200" height="110" fill="#d4edda" stroke="#333" strokeWidth="1" />
                  <Rect x="300" y="500" width="200" height="110" fill="#d4edda" stroke="#333" strokeWidth="1" />
                  <SvgText x="160" y="442" fontSize="12">Computer Lab</SvgText>
                  <SvgText x="370" y="442" fontSize="12">Electronics Lab</SvgText>
                  <SvgText x="160" y="562" fontSize="12">Physics Lab</SvgText>
                  <SvgText x="370" y="562" fontSize="12">Chem Lab</SvgText>

                  <Rect x="510" y="380" width="400" height="230" fill="#e2d9f3" stroke="#333" strokeWidth="1" />
                  <SvgText x="680" y="500" fontSize="18">Library</SvgText>
                  <Line x1="510" y1="500" x2="910" y2="500" stroke="#333" strokeWidth="1" strokeDasharray="4,2" />
                  <SvgText x="650" y="535" fontSize="11">Reading Area</SvgText>
                  <SvgText x="750" y="535" fontSize="11">Stacks</SvgText>

                  <Rect x="920" y="380" width="90" height="110" fill="#fdebd0" stroke="#333" strokeWidth="1" />
                  <Rect x="920" y="500" width="90" height="110" fill="#fdebd0" stroke="#333" strokeWidth="1" />
                  <SvgText x="935" y="442" fontSize="10">Storage</SvgText>
                  <SvgText x="935" y="562" fontSize="10">Server</SvgText>

                  <Rect x="90" y="620" width="350" height="130" fill="#f8d7da" stroke="#333" strokeWidth="1" />
                  <Rect x="450" y="620" width="460" height="130" fill="#f8d7da" stroke="#333" strokeWidth="1" />
                  <SvgText x="230" y="692" fontSize="14">Indoor Stadium</SvgText>
                  <SvgText x="650" y="692" fontSize="14">Auditorium</SvgText>

                  <Rect x="90" y="760" width={920} height="50" fill="#fff3cd" stroke="#333" strokeWidth="1" />
                  <SvgText x={520} y="788" fontSize="12">South Corridor</SvgText>

                  <Rect x="20" y="660" width="60" height="80" fill="#d5dbdb" stroke="#333" strokeWidth="1" />
                  <SvgText x="32" y="702" fontSize="9" transform="rotate(-90 50 700)">Utility</SvgText>

                  {/* Navigation path */}
                  {pathPointsString ? (
                    <Polyline
                      points={pathPointsString}
                      fill="none"
                      stroke="#007AFF"
                      strokeWidth="6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      opacity={0.9}
                    />
                  ) : null}

                  {/* User position with direction indicator */}
                  {/* Direction arrow (RED) */}
                  <Path
                    d={arrowPath}
                    stroke="#FF3B30"
                    strokeWidth="4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                  {/* Accuracy circle (outer glow) */}
                  <Circle
                    cx={position.x}
                    cy={position.y}
                    r="24"
                    fill="rgba(0,122,255,0.15)"
                  />
                  {/* User dot (BLUE) */}
                  <Circle
                    cx={position.x}
                    cy={position.y}
                    r="14"
                    fill="#007AFF"
                    stroke="#fff"
                    strokeWidth="3"
                  />
                </G>
              </Svg>
            </PinchGestureHandler>
          </PanGestureHandler>
        </TapGestureHandler>

        {isSettingPosition && (
          <View style={styles.settingOverlay}>
            <Text style={styles.settingOverlayText}>
              Tap on the map to set your position
            </Text>
          </View>
        )}
      </View>

      {/* Debug Log */}
      <View style={styles.debugContainer}>
        <Text style={styles.debugTitle}>Debug Log:</Text>
        <ScrollView style={styles.debugScroll} nestedScrollEnabled>
          {debugLog.map((entry, index) => (
            <Text key={index} style={styles.debugEntry}>{entry}</Text>
          ))}
        </ScrollView>
      </View>

      {/* Settings Modal */}
      <Modal
        visible={showSettings}
        transparent
        animationType="slide"
        onRequestClose={() => setShowSettings(false)}>
        <View style={styles.modalContainer}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>Simulation Settings</Text>

            <Text style={styles.settingLabel}>Step Length (meters): {stepLength.toFixed(2)}m</Text>
            <View style={styles.sliderRow}>
              <TouchableOpacity style={styles.adjustBtn} onPress={() => setStepLength(prev => Math.max(0.1, prev - 0.05))}>
                <Text style={styles.adjustBtnText}>-</Text>
              </TouchableOpacity>
              <Text style={styles.sliderValue}>{stepLength.toFixed(2)}</Text>
              <TouchableOpacity style={styles.adjustBtn} onPress={() => setStepLength(prev => Math.min(2.0, prev + 0.05))}>
                <Text style={styles.adjustBtnText}>+</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.settingLabel}>Pixels per Meter: {pixelsPerMeter}</Text>
            <View style={styles.sliderRow}>
              <TouchableOpacity style={styles.adjustBtn} onPress={() => setPixelsPerMeter(prev => Math.max(1, prev - 1))}>
                <Text style={styles.adjustBtnText}>-</Text>
              </TouchableOpacity>
              <Text style={styles.sliderValue}>{pixelsPerMeter}</Text>
              <TouchableOpacity style={styles.adjustBtn} onPress={() => setPixelsPerMeter(prev => Math.min(50, prev + 1))}>
                <Text style={styles.adjustBtnText}>+</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.settingLabel}>Auto-walk Speed: {autoWalkSpeed}ms</Text>
            <View style={styles.sliderRow}>
              <TouchableOpacity style={styles.adjustBtn} onPress={() => setAutoWalkSpeed(prev => Math.max(100, prev - 100))}>
                <Text style={styles.adjustBtnText}>-</Text>
              </TouchableOpacity>
              <Text style={styles.sliderValue}>{autoWalkSpeed}ms</Text>
              <TouchableOpacity style={styles.adjustBtn} onPress={() => setAutoWalkSpeed(prev => Math.min(2000, prev + 100))}>
                <Text style={styles.adjustBtnText}>+</Text>
              </TouchableOpacity>
            </View>

            <Text style={styles.settingHint}>
              Step pixels = stepLength × pixelsPerMeter = {(stepLength * pixelsPerMeter).toFixed(1)}px per step
            </Text>

            <TouchableOpacity
              style={styles.closeBtn}
              onPress={() => setShowSettings(false)}>
              <Text style={styles.closeBtnText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
  statusBar: {
    backgroundColor: '#16213e',
    paddingVertical: 6,
    paddingHorizontal: 12,
    paddingTop: Platform.OS === 'ios' ? 50 : 6,
  },
  statusTitle: {
    color: '#00ff88',
    fontSize: 14,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  statusText: {
    color: '#fff',
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    textAlign: 'center',
  },
  simControlsContainer: {
    backgroundColor: '#0f3460',
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  headingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 6,
  },
  controlLabel: {
    color: '#fff',
    fontSize: 12,
    marginRight: 8,
  },
  rotateBtn: {
    backgroundColor: '#e94560',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 4,
    marginHorizontal: 2,
  },
  rotateBtnText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
  headingDisplay: {
    backgroundColor: '#1a1a2e',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 4,
    marginHorizontal: 4,
    minWidth: 60,
    alignItems: 'center',
  },
  headingValue: {
    color: '#00ff88',
    fontSize: 16,
    fontWeight: 'bold',
  },
  presetRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 6,
  },
  presetBtn: {
    backgroundColor: '#533483',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4,
    marginHorizontal: 4,
  },
  presetBtnText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
  stepRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginBottom: 6,
  },
  stepBtn: {
    backgroundColor: '#00ff88',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderRadius: 8,
    marginHorizontal: 4,
  },
  stepBtnText: {
    color: '#1a1a2e',
    fontSize: 14,
    fontWeight: 'bold',
  },
  autoWalkBtn: {
    backgroundColor: '#ff9f1c',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    marginHorizontal: 4,
  },
  autoWalkBtnActive: {
    backgroundColor: '#ff3b30',
  },
  autoWalkBtnText: {
    color: '#1a1a2e',
    fontSize: 12,
    fontWeight: 'bold',
  },
  resetBtn: {
    backgroundColor: '#636e72',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 8,
    marginHorizontal: 4,
  },
  resetBtnText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  otherRow: {
    flexDirection: 'row',
    justifyContent: 'center',
  },
  smallBtn: {
    backgroundColor: '#4a69bd',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4,
    marginHorizontal: 4,
  },
  smallBtnActive: {
    backgroundColor: '#ffd32a',
  },
  smallBtnText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
  searchRow: {
    flexDirection: 'row',
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: '#fff',
    alignItems: 'center',
  },
  searchInput: {
    flex: 1,
    height: 36,
    backgroundColor: '#f5f5f5',
    borderRadius: 6,
    paddingHorizontal: 10,
    fontSize: 13,
    color: '#333',
  },
  clearBtn: {
    marginLeft: 6,
    paddingHorizontal: 10,
    paddingVertical: 6,
    backgroundColor: '#f0f0f0',
    borderRadius: 6,
  },
  clearBtnText: {
    fontSize: 11,
    color: '#333',
    fontWeight: '600',
  },
  resultsContainer: {
    maxHeight: 150,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  resultsList: {
    maxHeight: 150,
  },
  resultItem: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee',
  },
  resultName: {
    fontSize: 13,
    color: '#111',
    fontWeight: '500',
  },
  resultCategory: {
    fontSize: 10,
    color: '#666',
    marginTop: 1,
  },
  mapWrapper: {
    flex: 1,
    position: 'relative',
  },
  settingOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: 'rgba(255, 214, 10, 0.95)',
    padding: 10,
  },
  settingOverlayText: {
    textAlign: 'center',
    fontSize: 13,
    fontWeight: '600',
    color: '#333',
  },
  debugContainer: {
    backgroundColor: '#1a1a2e',
    maxHeight: 100,
    borderTopWidth: 1,
    borderTopColor: '#333',
  },
  debugTitle: {
    color: '#00ff88',
    fontSize: 11,
    fontWeight: 'bold',
    paddingHorizontal: 8,
    paddingTop: 4,
  },
  debugScroll: {
    paddingHorizontal: 8,
    paddingBottom: 4,
  },
  debugEntry: {
    color: '#aaa',
    fontSize: 10,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  modalContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.7)',
  },
  modalContent: {
    width: '85%',
    backgroundColor: '#16213e',
    borderRadius: 16,
    padding: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 16,
    textAlign: 'center',
    color: '#fff',
  },
  settingLabel: {
    fontSize: 13,
    fontWeight: '600',
    marginTop: 12,
    marginBottom: 4,
    color: '#fff',
  },
  sliderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  adjustBtn: {
    backgroundColor: '#e94560',
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 8,
  },
  adjustBtnText: {
    color: '#fff',
    fontSize: 20,
    fontWeight: 'bold',
  },
  sliderValue: {
    color: '#00ff88',
    fontSize: 18,
    fontWeight: 'bold',
    minWidth: 80,
    textAlign: 'center',
  },
  settingHint: {
    fontSize: 11,
    color: '#888',
    marginTop: 16,
    textAlign: 'center',
  },
  closeBtn: {
    backgroundColor: '#4a69bd',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 20,
  },
  closeBtnText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
});

export default IndoorMapSimulation;
