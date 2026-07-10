import generatedRoutes from '../data/generatedRoutes.json';
import { flattenLegs } from './tripExpansion.js';

export const ROUTE_DETAILS_VERSION = '4.20';
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

function routeGeometryForPayload(leg, old = {}, cacheVersion = ROUTE_DETAILS_CACHE_VERSION) {
  if (Array.isArray(old.geometry) && old.geometry.length > 1) return old.geometry;
  const generated = generatedRoutes?.routes || {};
  const browser = browserRouteCache();
  const directKey = routeCacheKeyForLeg(leg, cacheVersion);
  const reverseKey = reverseRouteCacheKeyForLeg(leg, cacheVersion);
  if (Array.isArray(generated[directKey]) && generated[directKey].length > 1) return generated[directKey];
  if (Array.isArray(generated[reverseKey]) && generated[reverseKey].length > 1) return [...generated[reverseKey]].reverse();
  if (Array.isArray(browser[directKey]) && browser[directKey].length > 1) return browser[directKey];
  if (Array.isArray(browser[reverseKey]) && browser[reverseKey].length > 1) return [...browser[reverseKey]].reverse();
  return null;
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
    const geometry = routeGeometryForPayload(entry.leg, old, cacheVersion);
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
      ...(geometry ? { geometry } : {}),
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
