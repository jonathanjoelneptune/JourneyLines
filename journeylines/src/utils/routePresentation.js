const SURFACE_MODES = new Set(['drive', 'car', 'train', 'boat']);
const geometryCache = new WeakMap();
const MAX_CACHE_VARIANTS_PER_GEOMETRY = 6;

/**
 * Builds the lightweight geometry used for surface playback and trail rendering.
 *
 * Provider geometry remains the source of truth. This function selects a much
 * smaller set of original route points instead of creating hundreds of new
 * equal-distance samples. Each retained span is constrained to the original
 * route corridor, which prevents the simplifier from inventing large shortcuts
 * across bays, lakes, peninsulas, islands, or other route detours.
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

  const output = selected.map(index => [...clean[index]]);
  output[0] = [...clean[0]];
  output[output.length - 1] = [...clean[clean.length - 1]];
  return remember(geometry, cacheKey, output);
}

// Backward-compatible name retained for prior release verification and any
// third-party imports. v7.1.3 no longer densifies or performs per-turn smoothing.
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
  const base = normalizedMode === 'boat' ? 28 : normalizedMode === 'train' ? 34 : 40;
  const distanceFactor = normalizedMode === 'boat' ? 4.2 : normalizedMode === 'train' ? 5.0 : 6.0;
  const maximum = normalizedMode === 'boat' ? 160 : normalizedMode === 'train' ? 190 : 220;
  return clamp(Math.round((base + Math.sqrt(miles) * distanceFactor) * profileScale), 24, maximum);
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
  const stretchLimit = mode === 'boat' ? 1.30 : mode === 'train' ? 1.25 : 1.22;
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
  if (mode === 'boat') return clamp(routeScale * 5.0, 40, 180);
  if (mode === 'train') return clamp(routeScale * 3.2, 28, 110);
  return clamp(routeScale * 2.6, 20, 90);
}

function minimumSimplificationTolerance(mode, totalMiles, profile) {
  const profileScale = profile === 'overview' ? 2.2 : profile === 'regional' ? 1.5 : 1;
  const base = mode === 'boat' ? 0.16 : mode === 'train' ? 0.10 : 0.065;
  return base * profileScale * clamp(Math.sqrt(Math.max(1, totalMiles)) / 18, 0.8, 2.4);
}

function maximumSimplificationTolerance(mode, totalMiles, profile) {
  const profileScale = profile === 'overview' ? 1.8 : profile === 'regional' ? 1.3 : 1;
  const base = mode === 'boat' ? 5.5 : mode === 'train' ? 2.8 : 1.8;
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
