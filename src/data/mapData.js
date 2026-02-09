/**
 * Indoor map data: locations (searchable) and navigation graph for pathfinding.
 * Nodes are corridor junctions and room centers; edges are walkable paths with distance weight.
 */

const dist = (a, b) =>
  Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);

// Searchable locations: id, display name, node id (for pathfinding), optional category
export const LOCATIONS = [
  { id: 'indoor_stadium', name: 'Indoor Stadium', nodeId: 'indoor_stadium', category: 'Venue' },
  { id: 'auditorium', name: 'Auditorium', nodeId: 'auditorium', category: 'Venue' },
  { id: 'library', name: 'Library', nodeId: 'library', category: 'Facility' },
  { id: 'computer_lab', name: 'Computer Lab', nodeId: 'computer_lab', category: 'Lab' },
  { id: 'electronics_lab', name: 'Electronics Lab', nodeId: 'electronics_lab', category: 'Lab' },
  { id: 'physics_lab', name: 'Physics Lab', nodeId: 'physics_lab', category: 'Lab' },
  { id: 'chem_lab', name: 'Chem Lab', nodeId: 'chem_lab', category: 'Lab' },
  { id: 'reception', name: 'Reception', nodeId: 'reception', category: 'Admin' },
  { id: 'cafeteria', name: 'Cafeteria', nodeId: 'cafeteria', category: 'Facility' },
  { id: 'meeting_1', name: 'Meeting Room 1', nodeId: 'meeting_1', category: 'Room' },
  { id: 'meeting_2', name: 'Meeting Room 2', nodeId: 'meeting_2', category: 'Room' },
  { id: 'stairs', name: 'Stairs', nodeId: 'stairs', category: 'Utility' },
  { id: 'elevator', name: 'Elevator', nodeId: 'elevator', category: 'Utility' },
  { id: 'restroom_m', name: 'Restroom (M)', nodeId: 'restroom_m', category: 'Utility' },
  { id: 'restroom_f', name: 'Restroom (F)', nodeId: 'restroom_f', category: 'Utility' },
  { id: 'storage', name: 'Storage', nodeId: 'storage', category: 'Utility' },
  { id: 'server', name: 'Server Room', nodeId: 'server', category: 'Utility' },
  { id: 'room_101', name: 'Room 101', nodeId: 'room_101', category: 'Classroom' },
  { id: 'room_102', name: 'Room 102', nodeId: 'room_102', category: 'Classroom' },
  { id: 'room_103', name: 'Room 103', nodeId: 'room_103', category: 'Classroom' },
  { id: 'room_104', name: 'Room 104', nodeId: 'room_104', category: 'Classroom' },
  { id: 'room_105', name: 'Room 105', nodeId: 'room_105', category: 'Classroom' },
  { id: 'room_106', name: 'Room 106', nodeId: 'room_106', category: 'Classroom' },
  { id: 'room_107', name: 'Room 107', nodeId: 'room_107', category: 'Classroom' },
  { id: 'room_108', name: 'Room 108', nodeId: 'room_108', category: 'Classroom' },
];

// Graph nodes: id -> { x, y } (map coordinates in px)
export const NODES = {
  // Corridor junctions
  main_west: { x: 90, y: 335 },
  main_center: { x: 550, y: 335 },
  main_east: { x: 1010, y: 335 },
  wing_a: { x: 50, y: 335 },
  wing_a_bottom: { x: 50, y: 650 },
  wing_b: { x: 1040, y: 335 },
  wing_b_bottom: { x: 1040, y: 650 },
  south_west: { x: 90, y: 785 },
  south_center: { x: 550, y: 785 },
  south_east: { x: 1010, y: 785 },
  south_stadium: { x: 265, y: 785 },
  south_auditorium: { x: 680, y: 785 },
  main_library: { x: 710, y: 335 },
  main_lab: { x: 190, y: 335 },
  lab_junction: { x: 300, y: 335 },       // between main_lab and main_electronics (corridor between labs)
  main_electronics: { x: 400, y: 335 },
  lab_corridor_mid: { x: 300, y: 495 },   // corridor between Computer/Electronics row and Physics/Chem row
  main_stairs: { x: 335, y: 335 },
  main_elevator: { x: 415, y: 335 },
  main_meeting: { x: 750, y: 335 },
  wing_b_storage: { x: 1040, y: 435 },

  // Room / venue centers (destinations)
  indoor_stadium: { x: 265, y: 685 },
  auditorium: { x: 680, y: 685 },
  library: { x: 710, y: 495 },
  computer_lab: { x: 190, y: 435 },
  electronics_lab: { x: 400, y: 435 },
  physics_lab: { x: 190, y: 555 },
  chem_lab: { x: 400, y: 555 },
  reception: { x: 190, y: 85 },
  cafeteria: { x: 915, y: 85 },
  meeting_1: { x: 750, y: 52 },
  meeting_2: { x: 750, y: 117 },
  stairs: { x: 335, y: 85 },
  elevator: { x: 415, y: 85 },
  restroom_m: { x: 510, y: 85 },
  restroom_f: { x: 620, y: 85 },
  storage: { x: 965, y: 435 },
  server: { x: 965, y: 555 },
  room_101: { x: 100, y: 67 },
  room_102: { x: 280, y: 67 },
  room_103: { x: 460, y: 67 },
  room_104: { x: 640, y: 67 },
  room_105: { x: 100, y: 172 },
  room_106: { x: 280, y: 172 },
  room_107: { x: 460, y: 172 },
  room_108: { x: 640, y: 172 },
};

// Edges: [fromId, toId, weight]. Weight = distance for Dijkstra.
function edge(a, b) {
  const w = Math.round(dist(NODES[a], NODES[b]));
  return [a, b, w];
}

const EDGES = [
  // Main corridor
  edge('main_west', 'main_lab'),
  edge('main_lab', 'lab_junction'),
  edge('lab_junction', 'main_electronics'),
  edge('lab_junction', 'lab_corridor_mid'),  // down to corridor between lab rows
  edge('main_electronics', 'main_stairs'),
  edge('main_stairs', 'main_elevator'),
  edge('main_elevator', 'main_center'),
  edge('main_center', 'main_library'),
  edge('main_library', 'main_meeting'),
  edge('main_meeting', 'main_east'),
  edge('main_west', 'wing_a'),
  edge('wing_a', 'wing_a_bottom'),
  edge('main_east', 'wing_b'),
  edge('wing_b', 'wing_b_storage'),
  edge('wing_b_storage', 'wing_b_bottom'),
  // South corridor
  edge('south_west', 'south_stadium'),
  edge('south_stadium', 'south_center'),
  edge('south_center', 'south_auditorium'),
  edge('south_auditorium', 'south_east'),
  // Vertical links
  edge('main_west', 'south_west'),
  edge('main_east', 'south_east'),
  edge('wing_a_bottom', 'south_west'),
  edge('wing_b_bottom', 'south_east'),
  // Rooms to corridors
  edge('indoor_stadium', 'south_stadium'),
  edge('auditorium', 'south_auditorium'),
  edge('library', 'main_library'),
  edge('computer_lab', 'main_lab'),
  edge('electronics_lab', 'main_electronics'),
  edge('physics_lab', 'lab_corridor_mid'),  // path via corridor between labs, not over Computer Lab
  edge('chem_lab', 'lab_corridor_mid'),     // path via corridor between labs, not over Electronics Lab
  edge('reception', 'main_lab'),
  edge('cafeteria', 'main_east'),
  edge('meeting_1', 'main_meeting'),
  edge('meeting_2', 'main_meeting'),
  edge('stairs', 'main_stairs'),
  edge('elevator', 'main_elevator'),
  edge('restroom_m', 'main_elevator'),
  edge('restroom_f', 'main_library'),
  edge('storage', 'wing_b_storage'),
  edge('server', 'wing_b_bottom'),
  edge('room_101', 'main_west'),
  edge('room_102', 'main_lab'),
  edge('room_103', 'main_stairs'),
  edge('room_104', 'main_elevator'),
  edge('room_105', 'main_west'),
  edge('room_106', 'main_lab'),
  edge('room_107', 'main_stairs'),
  edge('room_108', 'main_elevator'),
];

// Build adjacency list: nodeId -> [{ id, weight }, ...]
export const GRAPH = (() => {
  const g = {};
  const add = (from, to, w) => {
    if (!g[from]) g[from] = [];
    g[from].push({ id: to, weight: w });
  };
  EDGES.forEach(([a, b, w]) => {
    add(a, b, w);
    add(b, a, w);
  });
  return g;
})();

export default { LOCATIONS, NODES, GRAPH };
