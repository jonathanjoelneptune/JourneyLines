const SURFACE_MODES = new Set(['drive', 'car', 'train', 'boat']);
const reversedGeometryCache = new WeakMap();

export function canonicalRouteMode(mode) {
  const value = String(mode || '').toLowerCase();
  return value === 'car' ? 'drive' : value;
}

export function isReusableSurfaceMode(mode) {
  return SURFACE_MODES.has(String(mode || '').toLowerCase());
}

export function endpointToken(location = {}) {
  const id = String(location?.id || location?.name || 'location').trim().toLowerCase();
  const lon = Number(location?.lon);
  const lat = Number(location?.lat);
  const coordinates = Number.isFinite(lon) && Number.isFinite(lat)
    ? `@${lon.toFixed(5)},${lat.toFixed(5)}`
    : '';
  return `${id}${coordinates}`;
}

function routeShapeTokens(leg = {}) {
  const raw = Array.isArray(leg?.waypoints)
    ? leg.waypoints
    : Array.isArray(leg?.via)
      ? leg.via
      : Array.isArray(leg?.stops)
        ? leg.stops
        : [];
  return raw.map(endpointToken).filter(Boolean);
}

export function routeDirectionIsCanonical(leg = {}) {
  return endpointToken(leg?.from) <= endpointToken(leg?.to);
}

export function bidirectionalRouteKey(leg = {}, version = '') {
  if (!isReusableSurfaceMode(leg?.mode) || !leg?.from || !leg?.to) return '';
  const from = endpointToken(leg.from);
  const to = endpointToken(leg.to);
  const forward = from <= to;
  const endpoints = forward ? [from, to] : [to, from];
  const waypoints = routeShapeTokens(leg);
  const canonicalWaypoints = forward ? waypoints : [...waypoints].reverse();
  const shape = canonicalWaypoints.length ? `:via:${canonicalWaypoints.join('>')}` : '';
  const prefix = version ? `${version}:` : '';
  return `${prefix}surface-pair:${canonicalRouteMode(leg.mode)}:${endpoints[0]}<->${endpoints[1]}${shape}`;
}

export function reverseGeometryStable(geometry) {
  if (!Array.isArray(geometry)) return geometry;
  const cached = reversedGeometryCache.get(geometry);
  if (cached) return cached;
  const reversed = [...geometry].reverse();
  reversedGeometryCache.set(geometry, reversed);
  reversedGeometryCache.set(reversed, geometry);
  return reversed;
}

export function canonicalGeometryForLeg(leg, geometry) {
  if (!Array.isArray(geometry) || geometry.length < 2) return geometry;
  return routeDirectionIsCanonical(leg) ? geometry : reverseGeometryStable(geometry);
}

export function geometryForLegDirection(leg, canonicalGeometry) {
  if (!Array.isArray(canonicalGeometry) || canonicalGeometry.length < 2) return canonicalGeometry;
  return routeDirectionIsCanonical(leg) ? canonicalGeometry : reverseGeometryStable(canonicalGeometry);
}

export function endpointsMatchInReverse(firstLeg, secondLeg, toleranceDegrees = 0.12) {
  if (!firstLeg?.from || !firstLeg?.to || !secondLeg?.from || !secondLeg?.to) return false;
  return locationsMatch(firstLeg.from, secondLeg.to, toleranceDegrees)
    && locationsMatch(firstLeg.to, secondLeg.from, toleranceDegrees)
    && canonicalRouteMode(firstLeg.mode) === canonicalRouteMode(secondLeg.mode);
}

function locationsMatch(a, b, toleranceDegrees) {
  if (a?.id && b?.id && a.id === b.id) return true;
  const ax = Number(a?.lon);
  const ay = Number(a?.lat);
  const bx = Number(b?.lon);
  const by = Number(b?.lat);
  if (![ax, ay, bx, by].every(Number.isFinite)) return false;
  const dx = ((bx - ax + 540) % 360) - 180;
  return Math.hypot(dx, by - ay) <= toleranceDegrees;
}
