const SURFACE_MODES = new Set(['drive', 'car', 'train', 'boat']);
const geometryCache = new WeakMap();
const MAX_CACHE_VARIANTS_PER_GEOMETRY = 6;

/**
 * Builds the lightweight geometry used for surface playback and trail rendering.
 *
 * Provider geometry remains the source of truth. This function selects a much
 * smaller set of route anchors, preserves the exact endpoints, then applies a
 * bounded corner-softening pass for stable cinematic playback. Road and rail
 * remain close to their provider corridor while marine presentation is allowed
 * broader offshore chords instead of tracing every shoreline micro-turn.
 */
export function buildSurfacePresentationGeometry(geometry, mode, options = {}) {
  const normalizedMode = normalizeMode(mode);
  const profile = String(options.profile || 'playback');
  const requestedPoints = Number(options.points || 0);
  const cacheKey = `${normalizedMode}:${profile}:${requestedPoints || 'auto'}`;

  // Playback asks for the visual route repeatedly. Resolve the WeakMap before
  // sanitizing so a stable geometry array is an O(1) lookup after its first use.
  if (Array.isArray(geometry)) {
    const cached = geometryCache.get(geometry)?.get(cacheKey);
    if (cached) return cached;
  }

  const clean = sanitizeGeometry(geometry);
  if (clean.length < 3 || !isSurfaceRouteMode(mode)) return remember(geometry, cacheKey, clean);

  const cumulative = cumulativeMiles(clean);
  const totalMiles = cumulative[cumulative.length - 1] || 0;
  const budget = presentationPointBudget(totalMiles, normalizedMode, profile, requestedPoints);

  if (clean.length <= 3) return remember(geometry, cacheKey, clean);

  const minimumTolerance = minimumSimplificationTolerance(normalizedMode, totalMiles, profile);
  const maximumTolerance = maximumSimplificationTolerance(normalizedMode, totalMiles, profile);
  const workingIndexes = prethinIndexes(clean, cumulative, 6000);
  const working = workingIndexes.map(index => clean[index]);
  let selected = simplifyTowardBudget(working, budget, minimumTolerance, maximumTolerance)
    .map(index => workingIndexes[index]);
  selected = enforceRouteCorridor(clean, selected, cumulative, normalizedMode, totalMiles);
  selected = refineSharpPresentationCorners(clean, selected, cumulative, normalizedMode, totalMiles);

  const output = selected.map(index => [...clean[index]]);
  output[0] = [...clean[0]];
  output[output.length - 1] = [...clean[clean.length - 1]];

  // Playback should suggest the real road/rail/marine route without forcing the
  // vessel through every provider micro-turn. A light corner-cutting pass creates
  // stable, cinematic curves once up front; no route shaping occurs per frame.
  const softened = softenPresentationCorners(output, normalizedMode);
  softened[0] = [...clean[0]];
  softened[softened.length - 1] = [...clean[clean.length - 1]];
  return remember(geometry, cacheKey, softened);
}


export function anchorRouteGeometryToEndpoints(geometry, leg = {}) {
  const clean = sanitizeGeometry(geometry);
  if (clean.length < 2) return clean;
  const from = endpointCoordinate(leg?.from);
  const to = endpointCoordinate(leg?.to);
  const anchored = clean.map(point => [...point]);
  if (from) anchored[0] = from;
  if (to) anchored[anchored.length - 1] = to;
  return anchored;
}

/**
 * Returns the immutable prefix of a presentation route at a normalized progress.
 * Every already-travelled source vertex is preserved byte-for-byte; only the
 * current frontier point is interpolated. This prevents a laid surface trail
 * from shifting as its visible prefix grows.
 */
export function stableRoutePrefix(geometry, progress = 1) {
  const clean = Array.isArray(geometry) ? geometry : [];
  if (!clean.length) return [[0, 0], [0, 0]];
  if (clean.length === 1) return [clean[0], clean[0]];
  const t = clamp(Number(progress), 0, 1);
  if (t <= 0.000001) return [clean[0], clean[0]];
  if (t >= 0.999999) return clean;

  const cumulative = cumulativeMiles(clean);
  const total = cumulative[cumulative.length - 1] || 0;
  if (!total) return [clean[0], clean[0]];
  const target = t * total;
  let low = 1;
  let high = clean.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((cumulative[middle] || 0) < target) low = middle + 1;
    else high = middle;
  }
  const index = Math.max(1, low);
  const startDistance = cumulative[index - 1] || 0;
  const segmentDistance = Math.max(1e-12, (cumulative[index] || 0) - startDistance);
  const u = clamp((target - startDistance) / segmentDistance, 0, 1);
  const start = clean[index - 1];
  const end = clean[index];
  const endpoint = [
    interpolateLongitude(start[0], end[0], u),
    Number(start[1]) + (Number(end[1]) - Number(start[1])) * u
  ];
  const prefix = clean.slice(0, index);
  const last = prefix[prefix.length - 1];
  if (!last || Math.abs(shortestLongitudeDelta(endpoint[0] - last[0])) > 1e-10 || Math.abs(endpoint[1] - last[1]) > 1e-10) prefix.push(endpoint);
  if (prefix.length === 1) prefix.push(endpoint);
  return prefix;
}

function endpointCoordinate(value = {}) {
  const lon = Number(value?.lon);
  const lat = Number(value?.lat);
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || lat < -90 || lat > 90) return null;
  return [normalizeLongitude(lon), lat];
}

// Backward-compatible name retained for prior release verification and any
// third-party imports. The current implementation performs bounded one-time
// presentation smoothing and never reshapes routes inside the playback frame.
export function smoothSurfaceRouteGeometry(geometry, mode, options = {}) {
  return buildSurfacePresentationGeometry(geometry, mode, options);
}

export function isSurfaceRouteMode(mode) {
  return SURFACE_MODES.has(String(mode || '').toLowerCase());
}

export function surfaceRouteRenderSamples(geometry, mode, requested = 64, profile = 'active') {
  const length = Array.isArray(geometry) ? geometry.length : 0;
  const fallback = Math.max(2, Math.round(Number(requested) || 64));
  if (!isSurfaceRouteMode(mode) || length < 2) return fallback;

  // Never re-densify lightweight surface geometry during a render frame. The
  // route already contains all presentation anchors needed by the vehicle and
  // trail. Overview modes may downsample it further.
  const cap = profile === 'overview'
    ? 72
    : profile === 'regional'
      ? 128
      : profile === 'detail'
        ? 190
        : 220;
  return Math.max(2, Math.min(length - 1, fallback, cap));
}

export function presentationPointBudget(totalMiles, mode, profile = 'playback', requestedPoints = 0) {
  if (requestedPoints > 1) return clamp(Math.round(requestedPoints), 24, 320);
  const normalizedMode = normalizeMode(mode);
  const miles = Math.max(0, Number(totalMiles) || 0);
  const profileScale = profile === 'overview' ? 0.45 : profile === 'regional' ? 0.70 : 1;
  const base = normalizedMode === 'boat' ? 6 : normalizedMode === 'train' ? 30 : 24;
  const distanceFactor = normalizedMode === 'boat' ? 0.78 : normalizedMode === 'train' ? 4.0 : 3.25;
  const maximum = normalizedMode === 'boat' ? 34 : normalizedMode === 'train' ? 150 : 118;
  const minimum = normalizedMode === 'boat' ? 18 : 24;
  return clamp(Math.round((base + Math.sqrt(miles) * distanceFactor) * profileScale), minimum, maximum);
}

function prethinIndexes(points, cumulative, maximumPoints = 6000) {
  if (points.length <= maximumPoints) return points.map((_, index) => index);
  const totalMiles = cumulative[cumulative.length - 1] || 0;
  const spacingMiles = Math.max(0.01, totalMiles / Math.max(2, maximumPoints - 1));
  const indexes = [0];
  let lastDistance = 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    const distance = cumulative[index] || 0;
    if (distance - lastDistance >= spacingMiles) {
      indexes.push(index);
      lastDistance = distance;
    }
  }
  indexes.push(points.length - 1);
  return indexes;
}

function simplifyTowardBudget(points, budget, minimumTolerance, maximumTolerance) {
  if (points.length <= budget) {
    const lightlySimplified = rdpIndexes(points, minimumTolerance);
    return lightlySimplified.length >= 3 ? lightlySimplified : [0, points.length - 1];
  }

  let low = minimumTolerance;
  let high = Math.max(low, maximumTolerance);
  let best = rdpIndexes(points, low);
  if (best.length <= budget) return best;

  for (let iteration = 0; iteration < 12; iteration += 1) {
    const tolerance = (low + high) / 2;
    const candidate = rdpIndexes(points, tolerance);
    if (candidate.length > budget) {
      low = tolerance;
    } else {
      best = candidate;
      high = tolerance;
    }
  }

  if (best.length > budget) best = rdpIndexes(points, maximumTolerance);
  return best;
}

function enforceRouteCorridor(points, selectedIndexes, cumulative, mode, totalMiles) {
  const selected = [...new Set([0, ...selectedIndexes, points.length - 1])].sort((a, b) => a - b);
  const output = [selected[0]];

  for (let index = 1; index < selected.length; index += 1) {
    appendSafeSpan(points, cumulative, selected[index - 1], selected[index], mode, totalMiles, output, 0);
  }
  return [...new Set(output)].sort((a, b) => a - b);
}

function appendSafeSpan(points, cumulative, start, end, mode, totalMiles, output, depth) {
  if (end <= start + 1 || depth > 20) {
    output.push(end);
    return;
  }

  const directMiles = Math.max(0.0001, haversineMiles(points[start], points[end]));
  const alongMiles = Math.max(directMiles, (cumulative[end] || 0) - (cumulative[start] || 0));
  const stretchRatio = alongMiles / directMiles;
  const maxSegmentMiles = maximumPresentationSegmentMiles(mode, totalMiles);
  // Marine presentation is intentionally less literal than road/rail. Broad
  // route-native chords keep boats offshore instead of tracing every cove,
  // while the corridor guard still prevents implausible long shortcuts.
  const stretchLimit = mode === 'boat' ? 3.50 : mode === 'train' ? 1.38 : 1.48;
  const safe = directMiles <= maxSegmentMiles && stretchRatio <= stretchLimit;

  if (safe) {
    output.push(end);
    return;
  }

  let split = cumulativeMidpointIndex(cumulative, start, end);
  if (split <= start || split >= end) split = Math.floor((start + end) / 2);

  appendSafeSpan(points, cumulative, start, split, mode, totalMiles, output, depth + 1);
  appendSafeSpan(points, cumulative, split, end, mode, totalMiles, output, depth + 1);
}


function refineSharpPresentationCorners(points, selectedIndexes, cumulative, mode, totalMiles) {
  if (!Array.isArray(selectedIndexes) || selectedIndexes.length < 3) return selectedIndexes || [];
  const selected = [...new Set(selectedIndexes)].sort((a, b) => a - b);
  const additions = new Set(selected);
  const turnThreshold = mode === 'boat' ? 62 : mode === 'train' ? 32 : 38;
  const targetMiles = mode === 'boat'
    ? clamp(Math.sqrt(Math.max(1, totalMiles)) * 1.65, 14, 64)
    : mode === 'train'
      ? clamp(Math.sqrt(Math.max(1, totalMiles)) * 0.52, 2.5, 15)
      : clamp(Math.sqrt(Math.max(1, totalMiles)) * 0.34, 1.5, 9);

  for (let position = 1; position < selected.length - 1; position += 1) {
    const previous = selected[position - 1];
    const current = selected[position];
    const next = selected[position + 1];
    const turn = presentationTurnDegrees(points[previous], points[current], points[next]);
    if (turn < turnThreshold) continue;

    const before = indexAtDistanceBefore(cumulative, current, previous, targetMiles);
    const after = indexAtDistanceAfter(cumulative, current, next, targetMiles);
    if (before > previous && before < current) additions.add(before);
    if (after > current && after < next) additions.add(after);

    // Very abrupt retained corners receive a second pair of route-native anchors.
    // The vessel still travels only through provider points; the extra anchors
    // distribute the visual turn instead of cutting one sharp presentation elbow.
    if (turn > (mode === 'boat' ? 112 : 78)) {
      const innerBefore = indexAtDistanceBefore(cumulative, current, previous, targetMiles * 0.42);
      const innerAfter = indexAtDistanceAfter(cumulative, current, next, targetMiles * 0.42);
      if (innerBefore > previous && innerBefore < current) additions.add(innerBefore);
      if (innerAfter > current && innerAfter < next) additions.add(innerAfter);
    }
  }
  return [...additions].sort((a, b) => a - b);
}

function presentationTurnDegrees(a, b, c) {
  if (!a || !b || !c) return 0;
  const referenceLat = (Number(a[1]) + Number(b[1]) + Number(c[1])) / 3;
  const cosLat = Math.max(0.05, Math.cos(toRadians(referenceLat)));
  const incoming = [shortestLongitudeDelta(Number(b[0]) - Number(a[0])) * cosLat, Number(b[1]) - Number(a[1])];
  const outgoing = [shortestLongitudeDelta(Number(c[0]) - Number(b[0])) * cosLat, Number(c[1]) - Number(b[1])];
  const inLength = Math.hypot(...incoming);
  const outLength = Math.hypot(...outgoing);
  if (inLength < 1e-12 || outLength < 1e-12) return 0;
  const dot = clamp((incoming[0] * outgoing[0] + incoming[1] * outgoing[1]) / (inLength * outLength), -1, 1);
  return Math.acos(dot) * 180 / Math.PI;
}

function indexAtDistanceBefore(cumulative, current, lowerBound, miles) {
  const target = Math.max(cumulative[lowerBound] || 0, (cumulative[current] || 0) - Math.max(0, miles));
  let low = lowerBound;
  let high = current;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if ((cumulative[middle] || 0) > target) high = middle - 1;
    else low = middle;
  }
  return low;
}

function indexAtDistanceAfter(cumulative, current, upperBound, miles) {
  const target = Math.min(cumulative[upperBound] || 0, (cumulative[current] || 0) + Math.max(0, miles));
  let low = current;
  let high = upperBound;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((cumulative[middle] || 0) < target) low = middle + 1;
    else high = middle;
  }
  return low;
}

function rdpIndexes(points, toleranceMiles) {
  if (points.length <= 2) return [0, Math.max(0, points.length - 1)];
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack = [[0, points.length - 1]];

  while (stack.length) {
    const [start, end] = stack.pop();
    if (end <= start + 1) continue;
    let farthest = -1;
    let maximum = toleranceMiles;
    for (let index = start + 1; index < end; index += 1) {
      const distance = pointToSegmentMiles(points[index], points[start], points[end]);
      if (distance > maximum) {
        maximum = distance;
        farthest = index;
      }
    }
    if (farthest > start && farthest < end) {
      keep[farthest] = 1;
      stack.push([start, farthest], [farthest, end]);
    }
  }

  const indexes = [];
  for (let index = 0; index < keep.length; index += 1) if (keep[index]) indexes.push(index);
  return indexes;
}

function cumulativeMidpointIndex(cumulative, start, end) {
  const target = ((cumulative[start] || 0) + (cumulative[end] || 0)) / 2;
  let low = start + 1;
  let high = end - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((cumulative[middle] || 0) < target) low = middle + 1;
    else high = middle;
  }
  return low;
}

function maximumPresentationSegmentMiles(mode, totalMiles) {
  const routeScale = Math.sqrt(Math.max(1, totalMiles));
  if (mode === 'boat') return clamp(routeScale * 18.5, 210, 850);
  if (mode === 'train') return clamp(routeScale * 4.0, 36, 145);
  return clamp(routeScale * 4.2, 34, 155);
}

function softenPresentationCorners(points, mode) {
  if (!Array.isArray(points) || points.length < 3) return points || [];
  const iterations = mode === 'boat' ? 3 : 1;
  const amount = mode === 'boat' ? 0.34 : mode === 'train' ? 0.15 : 0.22;
  let current = points.map(point => [...point]);
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const next = [[...current[0]]];
    for (let index = 0; index < current.length - 1; index += 1) {
      const a = current[index];
      const b = current[index + 1];
      const lonDelta = shortestLongitudeDelta(Number(b[0]) - Number(a[0]));
      next.push([
        normalizeLongitude(Number(a[0]) + lonDelta * amount),
        Number(a[1]) + (Number(b[1]) - Number(a[1])) * amount
      ]);
      next.push([
        normalizeLongitude(Number(a[0]) + lonDelta * (1 - amount)),
        Number(a[1]) + (Number(b[1]) - Number(a[1])) * (1 - amount)
      ]);
    }
    next.push([...current[current.length - 1]]);
    current = next;
  }
  return current;
}

function minimumSimplificationTolerance(mode, totalMiles, profile) {
  const profileScale = profile === 'overview' ? 2.2 : profile === 'regional' ? 1.5 : 1;
  const base = mode === 'boat' ? 1.35 : mode === 'train' ? 0.16 : 0.20;
  return base * profileScale * clamp(Math.sqrt(Math.max(1, totalMiles)) / 18, 0.8, 2.4);
}

function maximumSimplificationTolerance(mode, totalMiles, profile) {
  const profileScale = profile === 'overview' ? 1.8 : profile === 'regional' ? 1.3 : 1;
  const base = mode === 'boat' ? 30.0 : mode === 'train' ? 4.2 : 5.5;
  return base * profileScale * clamp(Math.sqrt(Math.max(1, totalMiles)) / 28, 0.65, 2.4);
}

function cumulativeMiles(points) {
  const cumulative = [0];
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += haversineMiles(points[index - 1], points[index]);
    cumulative.push(total);
  }
  return cumulative;
}

function pointToSegmentMiles(point, start, end) {
  const referenceLat = (Number(start[1]) + Number(end[1]) + Number(point[1])) / 3;
  const cosLat = Math.max(0.05, Math.cos(toRadians(referenceLat)));
  const x1 = shortestLongitudeDelta(Number(start[0]) - Number(point[0])) * 69.172 * cosLat;
  const y1 = (Number(start[1]) - Number(point[1])) * 69.0;
  const x2 = shortestLongitudeDelta(Number(end[0]) - Number(point[0])) * 69.172 * cosLat;
  const y2 = (Number(end[1]) - Number(point[1])) * 69.0;
  const dx = x2 - x1;
  const dy = y2 - y1;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= 1e-12) return Math.hypot(x1, y1);
  const t = clamp(-(x1 * dx + y1 * dy) / lengthSquared, 0, 1);
  return Math.hypot(x1 + dx * t, y1 + dy * t);
}

function sanitizeGeometry(geometry) {
  const result = [];
  for (const value of Array.isArray(geometry) ? geometry : []) {
    if (!Array.isArray(value) || value.length < 2) continue;
    const lon = Number(value[0]);
    const lat = Number(value[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || lat < -90 || lat > 90) continue;
    const point = [normalizeLongitude(lon), lat];
    const previous = result[result.length - 1];
    if (!previous || Math.abs(shortestLongitudeDelta(point[0] - previous[0])) > 1e-9 || Math.abs(point[1] - previous[1]) > 1e-9) result.push(point);
  }
  return result;
}

function remember(original, key, value) {
  if (!Array.isArray(original)) return value;
  const variants = geometryCache.get(original) || new Map();
  variants.set(key, value);
  while (variants.size > MAX_CACHE_VARIANTS_PER_GEOMETRY) variants.delete(variants.keys().next().value);
  geometryCache.set(original, variants);
  return value;
}

function normalizeMode(mode) {
  const value = String(mode || '').toLowerCase();
  return value === 'drive' ? 'car' : value;
}

function haversineMiles(a, b) {
  const radius = 3958.7613;
  const lat1 = toRadians(a[1]);
  const lat2 = toRadians(b[1]);
  const dLat = lat2 - lat1;
  const dLon = toRadians(shortestLongitudeDelta(b[0] - a[0]));
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

function shortestLongitudeDelta(value) {
  return ((Number(value) + 540) % 360) - 180;
}

function interpolateLongitude(start, end, t) {
  return normalizeLongitude(Number(start) + shortestLongitudeDelta(Number(end) - Number(start)) * clamp(t, 0, 1));
}

function normalizeLongitude(value) {
  const numeric = Number(value);
  if (numeric >= -180 && numeric < 180) return numeric;
  return ((numeric + 540) % 360) - 180;
}

function toRadians(value) {
  return Number(value) * Math.PI / 180;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}
