const SURFACE_MODES = new Set(['drive', 'car', 'train', 'boat']);
const geometryCache = new WeakMap();
const MAX_CACHE_VARIANTS_PER_GEOMETRY = 8;

export function isSurfaceRouteMode(mode) {
  return SURFACE_MODES.has(String(mode || '').toLowerCase());
}

export function smoothSurfaceRouteGeometry(geometry, mode, options = {}) {
  const clean = sanitizeGeometry(geometry);
  if (clean.length < 3 || !isSurfaceRouteMode(mode)) return clean;

  const profile = String(options.profile || 'playback');
  const requestedPoints = Number(options.points || 0);
  const cacheKey = `${String(mode || '').toLowerCase()}:${profile}:${requestedPoints || 'auto'}`;
  if (Array.isArray(geometry)) {
    const variants = geometryCache.get(geometry);
    const cached = variants?.get(cacheKey);
    if (cached) return cached;
  }

  const miles = polylineMiles(clean);
  const targetCount = routeSampleCount(clean.length, miles, mode, profile, requestedPoints);
  const dense = resampleEqualDistance(clean, targetCount);
  const smoothed = smoothDenseRoute(dense, mode, miles, profile);
  smoothed[0] = [...clean[0]];
  smoothed[smoothed.length - 1] = [...clean[clean.length - 1]];

  if (Array.isArray(geometry)) {
    const variants = geometryCache.get(geometry) || new Map();
    variants.set(cacheKey, smoothed);
    while (variants.size > MAX_CACHE_VARIANTS_PER_GEOMETRY) variants.delete(variants.keys().next().value);
    geometryCache.set(geometry, variants);
  }
  return smoothed;
}

export function surfaceRouteRenderSamples(geometry, mode, requested = 64, profile = 'active') {
  const length = Array.isArray(geometry) ? geometry.length : 0;
  if (!isSurfaceRouteMode(mode) || length < 2) return Math.max(2, Math.round(Number(requested) || 64));
  const multiplier = profile === 'active' ? 4.2 : profile === 'detail' ? 3.2 : profile === 'regional' ? 2.4 : 1.8;
  return Math.max(2, Math.min(length - 1, Math.round(Math.max(Number(requested) || 64, (Number(requested) || 64) * multiplier))));
}

function routeSampleCount(originalCount, miles, mode, profile, requestedPoints) {
  if (requestedPoints > 1) return clamp(Math.round(requestedPoints), 24, 1600);
  const normalizedMode = String(mode || '').toLowerCase();
  const density = normalizedMode === 'boat' ? 0.9 : normalizedMode === 'train' ? 1.35 : 1.65;
  const minimum = profile === 'overview' ? 96 : profile === 'regional' ? 180 : 260;
  const maximum = profile === 'overview' ? 320 : profile === 'regional' ? 700 : 1400;
  return clamp(Math.round(Math.max(originalCount, minimum, miles * density)), minimum, maximum);
}

function smoothDenseRoute(points, mode, totalMiles, profile) {
  if (points.length < 5) return points.map(point => [...point]);
  const normalizedMode = String(mode || '').toLowerCase();
  const strength = normalizedMode === 'boat' ? 0.34 : normalizedMode === 'train' ? 0.31 : 0.28;
  const passes = profile === 'overview' ? 1 : 2;
  const longRouteScale = clamp(totalMiles / 800, 0, 1);
  const maxDeviationMiles = normalizedMode === 'boat'
    ? lerp(0.12, 0.7, longRouteScale)
    : normalizedMode === 'train'
      ? lerp(0.08, 0.38, longRouteScale)
      : lerp(0.05, 0.28, longRouteScale);

  const anchors = points.map(point => [...point]);
  let current = points.map(point => [...point]);
  for (let pass = 0; pass < passes; pass += 1) {
    const next = current.map(point => [...point]);
    for (let index = 1; index < current.length - 1; index += 1) {
      const previous = current[index - 1];
      const point = current[index];
      const following = current[index + 1];
      const average = weightedGeographicAverage(previous, point, following);
      const candidate = [
        lerpLongitude(point[0], average[0], strength),
        lerp(point[1], average[1], strength)
      ];
      const localSpacing = Math.max(0.001, Math.min(haversineMiles(previous, point), haversineMiles(point, following)));
      const allowed = Math.min(maxDeviationMiles, localSpacing * 0.42);
      next[index] = clampDisplacement(anchors[index], candidate, allowed);
    }
    current = next;
  }
  return current;
}

function weightedGeographicAverage(previous, point, following) {
  const previousLon = point[0] + shortestLongitudeDelta(previous[0] - point[0]);
  const followingLon = point[0] + shortestLongitudeDelta(following[0] - point[0]);
  return [
    normalizeLongitude((previousLon + point[0] * 2 + followingLon) / 4),
    (previous[1] + point[1] * 2 + following[1]) / 4
  ];
}

function clampDisplacement(anchor, candidate, maxMiles) {
  const distance = haversineMiles(anchor, candidate);
  if (!Number.isFinite(distance) || distance <= maxMiles || maxMiles <= 0) return candidate;
  const ratio = maxMiles / distance;
  return [
    lerpLongitude(anchor[0], candidate[0], ratio),
    lerp(anchor[1], candidate[1], ratio)
  ];
}

function resampleEqualDistance(points, count) {
  const cumulative = [0];
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    total += haversineMiles(points[index - 1], points[index]);
    cumulative.push(total);
  }
  if (!Number.isFinite(total) || total <= 0) return Array.from({ length: count }, () => [...points[0]]);

  const result = [];
  let segment = 1;
  for (let index = 0; index < count; index += 1) {
    const target = total * (index / Math.max(1, count - 1));
    while (segment < cumulative.length - 1 && cumulative[segment] < target) segment += 1;
    const a = points[segment - 1];
    const b = points[segment];
    const span = Math.max(1e-9, cumulative[segment] - cumulative[segment - 1]);
    const t = clamp((target - cumulative[segment - 1]) / span, 0, 1);
    result.push([lerpLongitude(a[0], b[0], t), lerp(a[1], b[1], t)]);
  }
  return result;
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

function polylineMiles(points) {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) total += haversineMiles(points[index - 1], points[index]);
  return total;
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

function lerpLongitude(a, b, t) {
  return normalizeLongitude(Number(a) + shortestLongitudeDelta(Number(b) - Number(a)) * clamp(t, 0, 1));
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

function lerp(a, b, t) {
  return Number(a) + (Number(b) - Number(a)) * clamp(t, 0, 1);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}
