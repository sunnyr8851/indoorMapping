/**
 * Access Point Manager Screen
 * 
 * Features:
 * - Fetch all nearby APs with RSSI
 * - Select specific APs or use all
 * - Manually add APs by BSSID/SSID
 * - Filter and export JSON mapping data
 */

import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Platform,
  ActivityIndicator,
  Alert,
} from 'react-native';

import {
  fetchAccessPoints,
  filterAccessPoints,
  createManualAP,
  filterMappingJSON,
  loadJSONFile,
  saveFilteredJSON,
  listMappingFiles,
  exportToCodebase,
} from '../utils/wifiAccessPointManager';
import { normalizeBssid } from '../utils/wifiScan';

export default function AccessPointManagerScreen({ onAPsSelected }) {
  // Fetched APs
  const [fetchedAPs, setFetchedAPs] = useState([]);
  const [fetchingAPs, setFetchingAPs] = useState(false);

  // Selection state
  const [selectedBssids, setSelectedBssids] = useState(new Set());

  // Manual AP input
  const [manualInput, setManualInput] = useState('');
  const [manualInputType, setManualInputType] = useState('bssid'); // 'bssid' or 'ssid'
  const [manualAPs, setManualAPs] = useState([]);

  // JSON filtering
  const [mappingFiles, setMappingFiles] = useState([]);
  const [selectedFile, setSelectedFile] = useState(null);
  const [exporting, setExporting] = useState(false);

  // Log
  const [log, setLog] = useState([]);

  const addLog = useCallback((msg) => {
    const t = new Date().toLocaleTimeString();
    setLog(prev => [`[${t}] ${msg}`, ...prev.slice(0, 19)]);
  }, []);

  /* ---------------- FETCH APs ---------------- */

  const handleFetchAPs = useCallback(async () => {
    setFetchingAPs(true);
    addLog('Requesting permission...');

    try {
      const list = await fetchAccessPoints();
      setFetchedAPs(list);
      setSelectedBssids(new Set()); // Clear selection
      addLog(`Found ${list.length} access point(s)`);
    } catch (e) {
      addLog(`Error: ${e.message}`);
    } finally {
      setFetchingAPs(false);
    }
  }, [addLog]);

  /* ---------------- SELECTION ---------------- */

  const toggleSelection = useCallback((bssid) => {
    setSelectedBssids(prev => {
      const newSet = new Set(prev);
      if (newSet.has(bssid)) {
        newSet.delete(bssid);
      } else {
        newSet.add(bssid);
      }
      return newSet;
    });
  }, []);

  const selectAll = useCallback(() => {
    const allBssids = fetchedAPs.map(ap => ap.bssid);
    setSelectedBssids(new Set(allBssids));
    addLog(`Selected all ${allBssids.length} APs`);
  }, [fetchedAPs, addLog]);

  const deselectAll = useCallback(() => {
    setSelectedBssids(new Set());
    addLog('Cleared selection (will use ALL APs)');
  }, [addLog]);

  const selectTopN = useCallback((n) => {
    const topBssids = fetchedAPs.slice(0, n).map(ap => ap.bssid);
    setSelectedBssids(new Set(topBssids));
    addLog(`Selected top ${topBssids.length} APs`);
  }, [fetchedAPs, addLog]);

  /* ---------------- MANUAL AP ---------------- */

  const handleAddManualAP = useCallback(() => {
    if (!manualInput.trim()) {
      addLog('Enter BSSID or SSID');
      return;
    }

    const newAP = createManualAP(manualInput.trim(), manualInputType);
    
    // Check if already exists
    const exists = manualAPs.some(
      ap => normalizeBssid(ap.bssid) === normalizeBssid(newAP.bssid) ||
            (ap.ssid === newAP.ssid && newAP.ssid !== 'Manual')
    );

    if (exists) {
      addLog('AP already in manual list');
      return;
    }

    setManualAPs(prev => [...prev, newAP]);
    setManualInput('');
    addLog(`Added manual AP: ${manualInputType === 'bssid' ? newAP.bssid : newAP.ssid}`);
  }, [manualInput, manualInputType, manualAPs, addLog]);

  const removeManualAP = useCallback((index) => {
    setManualAPs(prev => prev.filter((_, i) => i !== index));
    addLog('Removed manual AP');
  }, [addLog]);

  /* ---------------- USE SELECTED ---------------- */

  const handleUseSelected = useCallback(() => {
    const filteredAPs = filterAccessPoints(fetchedAPs, selectedBssids, manualAPs);
    
    const message = selectedBssids.size === 0
      ? `Using ALL ${filteredAPs.length} APs (no selection)`
      : `Using ${filteredAPs.length} selected APs`;
    
    addLog(message);

    // Pass to parent if callback provided
    if (onAPsSelected) {
      onAPsSelected(filteredAPs);
    }

    Alert.alert(
      'APs Configured',
      `${filteredAPs.length} access point(s) will be used for mapping.\n\n` +
      `Selected: ${selectedBssids.size || 'All'}\nManual: ${manualAPs.length}`,
      [{ text: 'OK' }]
    );
  }, [fetchedAPs, selectedBssids, manualAPs, onAPsSelected, addLog]);

  /* ---------------- JSON FILTERING ---------------- */

  const handleLoadMappingFiles = useCallback(async () => {
    const files = await listMappingFiles();
    setMappingFiles(files);
    addLog(`Found ${files.length} mapping file(s)`);
  }, [addLog]);

  const handleFilterAndExport = useCallback(async () => {
    if (!selectedFile) {
      addLog('Select a mapping file first');
      return;
    }

    setExporting(true);
    addLog('Loading and filtering JSON...');

    try {
      // Load original JSON
      const originalData = await loadJSONFile(selectedFile.path);
      addLog(`Loaded: ${originalData.nodes?.length || 0} nodes`);

      // Get selected APs
      const selectedAPsList = filterAccessPoints(fetchedAPs, selectedBssids, manualAPs);

      // Filter the JSON
      const filteredData = filterMappingJSON(originalData, selectedAPsList, manualAPs);

      // Save filtered JSON
      const timestamp = Date.now();
      const fileName = `filtered_floor_${originalData.floor || 1}_${timestamp}.json`;
      const savedPath = await saveFilteredJSON(filteredData, fileName);
      
      addLog(`Saved: ${fileName}`);

      // Also export to codebase
      const result = await exportToCodebase(filteredData);
      if (result.ok) {
        addLog('Exported to codebase');
      } else {
        addLog(`Export error: ${result.error}`);
      }

      Alert.alert('Export Complete', `Filtered JSON saved to:\n${savedPath}`);
    } catch (e) {
      addLog(`Error: ${e.message}`);
    } finally {
      setExporting(false);
    }
  }, [selectedFile, fetchedAPs, selectedBssids, manualAPs, addLog]);

  /* ---------------- COMPUTED VALUES ---------------- */

  const uniqueSSIDs = useMemo(() => {
    return [...new Set(fetchedAPs.map(ap => ap.ssid || 'Hidden'))];
  }, [fetchedAPs]);

  const selectBySSID = useCallback((ssid) => {
    const matching = fetchedAPs
      .filter(ap => (ap.ssid || 'Hidden') === ssid)
      .map(ap => ap.bssid);
    setSelectedBssids(prev => {
      const newSet = new Set(prev);
      matching.forEach(bssid => newSet.add(bssid));
      return newSet;
    });
    addLog(`Added ${matching.length} APs with SSID: ${ssid}`);
  }, [fetchedAPs, addLog]);

  /* ---------------- RENDER ---------------- */

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Access Point Manager</Text>

      {/* Fetch APs Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>1. Fetch Access Points</Text>
        <TouchableOpacity
          style={[styles.btn, styles.fetchBtn]}
          onPress={handleFetchAPs}
          disabled={fetchingAPs}
        >
          {fetchingAPs ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.btnText}>Fetch Access Points</Text>
          )}
        </TouchableOpacity>

        {fetchedAPs.length > 0 && (
          <Text style={styles.info}>
            Found: {fetchedAPs.length} | Selected: {selectedBssids.size || 'All'}
          </Text>
        )}
      </View>

      {/* Quick Select Buttons */}
      {fetchedAPs.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Quick Select</Text>
          <View style={styles.quickRow}>
            <TouchableOpacity style={styles.quickBtn} onPress={selectAll}>
              <Text style={styles.quickBtnText}>All</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.quickBtn} onPress={deselectAll}>
              <Text style={styles.quickBtnText}>None</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.quickBtn} onPress={() => selectTopN(3)}>
              <Text style={styles.quickBtnText}>Top 3</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.quickBtn} onPress={() => selectTopN(5)}>
              <Text style={styles.quickBtnText}>Top 5</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.quickBtn} onPress={() => selectTopN(10)}>
              <Text style={styles.quickBtnText}>Top 10</Text>
            </TouchableOpacity>
          </View>

          {/* SSID Filter */}
          {uniqueSSIDs.length > 1 && (
            <>
              <Text style={styles.hint}>Filter by SSID:</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.ssidRow}>
                {uniqueSSIDs.slice(0, 8).map((ssid, i) => (
                  <TouchableOpacity
                    key={i}
                    style={styles.ssidBtn}
                    onPress={() => selectBySSID(ssid)}
                  >
                    <Text style={styles.ssidBtnText}>{ssid.slice(0, 15)}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </>
          )}
        </View>
      )}

      {/* AP List */}
      {fetchedAPs.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Access Points</Text>
          <Text style={styles.hint}>Tap to select. Empty selection = use all APs</Text>
          <ScrollView style={styles.apList} nestedScrollEnabled>
            {fetchedAPs.map((ap, i) => {
              const isSelected = selectedBssids.has(ap.bssid);
              return (
                <TouchableOpacity
                  key={i}
                  style={[styles.apRow, isSelected && styles.apRowSelected]}
                  onPress={() => toggleSelection(ap.bssid)}
                >
                  <Text style={styles.checkbox}>{isSelected ? '☑' : '☐'}</Text>
                  <View style={styles.apInfo}>
                    <Text style={[styles.apRssi, isSelected && styles.apTextSelected]}>
                      {ap.rssi} dBm
                    </Text>
                    <Text style={[styles.apSsid, isSelected && styles.apTextSelected]}>
                      {ap.ssid || 'Hidden'}
                    </Text>
                    <Text style={styles.apBssid}>{ap.bssid}</Text>
                  </View>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* Manual AP Input */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>2. Add Manual Access Point</Text>
        <View style={styles.typeRow}>
          <TouchableOpacity
            style={[styles.typeBtn, manualInputType === 'bssid' && styles.typeBtnActive]}
            onPress={() => setManualInputType('bssid')}
          >
            <Text style={styles.typeBtnText}>BSSID</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.typeBtn, manualInputType === 'ssid' && styles.typeBtnActive]}
            onPress={() => setManualInputType('ssid')}
          >
            <Text style={styles.typeBtnText}>SSID</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            placeholder={manualInputType === 'bssid' ? 'aa:bb:cc:dd:ee:ff' : 'Network Name'}
            placeholderTextColor="#666"
            value={manualInput}
            onChangeText={setManualInput}
            autoCapitalize="none"
          />
          <TouchableOpacity style={styles.addBtn} onPress={handleAddManualAP}>
            <Text style={styles.addBtnText}>Add</Text>
          </TouchableOpacity>
        </View>

        {/* Manual APs List */}
        {manualAPs.length > 0 && (
          <View style={styles.manualList}>
            <Text style={styles.hint}>Manual APs (always included):</Text>
            {manualAPs.map((ap, i) => (
              <View key={i} style={styles.manualRow}>
                <Text style={styles.manualText}>
                  {ap.bssid || ap.ssid} {ap.manual && '(manual)'}
                </Text>
                <TouchableOpacity onPress={() => removeManualAP(i)}>
                  <Text style={styles.removeBtn}>✕</Text>
                </TouchableOpacity>
              </View>
            ))}
          </View>
        )}
      </View>

      {/* Use Selected Button */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>3. Apply Selection</Text>
        <TouchableOpacity style={[styles.btn, styles.useBtn]} onPress={handleUseSelected}>
          <Text style={styles.btnText}>
            {selectedBssids.size === 0
              ? `Use All APs (${fetchedAPs.length + manualAPs.length})`
              : `Use Selected (${selectedBssids.size + manualAPs.length})`}
          </Text>
        </TouchableOpacity>
      </View>

      {/* JSON Filtering Section */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>4. Filter Existing JSON</Text>
        <TouchableOpacity style={[styles.btn, styles.loadBtn]} onPress={handleLoadMappingFiles}>
          <Text style={styles.btnText}>Load Mapping Files</Text>
        </TouchableOpacity>

        {mappingFiles.length > 0 && (
          <ScrollView style={styles.fileList} nestedScrollEnabled>
            {mappingFiles.map((file, i) => (
              <TouchableOpacity
                key={i}
                style={[styles.fileRow, selectedFile?.path === file.path && styles.fileRowSelected]}
                onPress={() => setSelectedFile(file)}
              >
                <Text style={styles.fileName}>{file.name}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        {selectedFile && (
          <TouchableOpacity
            style={[styles.btn, styles.exportBtn]}
            onPress={handleFilterAndExport}
            disabled={exporting}
          >
            {exporting ? (
              <ActivityIndicator color="#fff" />
            ) : (
              <Text style={styles.btnText}>Filter & Export JSON</Text>
            )}
          </TouchableOpacity>
        )}
      </View>

      {/* Log */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Log</Text>
        <ScrollView style={styles.logContainer} nestedScrollEnabled>
          {log.map((l, i) => (
            <Text key={i} style={styles.logEntry}>{l}</Text>
          ))}
        </ScrollView>
      </View>
    </ScrollView>
  );
}

/* ---------------- STYLES ---------------- */

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1a1a2e',
  },
  content: {
    padding: 12,
    paddingBottom: 40,
  },
  title: {
    color: '#00ff88',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 16,
    textAlign: 'center',
  },
  section: {
    backgroundColor: '#16213e',
    borderRadius: 8,
    padding: 12,
    marginBottom: 12,
  },
  sectionTitle: {
    color: '#00ff88',
    fontWeight: '600',
    marginBottom: 8,
    fontSize: 14,
  },
  hint: {
    color: '#888',
    fontSize: 11,
    marginBottom: 8,
  },
  info: {
    color: '#aaa',
    fontSize: 12,
    marginTop: 8,
  },
  btn: {
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  fetchBtn: {
    backgroundColor: '#1a4d7a',
  },
  useBtn: {
    backgroundColor: '#00ff88',
  },
  loadBtn: {
    backgroundColor: '#4a69bd',
    marginBottom: 8,
  },
  exportBtn: {
    backgroundColor: '#6c5ce7',
    marginTop: 8,
  },
  btnText: {
    color: '#000',
    fontWeight: '600',
  },
  quickRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 8,
  },
  quickBtn: {
    backgroundColor: '#333',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 4,
    marginRight: 6,
    marginBottom: 6,
  },
  quickBtnText: {
    color: '#00ff88',
    fontSize: 12,
    fontWeight: '600',
  },
  ssidRow: {
    marginBottom: 4,
  },
  ssidBtn: {
    backgroundColor: '#1a4d7a',
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 4,
    marginRight: 6,
  },
  ssidBtnText: {
    color: '#fff',
    fontSize: 10,
  },
  apList: {
    maxHeight: 200,
  },
  apRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#1a1a2e',
    padding: 8,
    borderRadius: 4,
    marginBottom: 4,
  },
  apRowSelected: {
    backgroundColor: '#2d4a3e',
    borderWidth: 1,
    borderColor: '#00ff88',
  },
  checkbox: {
    color: '#00ff88',
    fontSize: 18,
    marginRight: 10,
    width: 24,
  },
  apInfo: {
    flex: 1,
  },
  apRssi: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  apSsid: {
    color: '#aaa',
    fontSize: 11,
  },
  apBssid: {
    color: '#666',
    fontSize: 9,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  apTextSelected: {
    color: '#00ff88',
  },
  typeRow: {
    flexDirection: 'row',
    marginBottom: 8,
  },
  typeBtn: {
    flex: 1,
    padding: 8,
    alignItems: 'center',
    backgroundColor: '#333',
    marginRight: 4,
    borderRadius: 4,
  },
  typeBtnActive: {
    backgroundColor: '#1a4d7a',
  },
  typeBtnText: {
    color: '#fff',
    fontSize: 12,
  },
  inputRow: {
    flexDirection: 'row',
  },
  input: {
    flex: 1,
    backgroundColor: '#1a1a2e',
    borderWidth: 1,
    borderColor: '#4a69bd',
    borderRadius: 4,
    padding: 10,
    color: '#fff',
    marginRight: 8,
  },
  addBtn: {
    backgroundColor: '#00ff88',
    paddingHorizontal: 16,
    borderRadius: 4,
    justifyContent: 'center',
  },
  addBtnText: {
    color: '#000',
    fontWeight: '600',
  },
  manualList: {
    marginTop: 12,
  },
  manualRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#2d4a3e',
    padding: 8,
    borderRadius: 4,
    marginBottom: 4,
  },
  manualText: {
    color: '#fff',
    fontSize: 11,
    flex: 1,
  },
  removeBtn: {
    color: '#e74c3c',
    fontSize: 16,
    paddingHorizontal: 8,
  },
  fileList: {
    maxHeight: 100,
  },
  fileRow: {
    backgroundColor: '#1a1a2e',
    padding: 10,
    borderRadius: 4,
    marginBottom: 4,
  },
  fileRowSelected: {
    backgroundColor: '#2d4a3e',
    borderWidth: 1,
    borderColor: '#00ff88',
  },
  fileName: {
    color: '#fff',
    fontSize: 11,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  logContainer: {
    maxHeight: 80,
  },
  logEntry: {
    color: '#aaa',
    fontSize: 10,
  },
});
