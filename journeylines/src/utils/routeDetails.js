import generatedRoutes from '../data/generatedRoutes.json';
import { flattenLegs } from './tripExpansion.js';

export const ROUTE_DETAILS_VERSION = '4.22';
export const ROUTE_DETAILS_CACHE_VERSION = 'v2.16';

export function routeDetailKeyForEntry(entry) {
  const tripId = String(entry?.trip?.id || entry?.trip?.label || entry?.trip?.title || 'trip');
  const legIndex = Number.isFinite(Number(entry?.legIndex)) ? Number(entry.legIndex) : 0;
  return `${tripId}::leg-${legIndex}`;
}

export function routeCacheKeyForLeg(leg, cacheVersion = ROUTE_DETAILS_CACHE_VERSION) {
  return `${cacheVersion}:${leg?.from?.id}->${leg?.to?.id}:${leg?.mode}`;
}

export function reverseRouteCacheKeyForLeg(leg, cacheVersion = ROUTE_DETAILS_CACHE_VERSION) {
  return `${cacheVersion}:${leg?.to?.id}->${leg?.from?.id}:${leg?.mode}`;
}

export function routeEndpointPairKey(leg) {
  const from = leg?.from?.id || leg?.from?.name;
  const to = leg?.to?.id || leg?.to?.name;
  if (!from || !to) return '';
  const pair = [String(from), String(to)].sort();
  return `${pair[0]}↔${pair[1]}`;
}

export function routeStackDirectionSignForLeg(leg) {
  const from = leg?.from?.id || leg?.from?.name;
  const to = leg?.to?.id || leg?.to?.name;
  if (!from || !to) return 1;
  const pair = [String(from), String(to)].sort();
  return String(from) === pair[0] ? 1 : -1;
}

export function normalizeRouteDetails(details = {}) {
  return {
    version: details?.version || ROUTE_DETAILS_VERSION,
    updatedAt: details?.updatedAt || null,
    source: details?.source || 'route-details',
    cacheVersion: details?.cacheVersion || ROUTE_DETAILS_CACHE_VERSION,
    routes: details?.routes && typeof details.routes === 'object' ? details.routes : {}
  };
}

export function routeDetailsGeometryCache(details = {}) {
  const normalized = normalizeRouteDetails(details);
  const out = {};
  for (const detail of Object.values(normalized.routes || {})) {
    const geometry = Array.isArray(detail?.geometry) ? detail.geometry : null;
    if (!geometry || geometry.length < 2) continue;
    const key = detail.routeCacheKey || `${normalized.cacheVersion}:${detail.fromLocationId}->${detail.toLocationId}:${detail.mode}`;
    if (key) out[key] = geometry;
  }
  return out;
}

export function applyRouteDetailsToEntries(entries = [], details = {}) {
  const normalized = normalizeRouteDetails(details);
  const routes = normalized.routes || {};
  return (entries || []).map(entry => {
    const key = routeDetailKeyForEntry(entry);
    const detail = routes[key];
    if (!detail) return entry;
    const geometry = Array.isArray(detail.geometry) && detail.geometry.length > 1 ? detail.geometry : null;
    return {
      ...entry,
      leg: {
        ...entry.leg,
        routeDetailsKey: key,
        routeCacheKey: detail.routeCacheKey || routeCacheKeyForLeg(entry.leg, normalized.cacheVersion),
        routeStackOffset: detail.routeStackOffset ?? entry.leg?.routeStackOffset,
        routeStackBaseOffset: detail.routeStackBaseOffset ?? entry.leg?.routeStackBaseOffset,
        routeStackDirectionSign: detail.routeStackDirectionSign ?? entry.leg?.routeStackDirectionSign,
        routeStackCount: detail.routeStackCount ?? entry.leg?.routeStackCount,
        routeStackIndex: detail.routeStackIndex ?? entry.leg?.routeStackIndex,
        routeEndpointPairKey: detail.endpointPairKey || entry.leg?.routeEndpointPairKey,
        ...(geometry ? { routeGeometry: geometry } : {})
      }
    };
  });
}

function browserRouteCache() {
  try {
    if (typeof localStorage === 'undefined') return {};
    return JSON.parse(localStorage.getItem('journeylines.routeCache') || '{}') || {};
  } catch {
    return {};
  }
}

function sanitizeGeometry(geometry) {
  if (!Array.isArray(geometry)) return null;
  const clean = geometry
    .map(point => Array.isArray(point) ? [Number(point[0]), Number(point[1])] : null)
    .filter(point => point && Number.isFinite(point[0]) && Number.isFinite(point[1]));
  return clean.length > 1 ? clean : null;
}

function simpleGeometryForLeg(leg) {
  const from = leg?.from;
  const to = leg?.to;
  const geometry = sanitizeGeometry([[from?.lon, from?.lat], [to?.lon, to?.lat]]);
  return geometry || null;
}

function routeGeometryForPayload(leg, old = {}, cacheVersion = ROUTE_DETAILS_CACHE_VERSION) {
  const generated = generatedRoutes?.routes || {};
  const browser = browserRouteCache();
  const directKey = routeCacheKeyForLeg(leg, cacheVersion);
  const reverseKey = reverseRouteCacheKeyForLeg(leg, cacheVersion);

  const oldGeometry = sanitizeGeometry(old.geometry);
  if (oldGeometry) return { geometry: oldGeometry, source: old.geometrySource || 'existingRouteDetails', detail: old.geometryDetail || 'preserved' };

  const generatedDirect = sanitizeGeometry(generated[directKey]);
  if (generatedDirect) return { geometry: generatedDirect, source: 'generatedRoutes', detail: 'direct' };

  const generatedReverse = sanitizeGeometry(generated[reverseKey]);
  if (generatedReverse) return { geometry: [...generatedReverse].reverse(), source: 'generatedRoutes', detail: 'reverse' };

  const browserDirect = sanitizeGeometry(browser[directKey]);
  if (browserDirect) return { geometry: browserDirect, source: 'browserRouteCache', detail: 'direct' };

  const browserReverse = sanitizeGeometry(browser[reverseKey]);
  if (browserReverse) return { geometry: [...browserReverse].reverse(), source: 'browserRouteCache', detail: 'reverse' };

  const simple = simpleGeometryForLeg(leg);
  if (simple) return { geometry: simple, source: 'simpleFallback', detail: 'straight-line' };

  return { geometry: null, source: 'missing', detail: 'no-valid-coordinates' };
}

export function summarizeRouteDetails(details = {}, expectedLegs = 0) {
  const normalized = normalizeRouteDetails(details);
  const records = Object.values(normalized.routes || {});
  const summary = {
    records: records.length,
    expected: expectedLegs,
    geometries: 0,
    detailed: 0,
    simple: 0,
    missing: 0,
    generated: 0,
    browser: 0,
    existing: 0,
    reverse: 0
  };
  for (const record of records) {
    const hasGeometry = Array.isArray(record?.geometry) && record.geometry.length > 1;
    if (!hasGeometry) {
      summary.missing += 1;
      continue;
    }
    summary.geometries += 1;
    const source = record.geometrySource || '';
    const detail = record.geometryDetail || '';
    if (source === 'simpleFallback') summary.simple += 1;
    else summary.detailed += 1;
    if (source === 'generatedRoutes') summary.generated += 1;
    if (source === 'browserRouteCache') summary.browser += 1;
    if (source === 'existingRouteDetails') summary.existing += 1;
    if (detail === 'reverse') summary.reverse += 1;
  }
  summary.label = `${summary.records}/${summary.expected || summary.records} legs · ${summary.geometries} geometries`;
  summary.detailLabel = `${summary.detailed} detailed · ${summary.simple} simple · ${summary.missing} missing`;
  return summary;
}

export function buildRouteDetailsPayload(trips = [], locations = [], homeBases = [], existingDetails = {}) {
  const existing = normalizeRouteDetails(existingDetails);
  const locationsById = Object.fromEntries((locations || []).map(loc => [loc.id, loc]));
  const entries = flattenLegs(trips || [], locationsById, homeBases || []);
  const routes = {};

  for (const entry of entries) {
    if (!entry?.leg?.from || !entry?.leg?.to) continue;
    const key = routeDetailKeyForEntry(entry);
    const old = existing.routes?.[key] || {};
    const cacheVersion = existing.cacheVersion || ROUTE_DETAILS_CACHE_VERSION;
    const routeCacheKey = routeCacheKeyForLeg(entry.leg, cacheVersion);
    const geometryInfo = routeGeometryForPayload(entry.leg, old, cacheVersion);
    const geometry = geometryInfo.geometry;
    routes[key] = {
      id: key,
      tripId: entry.trip?.id || null,
      legIndex: entry.legIndex,
      fromLocationId: entry.leg.from.id,
      toLocationId: entry.leg.to.id,
      fromName: entry.leg.from.name,
      toName: entry.leg.to.name,
      mode: entry.leg.mode,
      miles: Number(entry.leg.miles || 0),
      routeCacheKey,
      reverseRouteCacheKey: reverseRouteCacheKeyForLeg(entry.leg, cacheVersion),
      endpointPairKey: routeEndpointPairKey(entry.leg),
      routeStackOffset: Number(entry.leg.routeStackOffset || 0),
      routeStackBaseOffset: Number(entry.leg.routeStackBaseOffset || 0),
      routeStackDirectionSign: Number(entry.leg.routeStackDirectionSign || routeStackDirectionSignForLeg(entry.leg)),
      routeStackCount: Number(entry.leg.routeStackCount || 1),
      routeStackIndex: Number(entry.leg.routeStackIndex || 0),
      coordinates: {
        from: [Number(entry.leg.from.lon), Number(entry.leg.from.lat)],
        to: [Number(entry.leg.to.lon), Number(entry.leg.to.lat)]
      },
      ...(geometry ? {
        geometry,
        geometrySource: geometryInfo.source,
        geometryDetail: geometryInfo.detail,
        geometryPointCount: geometry.length
      } : {
        geometrySource: geometryInfo.source,
        geometryDetail: geometryInfo.detail,
        geometryPointCount: 0
      }),
      updatedAt: new Date().toISOString()
    };
  }

  return {
    version: ROUTE_DETAILS_VERSION,
    updatedAt: new Date().toISOString(),
    source: 'globe-hoppers-website',
    cacheVersion: existing.cacheVersion || ROUTE_DETAILS_CACHE_VERSION,
    notes: 'Generated route metadata for faster route rendering. The website owns updates to this file after v4.19.',
    routes
  };
}
