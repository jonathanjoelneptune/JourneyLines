export const MULTIMODAL_REVIEW_VERSION = '7.0';
export const SURFACE_MODES = new Set(['drive', 'car', 'train', 'boat']);

const MODE_SPEED_MPH = {
  drive: 52,
  car: 52,
  train: 62,
  boat: 21
};

export function canonicalTravelMode(mode) {
  return mode === 'car' ? 'drive' : String(mode || 'plane');
}

export function isSurfaceTravelMode(mode) {
  return SURFACE_MODES.has(String(mode || ''));
}

export function sanitizeRouteGeometry(geometry) {
  if (!Array.isArray(geometry)) return null;
  const clean = [];
  for (const point of geometry) {
    if (!Array.isArray(point) || point.length < 2) continue;
    const lon = Number(point[0]);
    const lat = Number(point[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;
    const previous = clean[clean.length - 1];
    if (!previous || Math.abs(previous[0] - lon) > 1e-8 || Math.abs(previous[1] - lat) > 1e-8) clean.push([lon, lat]);
  }
  return clean.length > 1 ? clean : null;
}

export function routeGeometryMiles(geometry = []) {
  const clean = sanitizeRouteGeometry(geometry);
  if (!clean) return 0;
  let total = 0;
  for (let index = 1; index < clean.length; index++) total += haversineMiles(clean[index - 1], clean[index]);
  return total;
}

export function directLegMiles(leg = {}) {
  const from = leg?.from;
  const to = leg?.to;
  if (!validEndpoint(from) || !validEndpoint(to)) return 0;
  return haversineMiles([Number(from.lon), Number(from.lat)], [Number(to.lon), Number(to.lat)]);
}

export function estimateTravelMinutes(mode, miles) {
  const canonical = canonicalTravelMode(mode);
  const speed = MODE_SPEED_MPH[canonical] || 45;
  const distance = Math.max(0, Number(miles) || 0);
  const base = distance / speed * 60;
  const terminalAllowance = canonical === 'train' ? 18 : canonical === 'boat' ? 24 : 12;
  return Math.max(1, Math.round(base + terminalAllowance));
}

export function formatReviewDuration(minutes) {
  const value = Math.max(0, Math.round(Number(minutes) || 0));
  if (value < 60) return `${value} min`;
  const hours = Math.floor(value / 60);
  const remainder = value % 60;
  return remainder ? `${hours} hr ${remainder} min` : `${hours} hr`;
}

export function routeReviewSignature(legs = []) {
  return JSON.stringify((legs || []).map(leg => ({
    id: String(leg?.legId || leg?.id || ''),
    mode: canonicalTravelMode(leg?.mode),
    from: endpointSignature(leg?.from),
    to: endpointSignature(leg?.to)
  })));
}

export function assessMultimodalRoute({ leg, geometry, source = 'unknown', provider = '', validation = {}, providerWarnings = [] } = {}) {
  const clean = sanitizeRouteGeometry(geometry);
  const mode = canonicalTravelMode(leg?.mode);
  const directMiles = directLegMiles(leg);
  const routeMiles = clean ? routeGeometryMiles(clean) : 0;
  const warnings = [...(Array.isArray(providerWarnings) ? providerWarnings : [])];
  const errors = [];

  if (!validEndpoint(leg?.from) || !validEndpoint(leg?.to)) errors.push('Route endpoints do not have valid coordinates.');
  if (!clean) errors.push('No usable route geometry was generated.');
  if (clean && directMiles > 2 && routeMiles < Math.max(0.5, directMiles * 0.72)) errors.push('Generated route is implausibly shorter than the direct distance.');
  const indirectWarningMultiplier = mode === 'drive' ? 2.5 : mode === 'train' ? 2.8 : mode === 'boat' ? 3.5 : 7;
  const indirectWarningAllowance = mode === 'drive' ? 50 : mode === 'train' ? 80 : mode === 'boat' ? 150 : 250;
  const indirectErrorMultiplier = mode === 'drive' ? 5 : mode === 'train' ? 5.5 : mode === 'boat' ? 8 : 12;
  const indirectErrorAllowance = mode === 'drive' ? 300 : mode === 'train' ? 350 : mode === 'boat' ? 500 : 500;
  if (clean && directMiles > 10 && routeMiles > directMiles * indirectErrorMultiplier + indirectErrorAllowance) {
    errors.push('Generated route is excessively indirect and should be corrected with a better endpoint or waypoint.');
  } else if (clean && directMiles > 10 && routeMiles > directMiles * indirectWarningMultiplier + indirectWarningAllowance) {
    warnings.push('Generated route is unusually indirect. Review the geometry before saving.');
  }
  if (clean && directMiles > 2 && routeMiles < 0.25) errors.push('Routing produced a stationary path.');

  const endpointGapMiles = Number(validation?.maxEndpointGapMiles || 0);
  const endpointWarningThreshold = mode === 'train' ? 45 : mode === 'boat' ? 55 : 25;
  if (endpointGapMiles > endpointWarningThreshold) warnings.push(`The route attaches about ${Math.round(endpointGapMiles)} miles from a trip endpoint.`);
  const networkStartGap = Number(validation?.networkStartGapMiles || 0);
  const networkEndGap = Number(validation?.networkEndGapMiles || 0);
  const networkGap = Math.max(networkStartGap, networkEndGap);
  const networkGapThreshold = mode === 'train' ? 45 : mode === 'drive' ? 25 : Infinity;
  if (networkGap > networkGapThreshold) warnings.push(`The mapped ${mode === 'train' ? 'rail' : 'road'} network begins about ${Math.round(networkGap)} miles from an endpoint, so a fallback connector was used.`);

  if (mode === 'boat' && Number(validation?.landCrossings || 0) > 0) errors.push('The boat route crosses land.');
  if (mode === 'boat' && validation?.stationaryFallback) errors.push('No safe navigable-water route could be found.');

  const waterRatio = Number(validation?.surfaceWaterRatio || 0);
  if (mode === 'drive' && waterRatio > 0.45) errors.push('The driving route spends too much distance off mapped land. Add a ferry leg or a corrective waypoint.');
  else if (mode === 'drive' && waterRatio > 0.12) warnings.push('A meaningful portion of the fallback driving route is not on mapped land. A ferry or manual correction may be needed.');
  if (mode === 'train' && waterRatio > 0.55) errors.push('The rail route spends too much distance off mapped land. Add an intermediate station or correct the endpoints.');
  else if (mode === 'train' && waterRatio > 0.20) warnings.push('A meaningful portion of the fallback rail route is not on mapped land. Check for a missing rail connection.');

  if (/fallback|control/i.test(String(source))) warnings.push('The detailed network was incomplete, so GlobeHoppers used a lower-confidence fallback corridor.');
  if (source === 'indexed-route-cache') warnings.push('This review reused a previously cached route. Use Recalculate to refresh it.');

  const uniqueWarnings = [...new Set(warnings.filter(Boolean))];
  const uniqueErrors = [...new Set(errors.filter(Boolean))];
  let confidence = 'high';
  if (uniqueErrors.length) confidence = 'error';
  else if (uniqueWarnings.length || !/mapbox|graph|water-graph/i.test(String(source))) confidence = 'medium';

  return {
    version: MULTIMODAL_REVIEW_VERSION,
    legId: leg?.legId || leg?.id || null,
    mode,
    source,
    provider: provider || source,
    geometry: clean,
    geometryPointCount: clean?.length || 0,
    directMiles,
    routeMiles,
    estimatedMinutes: estimateTravelMinutes(mode, routeMiles || directMiles),
    confidence,
    warnings: uniqueWarnings,
    errors: uniqueErrors,
    validation: validation && typeof validation === 'object' ? validation : {},
    reviewedAt: new Date().toISOString()
  };
}

export function createRouteReviewSnapshot(review = {}, signature = '') {
  const results = Array.isArray(review?.results) ? review.results : [];
  return {
    version: MULTIMODAL_REVIEW_VERSION,
    signature,
    approved: Boolean(review?.approved),
    approvedAt: review?.approvedAt || null,
    legs: results.map(result => ({
      legId: result?.legId || null,
      mode: canonicalTravelMode(result?.mode),
      source: result?.source || 'unknown',
      provider: result?.provider || result?.source || 'unknown',
      directMiles: roundNumber(result?.directMiles, 2),
      routeMiles: roundNumber(result?.routeMiles, 2),
      estimatedMinutes: Math.round(Number(result?.estimatedMinutes) || 0),
      confidence: result?.confidence || 'unknown',
      warnings: Array.isArray(result?.warnings) ? result.warnings.slice(0, 8) : [],
      errors: Array.isArray(result?.errors) ? result.errors.slice(0, 8) : [],
      geometryPointCount: Number(result?.geometryPointCount || result?.geometry?.length || 0),
      reviewedAt: result?.reviewedAt || null
    }))
  };
}

export function routeSourceLabel(source = '') {
  const value = String(source || '');
  if (value === 'mapbox-directions') return 'Mapbox road route';
  if (value === 'mapbox-build-cache') return 'Mapbox build cache';
  if (value === 'natural-earth-road-graph') return 'Road network';
  if (value === 'natural-earth-rail-graph') return 'Rail network';
  if (value === 'natural-earth-water-graph') return 'Navigable water';
  if (value === 'natural-earth-road-fallback') return 'Road fallback';
  if (value === 'natural-earth-rail-fallback') return 'Rail fallback';
  if (value === 'indexed-route-cache') return 'Cached detailed route';
  if (value === 'manual-override') return 'Manual route';
  return value ? value.replace(/[-_]+/g, ' ') : 'Route unavailable';
}

function endpointSignature(endpoint = {}) {
  return [
    String(endpoint?.id || endpoint?.name || ''),
    finiteFixed(endpoint?.lon),
    finiteFixed(endpoint?.lat)
  ].join('@');
}

function finiteFixed(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(5) : 'invalid';
}

function validEndpoint(endpoint) {
  const lon = Number(endpoint?.lon);
  const lat = Number(endpoint?.lat);
  return Number.isFinite(lon) && Number.isFinite(lat) && lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90;
}

function haversineMiles(a, b) {
  const radius = 3958.7613;
  const phi1 = degreesToRadians(Number(a[1]));
  const phi2 = degreesToRadians(Number(b[1]));
  const dPhi = degreesToRadians(Number(b[1]) - Number(a[1]));
  const dLambda = degreesToRadians(shortestLongitudeDelta(Number(b[0]) - Number(a[0])));
  const h = Math.sin(dPhi / 2) ** 2 + Math.cos(phi1) * Math.cos(phi2) * Math.sin(dLambda / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

function shortestLongitudeDelta(delta) {
  let value = delta;
  while (value > 180) value -= 360;
  while (value < -180) value += 360;
  return value;
}

function degreesToRadians(value) {
  return value * Math.PI / 180;
}

function roundNumber(value, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  const factor = 10 ** digits;
  return Math.round(number * factor) / factor;
}
