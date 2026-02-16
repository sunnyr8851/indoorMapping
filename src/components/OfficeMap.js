/**
 * Office map - Field Mapping only.
 * Floor walking data collection: RSSI + GPS, 3×3 ft tiles, directional buttons.
 */

import React from 'react';
import { View, StyleSheet, ScrollView, Platform } from 'react-native';
import FieldMapperPanel from './FieldMapperPanel';

export default function OfficeMap() {
  return (
    <View style={styles.container}>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator
      >
        <FieldMapperPanel />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    paddingTop: Platform.OS === 'ios' ? 50 : 8,
  },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 24 },
});
