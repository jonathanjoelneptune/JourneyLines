import generatedRoutes from '../data/generatedRoutes.json';
import { enforceRouteCacheLimit, getCachedRoute, putCachedRoute, pruneOldRoutingVersions, routeCacheKeyV6 } from './routeCacheIndexedDb.js';
import { assessMultimodalRoute, canonicalTravelMode, isSurfaceTravelMode, sanitizeRouteGeometry } from './multimodalRouting.js';

export const ROUTING_VERSION = 'multimodal-v7.0';
const listeners = new Set();
const pending = new Map();
const memoryRoutes = new Map();
const memoryRouteResults = new Map();
const memoryPlans = new Map();
const inFlightRoutes = new Map();
const inFlightPlans = new Map();
const WORKER_INIT_TIMEOUT_MS = 45000;
const WORKER_REQUEST_TIMEOUT_MS = 60000;
const MAPBOX_REQUEST_TIMEOUT_MS = 18000;

let worker = null;
let workerEpoch = 0;
let nextId = 1;
let initialized = false;
let initPromise = null;
let status = {
  state: 'idle',
  label: 'Routing engine idle',
  detail: 'Detailed multimodal routing will load in the background.',
  ready: false,
  queued: 0,
  activeJob: null,
  completed: 0,
  routingVersion: ROUTING_VERSION,
  dataVersion: null,
  loadedAt: null,
  error: null
};

function emit(patch = {}) {
  status = { ...status, ...patch, queued: pending.size };
  for (const listener of listeners) {
    try { listener(status); } catch {}
  }
  try {
    window.dispatchEvent(new CustomEvent('globehoppers-routing-status', { detail: status }));
  } catch {}
}

function dataUrl() {
  const base = String(import.meta.env.BASE_URL || './').replace(/\/?$/, '/');
  return new URL(`${base}data/naturalEarthRouting.json`, window.location.href).href;
}

function workerTimeoutFor(type) {
  return type === 'init' ? WORKER_INIT_TIMEOUT_MS : WORKER_REQUEST_TIMEOUT_MS;
}

function rejectPending(error) {
  const failure = error instanceof Error ? error : new Error(String(error || 'Routing worker reset.'));
  for (const [, record] of pending) {
    window.clearTimeout(record.timer);
    try { record.reject(failure); } catch {}
  }
  pending.clear();
}

function disposeWorker(reason = 'Routing worker reset.', rejectJobs = true) {
  const instance = worker;
  worker = null;
  workerEpoch += 1;
  initialized = false;
  initPromise = null;
  if (instance) {
    instance.onmessage = null;
    instance.onerror = null;
    instance.onmessageerror = null;
    try { instance.terminate(); } catch {}
  }
  if (rejectJobs) rejectPending(new Error(reason));
}

function ensureWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('../workers/routingWorker.js', import.meta.url), { type: 'module', name: 'globehoppers-routing' });
  const epoch = ++workerEpoch;
  worker.onmessage = event => {
    if (epoch !== workerEpoch) return;
    const message = event.data || {};
    if (message.type === 'status') {
      emit(message.status || {});
      return;
    }
    const record = pending.get(message.id);
    if (!record) return;
    pending.delete(message.id);
    window.clearTimeout(record.timer);
    emit({ queued: pending.size, activeJob: pending.size ? status.activeJob : null });
    if (message.ok) record.resolve(message.result);
    else record.reject(new Error(message.error || 'Routing worker failed.'));
  };
  worker.onerror = event => {
    if (epoch !== workerEpoch) return;
    const error = event?.message || 'Routing worker crashed.';
    disposeWorker(error, true);
    emit({ state: 'error', label: 'Routing engine error', detail: error, ready: false, activeJob: null, error });
  };
  worker.onmessageerror = () => {
    if (epoch !== workerEpoch) return;
    const error = 'Routing worker returned an unreadable message.';
    disposeWorker(error, true);
    emit({ state: 'error', label: 'Routing engine error', detail: error, ready: false, activeJob: null, error });
  };
  return worker;
}

function request(type, payload = {}, transfer = []) {
  const instance = ensureWorker();
  const id = nextId++;
  const timeoutMs = workerTimeoutFor(type);
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      if (!pending.has(id)) return;
      const message = `Routing worker ${type} request timed out after ${Math.round(timeoutMs / 1000)} seconds.`;
      disposeWorker(message, true);
      emit({ state: 'error', label: 'Routing engine timed out', detail: message, ready: false, activeJob: null, error: message });
    }, timeoutMs);
    pending.set(id, { resolve, reject, type, timer });
    emit({
      state: status.ready ? 'working' : 'loading',
      label: status.ready ? 'Routing job running' : 'Loading routing engine',
      activeJob: type,
      queued: pending.size
    });
    try {
      instance.postMessage({ id, type, payload }, transfer);
    } catch (error) {
      window.clearTimeout(timer);
      pending.delete(id);
      disposeWorker(error?.message || 'Routing worker postMessage failed.', true);
      emit({ state: 'error', label: 'Routing engine error', detail: error?.message || String(error), ready: false, activeJob: null, error: error?.message || String(error) });
      reject(error);
    }
  });
}

export function subscribeRoutingStatus(listener) {
  listeners.add(listener);
  listener(status);
  return () => listeners.delete(listener);
}

export function getRoutingStatus() {
  return status;
}

export async function restartRoutingEngine(reason = 'manual retry') {
  disposeWorker(`Routing engine restarted (${reason}).`, true);
  emit({ state: 'loading', label: 'Restarting routing engine', detail: `Creating a fresh routing worker (${reason}).`, ready: false, activeJob: null, error: null });
  return prewarmRoutingEngine(reason);
}

export async function prewarmRoutingEngine(reason = 'idle') {
  if (initialized && status.ready) return status;
  if (initPromise) return initPromise;
  initialized = true;
  emit({
    state: 'loading',
    label: 'Loading multimodal routing',
    detail: `Preparing road, rail, coastline, and water routing in the background (${reason}).`,
    ready: false,
    error: null
  });
  initPromise = request('init', { dataUrl: dataUrl(), routingVersion: ROUTING_VERSION, reason })
    .then(result => {
      emit({
        state: 'ready',
        label: 'Multimodal routing ready',
        detail: `${Number(result?.roadNodeCount || 0).toLocaleString()} road · ${Number(result?.railNodeCount || 0).toLocaleString()} rail · ${Number(result?.nodeCount || 0).toLocaleString()} water nodes`,
        ready: true,
        dataVersion: result?.dataVersion || null,
        loadedAt: Date.now(),
        completed: status.completed,
        error: null
      });
      pruneOldRoutingVersions(ROUTING_VERSION);
      return getRoutingStatus();
    })
    .catch(error => {
      disposeWorker(error?.message || 'Routing engine initialization failed.', false);
      emit({ state: 'error', label: 'Routing engine unavailable', detail: error.message, ready: false, error: error.message });
      throw error;
    });
  return initPromise;
}

export async function routeLegInWorker(leg, options = {}) {
  const result = await routeLegResult(leg, options);
  return result?.geometry || null;
}

export async function routeLegWithDiagnostics(leg, options = {}) {
  if (!leg?.from || !leg?.to) {
    return assessMultimodalRoute({ leg, geometry: null, source: 'missing-endpoints' });
  }

  const providerWarnings = [];
  const mode = canonicalTravelMode(leg.mode);
  if (mode === 'drive' && options.preferOnline !== false) {
    const token = runtimeMapboxToken();
    if (token) {
      try {
        const online = await requestMapboxDrivingRoute(leg, token);
        const assessed = assessMultimodalRoute({
          leg,
          geometry: online.geometry,
          source: 'mapbox-directions',
          provider: 'Mapbox Directions',
          validation: online.validation
        });
        if (!assessed.errors.length) {
          rememberRouteResult(leg, assessed);
          try {
            await cacheAssessedRoute(leg, assessed);
          } catch (error) {
            console.warn('[GlobeHoppers] Mapbox route cache write failed; continuing with the reviewed route.', error);
          }
          return assessed;
        }
        providerWarnings.push(...assessed.errors.map(message => `Mapbox route was rejected: ${message}`));
      } catch (error) {
        providerWarnings.push(`Online road routing was unavailable: ${error?.message || String(error)}`);
      }
    }
  }

  try {
    const result = await routeLegResult(leg, options);
    const assessed = assessMultimodalRoute({
      leg,
      geometry: result?.geometry,
      source: result?.source || 'routing-worker',
      provider: result?.provider || 'GlobeHoppers routing worker',
      validation: result?.validation || {},
      providerWarnings
    });
    rememberRouteResult(leg, { ...result, ...assessed });
    return { ...result, ...assessed };
  } catch (error) {
    return assessMultimodalRoute({
      leg,
      geometry: null,
      source: 'routing-error',
      providerWarnings: [...providerWarnings, error?.message || String(error)]
    });
  }
}

async function routeLegResult(leg, options = {}) {
  if (!leg?.from || !leg?.to) return null;
  const key = routeCacheKeyV6(leg, ROUTING_VERSION);
  if (!options.forceRefresh && memoryRouteResults.has(key)) return memoryRouteResults.get(key);
  if (!options.forceRefresh && inFlightRoutes.has(key)) return inFlightRoutes.get(key);

  const job = (async () => {
    if (!options.forceRefresh) {
      const cached = await getCachedRoute(key, ROUTING_VERSION);
      if (cached?.length > 1) {
        const cachedResult = {
          geometry: sanitizeRouteGeometry(cached),
          source: 'indexed-route-cache',
          provider: 'Browser route cache',
          dataVersion: status.dataVersion,
          routingVersion: ROUTING_VERSION,
          validation: {}
        };
        rememberRouteResult(leg, cachedResult);
        return cachedResult;
      }
      const generated = generatedDrivingRoute(leg);
      if (generated?.geometry) {
        const generatedResult = {
          geometry: generated.geometry,
          source: 'mapbox-build-cache',
          provider: 'Mapbox Directions build cache',
          detail: generated.reversed ? 'reversed-build-cache' : 'build-cache',
          dataVersion: generatedRoutes?.generatedAt || generatedRoutes?.version || null,
          routingVersion: ROUTING_VERSION,
          validation: { maxEndpointGapMiles: 0 }
        };
        rememberRouteResult(leg, generatedResult);
        return generatedResult;
      }
    }

    await prewarmRoutingEngine(options.reason || 'route request');
    emit({
      state: 'working',
      label: 'Calculating route',
      detail: `${leg.from.name || 'Origin'} → ${leg.to.name || 'Destination'} · ${leg.mode}`,
      activeJob: key
    });
    const result = await request('route', {
      leg: serializeLeg(leg),
      routingVersion: ROUTING_VERSION
    });
    const geometry = sanitizeRouteGeometry(result?.geometry);
    if (geometry) {
      const normalized = { ...result, geometry, provider: result?.provider || 'GlobeHoppers routing worker' };
      rememberRouteResult(leg, normalized);
      try {
        await putCachedRoute(key, geometry, ROUTING_VERSION, {
          mode: leg.mode,
          source: result?.source || 'worker',
          dataVersion: result?.dataVersion || status.dataVersion
        });
        enforceRouteCacheLimit(500).catch(() => {});
      } catch (error) {
        console.warn('[GlobeHoppers] Route cache write failed; continuing with in-memory geometry.', error);
      }
      emit({
        state: 'ready',
        label: 'Multimodal routing ready',
        detail: `Route cached · ${geometry.length.toLocaleString()} points`,
        activeJob: null,
        completed: Number(status.completed || 0) + 1,
        ready: true
      });
      return normalized;
    }
    return { ...result, geometry: null };
  })();

  inFlightRoutes.set(key, job);
  try {
    return await job;
  } finally {
    inFlightRoutes.delete(key);
  }
}

export async function buildPlaybackPlanInWorker(leg, geometry, options = {}) {
  if (!leg?.from || !leg?.to) return null;
  const geometrySignature = Array.isArray(geometry) && geometry.length > 1
    ? `${geometry.length}:${geometry[0]?.join(',')}:${geometry[geometry.length - 1]?.join(',')}`
    : 'no-geometry';
  const key = `${routeCacheKeyV6(leg, ROUTING_VERSION)}:plan:${options.samples || 'auto'}:${geometrySignature}`;
  if (memoryPlans.has(key)) return memoryPlans.get(key);
  if (inFlightPlans.has(key)) return inFlightPlans.get(key);

  const job = (async () => {
    await prewarmRoutingEngine(options.reason || 'playback plan');
    const result = await request('playbackPlan', {
      leg: serializeLeg(leg),
      geometry: Array.isArray(geometry) ? geometry : null,
      samples: options.samples || 0
    });
    if (result) {
      memoryPlans.set(key, result);
      if (memoryPlans.size > 120) {
        const oldestKey = memoryPlans.keys().next().value;
        memoryPlans.delete(oldestKey);
      }
    }
    return result;
  })();

  inFlightPlans.set(key, job);
  try {
    return await job;
  } finally {
    inFlightPlans.delete(key);
  }
}

export async function prefetchRoutingForLegs(entries = [], count = 4) {
  const queue = (entries || []).slice(0, Math.max(0, count));
  if (!queue.length) return;
  await prewarmRoutingEngine('playback prefetch');
  for (const entry of queue) {
    const leg = entry?.leg || entry;
    if (!leg?.from || !leg?.to) continue;
    try {
      const geometry = optionsGeometry(entry) || await routeLegInWorker(leg, { reason: 'prefetch' });
      if (geometry?.length > 1) await buildPlaybackPlanInWorker(leg, geometry, { reason: 'prefetch' });
    } catch {}
  }
}

function optionsGeometry(entry) {
  const geometry = entry?.leg?.routeGeometry || entry?.routeGeometry;
  return Array.isArray(geometry) && geometry.length > 1 ? geometry : null;
}

export function routingMemoryGeometry(leg) {
  return memoryRoutes.get(routeCacheKeyV6(leg, ROUTING_VERSION)) || null;
}

export function routingMemoryResult(leg) {
  return memoryRouteResults.get(routeCacheKeyV6(leg, ROUTING_VERSION)) || null;
}

export function prewarmWhenIdle() {
  const run = () => prewarmRoutingEngine('browser idle').catch(() => {});
  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(run, { timeout: 5000 });
  } else {
    window.setTimeout(run, 1800);
  }
}

function rememberRouteResult(leg, result) {
  const key = routeCacheKeyV6(leg, ROUTING_VERSION);
  if (result?.geometry) memoryRoutes.set(key, result.geometry);
  memoryRouteResults.set(key, result);
  if (memoryRouteResults.size > 600) {
    const oldest = memoryRouteResults.keys().next().value;
    memoryRouteResults.delete(oldest);
    memoryRoutes.delete(oldest);
  }
}

async function cacheAssessedRoute(leg, result) {
  if (!result?.geometry?.length) return;
  const key = routeCacheKeyV6(leg, ROUTING_VERSION);
  await putCachedRoute(key, result.geometry, ROUTING_VERSION, {
    mode: leg.mode,
    source: result.source,
    dataVersion: status.dataVersion
  });
  enforceRouteCacheLimit(500).catch(() => {});
}


function generatedDrivingRoute(leg) {
  if (canonicalTravelMode(leg?.mode) !== 'drive') return null;
  const routes = generatedRoutes?.routes;
  if (!routes || typeof routes !== 'object') return null;
  const version = generatedRoutes?.version || 'v2.16';
  const fromId = leg?.from?.id;
  const toId = leg?.to?.id;
  if (!fromId || !toId) return null;
  const direct = sanitizeRouteGeometry(routes[`${version}:${fromId}->${toId}:drive`]);
  if (direct) return { geometry: direct, reversed: false };
  const reverse = sanitizeRouteGeometry(routes[`${version}:${toId}->${fromId}:drive`]);
  if (reverse) return { geometry: [...reverse].reverse(), reversed: true };
  return null;
}

function serializeLeg(leg) {
  return {
    id: leg.legId || leg.id || null,
    legId: leg.legId || leg.id || null,
    mode: canonicalTravelMode(leg.mode),
    from: { id: leg.from.id, name: leg.from.name, lon: Number(leg.from.lon), lat: Number(leg.from.lat) },
    to: { id: leg.to.id, name: leg.to.name, lon: Number(leg.to.lon), lat: Number(leg.to.lat) },
    miles: Number(leg.miles || 0)
  };
}

function runtimeMapboxToken() {
  const runtime = typeof window !== 'undefined' ? window.JOURNEYLINES_CONFIG?.mapboxToken : '';
  const buildTime = import.meta.env.VITE_MAPBOX_TOKEN || '';
  const token = String(runtime || buildTime || '').trim();
  return token.startsWith('pk.') ? token : '';
}

async function requestMapboxDrivingRoute(leg, token) {
  const from = `${Number(leg.from.lon)},${Number(leg.from.lat)}`;
  const to = `${Number(leg.to.lon)},${Number(leg.to.lat)}`;
  const params = new URLSearchParams({
    access_token: token,
    alternatives: 'false',
    geometries: 'geojson',
    overview: 'full',
    steps: 'false'
  });
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), MAPBOX_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`https://api.mapbox.com/directions/v5/mapbox/driving/${from};${to}?${params}`, {
      signal: controller.signal,
      cache: 'no-store',
      referrerPolicy: 'strict-origin-when-cross-origin'
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`Mapbox Directions ${response.status}: ${text.slice(0, 180)}`);
    let payload;
    try { payload = JSON.parse(text); } catch { throw new Error('Mapbox returned unreadable route data.'); }
    const route = payload?.routes?.[0];
    const geometry = sanitizeRouteGeometry(route?.geometry?.coordinates);
    if (!geometry) throw new Error('Mapbox returned no usable driving geometry.');
    return {
      geometry,
      validation: {
        mapboxDistanceMeters: Number(route?.distance || 0),
        mapboxDurationSeconds: Number(route?.duration || 0),
        maxEndpointGapMiles: 0
      }
    };
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error(`Mapbox Directions timed out after ${Math.round(MAPBOX_REQUEST_TIMEOUT_MS / 1000)} seconds.`);
    throw error;
  } finally {
    window.clearTimeout(timer);
  }
}
