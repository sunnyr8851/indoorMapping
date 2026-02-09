import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Text,
  FlatList,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import Svg, { Rect, Text as SvgText, Circle, G, Line, Polyline } from 'react-native-svg';
import {
  PinchGestureHandler,
  PanGestureHandler,
  State,
} from 'react-native-gesture-handler';
import { LOCATIONS } from '../data/mapData';
import { getPathFromTo } from '../utils/pathfinding';

const MAP_WIDTH = 1100;
const MAP_HEIGHT = 900;

const IndoorMap2D = () => {
  const [scale, setScale] = useState(1);
  const [translateX, setTranslateX] = useState(0);
  const [translateY, setTranslateY] = useState(0);
  const baseScale = useRef(1);
  const baseTranslateX = useRef(0);
  const baseTranslateY = useRef(0);
  const directionRef = useRef(1);

  // Persist scale when pinch ends so next pinch is cumulative
  useEffect(() => {
    baseScale.current = scale;
  }, [scale]);
  useEffect(() => {
    baseTranslateX.current = translateX;
    baseTranslateY.current = translateY;
  }, [translateX, translateY]);

  const [userPosition, setUserPosition] = useState({ x: 120, y: 320 });
  const [searchQuery, setSearchQuery] = useState('');
  const [showResults, setShowResults] = useState(false);
  const [destination, setDestination] = useState(null);

  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return LOCATIONS;
    const q = searchQuery.trim().toLowerCase();
    return LOCATIONS.filter(
      loc => loc.name.toLowerCase().includes(q) || loc.category.toLowerCase().includes(q)
    );
  }, [searchQuery]);

  const pathPoints = useMemo(() => {
    if (!destination) return [];
    return getPathFromTo(userPosition, destination.nodeId);
  }, [userPosition, destination]);

  const pathPointsString = pathPoints.length > 0
    ? pathPoints.map(p => `${p.x},${p.y}`).join(' ')
    : '';

  useEffect(() => {
    const interval = setInterval(() => {
      setUserPosition(prev => {
        let newX = prev.x + 4 * directionRef.current;
        if (newX > 980) directionRef.current = -1;
        if (newX < 120) directionRef.current = 1;
        return { ...prev, x: newX };
      });
    }, 100);
    return () => clearInterval(interval);
  }, []);

  const onSelectDestination = (loc) => {
    setDestination(loc);
    setSearchQuery(loc.name);
    setShowResults(false);
  };

  const clearDestination = () => {
    setDestination(null);
    setSearchQuery('');
  };

  const zoomIn = () => {
    const s = Math.min(scale * 1.25, 3);
    setScale(s);
    baseScale.current = s;
  };
  const zoomOut = () => {
    const s = Math.max(scale / 1.25, 0.5);
    setScale(s);
    baseScale.current = s;
  };
  const zoomReset = () => {
    setScale(1);
    setTranslateX(0);
    setTranslateY(0);
    baseScale.current = 1;
    baseTranslateX.current = 0;
    baseTranslateY.current = 0;
  };

  return (
    <View style={{marginTop:60,flex:1}}>
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 0}
    >
      <View style={styles.searchRow}>
        <TextInput
          style={styles.searchInput}
          placeholder="Search location (e.g. Indoor Stadium)"
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
            renderItem={({ item }) => (
              <TouchableOpacity
                style={styles.resultItem}
                onPress={() => onSelectDestination(item)}
              >
                <Text style={styles.resultName}>{item.name}</Text>
                <Text style={styles.resultCategory}>{item.category}</Text>
              </TouchableOpacity>
            )}
          />
        </View>
      )}
      <View style={styles.mapWrapper}>
      <PanGestureHandler
        onGestureEvent={(e) => {
          setTranslateX(baseTranslateX.current + e.nativeEvent.translationX);
          setTranslateY(baseTranslateY.current + e.nativeEvent.translationY);
        }}
        onHandlerStateChange={(e) => {
          if (e.nativeEvent.oldState === State.ACTIVE) {
            baseTranslateX.current += e.nativeEvent.translationX;
            baseTranslateY.current += e.nativeEvent.translationY;
          }
        }}
      >
        <PinchGestureHandler
          onGestureEvent={(e) => {
            const newScale = baseScale.current * e.nativeEvent.scale;
            setScale(Math.max(0.5, Math.min(newScale, 3)));
          }}
          onHandlerStateChange={(e) => {
            if (e.nativeEvent.oldState === State.ACTIVE) {
              baseScale.current *= e.nativeEvent.scale;
              baseScale.current = Math.max(0.5, Math.min(baseScale.current, 3));
            }
          }}
        >
          <Svg width="100%" height="100%" viewBox={`0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`}>
            <G
              scale={scale}
              translateX={translateX / scale}
              translateY={translateY / scale}
            >
              <Rect x="0" y="0" width={MAP_WIDTH} height={MAP_HEIGHT} fill="#e8e8e8" />

              {/* North–South corridor (left) */}
              <Rect x="20" y="230" width="60" height="420" fill="#fff3cd" stroke="#333" strokeWidth="1" />
              <SvgText x="28" y={440} fontSize="10" transform="rotate(-90 50 440)">Wing A</SvgText>

              {/* Main horizontal corridor */}
              <Rect x="90" y="300" width={920} height="70" fill="#fff3cd" stroke="#333" strokeWidth="1" />
              <SvgText x={520} y="342" fontSize="14">Main Corridor</SvgText>

              {/* East vertical corridor */}
              <Rect x={1000} y="300" width="80" height="350" fill="#fff3cd" stroke="#333" strokeWidth="1" />
              <SvgText x={1025} y={470} fontSize="10" transform="rotate(-90 1040 470)">Wing B</SvgText>

              {/* ---------- WEST: Admin & Reception ---------- */}
              <Rect x="90" y="20" width="200" height="130" fill="#e2f0ff" stroke="#333" strokeWidth="1" />
              <Rect x="90" y="155" width="95" height="70" fill="#ffeaa7" stroke="#333" strokeWidth="1" />
              <Rect x="195" y="155" width="95" height="70" fill="#ffeaa7" stroke="#333" strokeWidth="1" />
              <SvgText x="155" y="55" fontSize="13">Reception</SvgText>
              <SvgText x="115" y="198" fontSize="11">Office A</SvgText>
              <SvgText x="220" y="198" fontSize="11">Office B</SvgText>

              {/* Stairs & Elevator */}
              <Rect x="300" y="20" width="70" height="130" fill="#dfe6e9" stroke="#333" strokeWidth="1" />
              <Rect x="380" y="20" width="70" height="130" fill="#b2bec3" stroke="#333" strokeWidth="1" />
              <SvgText x="315" y="82" fontSize="11">Stairs</SvgText>
              <SvgText x="395" y="82" fontSize="11">Elevator</SvgText>

              {/* Restrooms */}
              <Rect x="460" y="20" width="100" height="130" fill="#d5dbdb" stroke="#333" strokeWidth="1" />
              <Rect x="570" y="20" width="100" height="130" fill="#d5dbdb" stroke="#333" strokeWidth="1" />
              <SvgText x="485" y="82" fontSize="11">Restroom</SvgText>
              <SvgText x="595" y="82" fontSize="11">Restroom</SvgText>
              <SvgText x="495" y="95" fontSize="9">(M)</SvgText>
              <SvgText x="605" y="95" fontSize="9">(F)</SvgText>

              {/* Meeting rooms */}
              <Rect x="680" y="20" width="140" height="65" fill="#d5f5e3" stroke="#333" strokeWidth="1" />
              <Rect x="680" y="85" width="140" height="65" fill="#d5f5e3" stroke="#333" strokeWidth="1" />
              <SvgText x="725" y="58" fontSize="11">Meeting 1</SvgText>
              <SvgText x="725" y="123" fontSize="11">Meeting 2</SvgText>

              {/* Cafeteria */}
              <Rect x="830" y="20" width="170" height="130" fill="#fadbd8" stroke="#333" strokeWidth="1" />
              <SvgText x="885" y="82" fontSize="13">Cafeteria</SvgText>

              {/* ---------- NORTH WING: Classrooms 101–108 (drawn on top so not hidden) ---------- */}
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

              {/* ---------- CENTRAL: Labs & Library ---------- */}
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

              {/* ---------- EAST: Storage & Server ---------- */}
              <Rect x="920" y="380" width="90" height="110" fill="#fdebd0" stroke="#333" strokeWidth="1" />
              <Rect x="920" y="500" width="90" height="110" fill="#fdebd0" stroke="#333" strokeWidth="1" />
              <SvgText x="935" y="442" fontSize="10">Storage</SvgText>
              <SvgText x="935" y="562" fontSize="10">Server</SvgText>

              {/* ---------- SOUTH: Stadium & Auditorium ---------- */}
              <Rect x="90" y="620" width="350" height="130" fill="#f8d7da" stroke="#333" strokeWidth="1" />
              <Rect x="450" y="620" width="460" height="130" fill="#f8d7da" stroke="#333" strokeWidth="1" />
              <SvgText x="230" y="692" fontSize="14">Indoor Stadium</SvgText>
              <SvgText x="650" y="692" fontSize="14">Auditorium</SvgText>

              {/* South corridor link */}
              <Rect x="90" y="760" width={920} height="50" fill="#fff3cd" stroke="#333" strokeWidth="1" />
              <SvgText x={520} y="788" fontSize="12">South Corridor</SvgText>

              {/* Utility / Janitor */}
              <Rect x="20" y="660" width="60" height="80" fill="#d5dbdb" stroke="#333" strokeWidth="1" />
              <SvgText x="32" y="702" fontSize="9" transform="rotate(-90 50 700)">Utility</SvgText>

              {/* Navigation path (real-time: recomputed when userPosition or destination changes) */}
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

              {/* User dot (coordinates from demo; replace with BLE/trilateration for real-time) */}
              <Circle cx={userPosition.x} cy={userPosition.y} r="10" fill="#007AFF" stroke="#fff" strokeWidth="2" />
              <Circle cx={userPosition.x} cy={userPosition.y} r="18" fill="rgba(0,122,255,0.2)" />
            </G>
          </Svg>
        </PinchGestureHandler>
      </PanGestureHandler>
        {/* Zoom controls */}
        <View style={styles.zoomControls}>
          <TouchableOpacity style={styles.zoomBtn} onPress={zoomIn}>
            <Text style={styles.zoomBtnText}>+</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.zoomBtn} onPress={zoomOut}>
            <Text style={styles.zoomBtnText}>−</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.zoomBtn} onPress={zoomReset}>
            <Text style={styles.zoomBtnText}>⟲</Text>
          </TouchableOpacity>
          <Text style={styles.zoomLabel}>{scale.toFixed(1)}×</Text>
        </View>
      </View>
    </KeyboardAvoidingView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1 },
  searchRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 8,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
    alignItems: 'center',
  },
  searchInput: {
    flex: 1,
    height: 44,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
    paddingHorizontal: 12,
    fontSize: 16,
    color: '#333',
  },
  clearBtn: {
    marginLeft: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#f0f0f0',
    borderRadius: 8,
  },
  clearBtnText: { fontSize: 14, color: '#333', fontWeight: '600' },
  resultsContainer: {
    maxHeight: 220,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  resultsList: { maxHeight: 220 },
  resultItem: {
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#eee',
  },
  resultName: { fontSize: 16, color: '#111', fontWeight: '500' },
  resultCategory: { fontSize: 12, color: '#666', marginTop: 2 },
  mapWrapper: { flex: 1 },
  zoomControls: {
    position: 'absolute',
    right: 12,
    bottom: 24,
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: 8,
    paddingVertical: 4,
    paddingHorizontal: 6,
    flexDirection: 'column',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    elevation: 3,
  },
  zoomBtn: {
    width: 40,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  zoomBtnText: { fontSize: 22, color: '#333', fontWeight: '600' },
  zoomLabel: { fontSize: 11, color: '#666', marginTop: 2 },
});

export default IndoorMap2D;
