# Hotel Indoor Positioning System - Deployment Requirements

## Project Overview

We will implement an **Indoor Positioning System** for your hotel that allows guests to:
- See their real-time location on a digital map
- Navigate to rooms, facilities, and amenities
- Find nearby points of interest

**Scope:** Single Floor Deployment

---

## What We Need From You

### 1. Floor Plan Image

| Requirement | Details |
|-------------|---------|
| **Format** | PNG, JPG, or PDF (high resolution) |
| **View** | Top-down (bird's eye view) |
| **Scale** | Include scale bar or dimensions |
| **Clarity** | All rooms, corridors, walls visible |

**Example dimensions we need:**
```
┌─────────────────────────────────────────┐
│                                         │
│    Total Width: _____ feet/meters       │
│                                         │
│    Total Height: _____ feet/meters      │
│                                         │
└─────────────────────────────────────────┘
```

**We will create a tile grid overlay on your Figma design:**
```
┌───┬───┬───┬───┬───┬───┬───┬───┬───┬───┐
│0,9│1,9│2,9│3,9│4,9│5,9│6,9│7,9│8,9│9,9│  ← Each tile = 3 feet (1 meter)
├───┼───┼───┼───┼───┼───┼───┼───┼───┼───┤
│0,8│   │   │   │   │   │   │   │   │9,8│
├───┼───┼───┼───┼───┼───┼───┼───┼───┼───┤
│0,7│   │   │   │   │   │   │   │   │9,7│
├───┼───┼───┼───┼───┼───┼───┼───┼───┼───┤
│   │   │   │   │   │   │   │   │   │   │
├───┼───┼───┼───┼───┼───┼───┼───┼───┼───┤
│0,0│1,0│2,0│3,0│4,0│5,0│6,0│7,0│8,0│9,0│
└───┴───┴───┴───┴───┴───┴───┴───┴───┴───┘
```

---

### 2. WiFi Access Point Information

**CRITICAL: We need the following for EACH WiFi access point:**

| Field | Example | Your Data |
|-------|---------|-----------|
| **BSSID (MAC Address)** | `AA:BB:CC:DD:EE:01` | |
| **SSID (Network Name)** | `Hotel_Guest` | |
| **Physical Location** | Near Room 105 | |
| **Frequency** | 2.4GHz / 5GHz | |

**How to get BSSID:**
- From WiFi controller dashboard (Cisco, Ubiquiti, etc.)
- Or we can scan during site visit

**Please fill this table:**

| AP # | BSSID | SSID | Location Description | Mark on Floor Plan |
|------|-------|------|---------------------|-------------------|
| AP1 | | | | ⭐ |
| AP2 | | | | ⭐ |
| AP3 | | | | ⭐ |
| AP4 | | | | ⭐ |
| AP5 | | | | ⭐ |

**Minimum APs Required:**

| Floor Area | Minimum APs |
|------------|-------------|
| < 5,000 sq ft | 4 |
| 5,000 - 15,000 sq ft | 6-8 |
| 15,000 - 30,000 sq ft | 10-12 |

---

### 3. AP Placement Check

**IMPORTANT: Access Points must NOT be in a straight line!**

```
❌ BAD (all APs on one line - positioning will fail):

AP1 ────── AP2 ────── AP3 ────── AP4


✅ GOOD (APs spread across the floor):

        AP1
              
AP2                   AP4
              
        AP3
              
                      AP5
```

**Please verify your AP placement is spread across the floor area.**

---

### 4. Area Classification

Please mark on floor plan or list here:

| Area Type | Color Code | Examples |
|-----------|------------|----------|
| **Walkable** | 🟢 Green | Corridors, lobby, open areas |
| **Walls/Obstacles** | 🔴 Red | Walls, pillars, fixed furniture |
| **Rooms** | 🔵 Blue | Guest rooms (with room numbers) |
| **Restricted** | ⚫ Gray | Staff only, kitchen, storage |

---

### 5. Points of Interest (POI)

**Please list all locations guests might want to navigate to:**

#### Guest Rooms
| Room Number | Location Description |
|-------------|---------------------|
| 101 | |
| 102 | |
| 103 | |
| ... | |

#### Facilities & Amenities
| Name | Type | Location Description |
|------|------|---------------------|
| | Restaurant | |
| | Reception/Front Desk | |
| | Restroom (Male) | |
| | Restroom (Female) | |
| | Elevator | |
| | Stairs | |
| | Swimming Pool | |
| | Gym/Fitness | |
| | Spa | |
| | Conference Room | |
| | Business Center | |
| | ATM | |
| | Parking Entrance | |

#### Emergency Points
| Name | Location Description |
|------|---------------------|
| Emergency Exit 1 | |
| Emergency Exit 2 | |
| Fire Extinguisher | |
| Assembly Point | |

---

### 6. Figma Design Integration

**We will overlay your hotel design on our positioning grid.**

**What we need:**

| Item | Format | Notes |
|------|--------|-------|
| Figma file link | Share link (view access) | Or exported PNG |
| Design dimensions | Width × Height in pixels | Must match floor plan ratio |
| Asset export | Individual room/facility icons | Optional - for POI markers |

**Design Requirements:**
```
┌────────────────────────────────────────────────────────┐
│                   FIGMA DESIGN SPECS                   │
├────────────────────────────────────────────────────────┤
│                                                        │
│  Aspect Ratio: Must match actual floor plan            │
│                                                        │
│  Example:                                              │
│  - Floor: 200ft × 150ft (ratio 4:3)                   │
│  - Design: 800px × 600px (same ratio 4:3)             │
│                                                        │
│  Grid Alignment:                                       │
│  - We will map design pixels to tiles                  │
│  - 1 tile = (design_width / cols) pixels              │
│                                                        │
│  Transparency:                                         │
│  - Walkable areas: Semi-transparent for blue dot       │
│  - Walls: Can be opaque                               │
│                                                        │
└────────────────────────────────────────────────────────┘
```

**Layer Structure (Recommended):**
```
Figma Layers:
├── Background (floor texture)
├── Walls & Obstacles
├── Room Labels
├── Facility Icons
├── Corridor Highlights (optional)
└── POI Markers (optional)
```

---

### 7. Site Visit Requirements

| Requirement | Details |
|-------------|---------|
| **WiFi Access** | Password for guest network |
| **Duration** | 2-4 hours (depending on floor size) |
| **Access** | All areas including restricted (for mapping) |
| **Contact Person** | Name & phone for site visit day |
| **Best Time** | Low traffic hours preferred |

**What we do during site visit:**
1. Walk through entire floor
2. Scan WiFi at each tile position
3. Record RSSI fingerprints
4. Verify AP coverage
5. Test positioning accuracy

---

### 8. Tile Calculation

**Help us calculate your grid:**

```
Floor Dimensions:
- Width:  _______ feet/meters
- Height: _______ feet/meters

Tile Size: 3 feet (1 meter) recommended

Grid Size:
- Columns (COLS) = Width ÷ 3 = _______ tiles
- Rows (ROWS)    = Height ÷ 3 = _______ tiles
- Total Tiles    = COLS × ROWS = _______ tiles

Mapping Time Estimate:
- Time per tile: ~8 seconds
- Total time: _______ tiles × 8 sec = _______ minutes
```

**Example:**
```
Floor: 150ft × 120ft
Tile size: 3ft

COLS = 150 ÷ 3 = 50 tiles
ROWS = 120 ÷ 3 = 40 tiles
Total = 50 × 40 = 2,000 tiles

Mapping time = 2,000 × 8 sec = 16,000 sec ≈ 4.4 hours
```

---

### 9. Deliverables Summary

**From Hotel (You Provide):**

- [ ] Floor plan image (high resolution)
- [ ] Floor dimensions (width × height)
- [ ] WiFi AP list with BSSIDs
- [ ] AP locations marked on floor plan
- [ ] Area classification (walkable/walls/rooms)
- [ ] Room numbers list
- [ ] Facilities & amenities list
- [ ] Emergency points list
- [ ] Figma design file (or exported image)
- [ ] WiFi password for site visit
- [ ] Site visit contact person

**From Us (We Deliver):**

- [ ] Tile grid overlay on Figma design
- [ ] WiFi fingerprint mapping data
- [ ] Working positioning in app
- [ ] Navigation to all POIs
- [ ] Accuracy testing report

---

### 10. Quick Checklist

```
BEFORE SITE VISIT:
□ Floor plan received
□ Dimensions confirmed
□ WiFi AP list received
□ BSSIDs verified
□ Figma design received
□ POI list complete
□ Site visit scheduled

DURING SITE VISIT:
□ WiFi access working
□ All areas accessible
□ Mapping complete
□ Accuracy tested

AFTER SITE VISIT:
□ Mapping data processed
□ Design integrated
□ App configured
□ Final testing done
□ Handover complete
```

---

## Contact Information

**Project Contact:**
- Name: _______________________
- Email: ______________________
- Phone: ______________________

**Hotel Contact:**
- Name: _______________________
- Email: ______________________
- Phone: ______________________

---

## Timeline

| Phase | Duration | Activities |
|-------|----------|------------|
| **Requirements** | 1-2 days | Collect floor plan, WiFi info, POIs |
| **Design Setup** | 1-2 days | Grid overlay on Figma design |
| **Site Visit** | 1 day | WiFi fingerprint mapping |
| **Integration** | 2-3 days | Data processing, app config |
| **Testing** | 1 day | Accuracy verification |
| **Handover** | 1 day | Documentation, training |

**Total: 1-2 weeks**

---

*Document Version: 1.0*
*Last Updated: February 2026*
