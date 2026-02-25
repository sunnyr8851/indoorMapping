# WiFi Fingerprint Positioning - Technical Documentation

## Overview

This document explains the **Phase 2: Real-Time Position Detection** workflow implemented in `wifiFingerprintPositioning.js`. It describes what happens step-by-step when a user presses "Start Tracking" after uploading Phase 1 mapping data (JSON).

---

## Prerequisites

### Phase 1 Mapping Data (JSON Structure)

Before tracking can begin, you must upload a JSON file containing:

```json
{
  "accessPoints": [
    { "bssid": "AA:BB:CC:DD:EE:FF", "ssid": "Hotel_WiFi_1" },
    { "bssid": "11:22:33:44:55:66", "ssid": "Hotel_WiFi_2" },
    { "bssid": "77:88:99:AA:BB:CC", "ssid": "Hotel_WiFi_3" }
  ],
  "nodes": [
    { 
      "x": 5, 
      "y": 5, 
      "rssis": { 
        "AA:BB:CC:DD:EE:FF": -45, 
        "11:22:33:44:55:66": -62,
        "77:88:99:AA:BB:CC": -71
      } 
    },
    { 
      "x": 6, 
      "y": 5, 
      "rssis": { 
        "AA:BB:CC:DD:EE:FF": -48, 
        "11:22:33:44:55:66": -58,
        "77:88:99:AA:BB:CC": -68
      } 
    }
  ]
}
```

| Field | Description |
|-------|-------------|
| `accessPoints` | List of predefined WiFi APs (only these are used for matching) |
| `nodes` | Grid tiles with stored RSSI fingerprints from Phase 1 mapping |
| `x, y` | Tile coordinates on the map |
| `rssis` | RSSI values recorded at that tile for each AP |

---

## Step-by-Step Flow: Start Tracking

### Visual Flow Diagram

```
┌──────────────────────┐
│  1. Upload JSON      │  ← Phase 1 mapping data loaded
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│  2. Start Tracking   │  ← User presses button
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│  3. WiFi Scan x5     │  ← Get current RSSI (averaged)
│  scanAndFindPosition │
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│  4. Filter to known  │  ← filterToPredefinedAPs()
│     APs only         │
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│  5. Get Top 3 RSSI   │  ← getTopNRssi()
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│  6. Calculate dist   │  ← rssiEuclideanDistance()
│     to ALL tiles     │
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│  7. Select Top 3     │  ← Sort by distance
│     closest tiles    │
└──────────┬───────────┘
           ▼
┌──────────────────────┐
│  8. Weighted Centroid│  ← w = 1/(dist + 0.1)
│     (x, y) position  │     Normalize & average
└──────────────────────┘
```

---

## Detailed Step Breakdown

### Step 1: JSON Upload (Mapping Data Loaded)

The uploaded JSON is stored in memory as `mappingData`. This contains:
- List of predefined access points (APs)
- All mapped tiles with their RSSI fingerprints

---

### Step 2: Start Tracking Button Pressed

Triggers the main function:

```javascript
scanAndFindPosition(mappingData, options)
```

**Default Options:**
| Parameter | Default | Description |
|-----------|---------|-------------|
| `scanCount` | 5 | Number of WiFi scans to average |
| `delayMs` | 800 | Delay between scans (milliseconds) |
| `topN` | 3 | Number of strongest APs to compare |
| `stabilize` | true | Enable position stabilization |

**Total Scan Time:** ~4 seconds (5 scans × 800ms delay)

---

### Step 3: WiFi Scan (Get Current RSSI)

```javascript
const currentRssi = await getAveragedWifiRSSI(scanCount, delayMs);
```

**Process:**
1. Scan WiFi networks 5 times
2. Wait 800ms between each scan
3. Average RSSI values to reduce noise
4. Total time: ~4 seconds for stable readings

**Example Output:**
```javascript
{
  "AA:BB:CC:DD:EE:FF": -47,  // Hotel_WiFi_1
  "11:22:33:44:55:66": -60,  // Hotel_WiFi_2
  "77:88:99:AA:BB:CC": -68,  // Hotel_WiFi_3
  "XX:YY:ZZ:11:22:33": -72,  // Neighbor's WiFi (will be filtered)
  "DD:EE:FF:00:11:22": -85   // Unknown AP (will be filtered)
}
```

---

### Step 4: Filter to Predefined APs Only

```javascript
filteredCurrent = filterToPredefinedAPs(currentRssi, predefinedBssids);
```

**Purpose:** Remove unknown WiFi networks (neighbors, hotspots) that weren't part of Phase 1 mapping.

**How it works:**
1. Get list of predefined BSSIDs from `mappingData.accessPoints`
2. Normalize all BSSIDs (uppercase, consistent format)
3. Keep only APs that exist in predefined list

**Example:**
```javascript
// Before filtering (5 APs)
{
  "AA:BB:CC:DD:EE:FF": -47,  ✅ Predefined
  "11:22:33:44:55:66": -60,  ✅ Predefined
  "77:88:99:AA:BB:CC": -68,  ✅ Predefined
  "XX:YY:ZZ:11:22:33": -72,  ❌ Not predefined
  "DD:EE:FF:00:11:22": -85   ❌ Not predefined
}

// After filtering (3 APs)
{
  "AA:BB:CC:DD:EE:FF": -47,
  "11:22:33:44:55:66": -60,
  "77:88:99:AA:BB:CC": -68
}
```

---

### Step 5: Get Top N Strongest RSSI

```javascript
const currentTopN = getTopNRssi(filteredCurrent, topN);
```

**Purpose:** Use only the strongest (most reliable) signals for matching.

**Why Top 3?**
| RSSI Range | Reliability | Usage |
|------------|-------------|-------|
| -30 to -65 dBm | Very reliable | Primary matching |
| -65 to -80 dBm | Moderate | Secondary matching |
| < -80 dBm | Noisy/unstable | Should be ignored |

**Process:**
1. Sort APs by RSSI (strongest first = less negative)
2. Take top N entries (default 3)

**Example:**
```javascript
// Input (filtered)
{
  "AA:BB:CC:DD:EE:FF": -47,  // Strongest
  "11:22:33:44:55:66": -60,  // 2nd strongest
  "77:88:99:AA:BB:CC": -68   // 3rd strongest
}

// Output (top 3) - same in this case
{
  "AA:BB:CC:DD:EE:FF": -47,
  "11:22:33:44:55:66": -60,
  "77:88:99:AA:BB:CC": -68
}
```

---

### Step 6: Compare with All Stored Nodes

```javascript
for (const node of mappingData.nodes) {
  const nodeTopN = getTopNRssi(filteredNode, topN);
  const distance = rssiEuclideanDistance(currentTopN, nodeTopN);
  
  if (distance < bestDistance) {
    bestDistance = distance;
    bestMatch = node;
  }
}
```

**Process:**
1. Loop through every stored tile/node
2. Get that node's top 3 RSSI values
3. Calculate Euclidean distance between current and stored fingerprints
4. Store all tiles with their distances

---

### Step 6a: Euclidean Distance Calculation

```javascript
rssiEuclideanDistance(currentTopN, nodeTopN)
```

**Formula:**
```
Distance = √[(RSSI₁_current - RSSI₁_stored)² + (RSSI₂_current - RSSI₂_stored)² + ...] / √n
```

**Example Calculation:**

| BSSID | Current RSSI | Tile (1,1) RSSI | Tile (2,2) RSSI | Tile (2,3) RSSI |
|-------|--------------|-----------------|-----------------|-----------------|
| AP1 | -47 | -45 | -50 | -55 |
| AP2 | -60 | -62 | -58 | -57 |
| AP3 | -68 | -70 | -66 | -63 |

**Distance to Tile (1,1):** `2.0`  
**Distance to Tile (2,2):** `2.4`  
**Distance to Tile (2,3):** `3.2`

---

### Step 6b: Select Top 3 Closest Tiles

Sort all tiles by distance and select top 3:

| Rank | Tile | Distance |
|------|------|----------|
| 1 | (1,1) | 2.0 |
| 2 | (2,2) | 2.4 |
| 3 | (2,3) | 3.2 |

---

### Step 6c: Convert Distance to Weight

Apply inverse distance weighting:

$$w = \frac{1}{distance + \epsilon}$$

Where $\epsilon = 0.1$ (avoids division by zero)

**Example:**
```
w1 = 1 / (d1 + 0.1) = 1 / (2.0 + 0.1) = 1 / 2.1 = 0.476
w2 = 1 / (d2 + 0.1) = 1 / (2.4 + 0.1) = 1 / 2.5 = 0.400
w3 = 1 / (d3 + 0.1) = 1 / (3.2 + 0.1) = 1 / 3.3 = 0.303
```

---

### Step 6d: Calculate Total Weight

$$W = w_1 + w_2 + w_3$$

**Example:**
```
W = 0.476 + 0.400 + 0.303 = 1.179
```

---

### Step 7: Calculate Final Coordinates

$$x = \frac{w_1 \cdot x_1 + w_2 \cdot x_2 + w_3 \cdot x_3}{W}$$

$$y = \frac{w_1 \cdot y_1 + w_2 \cdot y_2 + w_3 \cdot y_3}{W}$$

**Example:**
```
x = (0.476 × 1 + 0.400 × 2 + 0.303 × 2) / 1.179
  = (0.476 + 0.800 + 0.606) / 1.179
  = 1.882 / 1.179
  = 1.60

y = (0.476 × 1 + 0.400 × 2 + 0.303 × 3) / 1.179
  = (0.476 + 0.800 + 0.909) / 1.179
  = 2.185 / 1.179
  = 1.85
```

**Final Position: (1.60, 1.85)** ✅

This gives sub-tile precision weighted toward closer matches!

---

### Step 8: Return Result

```javascript
return {
  x: 1.60,              // Weighted centroid X (fractional)
  y: 1.85,              // Weighted centroid Y (fractional)
  tileX: 2,             // Rounded to nearest tile
  tileY: 2,
  distance: 2.53,       // Average distance of top 3
  closestNode: {...},   // The single closest tile
  closestDistance: 2.0,
  topTiles: [
    { x: 1, y: 1, distance: 2.0, weight: 0.404 },
    { x: 2, y: 2, distance: 2.4, weight: 0.339 },
    { x: 2, y: 3, distance: 3.2, weight: 0.257 },
  ],
  weights: [0.404, 0.339, 0.257]
};
```

---

## Key Functions Reference

### `scanAndFindPosition(mappingData, options)`
Main entry point. Scans WiFi and returns estimated position.

### `findClosestTile(currentRssi, mappingData, options)`
Core matching logic. Compares current scan with all stored fingerprints.

### `filterToPredefinedAPs(rssiObj, predefinedBssids)`
Removes unknown APs from scan results.

### `getTopNRssi(rssiObj, topN)`
Returns only the N strongest RSSI values.

### `rssiEuclideanDistance(rssi1, rssi2)`
Calculates similarity between two RSSI fingerprints.

### `findClosestTiles(currentRssi, mappingData, topN)`
Returns multiple candidate positions (useful for debugging).

### `resetPositionStabilizer()`
Resets the position stabilizer. Call when starting a new tracking session.

### `getPositionStabilizer(options)`
Configure the position stabilizer with custom options.

---

## Position Stabilization

To prevent position fluctuation (jumping between tiles), a **Position Stabilizer** is applied after matching.

### Stabilization Strategies

| Strategy | Description |
|----------|-------------|
| **Confidence Filter** | Rejects matches with RSSI distance > 8 (weak matches) |
| **Jump Filter** | Rejects position jumps > 3 tiles in one scan |
| **History Voting** | Requires 3+ consistent readings before accepting new position |
| **EMA Smoothing** | Exponential moving average for gradual transitions |

### Stabilizer Options

```javascript
getPositionStabilizer({
  historySize: 5,       // Keep last N positions for voting
  maxJumpDistance: 3,   // Max tiles to jump in one scan
  minConfidence: 8,     // Max RSSI distance to accept
  emaAlpha: 0.3         // EMA smoothing factor (0.1=smooth, 0.5=responsive)
});
```

### When to Reset

```javascript
// Call before starting new tracking session
resetPositionStabilizer();
```

---

## Current Architecture: Multi-Layer Stabilization

```
┌─────────────────────────────────────────────────────────────┐
│                    RAW WiFi RSSI Scan                       │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  LAYER 1: Multi-Scan Averaging (5 scans × 800ms)            │
│  - Scans WiFi 5 times with 800ms delay                      │
│  - Averages RSSI values to reduce instant noise             │
│  - Total time: ~4 seconds per position update               │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  LAYER 2: Weighted Centroid (Implemented ✅)                │
│  - Calculate distance to ALL mapped tiles                   │
│  - Select top K=3 closest tiles                             │
│  - w = 1/(distance + 0.1)                                   │
│  - Weighted average: x = Σ(w*x)/W, y = Σ(w*y)/W             │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  LAYER 3: Kalman Filter (Implemented ✅) [Optional]         │
│  - State: [x, y, vx, vy] (position + velocity)              │
│  - Predict → Update cycle with real dt                      │
│  - RSSI confidence weighting                                │
│  - Toggle ON/OFF in UI                                      │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  LAYER 4: Obstacle Validation (Implemented ✅)              │
│  - Check if position falls on walkable tile                 │
│  - If on obstacle → snap to closest mapped tile             │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  LAYER 5: Fractional Display (Implemented ✅)               │
│  - Blue dot uses fractional position (5.3, 4.8)             │
│  - Smooth movement between tiles                            │
└─────────────────────────────────────────────────────────────┘
                           │
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                   FINAL POSITION (x, y)                     │
│          Sub-tile precision with smooth movement            │
└─────────────────────────────────────────────────────────────┘
```

---

## Fractional Positioning (Smooth Blue Dot)

### Why Fractional?

| Display Mode | Position | Visual Effect |
|--------------|----------|---------------|
| Integer (old) | (5, 5) → (6, 5) | Discrete jumps between tiles |
| Fractional | (5.2, 5.1) → (5.6, 5.0) → (6.1, 5.0) | Smooth continuous movement |

### Implementation

```javascript
// Blue dot uses exact weighted centroid position
setCurrentPosition({ x: result.x, y: result.y });  // (5.32, 4.87)

// SVG renders at fractional pixel position
<Circle
  cx={(COLS - 1 - currentPosition.x) * 30 + 15}
  cy={(ROWS - 1 - currentPosition.y) * 30 + 15}
  r={12}
  fill="#4a9eff"
/>
```

### Visual Result

```
Before (integer, discrete jumps):
Scan 1: ●(5,5)
Scan 2: ────────→ ●(6,5)   [instant jump]
Scan 3: ────────→ ●(7,5)   [instant jump]

After (fractional, smooth movement):
Scan 1: ●(5.2, 5.1)
Scan 2: ──→ ●(5.6, 5.0)    [small move]
Scan 3: ───→ ●(6.1, 4.9)   [small move]
Scan 4: ────→ ●(6.8, 5.0)  [small move]
```

---

## Obstacle Validation

### The Problem

Weighted centroid can land on obstacles:

```
Tile (6,2) walkable   d=2.0  w=0.476
Tile (7,1) walkable   d=2.4  w=0.400
Tile (5,1) walkable   d=3.2  w=0.303

Weighted: (6.3, 1.4) → Rounded: (6, 1) ← OBSTACLE! ❌
```

### Solution: Validate & Snap

```javascript
function isTileWalkable(x, y) {
  const tileX = Math.round(x);
  const tileY = Math.round(y);
  const tileType = OFFICE_GRID[tileY]?.[tileX];
  return tileType === TILE.WALKABLE;
}

function getValidPosition(x, y, topTiles) {
  // Check if rounded position is walkable
  if (isTileWalkable(x, y)) {
    return { x, y, wasAdjusted: false };
  }
  
  // On obstacle → snap to closest mapped tile
  return { 
    x: topTiles[0].x, 
    y: topTiles[0].y, 
    wasAdjusted: true 
  };
}
```

### Visual Result

```
Before (no validation):
┌─────┬─────┬─────┐
│     │█████│     │
│     │█ ● █│     │  ← Blue dot on obstacle ❌
└─────┴─────┴─────┘

After (with validation):
┌─────┬─────┬─────┐
│     │█████│     │
│  ●  │█████│     │  ← Blue dot snapped to walkable ✅
└─────┴─────┴─────┘
```

### Log Output

```
Position: (5.32, 4.87) | Dist: 2.14
Position: (6.12, 5.01) [adjusted - was on obstacle] | Dist: 2.31
```

---

## Kalman Filter (Implemented ✅)

The Kalman filter provides temporal smoothing by combining WiFi measurements with a motion model.

### State Vector

```
State = [x, y, vx, vy]

x, y   = Position (in grid tiles)
vx, vy = Velocity (tiles per second)
```

### Algorithm Flow

```
┌────────────────┐     ┌────────────────┐     ┌────────────────┐
│ Weighted       │ --> │ Kalman         │ --> │ Smoothed       │
│ Centroid (x,y) │     │ Predict/Update │     │ Position       │
└────────────────┘     └────────────────┘     └────────────────┘
                              │
                    Uses real dt between scans
                    RSSI confidence weighting
```

### Key Features

| Feature | Implementation |
|---------|----------------|
| Time step | Real `dt = (now - lastScan) / 1000` seconds |
| State | `[x, y, vx, vy]` - position + velocity |
| Velocity decay | `v *= 0.9` per step (friction) |
| Confidence | RSSI distance → confidence (0.3-1.0) |
| Process noise | 0.3 (tunable) |
| Measurement noise | 2.0 (tunable) |

### RSSI Confidence Calculation

```javascript
// Distance 0-3 → high confidence (0.8-1.0)
// Distance 3-8 → medium confidence (0.5-0.8)
// Distance 8-15 → low confidence (0.3-0.5)
rssiConfidence = max(0.3, min(1.0, 1 - (rssiDistance / 15)))
```

### Usage

Toggle Kalman filter ON/OFF in the UI. When enabled:
- Filter is reset at tracking start
- Real time delta (dt) is calculated between scans
- Position is predicted, then corrected with measurement
- Velocity is tracked for motion smoothing

### Behavior Comparison

| Scenario | Without Kalman | With Kalman |
|----------|----------------|-------------|
| Standing still | Small oscillations | Stable (velocity → 0) |
| Walking | Follows each measurement | Smooth trajectory |
| Noisy scan | Immediate position jump | Weighted blend |
| User stops | Continues oscillating | Quickly stabilizes |

### When to Use Kalman

**Enable (default):** Continuous tracking, smooth visualization
**Disable:** Debugging, testing raw positioning accuracy

### Detailed Example: Scan-by-Scan Walkthrough

This example shows exactly how Kalman processes consecutive scans:

```
┌─────────────────────────────────────────────────────────────────────┐
│                    COMPLETE KALMAN CYCLE                            │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  SCAN 1          SCAN 2          SCAN 3          SCAN 4            │
│    │               │               │               │                │
│    ▼               ▼               ▼               ▼                │
│ ┌─────┐        ┌─────┐        ┌─────┐        ┌─────┐               │
│ │WiFi │        │WiFi │        │WiFi │        │WiFi │               │
│ │Centroid      │Centroid      │Centroid      │Centroid             │
│ │(5.0,5.0)│    │(6.5,5.2)│    │(5.8,5.0)│    │(7.0,5.1)│           │
│ └──┬──┘        └──┬──┘        └──┬──┘        └──┬──┘               │
│    │               │               │               │                │
│    ▼               ▼               ▼               ▼                │
│ ┌─────────────────────────────────────────────────────────────┐    │
│ │                     KALMAN FILTER                           │    │
│ │  1. Calculate dt (time since last scan)                     │    │
│ │  2. PREDICT: Use velocity to guess position                 │    │
│ │  3. Calculate Kalman Gain (K)                               │    │
│ │  4. UPDATE: Blend prediction + measurement                  │    │
│ │  5. UPDATE VELOCITY: For next prediction                    │    │
│ │  6. Store state for next scan                               │    │
│ └──┬──────────────────────────────────────────────────────────┘    │
│    │                                                                │
│    ▼                                                                │
│ ┌─────┐        ┌─────┐        ┌─────┐        ┌─────┐               │
│ │Final│        │Final│        │Final│        │Final│               │
│ │(5.0,5.0)│    │(5.6,5.1)│    │(6.04,5.1)│   │(6.5,5.0)│           │
│ └─────┘        └─────┘        └─────┘        └─────┘               │
│                                                                     │
│ Notice: Raw jumped (6.5→5.8→7.0) but Final is smooth!              │
└─────────────────────────────────────────────────────────────────────┘
```

#### Scan 2 Detailed Breakdown

```
INPUTS:
├── Last State (from Scan 1):
│   ├── position: (5.0, 5.0)
│   ├── velocity: (0, 0)
│   └── timestamp: 1000ms
│
├── Current Scan 2:
│   ├── WiFi centroid: (6.5, 5.2)  ← Raw measurement
│   ├── RSSI distance: 2.5
│   └── timestamp: 5000ms

STEP 1: Calculate dt
├── dt = (5000 - 1000) / 1000 = 4 seconds

STEP 2: PREDICT (using velocity)
├── predictedX = 5.0 + (0 × 4) = 5.0
├── predictedY = 5.0 + (0 × 4) = 5.0
└── predicted: (5.0, 5.0)  ← No movement expected (velocity was 0)

STEP 3: Calculate Kalman Gain (K)
├── RSSI confidence = 1 - (2.5 / 15) = 0.83  ← Good match
├── K = 0.4  ← Trust both prediction and measurement
└── (K depends on P, R matrices internally)

STEP 4: UPDATE (blend prediction + measurement)
├── innovation_x = 6.5 - 5.0 = 1.5  ← Difference
├── innovation_y = 5.2 - 5.0 = 0.2
├── finalX = 5.0 + (0.4 × 1.5) = 5.6  ← Partial correction
├── finalY = 5.0 + (0.4 × 0.2) = 5.08
└── FINAL POSITION: (5.6, 5.08)  ← Smoothed!

STEP 5: UPDATE VELOCITY (for next prediction)
├── velocityX = 0.4 × (1.5 / 4) = 0.15 tiles/sec
├── velocityY = 0.4 × (0.2 / 4) = 0.02 tiles/sec
└── velocity: (0.15, 0.02)  ← Now we know user is moving!

STEP 6: Store State
├── position: (5.6, 5.08)
├── velocity: (0.15, 0.02)
└── timestamp: 5000ms

OUTPUT: Blue dot at (5.6, 5.08) ✅
```

#### Scan 3: Velocity Helps Predict!

```
INPUTS:
├── Last State (from Scan 2):
│   ├── position: (5.6, 5.08)
│   ├── velocity: (0.15, 0.02)  ← Now we have velocity!
│   └── timestamp: 5000ms
│
├── Current Scan 3:
│   ├── WiFi centroid: (5.8, 5.0)  ← Noisy jump back?
│   └── timestamp: 9000ms

STEP 1: Calculate dt
├── dt = (9000 - 5000) / 1000 = 4 seconds

STEP 2: PREDICT (using velocity)
├── predictedX = 5.6 + (0.15 × 4) = 6.2  ← Expects forward motion!
├── predictedY = 5.08 + (0.02 × 4) = 5.16
└── predicted: (6.2, 5.16)

STEP 3: WiFi says (5.8, 5.0) but we predicted (6.2, 5.16)
├── innovation_x = 5.8 - 6.2 = -0.4  ← WiFi says go back?
├── innovation_y = 5.0 - 5.16 = -0.16
└── This seems like noise...

STEP 4: UPDATE (K = 0.4)
├── finalX = 6.2 + (0.4 × -0.4) = 6.04
├── finalY = 5.16 + (0.4 × -0.16) = 5.10
└── FINAL: (6.04, 5.10)  ← Smooth! Didn't jump back!

STEP 5: UPDATE VELOCITY
├── velocityX = 0.15 + 0.4 × (-0.4/4) = 0.11  ← Slowing down
└── velocity: (0.11, 0.004)

OUTPUT: Blue dot at (6.04, 5.10) ✅
```

#### Visual: What Kalman Prevented

```
WiFi Raw (jumpy):
(5.0) ──► (6.5) ──► (5.8) ──► (7.0)
                      ↑
                   Jump back! Bad!

Kalman Output (smooth):
(5.0) ──► (5.6) ──► (6.04) ──► (6.5)
                      ↑
              Smooth progression! Good!
```

**Key insight:** Velocity creates "momentum" - the filter expects continued motion and resists sudden direction changes (noise)!

---

## Important Considerations

### 1. Linear AP Placement Problem

If all WiFi APs are placed in a straight line (e.g., all at y=5):
```
AP1(0,5)  AP2(5,5)  AP3(10,5)
───────────────────────────────
```

**Problem:** Points symmetric across the line will have identical fingerprints!
- (5, 4) and (5, 6) → Same RSSI values
- Cannot distinguish between them

**Solution:** Place APs in a non-collinear arrangement (triangle or spread pattern).

### 2. RSSI Noise

RSSI values fluctuate due to:
- Walls and obstacles
- People moving
- Multipath reflections

**Mitigation:** 
- Average 5 scans with 800ms delay (~4 seconds total)
- Position stabilization (jump filter + history voting)
- EMA smoothing for gradual transitions

### 3. Distance Threshold

A low distance value indicates high confidence:
| Distance | Confidence |
|----------|------------|
| < 3 | High confidence |
| 3-6 | Moderate confidence |
| > 6 | Low confidence (may be inaccurate) |

---

## Summary Table

| Aspect | Implementation | Status |
|--------|----------------|--------|
| **Matching Method** | Euclidean distance on RSSI vectors | ✅ Implemented |
| **Position Calculation** | Weighted Centroid of top 3 closest tiles | ✅ Implemented |
| **APs Used** | Top 3 strongest (filtered to predefined) | ✅ Implemented |
| **Scan Time** | ~4 seconds (5 scans × 800ms) | ✅ Implemented |
| **Layer 1** | Multi-scan averaging | ✅ Implemented |
| **Layer 2** | Weighted centroid (w = 1/(dist + ε)) | ✅ Implemented |
| **Layer 3** | Kalman filter (toggle ON/OFF) | ✅ Implemented |
| **Layer 4** | Obstacle validation (snap to walkable) | ✅ Implemented |
| **Layer 5** | Fractional display (sub-tile precision) | ✅ Implemented |
| **Output** | Fractional position + velocity + Kalman metadata | ✅ Implemented |
| **Approach** | Fingerprint matching (not trilateration) | ✅ Implemented |

---

## File Locations

| File | Purpose | Status |
|------|---------|--------|
| `/src/utils/wifiFingerprintPositioning.js` | Core positioning + Kalman integration | ✅ Active |
| `/src/utils/KalmanPositionFilter.js` | 2D Kalman filter with velocity model | ✅ Active |
| `/src/components/WifiPositioningPanel.js` | UI + Kalman toggle + obstacle validation | ✅ Active |
| `/src/data/officeGridData.js` | OFFICE_GRID obstacle map + TILE types | ✅ Active |

---

*Document updated: June 2025*
