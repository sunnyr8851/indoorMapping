import 'react-native-gesture-handler';
import React from 'react';
import { StyleSheet } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

// Available components:
import IndoorMap2D from './src/components/IndoorMap2D';              // Demo mode (auto-moving dot)
// import IndoorMapPDR from './src/components/IndoorMapPDR';         // Original PDR (may have sensor issues)
// import IndoorMapSimulation from './src/components/IndoorMapSimulation'; // Simulation (manual buttons)
// import IndoorMapRealPDR from './src/components/IndoorMapRealPDR';   // Real PDR with debug display
// import TestRoomPDR from './src/components/TestRoomPDR';           // Dummy map: 30x60m – practice PDR first
// import FirstFloorPDR from './src/components/FirstFloorPDR';     // REAL FLOOR MAP with PDR (unchanged)
import OfficeMap from './src/components/OfficeMap';
// ...

const App = () => {
  return (
    <GestureHandlerRootView style={styles.container}>
      {/* Demo: IndoorMap2D – dummy map, search, pathfinding, auto-moving dot */}
      {/* <IndoorMap2D /> */}
      <OfficeMap />
    </GestureHandlerRootView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1
  }
});

export default App;
