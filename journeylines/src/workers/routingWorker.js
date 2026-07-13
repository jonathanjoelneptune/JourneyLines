import { buildSurfacePresentationGeometry, isSurfaceRouteMode } from '../utils/routePresentation.js';

let routingData = null;
let routingVersion = 'multimodal-v7.1';
let dataVersion = null;
let landIndex = null;
let waterNodeIndex = null;
let waterNodes = [];
let corridorEdges = new Set();
let corridorCoordEdges = new Set();
let permittedLandCrossingEdges = new Set();
let routeCache = new Map();
let roadGraph = null;
let railGraph = null;

const LAND_CELL = 8;
const WATER_CELL = 4;
const SURFACE_CELL = 2;

self.onmessage = async event => {
  const message = event.data || {};
  const { id, type, payload = {} } = message;
  try {
    if (type === 'init') {
      const result = await initialize(payload);
      postResult(id, result);
      return;
    }
    if (!routingData) await initialize(payload);
    if (type === 'route') {
      const result = routeLeg(payload.leg);
      postResult(id, result);
      return;
    }
    if (type === 'playbackPlan') {
      const result = buildPlaybackPlan(payload.leg, payload.geometry, payload.samples);
      const transfer = [];
      for (const value of Object.values(result || {})) {
        if (value instanceof Float32Array || value instanceof Uint32Array || value instanceof Uint16Array) transfer.push(value.buffer);
      }
      self.postMessage({ id, ok: true, result }, transfer);
      return;
    }
    throw new Error(`Unknown worker request: ${type}`);
  } catch (error) {
    self.postMessage({ id, ok: false, error: error?.message || String(error) });
  }
};

function postResult(id, result) {
  self.postMessage({ id, ok: true, result });
}

function postStatus(status) {
  self.postMessage({ type: 'status', status });
}

async function initialize(payload = {}) {
  if (routingData) {
    return {
      ready: true,
      dataVersion,
      nodeCount: waterNodes.length,
      landRingCount: routingData?.landRings?.length || 0,
      roadNodeCount: roadGraph?.nodes?.length || 0,
      railNodeCount: railGraph?.nodes?.length || 0
    };
  }
  routingVersion = payload.routingVersion || routingVersion;
  const url = payload.dataUrl;
  if (!url) throw new Error('Natural Earth routing data URL was not provided.');
  postStatus({
    state: 'loading',
    label: 'Loading Natural Earth data',
    detail: 'Fetching detailed water, coastline, road, and rail data.',
    ready: false
  });
  const response = await fetch(url, { cache: 'force-cache' });
  if (!response.ok) throw new Error(`Routing data request failed (${response.status}).`);
  routingData = await response.json();
  dataVersion = routingData?.version || 'unknown';
  postStatus({
    state: 'indexing',
    label: 'Indexing routing data',
    detail: 'Building land and water spatial indexes in the worker.',
    ready: false
  });
  landIndex = buildLandIndex(routingData?.landRings || []);
  buildWaterGraphData();
  roadGraph = buildSurfaceGraph(routingData?.roads || [], 'road');
  railGraph = buildSurfaceGraph(routingData?.rails || [], 'rail');
  postStatus({
    state: 'ready',
    label: 'Routing engine ready',
    detail: `${(roadGraph?.nodes?.length || 0).toLocaleString()} road · ${(railGraph?.nodes?.length || 0).toLocaleString()} rail · ${waterNodes.length.toLocaleString()} water nodes`,
    ready: true,
    dataVersion,
    loadedAt: Date.now()
  });
  return {
    ready: true,
    dataVersion,
    nodeCount: waterNodes.length,
    landRingCount: routingData?.landRings?.length || 0,
    roadNodeCount: roadGraph?.nodes?.length || 0,
    railNodeCount: railGraph?.nodes?.length || 0
  };
}

function buildLandIndex(rings) {
  const index = new Map();
  rings.forEach((ring, i) => {
    const b = ring?.b;
    if (!Array.isArray(b) || b.length < 4) return;
    const x0 = Math.floor(b[0] / LAND_CELL);
    const x1 = Math.floor(b[2] / LAND_CELL);
    const y0 = Math.floor(b[1] / LAND_CELL);
    const y1 = Math.floor(b[3] / LAND_CELL);
    for (let x = x0; x <= x1; x++) {
      for (let y = y0; y <= y1; y++) {
        const key = `${x}:${y}`;
        const list = index.get(key) || [];
        list.push(i);
        index.set(key, list);
      }
    }
  });
  return index;
}

function buildWaterGraphData() {
  const nodeByKey = new Map();
  waterNodes = [];
  const add = p => {
    if (!Array.isArray(p) || p.length < 2) return -1;
    const lon = Number(p[0]);
    const lat = Number(p[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return -1;
    const key = coordKey([lon, lat], 2);
    if (nodeByKey.has(key)) return nodeByKey.get(key);
    const index = waterNodes.length;
    nodeByKey.set(key, index);
    waterNodes.push([lon, lat]);
    return index;
  };

  for (const p of routingData?.waterDetailNodes || []) add(p);
  for (const p of routingData?.waterGraphNodes || []) add(p);
  for (const corridor of routingData?.waterCorridors || []) {
    const coords = (corridor?.nodes || []).map(toCoord).filter(Boolean);
    const ids = coords.map(add).filter(i => i >= 0);
    const permittedIndexes = new Set(
      Array.isArray(corridor?.landCrossingEdgeIndexes)
        ? corridor.landCrossingEdgeIndexes.map(Number)
        : []
    );
    for (let i = 1; i < ids.length; i++) {
      corridorEdges.add(edgeKey(ids[i - 1], ids[i]));
      corridorEdges.add(edgeKey(ids[i], ids[i - 1]));
      corridorCoordEdges.add(coordEdgeKey(coords[i - 1], coords[i]));
      corridorCoordEdges.add(coordEdgeKey(coords[i], coords[i - 1]));
      if (permittedIndexes.has(i - 1)) {
        permittedLandCrossingEdges.add(coordEdgeKey(coords[i - 1], coords[i]));
        permittedLandCrossingEdges.add(coordEdgeKey(coords[i], coords[i - 1]));
      }
    }
  }

  waterNodeIndex = new Map();
  waterNodes.forEach((p, i) => {
    const key = waterCellKey(p);
    const list = waterNodeIndex.get(key) || [];
    list.push(i);
    waterNodeIndex.set(key, list);
  });
}


function buildSurfaceGraph(lines = [], kind = 'surface') {
  const nodes = [];
  const adjacency = [];
  const nodeByKey = new Map();
  const spatial = new Map();

  const addNode = point => {
    const coord = toCoord(point);
    if (!coord) return -1;
    const key = coordKey(coord, 2);
    if (nodeByKey.has(key)) return nodeByKey.get(key);
    const id = nodes.length;
    nodeByKey.set(key, id);
    nodes.push(coord);
    adjacency.push([]);
    const cell = surfaceCellKey(coord);
    const list = spatial.get(cell) || [];
    list.push(id);
    spatial.set(cell, list);
    return id;
  };

  const addEdge = (a, b) => {
    if (a < 0 || b < 0 || a === b) return;
    const weight = haversineMiles(nodes[a], nodes[b]);
    if (!Number.isFinite(weight) || weight <= 0 || weight > 600) return;
    adjacency[a].push([b, weight]);
    adjacency[b].push([a, weight]);
  };

  for (const line of lines || []) {
    const ids = (line?.p || []).map(addNode).filter(id => id >= 0);
    for (let index = 1; index < ids.length; index++) addEdge(ids[index - 1], ids[index]);
  }

  return { kind, nodes, adjacency, spatial };
}

function surfaceCellKey(point) {
  return `${Math.floor(Number(point[0]) / SURFACE_CELL)}:${Math.floor(Number(point[1]) / SURFACE_CELL)}`;
}

function nearestSurfaceNode(graph, point, maxRadiusDegrees = 12) {
  if (!graph?.nodes?.length) return null;
  const cx = Math.floor(Number(point[0]) / SURFACE_CELL);
  const cy = Math.floor(Number(point[1]) / SURFACE_CELL);
  const maxCells = Math.max(1, Math.ceil(maxRadiusDegrees / SURFACE_CELL));
  let bestId = -1;
  let bestMiles = Infinity;
  for (let radius = 0; radius <= maxCells; radius++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      for (let y = cy - radius; y <= cy + radius; y++) {
        if (radius > 0 && x !== cx - radius && x !== cx + radius && y !== cy - radius && y !== cy + radius) continue;
        for (const id of graph.spatial.get(`${x}:${y}`) || []) {
          const miles = haversineMiles(point, graph.nodes[id]);
          if (miles < bestMiles) {
            bestMiles = miles;
            bestId = id;
          }
        }
      }
    }
    if (bestId >= 0 && bestMiles < Math.max(18, radius * SURFACE_CELL * 45)) break;
  }
  return bestId >= 0 ? { id: bestId, miles: bestMiles } : null;
}

function astarSurfaceRoute(graph, startId, goalId, startPoint, goalPoint) {
  if (!graph?.nodes?.length || startId < 0 || goalId < 0) return null;
  if (startId === goalId) return [graph.nodes[startId]];
  const open = new MinHeap();
  open.push(startId, 0);
  const came = new Map();
  const g = new Map([[startId, 0]]);
  const closed = new Set();
  const directMiles = Math.max(1, haversineMiles(startPoint, goalPoint));
  const maxVisited = directMiles > 5000 ? 160000 : directMiles > 1800 ? 120000 : 80000;
  let visited = 0;

  while (open.size && visited++ < maxVisited) {
    const current = open.pop();
    if (closed.has(current)) continue;
    if (current === goalId) {
      const path = [];
      let cursor = current;
      path.unshift(graph.nodes[cursor]);
      while (came.has(cursor)) {
        cursor = came.get(cursor);
        path.unshift(graph.nodes[cursor]);
      }
      return simplifySurfacePath(path);
    }
    closed.add(current);
    for (const [next, weight] of graph.adjacency[current] || []) {
      if (closed.has(next)) continue;
      const nextPoint = graph.nodes[next];
      const corridorPenalty = Math.min(80, distancePointToSegment(nextPoint, startPoint, goalPoint) * 3.5);
      const tentative = (g.get(current) ?? Infinity) + weight + corridorPenalty;
      if (tentative >= (g.get(next) ?? Infinity)) continue;
      came.set(next, current);
      g.set(next, tentative);
      const heuristic = haversineMiles(nextPoint, goalPoint) * 0.94;
      open.push(next, tentative + heuristic);
    }
  }
  return null;
}

function simplifySurfacePath(path = []) {
  const clean = cleanRoute(path);
  if (clean.length <= 220) return clean;
  const stride = Math.max(1, Math.floor(clean.length / 180));
  const out = [clean[0]];
  for (let index = stride; index < clean.length - 1; index += stride) out.push(clean[index]);
  out.push(clean[clean.length - 1]);
  return cleanRoute(out);
}

function routeLeg(leg = {}) {
  if (!leg?.from || !leg?.to) throw new Error('Route endpoints are missing.');
  const mode = leg.mode === 'car' ? 'drive' : (leg.mode || 'plane');
  const fromKey = `${leg.from.id || 'from'}@${Number(leg.from.lon).toFixed(5)},${Number(leg.from.lat).toFixed(5)}`;
  const toKey = `${leg.to.id || 'to'}@${Number(leg.to.lon).toFixed(5)},${Number(leg.to.lat).toFixed(5)}`;
  const key = `${routingVersion}:${leg.legId || leg.id || 'legacy'}:${fromKey}->${toKey}:${mode}`;
  if (routeCache.has(key)) return routeCache.get(key);

  let routed;
  if (mode === 'boat') {
    const geometry = routeBoat(leg);
    routed = {
      geometry,
      source: 'natural-earth-water-graph',
      detail: 'water-graph'
    };
  } else if (mode === 'train') {
    routed = routeSurface(leg, railGraph, routingData?.rails || [], 'train');
  } else if (mode === 'drive') {
    routed = routeSurface(leg, roadGraph, routingData?.roads || [], 'drive');
  } else {
    routed = {
      geometry: greatCircleCoordinates(leg.from, leg.to, 180),
      source: 'great-circle',
      detail: 'air-route'
    };
  }

  const geometry = cleanRoute(routed?.geometry || []);
  const validation = validateGeneratedRoute(leg, geometry, mode, routed || {});
  const result = {
    geometry,
    source: routed?.source || 'routing-worker',
    detail: routed?.detail || '',
    provider: 'GlobeHoppers multimodal worker',
    validation,
    dataVersion,
    routingVersion
  };
  routeCache.set(key, result);
  return result;
}

function validateGeneratedRoute(leg, geometry, mode, routed = {}) {
  const from = [Number(leg.from.lon), Number(leg.from.lat)];
  const to = [Number(leg.to.lon), Number(leg.to.lat)];
  const routeMiles = routeMilesHaversine(geometry);
  const directMiles = haversineMiles(from, to);
  const startGap = geometry?.length ? haversineMiles(from, geometry[0]) : Infinity;
  const endGap = geometry?.length ? haversineMiles(to, geometry[geometry.length - 1]) : Infinity;
  const landCrossings = mode === 'boat' && geometry?.length ? countBoatLandCrossings(geometry) : 0;
  const surfaceWaterRatio = mode === 'drive' || mode === 'train' ? routeWaterSampleRatio(geometry) : 0;
  return {
    routeMiles,
    directMiles,
    startEndpointGapMiles: startGap,
    endEndpointGapMiles: endGap,
    maxEndpointGapMiles: Math.max(startGap, endGap),
    landCrossings,
    surfaceWaterRatio,
    stationaryFallback: Boolean(mode === 'boat' && directMiles > 2 && routeMiles < 0.25),
    networkStartGapMiles: Number(routed?.networkStartGapMiles || 0),
    networkEndGapMiles: Number(routed?.networkEndGapMiles || 0),
    graphVisited: Number(routed?.graphVisited || 0),
    usedFallback: Boolean(routed?.usedFallback)
  };
}

function routeMilesHaversine(route = []) {
  let total = 0;
  for (let index = 1; index < (route || []).length; index++) total += haversineMiles(route[index - 1], route[index]);
  return total;
}

function routeWaterSampleRatio(route = []) {
  if (!Array.isArray(route) || route.length < 2) return 1;
  let checked = 0;
  let water = 0;
  const stride = Math.max(1, Math.floor(route.length / 100));
  for (let index = 0; index < route.length; index += stride) {
    checked++;
    if (!isLand(route[index])) water++;
  }
  return checked ? water / checked : 1;
}

function routeBoat(leg) {
  const cityA = [Number(leg.from.lon), Number(leg.from.lat)];
  const cityB = [Number(leg.to.lon), Number(leg.to.lat)];
  const a = nearestWaterPoint(cityA, cityB);
  const b = nearestWaterPoint(cityB, a);
  const corridor = sameCorridorRoute(a, b);
  if (corridor?.length > 1) return finalizeBoatRoute(cityA, cityB, corridor);

  const path = astarWaterRoute(a, b);
  if (path?.length > 1) return finalizeBoatRoute(cityA, cityB, path);

  const gridPath = waterGridRoute(a, b);
  if (gridPath?.length > 1) return finalizeBoatRoute(cityA, cityB, gridPath);

  const direct = [a, b];
  if (!segmentHitsLand(a, b, false)) return finalizeBoatRoute(cityA, cityB, direct);

  const broad = broadWaterFallback(a, b);
  if (broad?.length > 1 && !routeHasLand(broad)) return finalizeBoatRoute(cityA, cityB, broad);

  // Never return a known land-crossing boat segment. A stationary water-side
  // dock is preferable to visually driving a boat across a continent.
  return [a, a];
}

function finalizeBoatRoute(cityA, cityB, route) {
  const clean = cleanRoute(route || []);
  const a = clean[0] || nearestWaterPoint(cityA, cityB);
  const b = clean[clean.length - 1] || nearestWaterPoint(cityB, a);
  // The visible boat path always starts/ends on explicit water/dock points.
  // City coordinates remain the semantic trip endpoints in the UI.
  const points = cleanRoute([a, ...clean, b]);
  return simplifyRoute(points, 0.018, 24);
}

function sameCorridorRoute(a, b) {
  let best = null;
  let bestScore = Infinity;
  for (const corridor of routingData?.waterCorridors || []) {
    const nodes = (corridor?.nodes || []).map(toCoord).filter(Boolean);
    if (nodes.length < 3) continue;
    const ai = nearestNodeIndex(a, nodes);
    const bi = nearestNodeIndex(b, nodes);
    if (ai < 0 || bi < 0 || ai === bi) continue;
    const da = distanceDeg(a, nodes[ai]);
    const db = distanceDeg(b, nodes[bi]);
    const maxAttach = corridor.kind === 'coastal' ? 9.5 : 5.5;
    if (da > maxAttach || db > maxAttach) continue;
    const lo = Math.min(ai, bi);
    const hi = Math.max(ai, bi);
    const sequence = ai <= bi ? nodes.slice(lo, hi + 1) : nodes.slice(lo, hi + 1).reverse();

    const safeSequence = safeCorridorSequence(sequence);
    if (!safeSequence?.length) continue;
    const first = safeSequence[0];
    const last = safeSequence[safeSequence.length - 1];
    const startAttach = segmentHitsLand(a, first, false)
      ? waterGridRoute(a, first, { step: 0.14, pad: 3.0, maxVisited: 160000 })
      : [a, first];
    const endAttach = segmentHitsLand(last, b, false)
      ? waterGridRoute(last, b, { step: 0.10, pad: 3.5, maxVisited: 220000 })
      : [last, b];
    if (!startAttach?.length || !endAttach?.length) continue;

    const route = cleanRoute([
      ...startAttach,
      ...safeSequence.slice(1, -1),
      ...endAttach
    ]);
    if (routeHasLand(route)) continue;
    const score = da + db + routeLength(route) * 0.01;
    if (score < bestScore) {
      bestScore = score;
      best = route;
    }
  }
  return best;
}

function safeCorridorSequence(sequence = []) {
  if (!Array.isArray(sequence) || sequence.length < 2) return sequence || [];
  const out = [sequence[0]];
  for (let i = 1; i < sequence.length; i++) {
    const a = out[out.length - 1];
    const b = sequence[i];
    if (!segmentHitsLand(a, b, isCorridorCoordinateEdge(a, b))) {
      out.push(b);
      continue;
    }
    const distance = distanceDeg(a, b);
    const step = distance < 4 ? 0.10 : distance < 9 ? 0.16 : 0.28;
    const repair = waterGridRoute(a, b, {
      step,
      pad: Math.max(2.8, distance * 0.45),
      maxVisited: distance < 9 ? 180000 : 260000
    });
    if (!repair?.length || routeHasLand(repair)) return null;
    out.push(...repair.slice(1));
  }
  return cleanRoute(out);
}

function astarWaterRoute(startPoint, goalPoint) {
  const startId = waterNodes.length;
  const goalId = waterNodes.length + 1;
  const tempNodes = [...waterNodes, startPoint, goalPoint];
  const directDistance = Math.max(1, distanceDeg(startPoint, goalPoint));
  const longRoute = directDistance > 25;
  const maxVisited = longRoute ? 24000 : 12000;
  const edgeCache = new Map();

  const open = new MinHeap();
  open.push(startId, 0);
  const came = new Map();
  const g = new Map([[startId, 0]]);
  let visited = 0;

  while (open.size && visited++ < maxVisited) {
    const current = open.pop();
    if (current === goalId) return reconstructPath(came, current, tempNodes);
    const currentPoint = tempNodes[current];
    const neighbors = waterNeighbors(current, currentPoint, startId, goalId, startPoint, goalPoint, tempNodes, directDistance);
    for (const next of neighbors) {
      const nextPoint = tempNodes[next];
      const pair = `${current}:${next}`;
      let valid = edgeCache.get(pair);
      if (valid == null) {
        valid = !segmentHitsLand(currentPoint, nextPoint, isCorridorCoordinateEdge(currentPoint, nextPoint));
        edgeCache.set(pair, valid);
      }
      if (!valid) continue;

      const distance = distanceDeg(currentPoint, nextPoint);
      const regionalPenalty = directDistance < 30 ? distancePointToSegment(nextPoint, startPoint, goalPoint) * 0.25 : distancePointToSegment(nextPoint, startPoint, goalPoint) * 0.035;
      const tentative = (g.get(current) ?? Infinity) + distance + regionalPenalty;
      if (tentative >= (g.get(next) ?? Infinity)) continue;
      came.set(next, current);
      g.set(next, tentative);
      const heuristic = distanceDeg(nextPoint, goalPoint) * 0.96;
      open.push(next, tentative + heuristic);
    }
  }
  return null;
}

function waterNeighbors(id, p, startId, goalId, startPoint, goalPoint, nodes, directDistance) {
  const radius = directDistance > 60 ? 7.5 : directDistance > 25 ? 6 : directDistance > 10 ? 4.8 : 3.2;
  const candidates = [];
  if (id === startId) {
    candidates.push(...nearestWaterNodeIds(startPoint, radius * 1.5, 24));
  } else if (id === goalId) {
    return [];
  } else {
    candidates.push(...nearbyWaterNodeIds(p, radius));
  }
  if (distanceDeg(p, goalPoint) <= radius * 1.5) candidates.push(goalId);
  if (distanceDeg(p, startPoint) <= radius * 1.2) candidates.push(startId);

  const unique = [...new Set(candidates)].filter(next => next !== id);
  unique.sort((a, b) => distanceDeg(p, nodes[a]) - distanceDeg(p, nodes[b]));
  return unique.slice(0, directDistance > 35 ? 26 : 18);
}

function nearbyWaterNodeIds(p, radius) {
  const ids = [];
  const cellRadius = Math.ceil(radius / WATER_CELL);
  const [cx, cy] = waterCellCoords(p);
  for (let x = cx - cellRadius; x <= cx + cellRadius; x++) {
    for (let y = cy - cellRadius; y <= cy + cellRadius; y++) {
      for (const id of waterNodeIndex.get(`${x}:${y}`) || []) {
        if (distanceDeg(p, waterNodes[id]) <= radius) ids.push(id);
      }
    }
  }
  return ids;
}

function nearestWaterNodeIds(p, radius, limit) {
  const ids = nearbyWaterNodeIds(p, radius);
  ids.sort((a, b) => distanceDeg(p, waterNodes[a]) - distanceDeg(p, waterNodes[b]));
  return ids.slice(0, limit);
}

function isCorridorCoordinateEdge(a, b) {
  // Only explicit canals may legally cross Natural Earth land polygons.
  // Coastal/sea/strait corridor edges still undergo normal land validation.
  return permittedLandCrossingEdges.has(coordEdgeKey(a, b));
}

function coordEdgeKey(a, b) {
  return `${coordKey(a, 2)}>${coordKey(b, 2)}`;
}

function nearestWaterPoint(city, other) {
  // Always prefer an explicit dense water node near a boat origin/destination.
  // Natural Earth land polygons can classify a coastal city coordinate as water
  // after simplification; anchoring to the water graph prevents final land clips.
  const nearby = nearestWaterNodeIds(city, 4.5, 64);
  let graphBest = null;
  let graphScore = Infinity;
  for (const id of nearby) {
    const p = waterNodes[id];
    if (!p || isLand(p)) continue;
    const d = distanceDeg(city, p);
    const score = d + distanceDeg(p, other) * 0.003;
    if (score < graphScore) {
      graphScore = score;
      graphBest = p;
    }
  }
  if (graphBest && distanceDeg(city, graphBest) <= 3.2) return graphBest;

  if (!isLand(city)) return city;
  let best = null;
  let bestScore = Infinity;
  for (let ring = 1; ring <= 24; ring++) {
    const distance = 0.10 + ring * 0.10;
    for (let i = 0; i < 40; i++) {
      const angle = i / 40 * Math.PI * 2;
      const p = [city[0] + Math.cos(angle) * distance, city[1] + Math.sin(angle) * distance];
      if (isLand(p)) continue;
      const score = distanceDeg(city, p) + distanceDeg(p, other) * 0.01;
      if (score < bestScore) {
        bestScore = score;
        best = p;
      }
    }
    if (best) break;
  }
  return best || city;
}

function waterGridRoute(a, b, options = {}) {
  const direct = distanceDeg(a, b);
  const step = Number(options.step) || (direct < 35 ? 0.5 : direct < 80 ? 1.0 : 1.75);
  const pad = Number(options.pad) || (direct < 35 ? 6 : direct < 80 ? 12 : 24);
  const box = expandedBox(a, b, pad);
  box[0] = Math.max(-180, box[0]);
  box[2] = Math.min(180, box[2]);
  box[1] = Math.max(-70, box[1]);
  box[3] = Math.min(75, box[3]);

  const keyFor = p => `${Math.round(p[0] / step)}:${Math.round(p[1] / step)}`;
  const pointFor = key => {
    const [x, y] = key.split(':').map(Number);
    return [x * step, y * step];
  };
  const validGridPoint = p => p[0] >= box[0] && p[0] <= box[2] && p[1] >= box[1] && p[1] <= box[3] && !isLand(p);
  const seedsAround = endpoint => {
    const seeds = [];
    const baseX = Math.round(endpoint[0] / step);
    const baseY = Math.round(endpoint[1] / step);
    for (let radius = 0; radius <= 5; radius++) {
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dy = -radius; dy <= radius; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
          const p = [(baseX + dx) * step, (baseY + dy) * step];
          if (!validGridPoint(p) || segmentHitsLand(endpoint, p, false)) continue;
          seeds.push(keyFor(p));
        }
      }
      if (seeds.length >= 8) break;
    }
    return [...new Set(seeds)];
  };

  const starts = seedsAround(a);
  const goals = new Set(seedsAround(b));
  if (!starts.length || !goals.size) return null;

  const open = new MinHeap();
  const came = new Map();
  const g = new Map();
  for (const key of starts) {
    const p = pointFor(key);
    const cost = distanceDeg(a, p);
    g.set(key, cost);
    open.push(key, cost + distanceDeg(p, b));
  }

  const directions = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
  let visited = 0;
  const maxVisited = Number(options.maxVisited) || (direct < 35 ? 50000 : 90000);
  let found = null;
  while (open.size && visited++ < maxVisited) {
    const current = open.pop();
    if (goals.has(current)) {
      found = current;
      break;
    }
    const [cx, cy] = current.split(':').map(Number);
    const cp = [cx * step, cy * step];
    for (const [dx, dy] of directions) {
      const np = [(cx + dx) * step, (cy + dy) * step];
      if (!validGridPoint(np) || segmentHitsLand(cp, np, false)) continue;
      const next = `${cx + dx}:${cy + dy}`;
      const edge = distanceDeg(cp, np);
      const corridorPenalty = direct < 35 ? distancePointToSegment(np, a, b) * 0.08 : 0;
      const tentative = (g.get(current) ?? Infinity) + edge + corridorPenalty;
      if (tentative >= (g.get(next) ?? Infinity)) continue;
      came.set(next, current);
      g.set(next, tentative);
      open.push(next, tentative + distanceDeg(np, b));
    }
  }
  if (!found) return null;

  const keys = [found];
  let current = found;
  while (came.has(current)) {
    current = came.get(current);
    keys.unshift(current);
  }
  const route = [a, ...keys.map(pointFor), b];
  if (routeHasLand(route)) return null;
  return simplifyRoute(route, step * 0.35, 20);
}

function broadWaterFallback(a, b) {
  const mid = midpoint(a, b);
  const perp = perpendicular(a, b);
  const base = Math.max(3, distanceDeg(a, b) * 0.18);
  const options = [
    [a, [mid[0] + perp[0] * base, mid[1] + perp[1] * base], b],
    [a, [mid[0] - perp[0] * base, mid[1] - perp[1] * base], b]
  ];
  options.sort((x, y) => countLandSegments(x) - countLandSegments(y) || routeLength(x) - routeLength(y));
  return options[0];
}

function routeSurface(leg, graph, network, type) {
  const a = [Number(leg.from.lon), Number(leg.from.lat)];
  const b = [Number(leg.to.lon), Number(leg.to.lat)];
  const baja = bajaSurfaceRoute(a, b, type);
  if (baja) {
    return {
      geometry: baja,
      source: type === 'train' ? 'natural-earth-rail-fallback' : 'natural-earth-road-fallback',
      detail: 'baja-corridor',
      usedFallback: true,
      networkStartGapMiles: 0,
      networkEndGapMiles: 0
    };
  }

  const start = nearestSurfaceNode(graph, a, type === 'train' ? 9 : 7);
  const goal = nearestSurfaceNode(graph, b, type === 'train' ? 9 : 7);
  if (start && goal) {
    const path = astarSurfaceRoute(graph, start.id, goal.id, a, b);
    if (path?.length > 1) {
      const geometry = cleanRoute([a, ...path, b]);
      if (surfaceMostlyOnLand(geometry)) {
        return {
          geometry,
          source: type === 'train' ? 'natural-earth-rail-graph' : 'natural-earth-road-graph',
          detail: 'connected-network',
          usedFallback: false,
          networkStartGapMiles: start.miles,
          networkEndGapMiles: goal.miles
        };
      }
    }
  }

  const box = expandedBox(a, b, type === 'train' ? 3 : 5);
  const lines = (network || []).filter(line => boxesIntersect(box, line?.b)).slice(0, 1200);
  const controls = [a];
  const targetAttachLimit = type === 'train' ? 0.75 : 1.4;
  const corridorLimit = type === 'train' ? 1.2 : 2.8;
  for (const t of type === 'train' ? [0.2, 0.4, 0.6, 0.8] : [0.16, 0.32, 0.5, 0.68, 0.84]) {
    const target = lerpCoord(a, b, t);
    const nearest = nearestNetworkPoint(target, lines);
    if (nearest?.point && nearest.distance <= targetAttachLimit && distancePointToSegment(nearest.point, a, b) < corridorLimit) controls.push(nearest.point);
  }
  controls.push(b);
  let geometry = controls.length > 2
    ? smoothControlRoute(controls, type === 'train' ? 110 : 130)
    : resampleEqualDistance([a, b], type === 'train' ? 110 : 130);
  let detail = controls.length > 2 ? 'local-control-corridor' : 'direct-land-corridor';
  const directMiles = Math.max(1, haversineMiles(a, b));
  const stretchLimit = type === 'train' ? 2.4 : 2.8;
  if (!surfaceMostlyOnLand(geometry) || routeMilesHaversine(geometry) > directMiles * stretchLimit + 50) {
    geometry = resampleEqualDistance([a, b], 100);
    detail = 'direct-land-corridor';
  }
  return {
    geometry,
    source: type === 'train' ? 'natural-earth-rail-fallback' : 'natural-earth-road-fallback',
    detail,
    usedFallback: true,
    networkStartGapMiles: start?.miles || 0,
    networkEndGapMiles: goal?.miles || 0
  };
}

function bajaSurfaceRoute(a, b, type = 'train') {
  const near = (p, q, degrees) => distanceDeg(p, q) <= degrees;
  const cabo = [-109.9167, 22.8905];
  const sanDiego = [-117.1611, 32.7157];
  const involvesCabo = near(a, cabo, 2.4) || near(b, cabo, 2.4);
  const involvesSoCal = near(a, sanDiego, 3.2) || near(b, sanDiego, 3.2);
  if (!involvesCabo || !involvesSoCal) return null;

  const southbound = a[1] > b[1];
  const corridor = [
    [-117.1611, 32.7157],
    [-116.10, 31.50],
    [-114.70, 29.70],
    [-113.45, 27.85],
    [-112.20, 26.00],
    [-110.85, 24.40],
    [-109.9167, 22.8905]
  ];
  const route = southbound
    ? [a, ...corridor.slice(1, -1), b]
    : [a, ...corridor.slice(1, -1).reverse(), b];
  // Piecewise resampling avoids spline overshoot off the narrow peninsula.
  return resampleEqualDistance(cleanRoute(route), type === 'train' ? 84 : 100);
}

function nearestNetworkPoint(target, lines) {
  let best = null;
  let bestDistance = Infinity;
  for (const line of lines) {
    for (const p of line?.p || []) {
      const d = distanceDeg(target, p);
      if (d < bestDistance) {
        bestDistance = d;
        best = p;
      }
    }
  }
  return best ? { point: best, distance: bestDistance } : null;
}

function surfaceMostlyOnLand(route) {
  let checked = 0;
  let water = 0;
  const stride = Math.max(1, Math.floor(route.length / 60));
  for (let i = 1; i < route.length - 1; i += stride) {
    checked++;
    if (!isLand(route[i])) water++;
  }
  return !checked || water / checked < 0.06;
}

function buildPlaybackPlan(leg, geometry, requestedSamples) {
  const mode = leg?.mode || 'plane';
  let route = Array.isArray(geometry) && geometry.length > 1 ? geometry.map(toCoord).filter(Boolean) : null;
  if (!route?.length) route = mode === 'plane' || mode === 'move' ? greatCircleCoordinates(leg.from, leg.to, 220) : [[leg.from.lon, leg.from.lat], [leg.to.lon, leg.to.lat]];
  if (isSurfaceRouteMode(mode) && route.length > 2) route = buildSurfacePresentationGeometry(route, mode, { profile: 'playback' });
  const routeMiles = Number(leg?.miles || 0);
  const sampleCount = Math.max(72, Math.min(320, Number(requestedSamples) || Math.round(72 + Math.sqrt(Math.max(0, routeMiles)) * 4)));
  const samples = resampleEqualDistance(route, sampleCount);
  const positions = new Float32Array(sampleCount * 2);
  const headings = new Float32Array(sampleCount);
  const camera = new Float32Array(sampleCount * 2);
  const cumulative = new Float32Array(sampleCount);
  let total = 0;
  for (let i = 0; i < sampleCount; i++) {
    const p = samples[i];
    positions[i * 2] = p[0];
    positions[i * 2 + 1] = p[1];
    if (i > 0) total += haversineMiles(samples[i - 1], p);
    cumulative[i] = total;
    const prev = samples[Math.max(0, i - 1)];
    const next = samples[Math.min(sampleCount - 1, i + 1)];
    headings[i] = bearing(prev, next);
  }
  const leadSamples = mode === 'boat' || mode === 'train' ? Math.max(1, Math.round(sampleCount * 0.015)) : Math.max(1, Math.round(sampleCount * 0.025));
  for (let i = 0; i < sampleCount; i++) {
    const lead = samples[Math.min(sampleCount - 1, i + leadSamples)];
    const p = samples[i];
    const bias = mode === 'boat' || mode === 'train' ? 0.18 : mode === 'drive' || mode === 'car' ? 0.25 : 0.28;
    camera[i * 2] = lerpLon(p[0], lead[0], bias);
    camera[i * 2 + 1] = p[1] + (lead[1] - p[1]) * bias;
  }

  const overview = new Float32Array(flattenCoords(simplifyToCount(samples, 64)));
  const regional = new Float32Array(flattenCoords(simplifyToCount(samples, 180)));
  return {
    sampleCount,
    totalMiles: total,
    positions,
    headings,
    camera,
    cumulative,
    overview,
    regional,
    routingVersion,
    dataVersion
  };
}

function resampleEqualDistance(route, count) {
  const pts = cleanRoute(route);
  if (pts.length < 2) return Array.from({ length: count }, () => pts[0] || [0, 0]);
  const cumulative = [0];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    total += distanceDeg(pts[i - 1], pts[i]);
    cumulative.push(total);
  }
  if (total <= 0) return Array.from({ length: count }, () => pts[0]);
  const out = [];
  let seg = 1;
  for (let i = 0; i < count; i++) {
    const target = total * (i / Math.max(1, count - 1));
    while (seg < cumulative.length - 1 && cumulative[seg] < target) seg++;
    const a = pts[seg - 1];
    const b = pts[seg];
    const span = Math.max(1e-9, cumulative[seg] - cumulative[seg - 1]);
    const t = (target - cumulative[seg - 1]) / span;
    out.push([lerpLon(a[0], b[0], t), a[1] + (b[1] - a[1]) * t]);
  }
  return out;
}

function greatCircleCoordinates(from, to, count) {
  const a = [Number(from.lon), Number(from.lat)];
  const b = [Number(to.lon), Number(to.lat)];
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push(sphericalInterpolate(a, b, i / Math.max(1, count - 1)));
  }
  return out;
}

function sphericalInterpolate(a, b, t) {
  const λ1 = deg2rad(a[0]), φ1 = deg2rad(a[1]);
  const λ2 = deg2rad(b[0]), φ2 = deg2rad(b[1]);
  const d = 2 * Math.asin(Math.sqrt(Math.sin((φ2 - φ1) / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin((λ2 - λ1) / 2) ** 2));
  if (!Number.isFinite(d) || d < 1e-9) return [a[0], a[1]];
  const A = Math.sin((1 - t) * d) / Math.sin(d);
  const B = Math.sin(t * d) / Math.sin(d);
  const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
  const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
  const z = A * Math.sin(φ1) + B * Math.sin(φ2);
  return [rad2deg(Math.atan2(y, x)), rad2deg(Math.atan2(z, Math.sqrt(x * x + y * y)))];
}

function smoothControlRoute(points, samples) {
  if (points.length < 3) return points;
  const out = [];
  for (let i = 0; i < samples; i++) {
    const t = i / Math.max(1, samples - 1);
    out.push(catmullRom(points, t));
  }
  return cleanRoute(out);
}

function catmullRom(points, t) {
  const n = points.length;
  const scaled = t * (n - 1);
  const i = Math.min(n - 2, Math.max(0, Math.floor(scaled)));
  const u = scaled - i;
  const p0 = points[Math.max(0, i - 1)];
  const p1 = points[i];
  const p2 = points[i + 1];
  const p3 = points[Math.min(n - 1, i + 2)];
  const u2 = u * u;
  const u3 = u2 * u;
  return [
    0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * u + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * u2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * u3),
    0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * u + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * u2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * u3)
  ];
}

function isLand(p) {
  if (!landIndex) return false;
  const key = `${Math.floor(p[0] / LAND_CELL)}:${Math.floor(p[1] / LAND_CELL)}`;
  for (const i of landIndex.get(key) || []) {
    const ring = routingData.landRings[i];
    if (pointInBox(p, ring.b) && pointInRing(p, ring.p || [])) return true;
  }
  return false;
}

function segmentHitsLand(a, b, allowCorridor) {
  if (allowCorridor) return false;
  const distance = distanceDeg(a, b);
  // Worker-side validation can afford much denser sampling than the old UI
  // thread implementation. This catches narrow peninsulas and islands that a
  // five-samples-per-degree test could skip.
  const samples = Math.max(18, Math.min(320, Math.ceil(distance * 18)));
  for (let i = 1; i < samples; i++) {
    const t = i / samples;
    const p = [lerpLon(a[0], b[0], t), a[1] + (b[1] - a[1]) * t];
    if (isLand(p)) return true;
  }
  return false;
}

function routeHasLand(route) {
  for (let i = 1; i < route.length; i++) if (segmentHitsLand(route[i - 1], route[i], isCorridorCoordinateEdge(route[i - 1], route[i]))) return true;
  return false;
}

function countLandSegments(route) {
  let count = 0;
  for (let i = 1; i < route.length; i++) if (segmentHitsLand(route[i - 1], route[i], false)) count++;
  return count;
}

function countBoatLandCrossings(route) {
  let count = 0;
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1];
    const b = route[i];
    if (segmentHitsLand(a, b, isCorridorCoordinateEdge(a, b))) count++;
  }
  return count;
}

function pointInRing(point, ring) {
  let inside = false;
  const x = point[0], y = point[1];
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersects = ((yi > y) !== (yj > y)) && x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-12) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function reconstructPath(came, current, nodes) {
  const ids = [current];
  while (came.has(current)) {
    current = came.get(current);
    ids.unshift(current);
  }
  return simplifyRoute(ids.map(id => nodes[id]), 0.03, 18);
}

function simplifyRoute(route, minSegment, minTurn) {
  let points = cleanRoute(route);
  const shortFiltered = [];
  for (const p of points) {
    if (!shortFiltered.length || distanceDeg(shortFiltered[shortFiltered.length - 1], p) >= minSegment) shortFiltered.push(p);
  }
  points = shortFiltered;
  let changed = true;
  let guard = 0;
  while (changed && guard++ < 4 && points.length > 3) {
    changed = false;
    for (let i = 1; i < points.length - 1; i++) {
      const angle = turnAngle(points[i - 1], points[i], points[i + 1]);
      if (angle < minTurn) {
        const candidateA = points[i - 1];
        const candidateB = points[i + 1];
        if (!segmentHitsLand(candidateA, candidateB, isCorridorCoordinateEdge(candidateA, candidateB))) {
          points.splice(i, 1);
          changed = true;
          break;
        }
      }
    }
  }
  return points;
}

function turnAngle(a, b, c) {
  const v1 = [shortestLonDelta(b[0] - a[0]), b[1] - a[1]];
  const v2 = [shortestLonDelta(c[0] - b[0]), c[1] - b[1]];
  const l1 = Math.hypot(v1[0], v1[1]) || 1;
  const l2 = Math.hypot(v2[0], v2[1]) || 1;
  const dot = clamp((v1[0] * v2[0] + v1[1] * v2[1]) / (l1 * l2), -1, 1);
  return Math.acos(dot) * 180 / Math.PI;
}

function nearestNodeIndex(p, nodes) {
  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < nodes.length; i++) {
    const d = distanceDeg(p, nodes[i]);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

function nearestIndexInArray(p, nodes) {
  return nearestNodeIndex(p, nodes);
}

function distancePointToSegment(p, a, b) {
  const dx = shortestLonDelta(b[0] - a[0]);
  const dy = b[1] - a[1];
  const px = shortestLonDelta(p[0] - a[0]);
  const py = p[1] - a[1];
  const len2 = dx * dx + dy * dy || 1;
  const t = clamp((px * dx + py * dy) / len2, 0, 1);
  return Math.hypot(px - dx * t, py - dy * t);
}

function routeLength(route) {
  let total = 0;
  for (let i = 1; i < route.length; i++) total += distanceDeg(route[i - 1], route[i]);
  return total;
}

function distanceDeg(a, b) {
  return Math.hypot(shortestLonDelta(b[0] - a[0]), b[1] - a[1]);
}

function haversineMiles(a, b) {
  const R = 3958.7613;
  const φ1 = deg2rad(a[1]), φ2 = deg2rad(b[1]);
  const dφ = deg2rad(b[1] - a[1]);
  const dλ = deg2rad(shortestLonDelta(b[0] - a[0]));
  const h = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function bearing(a, b) {
  const φ1 = deg2rad(a[1]), φ2 = deg2rad(b[1]);
  const λ = deg2rad(shortestLonDelta(b[0] - a[0]));
  const y = Math.sin(λ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(λ);
  return (rad2deg(Math.atan2(y, x)) + 360) % 360;
}

function waterCellCoords(p) {
  return [Math.floor(p[0] / WATER_CELL), Math.floor(p[1] / WATER_CELL)];
}

function waterCellKey(p) {
  const [x, y] = waterCellCoords(p);
  return `${x}:${y}`;
}

function edgeKey(a, b) {
  return `${a}:${b}`;
}

function coordKey(p, digits = 3) {
  return `${Number(p[0]).toFixed(digits)},${Number(p[1]).toFixed(digits)}`;
}

function coordsNear(a, b, tolerance = 0.08) {
  return distanceDeg(a, b) <= tolerance;
}

function pointInBox(p, b) {
  return Array.isArray(b) && p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3];
}

function boxesIntersect(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
}

function expandedBox(a, b, pad) {
  return [Math.min(a[0], b[0]) - pad, Math.min(a[1], b[1]) - pad, Math.max(a[0], b[0]) + pad, Math.max(a[1], b[1]) + pad];
}

function midpoint(a, b) {
  return [lerpLon(a[0], b[0], 0.5), (a[1] + b[1]) / 2];
}

function perpendicular(a, b) {
  const dx = shortestLonDelta(b[0] - a[0]);
  const dy = b[1] - a[1];
  const length = Math.hypot(dx, dy) || 1;
  return [-dy / length, dx / length];
}

function lerpCoord(a, b, t) {
  return [lerpLon(a[0], b[0], t), a[1] + (b[1] - a[1]) * t];
}

function lerpLon(a, b, t) {
  return a + shortestLonDelta(b - a) * t;
}

function shortestLonDelta(delta) {
  let d = delta;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return d;
}

function cleanRoute(route) {
  const out = [];
  for (const p of route || []) {
    const c = toCoord(p);
    if (!c) continue;
    if (!out.length || distanceDeg(out[out.length - 1], c) > 0.00001) out.push([round(c[0], 5), round(c[1], 5)]);
  }
  return out;
}

function toCoord(p) {
  if (!Array.isArray(p) || p.length < 2) return null;
  const lon = Number(p[0]), lat = Number(p[1]);
  return Number.isFinite(lon) && Number.isFinite(lat) ? [lon, lat] : null;
}

function flattenCoords(coords) {
  const out = [];
  for (const p of coords) out.push(p[0], p[1]);
  return out;
}

function simplifyToCount(coords, count) {
  if (coords.length <= count) return coords;
  const out = [];
  for (let i = 0; i < count; i++) out.push(coords[Math.round(i / Math.max(1, count - 1) * (coords.length - 1))]);
  return out;
}

function round(value, digits) {
  const p = 10 ** digits;
  return Math.round(value * p) / p;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function deg2rad(v) { return v * Math.PI / 180; }
function rad2deg(v) { return v * 180 / Math.PI; }

class MinHeap {
  constructor() { this.items = []; }
  get size() { return this.items.length; }
  push(value, priority) {
    const item = { value, priority };
    this.items.push(item);
    let i = this.items.length - 1;
    while (i > 0) {
      const p = Math.floor((i - 1) / 2);
      if (this.items[p].priority <= item.priority) break;
      this.items[i] = this.items[p];
      i = p;
    }
    this.items[i] = item;
  }
  pop() {
    if (!this.items.length) return null;
    const root = this.items[0].value;
    const last = this.items.pop();
    if (this.items.length && last) {
      let i = 0;
      this.items[0] = last;
      while (true) {
        const left = i * 2 + 1;
        const right = left + 1;
        let smallest = i;
        if (left < this.items.length && this.items[left].priority < this.items[smallest].priority) smallest = left;
        if (right < this.items.length && this.items[right].priority < this.items[smallest].priority) smallest = right;
        if (smallest === i) break;
        [this.items[i], this.items[smallest]] = [this.items[smallest], this.items[i]];
        i = smallest;
      }
    }
    return root;
  }
}
