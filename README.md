# Indoor Mapping

React Native app for indoor positioning, wayfinding, and navigation on a tile-based office map. Uses a canvas-based 2D map (no GPS at runtime for the floor plan), with optional GPS to set initial position and PDR (accelerometer + gyroscope) for step-based movement.

---

## Features

- **Tile-based map** — 6×12 grid (18 ft × 36 ft), 3 ft tiles; walkable / obstacle / blocked regions
- **Wayfinding** — A* pathfinding on the grid; tap or search to set start and destination; route polyline overlay
- **Search** — Search named locations (e.g. Washroom, Coffee, Exit, Meeting Table) and set destination; path from current position to selected location
- **PDR (Pedestrian Dead Reckoning)** — Step detection (accelerometer) + heading (gyroscope); blue dot moves with steps in heading direction
- **GPS** — “Location” button sets blue-dot position from device GPS (snapped to nearest walkable tile) for initial placement
- **Stylized floor plan** — `DummyFloorMap` background with labeled obstacles/blocked areas; transparent overlay for path and markers
- **Tap flow** — 1st tap: set start + move blue dot; 2nd tap: set destination and show route; 3rd tap: move “you” again and clear destination

---

## Tech Stack

- **React Native** 0.83
- **react-native-svg** — Map overlay (path, circles, heading arrow)
- **react-native-sensors** — Accelerometer, gyroscope (step detection + heading)
- **@react-native-community/geolocation** — GPS for “Location” button
- **react-native-wifi-reborn** — Available for future WiFi-based anchoring (not used in main flow yet)

---

## Project Structure

```
src/
├── components/
│   ├── OfficeMap.js       # Main screen: map, PDR, search, tap, path
│   ├── DummyFloorMap.js   # Stylized floor plan (SVG) + location labels
│   ├── FirstFloorMap.js   # Alternate floor visual
│   ├── FirstFloorPDR.js   # PDR on first-floor map
│   └── ...
├── data/
│   ├── officeGridData.js  # Grid, tiles, OFFICE_GRID, OFFICE_LOCATIONS, toMap/toGrid, snapToWalkable
│   ├── mapAnchor.js       # GPS ↔ map pixels (REF_LAT, REF_LON, latLonToMapPixels)
│   └── wifiAPData.js      # WiFi AP list (for future RSSI/zone use)
├── utils/
│   ├── gridPathfinding.js # A* on grid; getGridPathFromTo()
│   ├── locationService.js # GPS permission, getDeviceLocation, deviceCoordsToMapPixels
│   ├── wifiPositioning.js # WiFi-based position (optional)
│   ├── wifiScan.js       # WiFi scan (optional)
│   └── Document.txt      # Full technical & UX handoff (positioning, route-lock, free-roam, RSSI)
├── hooks/
│   └── usePDR.js
└── services/
    └── PedestrianDeadReckoning.js
```

---

## Map Model

- **Scale:** 18 ft × 36 ft; 30 px/ft → 540×1080 px; tile size 90 px (3 ft).
- **Tile types:** `WALKABLE` (0), `OBSTACLE` (1), `BLOCKED` (2). Pathfinding and movement use walkable tiles only.
- **Named locations** (`OFFICE_LOCATIONS`): Washroom/Kitchen (BLOCKED), Sofa, TV, Coffee, Exit, Sunny Table, Saneer-Ameen-Ibrahim Table, Ruhban, Meeting Table (OBSTACLE). Each has a walkable (col, row) to path to.

---

## Positioning (Current Behavior)

- **Start:** Tap a walkable tile or use “Location” (GPS) to set start and blue-dot position.
- **PDR:** On each detected step, position moves by a fixed step length (2.3 ft) in **phone heading** (gyro) direction, then snapped to walkable. Assumes phone is held facing walking direction.
- **Limitations:** If the phone points one way but the user walks another (e.g. backward or in pocket), the dot can move in the wrong direction. Route-locked movement (move dot along path, ignore heading) and free-roam candidate headings are described in `src/utils/Document.txt` and are not yet implemented in code.

---

## Getting Started

### Prerequisites

- Node ≥ 20
- React Native environment set up ([Set Up Your Environment](https://reactnative.dev/docs/set-up-your-environment))
- Android Studio / Xcode for running on device or emulator

### Install and run

```sh
# Install dependencies
npm install

# Start Metro
npm start
```

In a second terminal:

```sh
# Android
npm run android

# iOS (first time or after native dep changes: bundle exec pod install)
npm run ios
```

### Reload

- **Android:** Double-tap <kbd>R</kbd> or Dev Menu → Reload (<kbd>Ctrl</kbd>+<kbd>M</kbd> / <kbd>Cmd</kbd>+<kbd>M</kbd>).
- **iOS:** <kbd>R</kbd> in simulator.

---

## Reference: Full Specification

`src/utils/Document.txt` is the technical and UX handoff. It covers:

- Canvas model, tiles, zones, stable position
- **Route-locked movement** (move dot along path; ignores phone heading when navigating)
- **Free-roam** (candidate headings + snap to walkable)
- **RSSI zone anchoring** (fingerprint match + blend; no trilateration)
- Formulas (PDR step, snap, EMA, stationary, RSSI confidence)
- Implementation addendum: gyro heading, step detector, free-roam step code, WiFi zone match, wiring
- Screens, delivery targeting, dev tools

Use it as the single source of truth for implementing route-lock, free-roam, and optional RSSI anchoring.

---

## License

Private. See repository settings.
