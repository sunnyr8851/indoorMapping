/**
 * Indoor Map with Pedestrian Dead Reckoning (PDR)
 * 
 * This component uses smartphone sensors (accelerometer, gyroscope, magnetometer)
 * to track user position without external infrastructure.
 * 
 * HOW TO TEST:
 * 1. Tap "Set Position" and tap on the map to set your starting location
 * 2. Tap "Start PDR" to begin tracking
 * 3. Walk around - the blue dot should move with you
 * 4. Use "Calibrate Compass" when facing a known direction
 * 
 * ADJUST settings if tracking is inaccurate:
 * - Step Length: Measure your actual step length (heel to heel)
 * - Pixels/Meter: Adjust based on your map scale
 */

import React, { useState, useMemo, useCallback } from 'react';
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
import { usePDR } from '../hooks/usePDR';

const MAP_WIDTH = 1100;
const MAP_HEIGHT = 900;

// Default starting position (main corridor)
const DEFAULT_POSITION = { x: 550, y: 335 };

const IndoorMapPDR = () => {
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
  const [stepLengthInput, setStepLengthInput] = useState('0.65');
  const [pixelsPerMeterInput, setPixelsPerMeterInput] = useState('10');

  // PDR configuration
  const [stepLength, setStepLength] = useState(0.65);
  const [pixelsPerMeter, setPixelsPerMeter] = useState(10);

  // PDR hook
  const {
    position,
    headingDegrees,
    stepCount,
    totalDistance,
    isRunning,
    start,
    stop,
    resetPosition,
    calibrateHeading,
    calibrateWithCompass,
  } = usePDR({
    initialPosition: DEFAULT_POSITION,
    initialHeading: 0,
    stepLength,
    pixelsPerMeter,
    autoStart: false,
  });

  // Search filtering
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return LOCATIONS;
    const q = searchQuery.trim().toLowerCase();
    return LOCATIONS.filter(
      loc =>
        loc.name.toLowerCase().includes(q) ||
        loc.category.toLowerCase().includes(q)
    );
  }, [searchQuery]);

  // Path calculation
  const pathPoints = useMemo(() => {
    if (!destination) return [];
    return getPathFromTo(position, destination.nodeId);
  }, [position, destination]);

  const pathPointsString =
    pathPoints.length > 0
      ? pathPoints.map(p => `${p.x},${p.y}`).join(' ')
      : '';

  // Destination selection
  const onSelectDestination = useCallback(loc => {
    setDestination(loc);
    setSearchQuery(loc.name);
    setShowResults(false);
  }, []);

  const clearDestination = useCallback(() => {
    setDestination(null);
    setSearchQuery('');
  }, []);

  // Handle tap on map to set position
  const handleMapTap = useCallback(
    event => {
      if (!isSettingPosition) return;

      const { x, y } = event.nativeEvent;
      
      // Convert screen coordinates to map coordinates
      // Account for scale and translation
      const mapX = (x - translateX) / scale;
      const mapY = (y - translateY) / scale;

      // Clamp to map bounds
      const clampedX = Math.max(0, Math.min(MAP_WIDTH, mapX));
      const clampedY = Math.max(0, Math.min(MAP_HEIGHT, mapY));

      resetPosition({ x: clampedX, y: clampedY });
      setIsSettingPosition(false);
      
      Alert.alert(
        'Position Set',
        `Starting position set to (${Math.round(clampedX)}, ${Math.round(clampedY)})\n\nNow tap "Start PDR" and start walking!`
      );
    },
    [isSettingPosition, scale, translateX, translateY, resetPosition]
  );

  // PDR controls
  const handleStartPDR = useCallback(() => {
    start(position, 0);
  }, [start, position]);

  const handleStopPDR = useCallback(() => {
    stop();
  }, [stop]);

  const handleCalibrate = useCallback(() => {
    Alert.alert(
      'Calibrate Heading',
      'Point your phone in the direction you want to face (0° = up on map), then choose a method:',
      [
        {
          text: 'Use Compass',
          onPress: () => calibrateWithCompass(),
        },
        {
          text: 'Face Up (0°)',
          onPress: () => calibrateHeading(0),
        },
        {
          text: 'Face Right (90°)',
          onPress: () => calibrateHeading(90),
        },
        {
          text: 'Cancel',
          style: 'cancel',
        },
      ]
    );
  }, [calibrateHeading, calibrateWithCompass]);

  // Settings
  const handleSaveSettings = useCallback(() => {
    const newStepLength = parseFloat(stepLengthInput) || 0.65;
    const newPixelsPerMeter = parseFloat(pixelsPerMeterInput) || 10;
    setStepLength(newStepLength);
    setPixelsPerMeter(newPixelsPerMeter);
    setShowSettings(false);
  }, [stepLengthInput, pixelsPerMeterInput]);

  // Direction indicator arrow
  const arrowPath = useMemo(() => {
    const size = 20;
    const angle = ((headingDegrees - 90) * Math.PI) / 180; // Adjust for SVG coordinates
    const tipX = position.x + size * Math.cos(angle);
    const tipY = position.y + size * Math.sin(angle);
    return `M ${position.x} ${position.y} L ${tipX} ${tipY}`;
  }, [position, headingDegrees]);

  return (
    <View style={styles.container}>
      {/* Status bar */}
      <View style={styles.statusBar}>
        <Text style={styles.statusText}>
          Steps: {stepCount} | Distance: {totalDistance.toFixed(1)}m | Heading:{' '}
          {Math.round(headingDegrees)}°
        </Text>
        <Text style={styles.statusText}>
          Position: ({Math.round(position.x)}, {Math.round(position.y)})
        </Text>
      </View>

      {/* Control buttons */}
      <View style={styles.controlRow}>
        <TouchableOpacity
          style={[
            styles.controlBtn,
            isSettingPosition && styles.controlBtnActive,
          ]}
          onPress={() => setIsSettingPosition(!isSettingPosition)}>
          <Text style={styles.controlBtnText}>
            {isSettingPosition ? 'Tap Map...' : 'Set Position'}
          </Text>
        </TouchableOpacity>

        {!isRunning ? (
          <TouchableOpacity
            style={[styles.controlBtn, styles.startBtn]}
            onPress={handleStartPDR}>
            <Text style={styles.controlBtnText}>Start PDR</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={[styles.controlBtn, styles.stopBtn]}
            onPress={handleStopPDR}>
            <Text style={styles.controlBtnText}>Stop PDR</Text>
          </TouchableOpacity>
        )}

        <TouchableOpacity style={styles.controlBtn} onPress={handleCalibrate}>
          <Text style={styles.controlBtnText}>Calibrate</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.controlBtn}
          onPress={() => setShowSettings(true)}>
          <Text style={styles.controlBtnText}>Settings</Text>
        </TouchableOpacity>
      </View>

      {/* Search bar */}
      <KeyboardAvoidingView
        style={styles.searchContainer}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
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
      </KeyboardAvoidingView>

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
                  <Rect
                    x="0"
                    y="0"
                    width={MAP_WIDTH}
                    height={MAP_HEIGHT}
                    fill="#e8e8e8"
                  />

                  {/* ---------- NORTH WING: Classrooms 101–108 ---------- */}
                  {[0, 1, 2, 3].map(i => (
                    <React.Fragment key={`r1-${i}`}>
                      <Rect
                        x={20 + i * 180}
                        y={20}
                        width={160}
                        height={95}
                        fill="#cce5ff"
                        stroke="#333"
                        strokeWidth="1"
                      />
                      <SvgText x={60 + i * 180} y={72} fontSize="12">
                        Room {101 + i}
                      </SvgText>
                    </React.Fragment>
                  ))}
                  {[0, 1, 2, 3].map(i => (
                    <React.Fragment key={`r2-${i}`}>
                      <Rect
                        x={20 + i * 180}
                        y={125}
                        width={160}
                        height={95}
                        fill="#cce5ff"
                        stroke="#333"
                        strokeWidth="1"
                      />
                      <SvgText x={60 + i * 180} y={177} fontSize="12">
                        Room {105 + i}
                      </SvgText>
                    </React.Fragment>
                  ))}

                  {/* North–South corridor (left) */}
                  <Rect
                    x="20"
                    y="230"
                    width="60"
                    height="420"
                    fill="#fff3cd"
                    stroke="#333"
                    strokeWidth="1"
                  />
                  <SvgText
                    x="28"
                    y={440}
                    fontSize="10"
                    transform="rotate(-90 50 440)">
                    Wing A
                  </SvgText>

                  {/* Main horizontal corridor */}
                  <Rect
                    x="90"
                    y="300"
                    width={920}
                    height="70"
                    fill="#fff3cd"
                    stroke="#333"
                    strokeWidth="1"
                  />
                  <SvgText x={520} y="342" fontSize="14">
                    Main Corridor
                  </SvgText>

                  {/* East vertical corridor */}
                  <Rect
                    x={1000}
                    y="300"
                    width="80"
                    height="350"
                    fill="#fff3cd"
                    stroke="#333"
                    strokeWidth="1"
                  />
                  <SvgText
                    x={1025}
                    y={470}
                    fontSize="10"
                    transform="rotate(-90 1040 470)">
                    Wing B
                  </SvgText>

                  {/* ---------- WEST: Admin & Reception ---------- */}
                  <Rect
                    x="90"
                    y="20"
                    width="200"
                    height="130"
                    fill="#e2f0ff"
                    stroke="#333"
                    strokeWidth="1"
                  />
                  <Rect
                    x="90"
                    y="155"
                    width="95"
                    height="70"
                    fill="#ffeaa7"
                    stroke="#333"
                    strokeWidth="1"
                  />
                  <Rect
                    x="195"
                    y="155"
                    width="95"
                    height="70"
                    fill="#ffeaa7"
                    stroke="#333"
                    strokeWidth="1"
                  />
                  <SvgText x="155" y="55" fontSize="13">
                    Reception
                  </SvgText>
                  <SvgText x="115" y="198" fontSize="11">
                    Office A
                  </SvgText>
                  <SvgText x="220" y="198" fontSize="11">
                    Office B
                  </SvgText>

                  {/* Stairs & Elevator */}
                  <Rect
                    x="300"
                    y="20"
                    width="70"
                    height="130"
                    fill="#dfe6e9"
                    stroke="#333"
                    strokeWidth="1"
                  />
                  <Rect
                    x="380"
                    y="20"
                    width="70"
                    height="130"
                    fill="#b2bec3"
                    stroke="#333"
                    strokeWidth="1"
                  />
                  <SvgText x="315" y="82" fontSize="11">
                    Stairs
                  </SvgText>
                  <SvgText x="395" y="82" fontSize="11">
                    Elevator
                  </SvgText>

                  {/* Restrooms */}
                  <Rect
                    x="460"
                    y="20"
                    width="100"
                    height="130"
                    fill="#d5dbdb"
                    stroke="#333"
                    strokeWidth="1"
                  />
                  <Rect
                    x="570"
                    y="20"
                    width="100"
                    height="130"
                    fill="#d5dbdb"
                    stroke="#333"
                    strokeWidth="1"
                  />
                  <SvgText x="485" y="82" fontSize="11">
                    Restroom
                  </SvgText>
                  <SvgText x="595" y="82" fontSize="11">
                    Restroom
                  </SvgText>
                  <SvgText x="495" y="95" fontSize="9">
                    (M)
                  </SvgText>
                  <SvgText x="605" y="95" fontSize="9">
                    (F)
                  </SvgText>

                  {/* Meeting rooms */}
                  <Rect
                    x="680"
                    y="20"
                    width="140"
                    height="65"
                    fill="#d5f5e3"
                    stroke="#333"
                    strokeWidth="1"
                  />
                  <Rect
                    x="680"
                    y="85"
                    width="140"
                    height="65"
                    fill="#d5f5e3"
                    stroke="#333"
                    strokeWidth="1"
                  />
                  <SvgText x="725" y="58" fontSize="11">
                    Meeting 1
                  </SvgText>
                  <SvgText x="725" y="123" fontSize="11">
                    Meeting 2
                  </SvgText>

                  {/* Cafeteria */}
                  <Rect
                    x="830"
                    y="20"
                    width="170"
                    height="130"
                    fill="#fadbd8"
                    stroke="#333"
                    strokeWidth="1"
                  />
                  <SvgText x="885" y="82" fontSize="13">
                    Cafeteria
                  </SvgText>

                  {/* ---------- CENTRAL: Labs & Library ---------- */}
                  <Rect
                    x="90"
                    y="380"
                    width="200"
                    height="110"
                    fill="#d4edda"
                    stroke="#333"
                    strokeWidth="1"
                  />
                  <Rect
                    x="300"
                    y="380"
                    width="200"
                    height="110"
                    fill="#d4edda"
                    stroke="#333"
                    strokeWidth="1"
                  />
                  <Rect
                    x="90"
                    y="500"
                    width="200"
                    height="110"
                    fill="#d4edda"
                    stroke="#333"
                    strokeWidth="1"
                  />
                  <Rect
                    x="300"
                    y="500"
                    width="200"
                    height="110"
                    fill="#d4edda"
                    stroke="#333"
                    strokeWidth="1"
                  />
                  <SvgText x="160" y="442" fontSize="12">
                    Computer Lab
                  </SvgText>
                  <SvgText x="370" y="442" fontSize="12">
                    Electronics Lab
                  </SvgText>
                  <SvgText x="160" y="562" fontSize="12">
                    Physics Lab
                  </SvgText>
                  <SvgText x="370" y="562" fontSize="12">
                    Chem Lab
                  </SvgText>

                  <Rect
                    x="510"
                    y="380"
                    width="400"
                    height="230"
                    fill="#e2d9f3"
                    stroke="#333"
                    strokeWidth="1"
                  />
                  <SvgText x="680" y="500" fontSize="18">
                    Library
                  </SvgText>
                  <Line
                    x1="510"
                    y1="500"
                    x2="910"
                    y2="500"
                    stroke="#333"
                    strokeWidth="1"
                    strokeDasharray="4,2"
                  />
                  <SvgText x="650" y="535" fontSize="11">
                    Reading Area
                  </SvgText>
                  <SvgText x="750" y="535" fontSize="11">
                    Stacks
                  </SvgText>

                  {/* ---------- EAST: Storage & Server ---------- */}
                  <Rect
                    x="920"
                    y="380"
                    width="90"
                    height="110"
                    fill="#fdebd0"
                    stroke="#333"
                    strokeWidth="1"
                  />
                  <Rect
                    x="920"
                    y="500"
                    width="90"
                    height="110"
                    fill="#fdebd0"
                    stroke="#333"
                    strokeWidth="1"
                  />
                  <SvgText x="935" y="442" fontSize="10">
                    Storage
                  </SvgText>
                  <SvgText x="935" y="562" fontSize="10">
                    Server
                  </SvgText>

                  {/* ---------- SOUTH: Stadium & Auditorium ---------- */}
                  <Rect
                    x="90"
                    y="620"
                    width="350"
                    height="130"
                    fill="#f8d7da"
                    stroke="#333"
                    strokeWidth="1"
                  />
                  <Rect
                    x="450"
                    y="620"
                    width="460"
                    height="130"
                    fill="#f8d7da"
                    stroke="#333"
                    strokeWidth="1"
                  />
                  <SvgText x="230" y="692" fontSize="14">
                    Indoor Stadium
                  </SvgText>
                  <SvgText x="650" y="692" fontSize="14">
                    Auditorium
                  </SvgText>

                  {/* South corridor link */}
                  <Rect
                    x="90"
                    y="760"
                    width={920}
                    height="50"
                    fill="#fff3cd"
                    stroke="#333"
                    strokeWidth="1"
                  />
                  <SvgText x={520} y="788" fontSize="12">
                    South Corridor
                  </SvgText>

                  {/* Utility / Janitor */}
                  <Rect
                    x="20"
                    y="660"
                    width="60"
                    height="80"
                    fill="#d5dbdb"
                    stroke="#333"
                    strokeWidth="1"
                  />
                  <SvgText
                    x="32"
                    y="702"
                    fontSize="9"
                    transform="rotate(-90 50 700)">
                    Utility
                  </SvgText>

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
                  {/* Direction arrow */}
                  <Path
                    d={arrowPath}
                    stroke="#FF3B30"
                    strokeWidth="3"
                    strokeLinecap="round"
                  />
                  {/* Accuracy circle (outer glow) */}
                  <Circle
                    cx={position.x}
                    cy={position.y}
                    r="22"
                    fill="rgba(0,122,255,0.15)"
                  />
                  {/* User dot */}
                  <Circle
                    cx={position.x}
                    cy={position.y}
                    r="12"
                    fill="#007AFF"
                    stroke="#fff"
                    strokeWidth="3"
                  />
                </G>
              </Svg>
            </PinchGestureHandler>
          </PanGestureHandler>
        </TapGestureHandler>

        {/* Position setting overlay */}
        {isSettingPosition && (
          <View style={styles.settingOverlay}>
            <Text style={styles.settingOverlayText}>
              Tap on the map to set your starting position
            </Text>
          </View>
        )}
      </View>

      {/* Settings Modal */}
      <Modal
        visible={showSettings}
        transparent
        animationType="slide"
        onRequestClose={() => setShowSettings(false)}>
        <View style={styles.modalContainer}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>PDR Settings</Text>

            <Text style={styles.settingLabel}>
              Step Length (meters): {stepLength.toFixed(2)}m
            </Text>
            <TextInput
              style={styles.settingInput}
              value={stepLengthInput}
              onChangeText={setStepLengthInput}
              keyboardType="decimal-pad"
              placeholder="0.65"
            />
            <Text style={styles.settingHint}>
              Average adult: 0.6-0.8m. Measure your step (heel to heel).
            </Text>

            <Text style={styles.settingLabel}>
              Pixels per Meter: {pixelsPerMeter}
            </Text>
            <TextInput
              style={styles.settingInput}
              value={pixelsPerMeterInput}
              onChangeText={setPixelsPerMeterInput}
              keyboardType="decimal-pad"
              placeholder="10"
            />
            <Text style={styles.settingHint}>
              Map scale factor. Increase if dot moves too slowly.
            </Text>

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[styles.modalBtn, styles.cancelBtn]}
                onPress={() => setShowSettings(false)}>
                <Text style={styles.modalBtnText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.modalBtn, styles.saveBtn]}
                onPress={handleSaveSettings}>
                <Text style={styles.modalBtnText}>Save</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  statusBar: {
    backgroundColor: '#333',
    paddingVertical: 8,
    paddingHorizontal: 12,
    paddingTop: Platform.OS === 'ios' ? 50 : 8,
  },
  statusText: {
    color: '#fff',
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  controlRow: {
    flexDirection: 'row',
    padding: 8,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#ddd',
  },
  controlBtn: {
    flex: 1,
    marginHorizontal: 4,
    paddingVertical: 10,
    backgroundColor: '#f0f0f0',
    borderRadius: 8,
    alignItems: 'center',
  },
  controlBtnActive: {
    backgroundColor: '#FFD60A',
  },
  startBtn: {
    backgroundColor: '#34C759',
  },
  stopBtn: {
    backgroundColor: '#FF3B30',
  },
  controlBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#333',
  },
  searchContainer: {
    backgroundColor: '#fff',
  },
  searchRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 8,
    alignItems: 'center',
  },
  searchInput: {
    flex: 1,
    height: 40,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 14,
    color: '#333',
  },
  clearBtn: {
    marginLeft: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#f0f0f0',
    borderRadius: 8,
  },
  clearBtnText: {
    fontSize: 12,
    color: '#333',
    fontWeight: '600',
  },
  resultsContainer: {
    maxHeight: 180,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  resultsList: {
    maxHeight: 180,
  },
  resultItem: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee',
  },
  resultName: {
    fontSize: 14,
    color: '#111',
    fontWeight: '500',
  },
  resultCategory: {
    fontSize: 11,
    color: '#666',
    marginTop: 2,
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
    backgroundColor: 'rgba(255, 214, 10, 0.9)',
    padding: 12,
  },
  settingOverlayText: {
    textAlign: 'center',
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  modalContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  modalContent: {
    width: '85%',
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 16,
    textAlign: 'center',
  },
  settingLabel: {
    fontSize: 14,
    fontWeight: '600',
    marginTop: 12,
    marginBottom: 4,
  },
  settingInput: {
    height: 44,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 16,
  },
  settingHint: {
    fontSize: 11,
    color: '#666',
    marginTop: 4,
  },
  modalButtons: {
    flexDirection: 'row',
    marginTop: 20,
  },
  modalBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginHorizontal: 4,
  },
  cancelBtn: {
    backgroundColor: '#f0f0f0',
  },
  saveBtn: {
    backgroundColor: '#007AFF',
  },
  modalBtnText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
});

export default IndoorMapPDR;
