/**
 * Office map - WiFi Indoor Positioning
 * 
 * AP Manager: Configure access points for mapping
 * Phase 1: Field Mapping - collect RSSI data per tile
 * Phase 2: Live Positioning - scan and find position from saved data
 */

import React, { useState, useCallback } from 'react';
import { View, StyleSheet, ScrollView, Platform, TouchableOpacity, Text, StatusBar, SafeAreaView } from 'react-native';
import FieldMapperPanel from './FieldMapperPanel';
import WifiPositioningPanel from './WifiPositioningPanel';
import AccessPointManagerScreen from './AccessPointManagerScreen';

export default function OfficeMap() {
  const [activeTab, setActiveTab] = useState('apManager'); // 'apManager' | 'mapping' | 'positioning'
  const [selectedAPs, setSelectedAPs] = useState([]);

  const handleAPsSelected = useCallback((aps) => {
    setSelectedAPs(aps);
    // Auto-switch to mapping tab after selection
    setActiveTab('mapping');
  }, []);

  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar barStyle="light-content" backgroundColor="#1a1a2e" />
      <View style={styles.container}>
      {/* Tab Switcher */}
      <View style={styles.tabContainer}>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'apManager' && styles.tabActive]}
          onPress={() => setActiveTab('apManager')}
        >
          <Text style={[styles.tabText, activeTab === 'apManager' && styles.tabTextActive]}>
            AP Manager
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'mapping' && styles.tabActive]}
          onPress={() => setActiveTab('mapping')}
        >
          <Text style={[styles.tabText, activeTab === 'mapping' && styles.tabTextActive]}>
            Mapping
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.tab, activeTab === 'positioning' && styles.tabActive]}
          onPress={() => setActiveTab('positioning')}
        >
          <Text style={[styles.tabText, activeTab === 'positioning' && styles.tabTextActive]}>
            Positioning
          </Text>
        </TouchableOpacity>
      </View>

      {activeTab === 'apManager' ? (
        <AccessPointManagerScreen onAPsSelected={handleAPsSelected} />
      ) : (
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator
        >
          {activeTab === 'mapping' ? (
            <FieldMapperPanel selectedAPs={selectedAPs} />
          ) : (
            <WifiPositioningPanel />
          )}
        </ScrollView>
      )}
    </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    paddingTop: Platform.OS === 'android' ? StatusBar.currentHeight : 0,
  },
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
  tabContainer: {
    flexDirection: 'row',
    paddingHorizontal: 8,
    paddingTop: 8,
    backgroundColor: '#1a1a2e',
  },
  tab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: '#16213e',
    marginHorizontal: 4,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#333',
  },
  tabActive: {
    backgroundColor: '#2d4a3e',
    borderColor: '#00ff88',
  },
  tabText: {
    color: '#888',
    fontWeight: '600',
    fontSize: 12,
  },
  tabTextActive: {
    color: '#00ff88',
  },
  scroll: { flex: 1 },
  scrollContent: { paddingBottom: 24 },
});
