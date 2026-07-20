import { useEffect, useMemo, useRef, useState } from 'react';
import { colorGradient, normalizeHopperData, resolveTripVisual, segmentedCircleBackground, segmentedBorderGradient } from '../utils/hopperUtils.js';
import routeDetails from '../data/routeDetails.json';
import { buildRouteDetailsPayload, legacyRouteDetailKeyForEntry, routeDetailKeyForEntry } from '../utils/routeDetails.js';
import { flattenLegs } from '../utils/tripExpansion.js';
import { routeLegInWorker, routeLegWithDiagnostics } from '../utils/routingClient.js';
import { compareDateParts, createStableId, isResolvedLocation, normalizeTripForV61, validDateParts } from '../utils/tripModel.js';
import { createRouteReviewSnapshot, formatReviewDuration, isSurfaceTravelMode, routeReviewSignature, routeSourceLabel } from '../utils/multimodalRouting.js';

const MODE_OPTIONS = [
  { id: 'plane', label: 'Plane', icon: '✈' },
  { id: 'drive', label: 'Car', icon: '🚗' },
  { id: 'train', label: 'Train', icon: '🚆' },
  { id: 'boat', label: 'Boat', icon: '⛴' }
];
const TRAVELER_OPTIONS = [
  { id: 'joey', label: 'Joey', color: '#ff8a00' },
  { id: 'bonnie', label: 'Bonnie', color: '#ff4fd8' }
];
const MONTH_OPTIONS = [
  { value: '', label: 'Choose month' },
  { value: 1, label: 'January' },
  { value: 2, label: 'February' },
  { value: 3, label: 'March' },
  { value: 4, label: 'April' },
  { value: 5, label: 'May' },
  { value: 6, label: 'June' },
  { value: 7, label: 'July' },
  { value: 8, label: 'August' },
  { value: 9, label: 'September' },
  { value: 10, label: 'October' },
  { value: 11, label: 'November' },
  { value: 12, label: 'December' }
];
const empty = {
  year: new Date().getFullYear(), month: null, day: null, endYear: null, endMonth: null, endDay: null, label: '', travelers: [], mode: 'plane',
  roundTrip: true, returnMode: '', fromLocationId: null, fromLocationText: '', fromCity: null, toLocationId: '', toLocationText: '', toCity: null,
  toCustomEnabled: false, toCustomName: '', toCustomLat: '', toCustomLon: '',
  startPointId: '', mainPointId: '', mainLegId: '', returnPointId: '', returnLegId: '',
  notes: '', occasion: '', route: [], extraLegs: [], overrideFrom: false, _fromTouched: false, _titleMode: 'auto', trailStyle: 'solid', trailColorMode: 'members'
};
const emptyRouteReview = () => ({
  signature: '',
  status: 'idle',
  results: [],
  checkedAt: null,
  error: null,
  startedAt: null
});

function createNewHopDraft() {
  return {
    ...empty,
    travelers: [],
    year: new Date().getFullYear(),
    month: null,
    fromCity: null,
    toCity: null,
    toLocationText: '',
    _fromTouched: false,
    _titleMode: 'auto',
    startPointId: createStableId('point'),
    mainPointId: createStableId('point'),
    mainLegId: createStableId('leg'),
    returnPointId: createStableId('point'),
    returnLegId: createStableId('leg')
  };
}

function isDraftMeaningfullyBlank(value = {}) {
  return !(value._titleMode === 'custom' && String(value.label || '').trim())
    && !value.month
    && !value.day
    && !value.endMonth
    && !value.endDay
    && !(value.travelers || []).length
    && !(value.guestHoppers || []).length
    && !String(value.toLocationText || '').trim()
    && !value.toLocationId
    && !value.toCity
    && !String(value.toCustomName || '').trim()
    && !(value.extraLegs || []).some(leg => leg?.locationId || leg?.city || String(leg?.locationText || '').trim())
    && !String(value.notes || '').trim();
}

function mergeLocationsById(...groups) {
  const merged = new Map();
  for (const group of groups) {
    for (const location of group || []) {
      if (location?.id) merged.set(location.id, location);
    }
  }
  return [...merged.values()];
}

function sortBatchRows(rows = []) {
  return [...rows].sort((a, b) => {
    const dateOrder = compareDateParts(a?.trip || {}, b?.trip || {});
    if (dateOrder) return dateOrder;
    return Number(a?.entryOrder || 0) - Number(b?.entryOrder || 0);
  });
}
let cityDbPromise = null;
let cityDbCache = [];
function loadCityDatabase() {
  if (cityDbPromise) return cityDbPromise;
  cityDbPromise = fetch(`${import.meta.env.BASE_URL || '/'}data/cities15000.json`)
    .then(response => response.ok ? response.json() : [])
    .then(data => {
      cityDbCache = Array.isArray(data) ? data : [];
      return cityDbCache;
    })
    .catch(() => {
      cityDbCache = [];
      return [];
    });
  return cityDbPromise;
}

let citySearchWorker = null;
let citySearchRequestId = 1;
const citySearchPending = new Map();

function cityDataUrl() {
  const base = String(import.meta.env.BASE_URL || './').replace(/\/?$/, '/');
  return new URL(`${base}data/cities15000.json`, window.location.href).href;
}

function ensureCitySearchWorker() {
  if (citySearchWorker) return citySearchWorker;
  citySearchWorker = new Worker(new URL('../workers/citySearchWorker.js', import.meta.url), {
    type: 'module',
    name: 'globehoppers-city-search'
  });
  citySearchWorker.onmessage = event => {
    const message = event.data || {};
    const pending = citySearchPending.get(message.id);
    if (!pending) return;
    citySearchPending.delete(message.id);
    if (message.ok) pending.resolve(message.results || []);
    else pending.reject(new Error(message.error || 'City search failed.'));
  };
  citySearchWorker.onerror = event => {
    const error = new Error(event?.message || 'City search worker failed.');
    for (const pending of citySearchPending.values()) pending.reject(error);
    citySearchPending.clear();
    try { citySearchWorker.terminate(); } catch {}
    citySearchWorker = null;
  };
  return citySearchWorker;
}

function searchCitiesInWorker(query, limit = 24) {
  const worker = ensureCitySearchWorker();
  const id = citySearchRequestId++;
  return new Promise((resolve, reject) => {
    citySearchPending.set(id, { resolve, reject });
    worker.postMessage({
      id,
      type: 'search',
      payload: { query, limit, dataUrl: cityDataUrl() }
    });
  });
}

const repoSaveQueue = {
  pending: null,
  current: null,
  completed: null,
  timer: null,
  saving: false
};

const REPO_SAVE_LOCK_KEY = 'journeylines.repoSaveLock.v1';
const REPO_SAVE_LOCK_TTL = 45000;
const REPO_SAVE_COOLDOWN_MS = 5000;

function tabSaveId() {
  try {
    let id = sessionStorage.getItem('journeylines.repoSaveTabId');
    if (!id) {
      id = `tab-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      sessionStorage.setItem('journeylines.repoSaveTabId', id);
    }
    return id;
  } catch {
    return 'tab-unknown';
  }
}

function readRepoSaveLock() {
  try {
    return JSON.parse(localStorage.getItem(REPO_SAVE_LOCK_KEY) || 'null');
  } catch {
    return null;
  }
}

function writeRepoSaveLock(lock) {
  try { localStorage.setItem(REPO_SAVE_LOCK_KEY, JSON.stringify(lock)); } catch {}
}

function clearRepoSaveLock(owner) {
  try {
    const lock = readRepoSaveLock();
    if (!lock || lock.owner === owner) localStorage.removeItem(REPO_SAVE_LOCK_KEY);
  } catch {}
}

async function acquireRepoSaveLock(onStatus = () => {}) {
  const owner = tabSaveId();
  const start = Date.now();
  while (Date.now() - start < REPO_SAVE_LOCK_TTL) {
    const now = Date.now();
    const lock = readRepoSaveLock();
    if (!lock || !lock.owner || now - Number(lock.at || 0) > REPO_SAVE_LOCK_TTL) {
      writeRepoSaveLock({ owner, at: now });
      await wait(80);
      const confirm = readRepoSaveLock();
      if (confirm?.owner === owner) return owner;
    }
    onStatus({
      state: 'queued',
      label: 'Repository save waiting',
      detail: 'Waiting for another repository save to finish…',
      startedAt: start,
      completedAt: null,
      error: null
    });
    await wait(700);
  }
  throw new Error('Timed out waiting for the repository save lock. Try again in a moment.');
}


export default function AdminPanel({ trips, setTrips, locations, setLocations, homeBases, initialEditTripId, initialAddRequestId = 0, initialTimelineRequestId = 0, initialScroll, onScrollStore, onConsumedInitialEdit, viewType = 'expanded', onViewTypeChange, addTripNoun = 'Hop', hopperData, setHopperData, activeTripId, onPlayTrip, onTripSaved = () => {}, modalOnly = false, onRepoSaveStatus = () => {}, cloudMode = false, cloudTripCreateEnabled = false, mapId = null, onCloudCreateTrip = null }) {
  const [draft, setDraft] = useState(empty);
  const [modal, setModal] = useState(null); // 'add' | 'edit' | null
  const [modalClosing, setModalClosing] = useState(false);
  const [closing, setClosing] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const reorderMode = false;
  const [busy, setBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [formError, setFormError] = useState('');
  const [confirmRequest, setConfirmRequest] = useState(null);
  const [token, setToken] = useState(() => localStorage.getItem('journeylines.githubToken') || '');
  const [repo, setRepo] = useState(() => localStorage.getItem('journeylines.repo') || '');
  const [cityDb, setCityDb] = useState(() => cityDbCache);
  const [cityDbLoaded, setCityDbLoaded] = useState(() => cityDbCache.length > 0);
  const [cityDbLoading, setCityDbLoading] = useState(false);
  const [citySearchResults, setCitySearchResults] = useState({});
  const [citySearchLoading, setCitySearchLoading] = useState({});
  const [routeReview, setRouteReview] = useState(() => emptyRouteReview());
  const [batchRows, setBatchRows] = useState([]);
  const [batchEditingStageId, setBatchEditingStageId] = useState(null);
  const batchSequenceRef = useRef(0);
  const routeReviewGenerationRef = useRef(0);
  const tripsRef = useRef(trips);
  const locationsRef = useRef(locations);
  const routeDetailsRef = useRef(routeDetails);
  const [dragId, setDragId] = useState(null);
  const [dropId, setDropId] = useState(null);
  const studioListRef = useRef(null);
  const restoreScrollRef = useRef(null);
  const modalCloseTimerRef = useRef(null);
  const initialDraftSignatureRef = useRef('');
  const initialAddRequestRef = useRef(0);
  const initialTimelineRequestRef = useRef(0);
  const modalTriggerRef = useRef(null);
  const locs = useMemo(() => [...locations].sort((a,b) => a.name.localeCompare(b.name)), [locations]);
  const locById = useMemo(() => Object.fromEntries(locations.map(l => [l.id, l])), [locations]);
  useEffect(() => { tripsRef.current = trips; }, [trips]);
  useEffect(() => { locationsRef.current = locations; }, [locations]);
  const sortedTrips = useMemo(() => sortTripsForEditor(trips), [trips]);
  const normalizedHoppers = useMemo(() => normalizeHopperData(hopperData), [hopperData]);
  const draftReviewLegs = useMemo(
    () => modal ? buildDraftReviewLegs(draft, locById, locs, homeBases) : [],
    [modal, draft, locById, locs, homeBases]
  );
  const draftSurfaceReviewLegs = useMemo(
    () => draftReviewLegs.filter(leg => isSurfaceTravelMode(leg.mode)),
    [draftReviewLegs]
  );
  const currentRouteReviewSignature = useMemo(
    () => routeReviewSignature(draftSurfaceReviewLegs),
    [draftSurfaceReviewLegs]
  );

  function previewMapLocation(location) {
    if (!location || location.lon == null || location.lat == null) return;
    window.dispatchEvent(new CustomEvent('globehoppers-preview-location', { detail: { lon: location.lon, lat: location.lat, name: displayLocation(location) || location.name } }));
  }


  useEffect(() => {
    if (!modal) return;
    if (!draftSurfaceReviewLegs.length) {
      routeReviewGenerationRef.current += 1;
      if (routeReview.status !== 'idle' || routeReview.signature || routeReview.results.length) {
        setRouteReview(emptyRouteReview());
      }
      return;
    }
    if (routeReview.signature && routeReview.signature !== currentRouteReviewSignature) {
      routeReviewGenerationRef.current += 1;
      setRouteReview({
        ...emptyRouteReview(),
        status: 'stale',
        error: 'The route changed. GlobeHoppers will recalculate it automatically before saving.'
      });
    }
  }, [modal, currentRouteReviewSignature, draftSurfaceReviewLegs.length, routeReview.signature, routeReview.status, routeReview.results.length]);

  useEffect(() => {
    if (!modal || !draftSurfaceReviewLegs.length || draftSurfaceReviewLegs.length > 4) return;
    if (!currentRouteReviewSignature || !draftSurfaceReviewLegs.every(reviewLegHasValidEndpoints)) return;
    if (routeReview.signature === currentRouteReviewSignature && ['working', 'ready', 'error'].includes(routeReview.status)) return;
    const timer = window.setTimeout(() => reviewDraftRoutes(false), 700);
    return () => window.clearTimeout(timer);
  // The route signature is the stable dependency; reviewDraftRoutes intentionally reads the current draft snapshot.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modal, currentRouteReviewSignature, draftSurfaceReviewLegs.length]);

  async function reviewDraftRoutes(forceRefresh = false) {
    const legs = buildDraftReviewLegs(draft, locById, locs, homeBases).filter(leg => isSurfaceTravelMode(leg.mode));
    const signature = routeReviewSignature(legs);
    if (!legs.length) {
      const next = emptyRouteReview();
      setRouteReview(next);
      return next;
    }
    const incomplete = legs.find(leg => !reviewLegHasValidEndpoints(leg));
    if (incomplete) {
      const next = {
        ...emptyRouteReview(),
        status: 'incomplete',
        error: `Choose valid locations for ${incomplete.from?.name || 'the origin'} and ${incomplete.to?.name || 'the destination'} before routing.`
      };
      setRouteReview(next);
      return next;
    }

    const generation = ++routeReviewGenerationRef.current;
    setRouteReview({
      signature,
      status: 'working',
      results: [],
      checkedAt: null,
      error: null,
      startedAt: Date.now()
    });

    const results = new Array(legs.length);
    let cursor = 0;
    const concurrency = Math.max(1, Math.min(2, legs.length));
    await Promise.all(Array.from({ length: concurrency }, async () => {
      while (cursor < legs.length) {
        const index = cursor++;
        const leg = legs[index];
        try {
          const routed = await routeLegWithDiagnostics(leg, {
            reason: 'automatic Hop route check',
            forceRefresh,
            preferOnline: true
          });
          const contextualWarnings = routeEndpointContextWarnings(leg);
          const warnings = [...new Set([...(routed?.warnings || []), ...contextualWarnings])];
          results[index] = {
            ...routed,
            legId: leg.legId || leg.id,
            mode: leg.mode,
            from: leg.from,
            to: leg.to,
            warnings,
            confidence: routed?.errors?.length ? 'error' : warnings.length ? 'medium' : (routed?.confidence || 'high')
          };
        } catch (error) {
          results[index] = {
            legId: leg.legId || leg.id,
            mode: leg.mode,
            from: leg.from,
            to: leg.to,
            geometry: null,
            routeMiles: 0,
            estimatedMinutes: 0,
            source: 'routing-error',
            provider: 'GlobeHoppers routing system',
            warnings: routeEndpointContextWarnings(leg),
            errors: [error?.message || 'The route could not be calculated.'],
            confidence: 'error'
          };
        }
      }
    }));

    const failed = results.filter(result => (result?.errors || []).length || !result?.geometry?.length);
    const next = {
      signature,
      status: failed.length ? 'error' : 'ready',
      results,
      checkedAt: new Date().toISOString(),
      error: failed.length ? `${failed.length} route${failed.length === 1 ? '' : 's'} could not be generated safely. Correct the endpoints or try Recalculate.` : null,
      startedAt: null
    };
    if (generation === routeReviewGenerationRef.current) setRouteReview(next);
    return generation === routeReviewGenerationRef.current ? next : null;
  }

  async function ensureDraftRoutesForSave() {
    const legs = buildDraftReviewLegs(draft, locById, locs, homeBases).filter(leg => isSurfaceTravelMode(leg.mode));
    if (!legs.length) return emptyRouteReview();
    const signature = routeReviewSignature(legs);
    const incomplete = legs.find(leg => !reviewLegHasValidEndpoints(leg));
    if (incomplete) throw new Error('Choose valid endpoints for every road, rail, and boat leg before saving.');

    const currentIsUsable = routeReview.signature === signature
      && routeReview.status === 'ready'
      && routeReview.results.length === legs.length
      && routeReview.results.every(result => !(result?.errors || []).length && (result?.geometry?.length > 1 || result?.cachedRoute));
    const resolved = currentIsUsable ? routeReview : await reviewDraftRoutes(routeReview.status === 'error');
    validateAutomaticRouteCheckForSave(legs, signature, resolved || {});
    return resolved;
  }


  useEffect(() => {
    if (!initialAddRequestId || initialAddRequestRef.current === initialAddRequestId) return;
    initialAddRequestRef.current = initialAddRequestId;
    openAdd();
  // The request id is a one-shot command from the lazy-loaded parent.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialAddRequestId]);

  useEffect(() => {
    if (!initialTimelineRequestId || initialTimelineRequestRef.current === initialTimelineRequestId) return;
    initialTimelineRequestRef.current = initialTimelineRequestId;
    if (modal) closeModal();
  // This is a distinct, durable parent command. It must never be interpreted as
  // an Add Hop request when Studio mounts lazily or reopens.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTimelineRequestId]);

  useEffect(() => {
    if (!initialEditTripId) return;
    const trip = trips.find(t => t.id === initialEditTripId);
    if (trip) openEdit(trip);
    onConsumedInitialEdit?.();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialEditTripId]);

  useEffect(() => {
    if (restoreScrollRef.current == null || !studioListRef.current) return;
    const y = restoreScrollRef.current;
    requestAnimationFrame(() => {
      if (studioListRef.current) studioListRef.current.scrollTop = y;
      restoreScrollRef.current = null;
    });
  }, [trips]);

  useEffect(() => {
    if (!studioListRef.current) return;
    requestAnimationFrame(() => {
      if (studioListRef.current) studioListRef.current.scrollTop = initialScroll || 0;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => () => {
    window.clearTimeout(modalCloseTimerRef.current);
  }, []);

  useEffect(() => {
    function handleRequestClose() {
      requestCloseStudio();
    }
    window.addEventListener('globehoppers-request-close-studio', handleRequestClose);
    return () => window.removeEventListener('globehoppers-request-close-studio', handleRequestClose);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closing, modal, draft]);


  function requestCitySuggestions(query = '') {
    const key = normalizeSearchText(query);
    if (key.length < 2 || citySearchResults[key] || citySearchLoading[key]) return;
    setCitySearchLoading(previous => ({ ...previous, [key]: true }));
    searchCitiesInWorker(query, 28)
      .then(results => {
        setCitySearchResults(previous => ({ ...previous, [key]: Array.isArray(results) ? results : [] }));
      })
      .catch(error => {
        console.warn('[GlobeHoppers] City search worker failed.', error);
        setCitySearchResults(previous => ({ ...previous, [key]: [] }));
      })
      .finally(() => {
        setCitySearchLoading(previous => {
          const next = { ...previous };
          delete next[key];
          return next;
        });
      });
  }

  useEffect(() => {
    function handleOpenNewTrip() {
      openAdd();
    }
    window.addEventListener('globehoppers-open-new-trip', handleOpenNewTrip);
    return () => window.removeEventListener('globehoppers-open-new-trip', handleOpenNewTrip);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function handleRetryRepositorySave() {
      const queue = repoSaveQueue;
      if (queue.saving || queue.pending || !queue.completed?.error) return;
      const retryJob = {
        ...queue.completed,
        error: null,
        completedAt: null,
        queuedAt: Date.now()
      };
      queue.completed = null;
      queue.pending = retryJob;
      onRepoSaveStatus(repoSaveStatusPayload(queue, {
        state: 'queued',
        label: 'Repository retry queued',
        detail: repoSaveBatchDetail(retryJob, false),
        startedAt: retryJob.queuedAt,
        completedAt: null,
        error: null,
        canRetry: false
      }));
      schedulePendingRepoSave(250);
    }
    window.addEventListener('globehoppers-retry-repo-save', handleRetryRepositorySave);
    return () => window.removeEventListener('globehoppers-retry-repo-save', handleRetryRepositorySave);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  function saveLocalToken(value) { setToken(value); localStorage.setItem('journeylines.githubToken', value); }
  function saveRepo(value) { setRepo(value); localStorage.setItem('journeylines.repo', value); }

  function openAdd() {
    modalTriggerRef.current = document.activeElement;
    window.dispatchEvent(new CustomEvent('globehoppers-pause-for-hop-modal'));
    window.clearTimeout(modalCloseTimerRef.current);
    setFormError('');
    setModalClosing(false);
    setEditingId(null);
    setBatchRows([]);
    setBatchEditingStageId(null);
    const nextDraft = createNewHopDraft();
    routeReviewGenerationRef.current += 1;
    setRouteReview(emptyRouteReview());
    initialDraftSignatureRef.current = draftSignature(nextDraft);
    setDraft(nextDraft);
    setModal('add');
  }

  function openBatchAdd() {
    window.clearTimeout(modalCloseTimerRef.current);
    setFormError('');
    setModalClosing(false);
    setEditingId(null);
    setBatchRows([]);
    setBatchEditingStageId(null);
    batchSequenceRef.current = 0;
    const nextDraft = createNewHopDraft();
    routeReviewGenerationRef.current += 1;
    setRouteReview(emptyRouteReview());
    initialDraftSignatureRef.current = draftSignature(nextDraft);
    setDraft(nextDraft);
    setModal('batch');
  }
  function openEdit(trip) {
    modalTriggerRef.current = document.activeElement;
    window.dispatchEvent(new CustomEvent('globehoppers-pause-for-hop-modal'));
    window.clearTimeout(modalCloseTimerRef.current);
    setFormError('');
    setModalClosing(false);
    const normalizedTrip = normalizeTripForV61(trip, homeBases);
    const route = Array.isArray(normalizedTrip.route) ? normalizedTrip.route : [];
    const hasRoute = route.length > 1;
    const routeStart = hasRoute ? route[0] : null;
    const routeDestination = hasRoute ? route[1] : null;
    const routeEnd = hasRoute ? route[route.length - 1] : null;
    const returnsToStart = !!(normalizedTrip.roundTrip && routeStart?.locationId && routeEnd?.locationId === routeStart.locationId && route.length > 2);
    const extraRouteStops = hasRoute ? route.slice(2, returnsToStart ? -1 : undefined) : [];
    const to = locById[routeDestination?.locationId || normalizedTrip.toLocationId];
    const derivedReturnMode = returnsToStart
      ? (routeEnd?.modeFromPrevious || normalizedTrip.returnMode || normalizedTrip.mode || 'plane')
      : (normalizedTrip.returnMode || normalizedTrip.mode || 'plane');

    const nextDraft = {
      ...empty,
      ...normalizedTrip,
      returnMode: derivedReturnMode,
      overrideFrom: false,
      _fromTouched: true,
      _titleMode: 'custom',
      startPointId: routeStart?.pointId || createStableId('point'),
      mainPointId: routeDestination?.pointId || createStableId('point'),
      mainLegId: routeDestination?.legId || createStableId('leg'),
      returnPointId: returnsToStart ? (routeEnd?.pointId || createStableId('point')) : createStableId('point'),
      returnLegId: returnsToStart ? (routeEnd?.legId || createStableId('leg')) : createStableId('leg'),
      fromLocationId: routeStart?.locationId || normalizedTrip.fromLocationId || null,
      fromLocationText: routeStart?.locationId ? displayLocation(locById[routeStart.locationId]) : '',
      toLocationId: routeDestination?.locationId || normalizedTrip.toLocationId || '',
      toLocationText: to ? displayLocation(to) : (normalizedTrip.toLocationName || normalizedTrip.label || ''),
      fromCity: null,
      toCity: null,
      extraLegs: extraRouteStops.map(routePoint => ({
        draftId: routePoint.pointId || createStableId('draft-leg'),
        pointId: routePoint.pointId || createStableId('point'),
        legId: routePoint.legId || createStableId('leg'),
        locationId: routePoint.locationId || '',
        locationText: displayLocation(locById[routePoint.locationId]) || '',
        modeFromPrevious: routePoint.modeFromPrevious || normalizedTrip.mode || 'plane'
      }))
    };
    const initialReviewLegs = buildDraftReviewLegs(nextDraft, locById, locs, homeBases).filter(leg => isSurfaceTravelMode(leg.mode));
    const initialReviewSignature = routeReviewSignature(initialReviewLegs);
    const savedReview = normalizedTrip.routeReview;
    const savedReviewIsCurrent = Boolean(savedReview?.signature === initialReviewSignature && Array.isArray(savedReview?.legs) && savedReview.legs.length === initialReviewLegs.length);
    routeReviewGenerationRef.current += 1;
    setRouteReview(savedReviewIsCurrent ? {
      signature: initialReviewSignature,
      status: 'ready',
      results: (savedReview.legs || []).map((result, index) => ({
        ...result,
        legId: result?.legId || initialReviewLegs[index]?.legId,
        mode: result?.mode || initialReviewLegs[index]?.mode,
        from: initialReviewLegs[index]?.from,
        to: initialReviewLegs[index]?.to,
        geometry: null,
        cachedRoute: true
      })),
      checkedAt: savedReview.checkedAt || savedReview.approvedAt || null,
      error: null,
      startedAt: null
    } : emptyRouteReview());
    setEditingId(normalizedTrip.id);
    initialDraftSignatureRef.current = draftSignature(nextDraft);
    setDraft(nextDraft);
    setModal('edit');
  }

  function closeModal(force = false) {
    setFormError('');
    if (!modal) return;
    if (!force && modal === 'batch' && (batchDraftIsDirty() || batchRows.length)) {
      setConfirmRequest({
        title: 'Leave Batch Add?',
        message: batchRows.length
          ? `You have ${batchRows.length} staged Hop${batchRows.length === 1 ? '' : 's'}${batchDraftIsDirty() ? ' and unsaved editor changes' : ''}. Save the batch before closing?`
          : 'The Hop in the editor has not been staged. Save it before closing?',
        confirmLabel: 'Save Batch',
        confirmClass: 'primary',
        discardLabel: 'Discard Batch',
        onConfirm: async () => {
          if (batchDraftIsDirty()) {
            const staged = await stageCurrentBatchHop();
            if (staged) await commitBatchRows(staged.rows);
          } else {
            await commitBatchRows(batchRows);
          }
        },
        onDiscard: () => closeModal(true)
      });
      return;
    }
    if (!force && draftSignature(draft) !== initialDraftSignatureRef.current) {
      setConfirmRequest({
        title: 'Discard unsaved changes?',
        message: 'Your changes to this Hop have not been saved.',
        confirmLabel: 'Discard changes',
        onConfirm: async () => closeModal(true)
      });
      return;
    }
    window.clearTimeout(modalCloseTimerRef.current);
    setModalClosing(true);
    modalCloseTimerRef.current = window.setTimeout(() => {
      setModal(null);
      setModalClosing(false);
      setEditingId(null);
      setBatchRows([]);
      setBatchEditingStageId(null);
      setDraft(empty);
      routeReviewGenerationRef.current += 1;
      setRouteReview(emptyRouteReview());
      initialDraftSignatureRef.current = '';
      try { modalTriggerRef.current?.focus?.(); } catch {}
      modalTriggerRef.current = null;
      window.dispatchEvent(new CustomEvent('globehoppers-resume-after-hop-modal'));
      if (modalOnly) window.dispatchEvent(new CustomEvent('globehoppers-close-studio'));
    }, 260);
  }

  function updateTraveler(id) {
    setFormError('');
    const set = new Set(draft.travelers || []);
    if (set.has(id)) set.delete(id); else set.add(id);
    const next = Array.from(set);
    setDraft(d => ({ ...d, travelers: next }));
  }

  function chooseDestination(location) {
    setFormError('');
    const isCity = location?._source === 'city';
    setDraft(d => ({
      ...d,
      toLocationId: isCity ? '' : location.id,
      toCity: isCity ? location.city : null,
      toLocationText: selectedLocationText(location),
      toCustomEnabled: false,
      toCustomName: '',
      toCustomLat: '',
      toCustomLon: ''
    }));
    previewMapLocation(location);
  }
  function chooseFrom(location) {
    const isCity = location?._source === 'city';
    setDraft(d => ({ ...d, fromLocationId: isCity ? '' : location.id, fromCity: isCity ? location.city : null, fromLocationText: selectedLocationText(location), overrideFrom: false, _fromTouched: true }));
    previewMapLocation(location);
  }
  function chooseExtraLeg(index, location) {
    const isCity = location?._source === 'city';
    setDraft(d => {
      const extraLegs = [...(d.extraLegs || [])];
      extraLegs[index] = { ...extraLegs[index], locationId: isCity ? '' : location.id, city: isCity ? location.city : null, locationText: selectedLocationText(location) };
      return { ...d, extraLegs };
    });
    previewMapLocation(location);
  }
  function setExtraLeg(index, patch) {
    setDraft(d => {
      const extraLegs = [...(d.extraLegs || [])];
      extraLegs[index] = { ...extraLegs[index], ...patch };
      return { ...d, extraLegs };
    });
  }
  function addLeg() {
    setDraft(d => ({
      ...d,
      extraLegs: [
        ...(d.extraLegs || []),
        {
          draftId: createStableId('draft-leg'),
          pointId: createStableId('point'),
          legId: createStableId('leg'),
          locationId: '',
          locationText: '',
          city: null,
          modeFromPrevious: d.mode || 'plane'
        }
      ]
    }));
  }
  function removeLeg(index) { setDraft(d => ({ ...d, extraLegs: (d.extraLegs || []).filter((_, i) => i !== index) })); }
  function setReturnMode(mode) { setDraft(d => ({ ...d, returnMode: mode })); }
  function setPreviewLegMode(target, mode) {
    if (target === 'main') setDraft(d => ({ ...d, mode, returnMode: d.returnMode || mode }));
    else if (target === 'return') setDraft(d => ({ ...d, returnMode: mode }));
    else if (typeof target === 'number') setExtraLeg(target, { modeFromPrevious: mode });
  }

  function batchDraftIsDirty() {
    return draftSignature(draft) !== initialDraftSignatureRef.current && !isDraftMeaningfullyBlank(draft);
  }

  function batchLocationsExcluding(stageId = null) {
    const stagedLocations = batchRows
      .filter(row => row.stageId !== stageId)
      .flatMap(row => row.addedLocations || []);
    return mergeLocationsById(locationsRef.current || locations, stagedLocations);
  }

  function cloneBatchDraft(value = {}) {
    return {
      ...value,
      travelers: [...(value.travelers || [])],
      guestHoppers: (value.guestHoppers || []).map(guest => ({ ...guest })),
      extraLegs: (value.extraLegs || []).map(leg => ({ ...leg })),
      route: (value.route || []).map(point => ({ ...point }))
    };
  }

  async function stageCurrentBatchHop() {
    if (busy) return null;
    setBusy(true);
    setFormError('');
    try {
      validateHopDraftForSave(draft);
      const resolvedRouteReview = await ensureDraftRoutesForSave();
      const existingRow = batchEditingStageId ? batchRows.find(row => row.stageId === batchEditingStageId) : null;
      const otherRows = batchRows.filter(row => row.stageId !== batchEditingStageId);
      const workingTrips = [...(tripsRef.current || trips), ...otherRows.map(row => row.trip)];
      const workingLocations = batchLocationsExcluding(batchEditingStageId);
      const draftForNormalization = {
        ...draft,
        id: existingRow?.trip?.id || draft.id || undefined
      };
      const { trip, nextLocations } = normalizeTrip(draftForNormalization, workingTrips, workingLocations, homeBases, normalizedHoppers);
      const nextLocationMap = Object.fromEntries((nextLocations || []).map(location => [location.id, location]));
      const persistedSurfaceLegs = flattenLegs([trip], nextLocationMap, homeBases)
        .map(entry => entry.leg)
        .filter(leg => isSurfaceTravelMode(leg.mode));
      const persistedReview = persistedSurfaceLegs.length
        ? createRouteReviewSnapshot(resolvedRouteReview, routeReviewSignature(persistedSurfaceLegs))
        : null;
      const normalizedTrip = normalizeTripForV61({ ...trip, routeReview: persistedReview }, homeBases);
      validateTripLocationReferences(normalizedTrip, nextLocations);
      if (tripNeedsDetailedVesselRouting(normalizedTrip, nextLocations)) {
        await prepareTripRoutesForPlayback(normalizedTrip, nextLocations);
      }

      const workingIds = new Set(workingLocations.map(location => location.id));
      const addedLocations = (nextLocations || []).filter(location => !workingIds.has(location.id));
      const stageId = existingRow?.stageId || createStableId('batch-hop');
      const entryOrder = existingRow?.entryOrder || ++batchSequenceRef.current;
      const stagedDraft = cloneBatchDraft({ ...draftForNormalization, id: normalizedTrip.id, routeReview: persistedReview });
      const row = {
        stageId,
        entryOrder,
        draft: stagedDraft,
        trip: normalizedTrip,
        addedLocations,
        routeReview: resolvedRouteReview,
        stagedAt: Date.now()
      };
      const nextRows = sortBatchRows([...otherRows, row]);
      setBatchRows(nextRows);
      setBatchEditingStageId(stageId);
      setDraft(stagedDraft);
      setRouteReview(resolvedRouteReview || emptyRouteReview());
      initialDraftSignatureRef.current = draftSignature(stagedDraft);
      return { row, rows: nextRows };
    } catch (error) {
      setFormError(error?.message || String(error));
      return null;
    } finally {
      setBusy(false);
    }
  }

  function loadBatchRow(row) {
    if (!row) return;
    const nextDraft = cloneBatchDraft(row.draft);
    routeReviewGenerationRef.current += 1;
    setBatchEditingStageId(row.stageId);
    setDraft(nextDraft);
    setRouteReview(row.routeReview || emptyRouteReview());
    initialDraftSignatureRef.current = draftSignature(nextDraft);
    setFormError('');
  }

  function resetBatchDraft() {
    const nextDraft = createNewHopDraft();
    routeReviewGenerationRef.current += 1;
    setBatchEditingStageId(null);
    setDraft(nextDraft);
    setRouteReview(emptyRouteReview());
    initialDraftSignatureRef.current = draftSignature(nextDraft);
    setFormError('');
  }

  function requestBatchEdit(stageId) {
    const target = batchRows.find(row => row.stageId === stageId);
    if (!target || target.stageId === batchEditingStageId && !batchDraftIsDirty()) return;
    if (!batchDraftIsDirty()) {
      loadBatchRow(target);
      return;
    }
    setConfirmRequest({
      title: 'Save the current Hop?',
      message: 'You have unsaved changes in the batch editor. Save them to the batch before editing another Hop?',
      confirmLabel: 'Save Hop to Batch',
      confirmClass: 'primary',
      discardLabel: 'Discard changes',
      onConfirm: async () => {
        const staged = await stageCurrentBatchHop();
        if (staged) loadBatchRow(target);
      },
      onDiscard: () => loadBatchRow(target)
    });
  }

  function requestNewBatchDraft() {
    if (!batchDraftIsDirty()) {
      resetBatchDraft();
      return;
    }
    setConfirmRequest({
      title: 'Save the current Hop?',
      message: 'Save these changes to the batch before starting another Hop?',
      confirmLabel: 'Save Hop to Batch',
      confirmClass: 'primary',
      discardLabel: 'Discard changes',
      onConfirm: async () => {
        const staged = await stageCurrentBatchHop();
        if (staged) resetBatchDraft();
      },
      onDiscard: resetBatchDraft
    });
  }

  function requestDeleteBatchRow(stageId) {
    const row = batchRows.find(item => item.stageId === stageId);
    if (!row) return;
    setConfirmRequest({
      title: 'Delete staged Hop?',
      message: `Remove ${row.trip?.label || 'this Hop'} from the batch?`,
      confirmLabel: 'Delete staged Hop',
      onConfirm: async () => {
        const nextRows = batchRows.filter(item => item.stageId !== stageId);
        setBatchRows(nextRows);
        if (batchEditingStageId === stageId) resetBatchDraft();
      }
    });
  }

  async function commitBatchRows(rowsToCommit = batchRows) {
    const rows = sortBatchRows(rowsToCommit);
    if (!rows.length) {
      setFormError('Add at least one Hop to the batch before saving.');
      return false;
    }
    if (busy) return false;
    setBusy(true);
    try {
      const currentTrips = tripsRef.current || trips;
      const currentLocations = locationsRef.current || locations;
      const nextLocations = mergeLocationsById(currentLocations, rows.flatMap(row => row.addedLocations || []));
      const stagedTrips = rows.map(row => row.trip);
      stagedTrips.forEach(trip => validateTripLocationReferences(trip, nextLocations));
      const nextTrips = insertChronologically([...currentTrips, ...stagedTrips]);
      tripsRef.current = nextTrips;
      locationsRef.current = nextLocations;
      setTrips(nextTrips);
      if (nextLocations !== currentLocations) setLocations(nextLocations);
      const items = rows.map(row => ({
        action: 'add',
        tripId: row.trip.id,
        label: row.trip.label || row.trip.toLocationName || row.trip.id,
        message: `Add Hop: ${row.trip.label || row.trip.toLocationName || row.trip.id} (${row.trip.id})`
      }));
      initialDraftSignatureRef.current = draftSignature(draft);
      closeModal(true);
      onTripSaved({ action: 'batch-add', tripIds: stagedTrips.map(trip => trip.id), shouldAutoPlay: false });
      saveDataInBackground(nextTrips, nextLocations, `Batch Add Hops: ${rows.length} Hops`, items);
      return true;
    } catch (error) {
      setFormError(error?.message || String(error));
      return false;
    } finally {
      setBusy(false);
    }
  }

  function requestSaveBatch() {
    if (!batchDraftIsDirty()) {
      commitBatchRows(batchRows);
      return;
    }
    setConfirmRequest({
      title: 'Save the current Hop?',
      message: 'The Hop in the editor has changes that are not staged. Save it to the batch before saving all Hops?',
      confirmLabel: 'Save Hop and Batch',
      confirmClass: 'primary',
      discardLabel: batchRows.length ? 'Discard current changes' : null,
      onConfirm: async () => {
        const staged = await stageCurrentBatchHop();
        if (staged) await commitBatchRows(staged.rows);
      },
      onDiscard: batchRows.length ? () => commitBatchRows(batchRows) : null
    });
  }

  async function saveTripFromModal() {
    if (busy) return;
    setBusy(true);
    try {
      validateHopDraftForSave(draft);
      const resolvedRouteReview = await ensureDraftRoutesForSave();
      const currentTrips = tripsRef.current || trips;
      const currentLocations = locationsRef.current || locations;
      const currentScroll = studioListRef.current?.scrollTop ?? null;
      const existingTrip = editingId ? currentTrips.find(item => item.id === editingId) : null;
      const { trip, nextLocations } = normalizeTrip(draft, currentTrips, currentLocations, homeBases, normalizedHoppers);
      const nextLocationMap = Object.fromEntries((nextLocations || []).map(location => [location.id, location]));
      const persistedSurfaceLegs = flattenLegs([trip], nextLocationMap, homeBases)
        .map(entry => entry.leg)
        .filter(leg => isSurfaceTravelMode(leg.mode));
      const persistedReview = persistedSurfaceLegs.length
        ? createRouteReviewSnapshot(resolvedRouteReview, routeReviewSignature(persistedSurfaceLegs))
        : null;
      const normalizedTrip = normalizeTripForV61({ ...trip, routeReview: persistedReview }, homeBases);
      const updatedTrips = editingId
        ? currentTrips.map(item => item.id === editingId ? { ...item, ...normalizedTrip, id: editingId } : item)
        : [...currentTrips, normalizedTrip];
      const nextTrips = insertChronologically(updatedTrips);
      const actionLabel = editingId ? 'Edit Hop' : 'Add Hop';
      const message = `${actionLabel}: ${normalizedTrip.label || normalizedTrip.toLocationName || normalizedTrip.id} (${normalizedTrip.id})`;
      const changeKind = editingId ? classifyTripEdit(existingTrip, normalizedTrip) : 'add';
      const shouldAutoPlay = !editingId || changeKind === 'route' || changeKind === 'date';

      if (cloudMode) {
        if (editingId) throw new Error('Editing existing cloud trips is not enabled in Work Package 3.');
        if (!cloudTripCreateEnabled) throw new Error('Cloud Add Hop saving is disabled for this deployment.');
        if (!mapId) throw new Error('Your private map is still loading. Close Add Hop and try again.');
        if (typeof onCloudCreateTrip !== 'function') throw new Error('The cloud trip repository is unavailable.');

        const saved = await onCloudCreateTrip({
          trip: normalizedTrip,
          locations: nextLocations
        });
        initialDraftSignatureRef.current = draftSignature(draft);
        closeModal(true);
        onTripSaved({
          tripId: saved?.tripId || saved?.id || normalizedTrip.id,
          action: 'add',
          label: normalizedTrip.label,
          changeKind: 'add',
          shouldAutoPlay: false
        });
        return;
      }

      if (currentScroll != null) restoreScrollRef.current = currentScroll;
      validateTripLocationReferences(normalizedTrip, nextLocations);
      tripsRef.current = nextTrips;
      locationsRef.current = nextLocations;
      setTrips(nextTrips);
      if (nextLocations !== currentLocations) setLocations(nextLocations);
      initialDraftSignatureRef.current = draftSignature(draft);
      closeModal(true);
      const savedPlaybackRequest = {
        tripId: normalizedTrip.id,
        action: editingId ? 'edit' : 'add',
        label: normalizedTrip.label,
        changeKind,
        shouldAutoPlay
      };
      if (shouldAutoPlay && tripNeedsDetailedVesselRouting(normalizedTrip, nextLocations)) {
        prepareTripRoutesForPlayback(normalizedTrip, nextLocations)
          .then(() => onTripSaved(savedPlaybackRequest))
          .catch(error => {
            console.warn('[GlobeHoppers] Saved Hop will not auto-play because its detailed route could not be prepared.', error);
            window.dispatchEvent(new CustomEvent('globehoppers-route-preparation-failed', {
              detail: { tripId: normalizedTrip.id, message: error?.message || String(error) }
            }));
            onTripSaved({ ...savedPlaybackRequest, shouldAutoPlay: false });
          });
      } else {
        onTripSaved(savedPlaybackRequest);
      }
      saveDataInBackground(nextTrips, nextLocations, message, {
        action: editingId ? 'edit' : 'add',
        tripId: normalizedTrip.id,
        label: normalizedTrip.label || normalizedTrip.toLocationName || normalizedTrip.id
      });
    } catch (err) {
      setFormError(err.message || String(err));
    } finally {
      setBusy(false);
    }
  }

  async function deleteTripFromModal() {
    if (!editingId) return;
    const label = draft.label || draft.toLocationText || editingId;
    setConfirmRequest({
      title: 'Delete hop?',
      message: `Delete ${label}? This cannot be undone.`,
      confirmLabel: 'Delete hop',
      onConfirm: async () => {
        if (busy) return;
        setBusy(true);
        try {
          const currentTrips = tripsRef.current || trips;
          const currentLocations = locationsRef.current || locations;
          const currentScroll = studioListRef.current?.scrollTop ?? null;
          const nextTrips = insertChronologically(currentTrips.filter(t => t.id !== editingId));
          if (currentScroll != null) restoreScrollRef.current = currentScroll;
          tripsRef.current = nextTrips;
          setTrips(nextTrips);
          initialDraftSignatureRef.current = draftSignature(draft);
          closeModal(true);
          saveDataInBackground(nextTrips, currentLocations, `Delete trip: ${label} (${editingId})`, { action: 'delete', tripId: editingId, label });
        } catch (err) {
          setFormError(err.message || String(err));
        } finally {
          setBusy(false);
        }
      }
    });
  }

  function del(id) {
    const trip = trips.find(t => t.id === id);
    const label = trip?.label || trip?.toLocationName || trip?.toLocationId || 'this hop';
    setConfirmRequest({
      title: 'Delete hop?',
      message: `Delete ${label}? This cannot be undone.`,
      confirmLabel: 'Delete hop',
      onConfirm: async () => {
        try {
          const currentTrips = tripsRef.current || trips;
          const currentLocations = locationsRef.current || locations;
          const nextTrips = insertChronologically(currentTrips.filter(t => t.id !== id));
          tripsRef.current = nextTrips;
          setTrips(nextTrips);
          saveDataInBackground(nextTrips, currentLocations, `Delete trip: ${label} (${id})`, { action: 'delete', tripId: id, label });
        } catch (err) {
          setFormError(err.message || String(err));
        }
      }
    });
  }
  function download() {
    const blob = new Blob([JSON.stringify(trips, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'trips.json'; a.click(); URL.revokeObjectURL(url);
  }
  function saveDataInBackground(nextTrips = trips, nextLocations = locations, message = 'Update travel history from GlobeHoppers', item = {}) {
    const queuedAt = Date.now();
    const queue = repoSaveQueue;
    const incomingItems = (Array.isArray(item) ? item : [item])
      .map(entry => normalizeRepoSaveItem(entry, entry?.message || message))
      .filter(Boolean);
    const previousItems = Array.isArray(queue.pending?.items) ? queue.pending.items : [];
    queue.pending = {
      trips: nextTrips,
      locations: nextLocations,
      message,
      queuedAt,
      items: [...previousItems, ...incomingItems]
    };

    if (queue.timer) clearTimeout(queue.timer);

    onRepoSaveStatus(repoSaveStatusPayload(queue, {
      state: 'queued',
      label: 'Repository save queued',
      detail: repoSaveBatchDetail(queue.pending, queue.saving),
      startedAt: queuedAt,
      completedAt: null,
      error: null
    }));

    if (queue.saving) return;

    queue.timer = setTimeout(() => {
      queue.timer = null;
      processRepoSaveQueue();
    }, 3000);
  }

  function schedulePendingRepoSave(delayMs = 3000) {
    const queue = repoSaveQueue;
    if (!queue.pending || queue.saving) return;
    if (queue.timer) clearTimeout(queue.timer);
    queue.timer = setTimeout(() => {
      queue.timer = null;
      processRepoSaveQueue();
    }, delayMs);
  }

  async function processRepoSaveQueue() {
    const queue = repoSaveQueue;
    if (queue.saving) return;
    const job = queue.pending;
    if (!job) return;

    queue.pending = null;
    queue.current = job;
    queue.saving = true;
    const startedAt = Date.now();
    const commitMessage = repoSaveCommitMessage(job);

    onRepoSaveStatus(repoSaveStatusPayload(queue, {
      state: 'saving',
      label: 'Saving to GitHub…',
      detail: repoSaveBatchDetail(job, false),
      startedAt,
      completedAt: null,
      error: null
    }));

    let lockOwner = null;
    try {
      lockOwner = await acquireRepoSaveLock((status) => onRepoSaveStatus(repoSaveStatusPayload(queue, status)));
      const { trips: repairedTrips, locations: repairedLocations, repairedIds } = await repairMissingLocationsForTrips(job.trips, job.locations);
      if (repairedIds.length) {
        locationsRef.current = repairedLocations;
        setLocations(repairedLocations);
        onRepoSaveStatus(repoSaveStatusPayload(queue, {
          state: 'saving',
          label: 'Repairing missing locations…',
          detail: `${repoSaveBatchDetail(job, false)} • repaired ${repairedIds.join(', ')}`,
          startedAt,
          completedAt: null,
          error: null
        }));
      }

      await commitData(repairedTrips, repairedLocations, commitMessage);
      queue.completed = { ...job, completedAt: Date.now(), startedAt };
      onRepoSaveStatus(repoSaveStatusPayload(queue, {
        state: 'saved',
        label: 'Saved to GitHub',
        detail: repoSaveCompletedDetail(job),
        startedAt,
        completedAt: queue.completed.completedAt,
        error: null
      }));
      await wait(REPO_SAVE_COOLDOWN_MS);
    } catch (err) {
      const errorMessage = err?.message || String(err);
      queue.completed = { ...job, completedAt: Date.now(), startedAt, error: errorMessage };
      onRepoSaveStatus(repoSaveStatusPayload(queue, {
        state: 'error',
        label: 'Repository save failed',
        detail: repoSaveCompletedDetail(job),
        startedAt,
        completedAt: queue.completed.completedAt,
        error: errorMessage
      }));
      window.dispatchEvent(new CustomEvent('globehoppers-repository-error', {
        detail: { message: errorMessage, items: job.items || [] }
      }));
    } finally {
      if (lockOwner) clearRepoSaveLock(lockOwner);
      queue.saving = false;
      queue.current = null;
      if (queue.pending) {
        onRepoSaveStatus(repoSaveStatusPayload(queue, {
          state: 'queued',
          label: 'Repository save queued',
          detail: repoSaveBatchDetail(queue.pending, false),
          startedAt: queue.pending.queuedAt || Date.now(),
          completedAt: null,
          error: null
        }));
        schedulePendingRepoSave(3000);
      } else if (queue.completed) {
        onRepoSaveStatus(repoSaveStatusPayload(queue, {
          state: queue.completed.error ? 'error' : 'saved',
          label: queue.completed.error ? 'Repository save failed' : 'Saved to GitHub',
          detail: repoSaveCompletedDetail(queue.completed),
          startedAt: queue.completed.startedAt || startedAt,
          completedAt: queue.completed.completedAt || Date.now(),
          error: queue.completed.error || null
        }));
      }
    }
  }
  function normalizeRepoSaveItem(item = {}, fallbackMessage = '') {
    if (!item && !fallbackMessage) return null;
    const action = item.action || actionFromRepoSaveMessage(fallbackMessage);
    const label = item.label || labelFromRepoSaveMessage(fallbackMessage);
    const tripId = item.tripId || '';
    return {
      action,
      label,
      tripId,
      message: fallbackMessage,
      queuedAt: Date.now()
    };
  }

  function actionFromRepoSaveMessage(message = '') {
    if (/^delete/i.test(message)) return 'delete';
    if (/^edit/i.test(message)) return 'edit';
    if (/^add/i.test(message)) return 'add';
    return 'update';
  }

  function labelFromRepoSaveMessage(message = '') {
    return String(message || '').replace(/^(Add Hop|Add trip|Edit Hop|Delete trip):\s*/i, '').replace(/\s*\([^)]*\)\s*$/, '') || 'Travel history';
  }

  function repoSaveBatchDetail(job = {}, waitingForCurrent = false) {
    const items = Array.isArray(job.items) ? job.items : [];
    if (!items.length) return waitingForCurrent ? 'Waiting for current GitHub save to finish' : 'Saving in about 3 seconds';
    const countText = items.length === 1 ? '1 pending change' : `${items.length} pending changes`;
    const actionText = items.map(formatRepoSaveItem).join(' • ');
    return `${countText}: ${actionText}${waitingForCurrent ? ' • waiting for current GitHub save to finish' : ' • saving in about 3 seconds'}`;
  }

  function repoSaveCommitMessage(job = {}) {
    const items = Array.isArray(job.items) ? job.items : [];
    if (!items.length) return job.message || 'Update travel history from GlobeHoppers';
    if (items.length === 1) return items[0].message || job.message || 'Update travel history from GlobeHoppers';
    return `Update travel history from GlobeHoppers (${items.length} changes)`;
  }

  function formatRepoSaveItem(item = {}) {
    const verb = item.action === 'delete' ? 'Delete' : item.action === 'edit' ? 'Edit' : item.action === 'add' ? 'Add' : 'Update';
    const id = item.tripId ? ` [${item.tripId}]` : '';
    return `${verb} ${item.label || 'Hop'}${id}`;
  }

  function repoSaveStatusPayload(queue = repoSaveQueue, base = {}) {
    const pendingItems = Array.isArray(queue.pending?.items) ? queue.pending.items : [];
    const currentItems = Array.isArray(queue.current?.items) ? queue.current.items : [];
    const completedItems = Array.isArray(queue.completed?.items) ? queue.completed.items : [];
    return {
      ...base,
      items: currentItems.length ? currentItems : pendingItems,
      pendingItems,
      currentItems,
      completedItems,
      completedAt: base.completedAt ?? queue.completed?.completedAt ?? null,
      canRetry: base.canRetry ?? Boolean(queue.completed?.error && !queue.saving && !queue.pending)
    };
  }

  function repoSaveCompletedDetail(job = {}) {
    const items = Array.isArray(job.items) ? job.items : [];
    if (!items.length) return 'Repository is up to date';
    const countText = items.length === 1 ? '1 completed change' : `${items.length} completed changes`;
    return `${countText}: ${items.map(formatRepoSaveItem).join(' • ')}`;
  }



  async function repairMissingLocationsForTrips(nextTrips = trips, nextLocations = locations) {
    let repairedLocations = Array.isArray(nextLocations) ? [...nextLocations] : [];
    const existingIds = new Set(repairedLocations.map(l => l.id));
    const referencedIds = collectReferencedLocationIds(nextTrips);
    const missingIds = referencedIds.filter(id => id && !existingIds.has(id));
    const repairedIds = [];
    if (!missingIds.length) return { trips: nextTrips, locations: repairedLocations, repairedIds };

    let db = cityDbCache;
    if ((!Array.isArray(db) || !db.length) && (cityDbLoaded || cityDb.length)) db = cityDb;
    if (!Array.isArray(db) || !db.length) db = await loadCityDatabase();

    for (const id of missingIds) {
      const city = findCityByGeneratedLocationId(db, id);
      if (!city) continue;
      const loc = locationFromCity(city, id);
      if (loc && !existingIds.has(loc.id)) {
        repairedLocations.push(loc);
        existingIds.add(loc.id);
        repairedIds.push(loc.id);
      }
    }

    const unresolved = missingIds.filter(id => !existingIds.has(id));
    if (unresolved.length) {
      throw new Error(`Some trips reference locations that are not present in locations.json and could not be auto-repaired: ${unresolved.join(', ')}. Delete or edit those trips, or add the missing locations before saving.`);
    }
    return { trips: nextTrips, locations: repairedLocations, repairedIds };
  }

  function collectReferencedLocationIds(nextTrips = trips) {
    const ids = new Set();
    for (const trip of nextTrips || []) {
      if (Array.isArray(trip?.route) && trip.route.length) {
        trip.route.forEach(r => { if (r?.locationId) ids.add(r.locationId); });
      } else {
        if (trip?.fromLocationId) ids.add(trip.fromLocationId);
        if (trip?.toLocationId) ids.add(trip.toLocationId);
      }
    }
    return Array.from(ids);
  }

  function findCityByGeneratedLocationId(db = [], id) {
    if (!id || !Array.isArray(db)) return null;
    return db.find(city => cityLocationId(city) === id) || null;
  }

  function locationFromCity(city, forcedId = '') {
    if (!city) return null;
    const cc = cityField(city, 'countryCode');
    const country = countryNameFromCode(cc);
    return {
      id: forcedId || cityLocationId(city),
      name: cityField(city, 'name'),
      region: cityField(city, 'region') || '',
      country,
      countryCode: cc || '',
      continent: '',
      lat: Number(cityField(city, 'lat', 0)) || 0,
      lon: Number(cityField(city, 'lon', 0)) || 0,
      geonameId: Number(cityField(city, 'id')) || null,
      population: Number(cityField(city, 'population', 0)) || 0,
      timezone: cityField(city, 'timezone') || ''
    };
  }

  function validateTripLocationReferences(trip, nextLocations) {
    const ids = new Set((nextLocations || []).map(l => l.id));
    const routeIds = Array.isArray(trip?.route) && trip.route.length
      ? trip.route.map(r => r.locationId).filter(Boolean)
      : [trip?.fromLocationId, trip?.toLocationId].filter(Boolean);
    const missing = routeIds.filter(id => !ids.has(id));
    if (missing.length) {
      throw new Error(`Saved Hop has route locations that are not present in locations.json: ${Array.from(new Set(missing)).join(', ')}. Repository save was stopped so trips.json cannot reference missing locations.`);
    }
  }

  function tripNeedsDetailedVesselRouting(trip, nextLocations) {
    const locationsById = Object.fromEntries((nextLocations || []).map(location => [location.id, location]));
    return flattenLegs([trip], locationsById, homeBases || [])
      .some(entry => ['drive', 'car', 'train', 'boat'].includes(entry?.leg?.mode));
  }

  async function prepareTripRoutesForPlayback(trip, nextLocations) {
    const locationsById = Object.fromEntries((nextLocations || []).map(location => [location.id, location]));
    const entries = flattenLegs([trip], locationsById, homeBases || [])
      .filter(entry => ['drive', 'car', 'train', 'boat'].includes(entry?.leg?.mode));
    if (!entries.length) return;
    const results = await Promise.all(entries.map(entry => routeLegInWorker(entry.leg, { reason: 'saved Hop playback' })));
    if (results.some(geometry => !Array.isArray(geometry) || geometry.length < 2)) {
      throw new Error('One or more detailed vessel routes could not be generated.');
    }
  }

  async function prepareChangedVesselRoutes(nextTrips, nextLocations) {
    const locationsById = Object.fromEntries((nextLocations || []).map(location => [location.id, location]));
    const entries = flattenLegs(nextTrips || [], locationsById, homeBases || []);
    const jobs = entries.filter(entry => {
      const leg = entry?.leg;
      if (!leg || !['drive', 'car', 'train', 'boat'].includes(leg.mode)) return false;
      const old = routeDetailsRef.current?.routes?.[routeDetailKeyForEntry(entry)] || routeDetailsRef.current?.routes?.[legacyRouteDetailKeyForEntry(entry)];
      const matches = String(old?.fromLocationId || '') === String(leg?.from?.id || '')
        && String(old?.toLocationId || '') === String(leg?.to?.id || '')
        && String(old?.mode || '') === String(leg?.mode || '')
        && (!old?.legId || String(old.legId) === String(entry?.legId || leg?.legId || leg?.id || ''))
        && Math.abs(Number(old?.coordinates?.from?.[0]) - Number(leg?.from?.lon)) <= 0.0002
        && Math.abs(Number(old?.coordinates?.from?.[1]) - Number(leg?.from?.lat)) <= 0.0002
        && Math.abs(Number(old?.coordinates?.to?.[0]) - Number(leg?.to?.lon)) <= 0.0002
        && Math.abs(Number(old?.coordinates?.to?.[1]) - Number(leg?.to?.lat)) <= 0.0002
        && Array.isArray(old?.geometry)
        && old.geometry.length > 1;
      return !matches;
    });
    if (!jobs.length) return;

    let cursor = 0;
    const concurrency = Math.min(2, jobs.length);
    await Promise.all(Array.from({ length: concurrency }, async () => {
      while (cursor < jobs.length) {
        const entry = jobs[cursor++];
        try {
          await routeLegInWorker(entry.leg, { reason: 'repository route save' });
        } catch (error) {
          console.warn('[GlobeHoppers] Background route preparation failed; the trip will still save.', entry?.trip?.id, error);
        }
      }
    }));
  }

  async function commitData(nextTrips = trips, nextLocations = locations, message = 'Update travel history from GlobeHoppers') {
    if (!token || !repo) throw new Error('Enter a repo and fine-grained GitHub token in Repository Settings first.');
    for (const trip of nextTrips || []) validateTripLocationReferences(trip, nextLocations);
    await prepareChangedVesselRoutes(nextTrips, nextLocations);
    const nextRouteDetails = buildRouteDetailsPayload(nextTrips, nextLocations, homeBases, routeDetailsRef.current);
    const files = [
      { path: 'journeylines/src/data/locations.json', data: nextLocations },
      { path: 'journeylines/src/data/trips.json', data: nextTrips },
      { path: 'journeylines/src/data/routeDetails.json', data: nextRouteDetails }
    ];
    try { localStorage.setItem('journeylines.routeDetails', JSON.stringify(nextRouteDetails)); } catch {}
    routeDetailsRef.current = nextRouteDetails;
    window.dispatchEvent(new CustomEvent('globehoppers-route-details-updated', { detail: nextRouteDetails }));
    try {
      await commitFilesAtomically(files, message);
    } catch (err) {
      if (!isRetryableGitConflict(err)) throw err;
      console.warn('[GlobeHoppers] Atomic Git save failed after retries. Falling back to Contents API sequential save.', err);
      await commitFilesWithContentsApi(files, `${message} (fallback sync)`);
    }
  }

  function isRetryableGitConflict(err) {
    const text = err?.message || String(err || '');
    return /fast.?forward|409|422|conflict|reference|retrying/i.test(text);
  }

  async function commitFilesAtomically(files, message) {
    const headers = githubHeaders(token);
    let lastError = null;
    for (let attempt = 1; attempt <= 5; attempt++) {
      try {
        const refRes = await fetch(`https://api.github.com/repos/${repo}/git/ref/heads/main`, { headers });
        if (!refRes.ok) throw new Error(await refRes.text());
        const ref = await refRes.json();
        const headSha = ref.object?.sha;
        if (!headSha) throw new Error('Could not read the current main branch SHA.');

        const commitRes = await fetch(`https://api.github.com/repos/${repo}/git/commits/${headSha}`, { headers });
        if (!commitRes.ok) throw new Error(await commitRes.text());
        const headCommit = await commitRes.json();
        const baseTree = headCommit.tree?.sha;
        if (!baseTree) throw new Error('Could not read the current tree SHA.');

        const treeRes = await fetch(`https://api.github.com/repos/${repo}/git/trees`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            base_tree: baseTree,
            tree: files.map(file => ({
              path: file.path,
              mode: '100644',
              type: 'blob',
              content: JSON.stringify(file.data, null, 2) + '\n'
            }))
          })
        });
        if (!treeRes.ok) throw new Error(await treeRes.text());
        const tree = await treeRes.json();

        const newCommitRes = await fetch(`https://api.github.com/repos/${repo}/git/commits`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ message, tree: tree.sha, parents: [headSha] })
        });
        if (!newCommitRes.ok) throw new Error(await newCommitRes.text());
        const newCommit = await newCommitRes.json();

        const updateRefRes = await fetch(`https://api.github.com/repos/${repo}/git/refs/heads/main`, {
          method: 'PATCH',
          headers,
          body: JSON.stringify({ sha: newCommit.sha, force: false })
        });
        if (updateRefRes.ok) return newCommit;

        const text = await updateRefRes.text();
        const retryableConflict = updateRefRes.status === 409 || updateRefRes.status === 422 || /fast.?forward|conflict|reference/i.test(text || '');
        if (!retryableConflict) throw new Error(text);
        lastError = new Error(text || 'GitHub reported a conflict while updating main. Retrying with the latest branch state.');
        await wait(1500 * attempt);
      } catch (err) {
        lastError = err;
        if (attempt < 5) await wait(1500 * attempt);
      }
    }
    throw new Error(`GitHub commit conflict after retrying with a client-side save lock. Refresh GlobeHoppers Studio and try again. Details: ${lastError?.message || lastError}`);
  }

  async function commitFilesWithContentsApi(files, message) {
    for (const file of files) await commitFileWithRetry(file.path, file.data, message);
  }

  async function commitFileWithRetry(path, data, message) {
    let lastError = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const headers = githubHeaders(token);
        const getRes = await fetch(`https://api.github.com/repos/${repo}/contents/${path}?ref=main`, { headers, cache: 'no-store' });
        const existing = getRes.ok ? await getRes.json() : null;
        const body = { message, content: toBase64(JSON.stringify(data, null, 2) + '\n'), branch: 'main' };
        if (existing?.sha) body.sha = existing.sha;
        const putRes = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, { method: 'PUT', headers, body: JSON.stringify(body) });
        if (putRes.ok) return await putRes.json();
        const text = await putRes.text();
        lastError = new Error(text);
        if (putRes.status !== 409) throw lastError;
        await wait(450 * attempt);
      } catch (err) {
        lastError = err;
        if (attempt < 3) await wait(450 * attempt);
      }
    }
    throw lastError || new Error(`Could not commit ${path}.`);
  }

  function moveTrip() {}
  function requestCloseStudio() {
    if (modal) {
      closeModal();
      return;
    }
    if (closing) return;
    setClosing(true);
    window.setTimeout(() => window.dispatchEvent(new CustomEvent('globehoppers-close-studio')), 420);
  }

  return <section className={`studio-shell ${closing ? 'is-closing' : ''} ${modalOnly ? 'studio-shell--modal-only' : ''}`} onWheelCapture={(e) => e.stopPropagation()} onPointerDownCapture={(e) => e.stopPropagation()}>
    <aside className={`studio-panel glass studio-panel--${viewType}`}>
      <div className="studio-header drawer-header-unified">
        <p className="eyebrow">GlobeHoppers Studio</p>
        <StudioViewTypeSelector value={viewType} onChange={onViewTypeChange} />
        <button className="studio-close drawer-close-button" onClick={requestCloseStudio}>Close</button>
        <h2>GlobeHopper Timeline</h2>
      </div>

      <div className="studio-actions-main">
        <button className="primary" onClick={openAdd}>Add {addTripNoun}</button>
      </div>

      <div ref={studioListRef} className={`studio-trip-list studio-trip-list--${viewType}`} onWheel={(e) => e.stopPropagation()} onScroll={(e) => onScrollStore?.(e.currentTarget.scrollTop)}>
        {viewType === 'card' ? groupTripsByYear(sortedTrips).map(group => <section className="timeline-year-section studio-year-section" key={group.year}>
          <h3>{group.year}</h3>
          <div className="timeline-card-grid studio-card-grid">
            {group.rows.map(trip => <StudioTripRow key={trip.id} trip={trip} viewType={viewType} reorderMode={false} dragId={dragId} setDragId={setDragId} dropId={dropId} setDropId={setDropId} moveTrip={moveTrip} locById={locById} onEdit={openEdit} onDelete={del} hopperData={normalizedHoppers} activeTripId={activeTripId} onPlayTrip={onPlayTrip} />)}
          </div>
        </section>) : sortedTrips.map(trip => <StudioTripRow key={trip.id} trip={trip} viewType={viewType} reorderMode={false} dragId={dragId} setDragId={setDragId} dropId={dropId} setDropId={setDropId} moveTrip={moveTrip} locById={locById} onEdit={openEdit} onDelete={del} hopperData={normalizedHoppers} activeTripId={activeTripId} onPlayTrip={onPlayTrip} />)}
      </div>

      <details className="repo-settings" open={settingsOpen} onToggle={e => setSettingsOpen(e.currentTarget.open)}>
        <summary>Repository Settings</summary>
        <div className="repo-grid">
          <button onClick={download}>Download trips.json</button>
          <input value={repo} onChange={e => saveRepo(e.target.value)} placeholder="owner/repo" />
          <input value={token} onChange={e => saveLocalToken(e.target.value)} type="password" placeholder="GitHub fine-grained token" />
          <button onClick={() => commitData().then(() => alert('Travel history committed.')).catch(err => alert(err.message))}>Commit current data</button>
          <button onClick={() => { localStorage.removeItem('journeylines.githubToken'); setToken(''); }}>Clear token</button>
        </div>
      </details>
    </aside>

    {confirmRequest && <ThemedConfirmPopup
      request={confirmRequest}
      busy={busy}
      onCancel={() => setConfirmRequest(null)}
      onDiscard={async () => { const action = confirmRequest.onDiscard; setConfirmRequest(null); await action?.(); }}
      onConfirm={async () => { const action = confirmRequest.onConfirm; setConfirmRequest(null); await action?.(); }}
    />}

    {modal && <TripModal
      mode={modal}
      closing={modalClosing}
      draft={draft}
      setDraft={setDraft}
      busy={busy}
      locs={locs}
      locById={locById}
      onClose={closeModal}
      onSave={modal === 'batch' ? stageCurrentBatchHop : saveTripFromModal}
      onOpenBatch={openBatchAdd}
      onSaveBatch={requestSaveBatch}
      onAddAnotherBatchHop={requestNewBatchDraft}
      onEditBatchHop={requestBatchEdit}
      onDeleteBatchHop={requestDeleteBatchRow}
      batchRows={batchRows}
      batchEditingStageId={batchEditingStageId}
      onTravelerToggle={updateTraveler}
      onChooseDestination={chooseDestination}
      onChooseFrom={chooseFrom}
      onChooseExtraLeg={chooseExtraLeg}
      onSetExtraLeg={setExtraLeg}
      onAddLeg={addLeg}
      onRemoveLeg={removeLeg}
      onSetReturnMode={setReturnMode}
      onSetPreviewLegMode={setPreviewLegMode}
      addTripNoun={addTripNoun} normalizedHoppers={normalizedHoppers} formError={formError} setFormError={setFormError}
      onDelete={modal === 'edit' ? deleteTripFromModal : null}
      homeBases={homeBases}
      cityDb={cityDb}
      cityDbLoaded={cityDbLoaded}
      cityDbLoading={cityDbLoading}
      citySearchResults={citySearchResults}
      citySearchLoading={citySearchLoading}
      onRequestCitySuggestions={requestCitySuggestions}
      routeReview={routeReview}
      routeReviewLegs={draftSurfaceReviewLegs}
      routeReviewSignature={currentRouteReviewSignature}
      onReviewRoutes={reviewDraftRoutes}
    />}
  </section>;
}



function draftSignature(value = {}) {
  return JSON.stringify(canonicalizeDraftValue(value));
}

function canonicalizeDraftValue(value) {
  if (Array.isArray(value)) return value.map(canonicalizeDraftValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .filter(key => !key.startsWith('_'))
      .sort()
      .map(key => [key, canonicalizeDraftValue(value[key])])
  );
}

function classifyTripEdit(previous = {}, next = {}) {
  const previousRoute = routeEditSignature(previous);
  const nextRoute = routeEditSignature(next);
  if (previousRoute !== nextRoute) return 'route';
  const previousDate = [previous.year, previous.month, previous.day, previous.endYear, previous.endMonth, previous.endDay].join('|');
  const nextDate = [next.year, next.month, next.day, next.endYear, next.endMonth, next.endDay].join('|');
  if (previousDate !== nextDate) return 'date';
  return 'metadata';
}

function routeEditSignature(trip = {}) {
  return JSON.stringify({
    fromLocationId: trip.fromLocationId || '',
    toLocationId: trip.toLocationId || '',
    mode: trip.mode || '',
    roundTrip: Boolean(trip.roundTrip),
    returnMode: trip.returnMode || '',
    route: (trip.route || []).map(point => ({
      locationId: point?.locationId || '',
      legId: point?.legId || '',
      modeFromPrevious: point?.modeFromPrevious || ''
    }))
  });
}

function ensureCustomCoordinateLocation(locations = [], custom = {}, fieldLabel = 'Location') {
  const name = String(custom.name || '').trim();
  const lat = Number(custom.lat);
  const lon = Number(custom.lon);
  if (!name) throw new Error(`${fieldLabel} needs a name.`);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw new Error(`${fieldLabel} latitude must be between -90 and 90.`);
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) throw new Error(`${fieldLabel} longitude must be between -180 and 180.`);

  const existing = (locations || []).find(location =>
    normalizeSearchText(location?.name) === normalizeSearchText(name)
    && Math.abs(Number(location?.lat) - lat) <= 0.00005
    && Math.abs(Number(location?.lon) - lon) <= 0.00005
  );
  if (existing) return { id: existing.id, locations };

  const location = {
    id: createStableId('location'),
    name,
    region: '',
    country: '',
    countryCode: '',
    continent: '',
    lat,
    lon,
    source: 'manual-coordinates'
  };
  return { id: location.id, locations: [...locations, location] };
}

function validateHopDraftForSave(draft = {}) {
  const missing = [];
  if (!draft.year) missing.push(['Year', 'Please choose a year']);
  if (!draft.month) missing.push(['Month', 'Please choose a month']);
  if (!draft.travelers?.length && !(draft.guestHoppers || []).length) missing.push(['Hoppers', 'Please add at least one Hopper or Guest Hopper']);
  if (!draft.toCustomEnabled && !draft.toLocationId && !draft.toCity && !draft.toLocationText?.trim()) missing.push(['Destination', 'Please choose a destination']);
  if (draft.toCustomEnabled && !String(draft.toCustomName || '').trim()) missing.push(['Custom destination name', 'Please name the custom destination']);
  if (!draft.fromLocationId && !draft.fromCity && !draft.fromLocationText?.trim()) missing.push(['Start location', 'Please choose a start location']);
  if (missing.length) {
    throw new Error(`Missing Required Fields:\n${missing.map(([field, action]) => `• ${field} - ${action}`).join('\n')}`);
  }
  if (!validDateParts(draft.year, draft.month, draft.day)) {
    throw new Error('The selected start date is invalid for that month and year.');
  }
  const hasAnyEndDate = Boolean(draft.endYear || draft.endMonth || draft.endDay);
  if (hasAnyEndDate && !validDateParts(draft.endYear, draft.endMonth, draft.endDay)) {
    throw new Error('Choose a complete and valid end date.');
  }
}


function validateAutomaticRouteCheckForSave(legs = [], signature = '', review = {}) {
  if (!legs.length) return;
  const incomplete = legs.find(leg => !reviewLegHasValidEndpoints(leg));
  if (incomplete) throw new Error('Choose valid endpoints for every road, rail, and boat leg before saving.');
  if (review.signature !== signature || review.status !== 'ready') {
    throw new Error('GlobeHoppers could not finish checking the road, rail, and water routes. Try Recalculate and save again.');
  }
  if ((review.results || []).length !== legs.length) {
    throw new Error('Automatic routing is incomplete. Recalculate all surface legs before saving.');
  }
  const failed = (review.results || []).find(result => (result?.errors || []).length || (!result?.geometry?.length && !result?.cachedRoute));
  if (failed) throw new Error('One or more routes could not be generated safely. Correct the endpoints or recalculate before saving.');
}

function buildDraftReviewLegs(draft = {}, locById = {}, locs = [], homeBases = []) {
  const defaultFromId = activeHomeBaseId(homeBases, draft);
  const start = previewDraftLocation(draft.fromLocationId || defaultFromId, draft.fromCity, draft.fromLocationText, locById, locs)
    || previewDraftLocation(defaultFromId, null, '', locById, locs);
  const destination = draft.toCustomEnabled
    ? previewCustomLocation(draft)
    : previewDraftLocation(draft.toLocationId, draft.toCity, draft.toLocationText, locById, locs);
  if (!start || !destination) return [];
  const legs = [];
  let previous = start;
  if (destination) {
    legs.push({
      id: draft.mainLegId || 'main-leg',
      legId: draft.mainLegId || 'main-leg',
      mode: draft.mode || 'plane',
      from: previous,
      to: destination
    });
    previous = destination;
  }
  for (const extra of draft.extraLegs || []) {
    if (!extra?.locationId && !extra?.city && !String(extra?.locationText || '').trim()) continue;
    const next = previewDraftLocation(extra.locationId, extra.city, extra.locationText, locById, locs);
    legs.push({
      id: extra.legId || extra.draftId || `extra-${legs.length}`,
      legId: extra.legId || extra.draftId || `extra-${legs.length}`,
      mode: extra.modeFromPrevious || draft.mode || 'plane',
      from: previous,
      to: next
    });
    previous = next;
  }
  if (draft.roundTrip && start && previous && endpointReviewIdentity(start) !== endpointReviewIdentity(previous)) {
    legs.push({
      id: draft.returnLegId || 'return-leg',
      legId: draft.returnLegId || 'return-leg',
      mode: draft.returnMode || draft.mode || 'plane',
      from: previous,
      to: start
    });
  }
  return legs;
}

function previewDraftLocation(locationId, city, text, locById = {}, locs = []) {
  const saved = locationId ? locById[locationId] : findLocationByText(locs, text);
  if (saved) return reviewEndpointFromLocation(saved);
  if (city) {
    const option = citySuggestionToOption(city);
    return reviewEndpointFromLocation({ ...option, id: cityLocationId(city, text) });
  }
  if (String(text || '').trim()) return { id: `unresolved-${slug(text)}`, name: String(text).trim(), lon: NaN, lat: NaN };
  return null;
}

function previewCustomLocation(draft = {}) {
  const name = String(draft.toCustomName || 'Custom destination').trim();
  const lat = Number(draft.toCustomLat);
  const lon = Number(draft.toCustomLon);
  return {
    id: `custom-${slug(name)}-${Number.isFinite(lat) ? lat.toFixed(4) : 'lat'}-${Number.isFinite(lon) ? lon.toFixed(4) : 'lon'}`,
    name,
    lat,
    lon
  };
}

function reviewEndpointFromLocation(location = {}) {
  return {
    id: location.id || slug(displayLocation(location) || location.name),
    name: displayLocation(location) || location.name || 'Location',
    lat: Number(location.lat),
    lon: Number(location.lon),
    type: location.type || location.locationType || null
  };
}

function reviewLegHasValidEndpoints(leg = {}) {
  return [leg.from, leg.to].every(endpoint => {
    const lat = Number(endpoint?.lat);
    const lon = Number(endpoint?.lon);
    return Number.isFinite(lat) && Number.isFinite(lon) && lat >= -90 && lat <= 90 && lon >= -180 && lon <= 180;
  });
}

function endpointReviewIdentity(endpoint = {}) {
  const lat = Number(endpoint?.lat);
  const lon = Number(endpoint?.lon);
  return `${endpoint?.id || endpoint?.name || ''}@${Number.isFinite(lon) ? lon.toFixed(5) : 'x'},${Number.isFinite(lat) ? lat.toFixed(5) : 'x'}`;
}

function routeEndpointContextWarnings(leg = {}) {
  const mode = leg.mode;
  const names = `${leg.from?.name || ''} ${leg.to?.name || ''}`.toLowerCase();
  if (mode === 'train' && !/(station|depot|terminal|gare|sants|bahnhof|st\.?\s*pancras|union station)/i.test(names)) {
    return ['This rail leg uses city coordinates. Choose saved station locations for more precise station-to-station routing.'];
  }
  if (mode === 'boat' && !/(port|harbou?r|marina|pier|cruise|ferry|terminal|dock|wharf|quay)/i.test(names)) {
    return ['This water leg uses city coordinates. Choose saved port or marina locations for more precise dock-to-dock routing.'];
  }
  return [];
}

function formatHumanList(items = []) {
  if (items.length <= 1) return items[0] || '';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

function ThemedConfirmPopup({ request, busy, onCancel, onConfirm, onDiscard }) {
  const stopConfirmEvent = (event) => event.stopPropagation();
  const confirmClass = request.confirmClass || 'danger';
  return <div className="studio-confirm-backdrop" role="presentation" onPointerDown={stopConfirmEvent} onClick={onCancel}>
    <div className="studio-confirm-popup glass" role="dialog" aria-modal="true" aria-labelledby="studio-confirm-title" onPointerDown={stopConfirmEvent} onClick={stopConfirmEvent}>
      <p className="eyebrow">Please confirm</p>
      <h3 id="studio-confirm-title">{request.title || 'Confirm action'}</h3>
      <p>{request.message}</p>
      <div className="studio-confirm-actions">
        <button type="button" className="secondary" disabled={busy} onPointerDown={stopConfirmEvent} onClick={onCancel}>Cancel</button>
        {request.discardLabel && request.onDiscard && <button type="button" className="secondary studio-confirm-discard" disabled={busy} onPointerDown={stopConfirmEvent} onClick={onDiscard}>{request.discardLabel}</button>}
        <button type="button" className={confirmClass} disabled={busy} onPointerDown={stopConfirmEvent} onClick={onConfirm}>{busy ? 'Working…' : (request.confirmLabel || 'Confirm')}</button>
      </div>
    </div>
  </div>;
}



function splitStudioBorderColors(colors = [], fallback = '#00e5ff') {
  const list = [...new Set((colors || []).filter(Boolean))];
  return list.length ? list : [fallback];
}

function linearStudioStops(colors = [], direction = '90deg') {
  const list = splitStudioBorderColors(colors);
  if (list.length === 1) return list[0];
  const step = 100 / list.length;
  return `linear-gradient(${direction}, ${list.map((color, index) => `${color} ${Math.max(0, index * step)}% ${Math.min(100, (index + 1) * step)}%`).join(', ')})`;
}

function studioBorderSegmentForSide(colors = [], side, fallback = '#00e5ff') {
  const list = splitStudioBorderColors(colors, fallback);
  if (list.length === 1) return list[0];
  if (list.length === 2) {
    if (side === 'left') return list[0];
    if (side === 'right') return list[1];
    return `linear-gradient(90deg, ${list[0]} 0 50%, ${list[1]} 50% 100%)`;
  }
  if (list.length === 3) {
    if (side === 'top') return `linear-gradient(90deg, ${list[0]} 0 50%, ${list[1]} 50% 100%)`;
    if (side === 'right') return list[1];
    if (side === 'bottom') return `linear-gradient(90deg, ${list[2]} 0 50%, ${list[1]} 50% 100%)`;
    return `linear-gradient(180deg, ${list[0]} 0 50%, ${list[2]} 50% 100%)`;
  }
  const topLeft = list[0];
  const topRight = list[1] || topLeft;
  const bottomRight = list[2] || topRight;
  const bottomLeft = list[3] || bottomRight;
  const extra = list.slice(4);
  if (side === 'top') return linearStudioStops([topLeft, ...extra.filter((_, i) => i % 2 === 0), topRight], '90deg');
  if (side === 'right') return linearStudioStops([topRight, ...extra.filter((_, i) => i % 2 === 1), bottomRight], '180deg');
  if (side === 'bottom') return linearStudioStops([bottomLeft, ...extra.filter((_, i) => i % 2 === 0).reverse(), bottomRight], '90deg');
  return linearStudioStops([topLeft, bottomLeft], '180deg');
}

function StudioTimelineRowBorder({ colors = [], fallback = '#00e5ff' }) {
  // Border color math is passed through --trip-border on the row. The element
  // stays intentionally simple so CSS can draw one clean rounded ring.
  return <span className="gh-studio-row-border" aria-hidden="true" />;
}

function StudioTripRow({ trip, viewType, reorderMode, dragId, setDragId, dropId, setDropId, moveTrip, locById, onEdit, onDelete, hopperData, activeTripId, onPlayTrip }) {
  const playFromRow = () => { if (!reorderMode) onPlayTrip?.(trip.id); };
  const visual = resolveTripVisual(trip, hopperData || {});
  const colors = (visual.colors || []).filter(Boolean);
  const borderColors = (visual.squadMemberColors || visual.circleColors || visual.memberColors || visual.colors || [visual.color]).filter(Boolean);
  const isMixed = borderColors.length > 1;
  const accent = tripAccent(trip, hopperData);
  const accent2 = visual.accentColors?.[0] || colors[1] || accent;
  const accent3 = visual.accentColors?.[1] || colors[2] || 'transparent';
  const accent4 = visual.accentColors?.[2] || colors[3] || 'transparent';
  const isCurrent = activeTripId && trip.id === activeTripId;
  const isDragging = reorderMode && dragId === trip.id;
  const isDropTarget = reorderMode && dropId === trip.id && dragId && dragId !== trip.id;
  return <div
    className={`gh-studio-trip-row gh-studio-trip-row--${viewType} ${isMixed ? 'is-mixed' : ''} ${isCurrent ? 'is-active' : ''} ${isDragging ? 'is-dragging' : ''} ${isDropTarget ? 'is-drop-target' : ''}`}
    style={{ '--accent': accent, '--accent-2': accent2, '--accent-3': accent3, '--accent-4': accent4, '--accent-gradient': colorGradient(colors, accent), '--trip-border': segmentedBorderGradient(borderColors, accent) }}
    draggable={reorderMode}
    onClick={playFromRow}
    onContextMenu={(e) => { e.preventDefault(); if (!reorderMode) onEdit(trip); }}
    onDragStart={(e) => { setDragId(trip.id); try { e.dataTransfer.effectAllowed = 'move'; } catch {} }}
    onDragOver={e => { if (!reorderMode) return; e.preventDefault(); setDropId(trip.id); try { e.dataTransfer.dropEffect = 'move'; } catch {} }}
    onDragEnter={() => { if (reorderMode) setDropId(trip.id); }}
    onDragLeave={(e) => { if (e.currentTarget.contains(e.relatedTarget)) return; if (dropId === trip.id) setDropId(null); }}
    onDrop={() => { moveTrip(dragId, trip.id); setDragId(null); setDropId(null); }}
    onDragEnd={() => { setDragId(null); setDropId(null); }}
  >
    <span className="studio-trip-date">{formatTripDate(trip)}</span>
    <span className="studio-trip-main"><strong>{trip.label || trip.toLocationName || trip.toLocationId}</strong><small>{summarizeTrip(trip, locById, hopperData)}</small></span>
    <span className="studio-trip-buttons">
      {reorderMode ? <span className="drag-handle">↕</span> : viewType === 'card' ? null : <><button onClick={(e) => { e.stopPropagation(); onEdit(trip); }}>Edit</button><button onClick={(e) => { e.stopPropagation(); onDelete(trip.id); }}>Delete</button></>}
    </span>
    <StudioTimelineRowBorder colors={borderColors} fallback={accent} />
  </div>;
}

function StudioViewTypeSelector({ value, onChange }) {
  return <div className="view-type-selector" role="group" aria-label="Travel history view type">
    {[['expanded','Expanded'], ['compact','Compact'], ['card','Card']].map(([id, label]) => <button key={id} type="button" className={value === id ? 'is-selected' : ''} onClick={() => onChange?.(id)}>{label}</button>)}
  </div>;
}

function groupTripsByYear(trips = []) {
  const groups = [];
  const byYear = new Map();
  for (const trip of trips) {
    const year = String(trip.year || 'Trips');
    if (!byYear.has(year)) { const group = { year, rows: [] }; byYear.set(year, group); groups.push(group); }
    byYear.get(year).rows.push(trip);
  }
  return groups;
}

function BubbleSelect({ label, value, display, options, open, setOpen, onChoose, required, variant }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    function handlePointerDown(event) {
      if (ref.current && !ref.current.contains(event.target)) setOpen(false);
    }
    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [open, setOpen]);
  return <label ref={ref} className={`bubble-select-field ${variant ? `bubble-select-field--${variant}` : ''}`}>{label}{required && <span className="required-dot">Required</span>}
    <button type="button" className={`bubble-select-button ${!value ? 'needs-choice' : ''}`} onClick={() => setOpen(!open)}>
      {display}<span>▾</span>
    </button>
    {open && <div className={`bubble-select-popover glass ${variant ? `bubble-select-popover--${variant}` : ''}`}>
      {options.map(option => <button key={option.value} type="button" className={String(value) === String(option.value) ? 'is-selected' : ''} onClick={() => { onChoose(option.value); setOpen(false); }}>{option.label}</button>)}
    </div>}
  </label>;
}

function TripModal({mode, closing, draft, setDraft, busy, locs, locById, homeBases, onClose, onSave, onDelete, onTravelerToggle, onChooseDestination, onChooseFrom, onChooseExtraLeg, onSetExtraLeg, onAddLeg, onRemoveLeg, onSetReturnMode, onSetPreviewLegMode, onOpenBatch = () => {}, onSaveBatch = () => {}, onAddAnotherBatchHop = () => {}, onEditBatchHop = () => {}, onDeleteBatchHop = () => {}, batchRows = [], batchEditingStageId = null, addTripNoun = 'Hop', normalizedHoppers, formError, setFormError, cityDb = [], cityDbLoaded = false, cityDbLoading = false, citySearchResults = {}, citySearchLoading = {}, onRequestCitySuggestions = () => {}, routeReview = emptyRouteReview(), routeReviewLegs = [], routeReviewSignature: currentReviewSignature = '', onReviewRoutes = () => {}}) {
  const cityMatchesFor = query => citySearchResults[normalizeSearchText(query)] || [];
  const cityLoadingFor = query => Boolean(citySearchLoading[normalizeSearchText(query)]);
  const destinationMatches = locationSuggestions(locs, draft.toLocationText || '', cityMatchesFor(draft.toLocationText), true, cityLoadingFor(draft.toLocationText));
  const fromMatches = locationSuggestions(locs, draft.fromLocationText || '', cityMatchesFor(draft.fromLocationText), true, cityLoadingFor(draft.fromLocationText));
  const batchMode = mode === 'batch';
  const automaticTitle = automaticHopTitle(draft, locById, locs);
  const title = (draft._titleMode === 'custom' ? String(draft.label || '').trim() : automaticTitle)
    || automaticTitle
    || (mode === 'add' ? `Add ${addTripNoun}` : batchMode ? 'Batch Add Hops' : 'Edit Hop');
  const currentHopSquad = activeDraftSquad(draft, normalizedHoppers || {});
  const currentHopSquadColor = currentHopSquad?.color || null;
  const currentDraftVisual = resolveTripVisual(draft, normalizedHoppers || {});
  const currentVisualColor = currentHopSquadColor || currentDraftVisual?.color || '#00e5ff';
  const currentCircleColors = (currentDraftVisual?.circleColors || currentDraftVisual?.memberColors || currentDraftVisual?.colors || []).filter(Boolean);
  const selectedTravelerCount = (draft.travelers?.length || 0) + ((draft.guestHoppers || []).length || 0);
  const defaultTrailColorMode = 'members';
  const effectiveTrailColorMode = draft.trailColorMode || defaultTrailColorMode;
  const effectiveTrailStyle = draft.trailStyle || 'solid';
  useEffect(() => {
    if (mode !== 'add' && mode !== 'batch') return;
    if (draft._trailStyleTouched) return;
    if (selectedTravelerCount >= 2 && (draft.trailStyle || 'solid') === 'solid') {
      setDraft(d => ({ ...d, trailStyle: 'ribbon', trailColorMode: 'members' }));
    }
  }, [mode, selectedTravelerCount, draft._trailStyleTouched, draft.trailStyle, setDraft]);
  const defaultFromId = activeHomeBaseId(homeBases, draft);
  const defaultFrom = locById[defaultFromId];
  const effectiveStart = locById[draft.fromLocationId] || findLocationByText(locs, draft.fromLocationText) || defaultFrom || (draft.fromLocationText ? { name: draft.fromLocationText } : null);
  const effectiveDestination = draft.toCustomEnabled
    ? {
        id: 'custom-coordinate-preview',
        name: draft.toCustomName || 'Custom destination',
        lat: Number(draft.toCustomLat),
        lon: Number(draft.toCustomLon)
      }
    : locById[draft.toLocationId] || findLocationByText(locs, draft.toLocationText) || (draft.toLocationText ? { name: draft.toLocationText } : null);
  const yearOptions = buildYearOptions(locs, draft.year);
  const dateRangeLabel = formatDateRangeLabel(draft);
  const [dateRangeOpen, setDateRangeOpen] = useState(false);
  const [rangePhase, setRangePhase] = useState('start');
  const [calendarCursor, setCalendarCursor] = useState(() => ({ year: Number(draft.year) || new Date().getFullYear(), month: Number(draft.month) || new Date().getMonth() + 1 }));
  const [yearPickerOpen, setYearPickerOpen] = useState(false);
  const [monthPickerOpen, setMonthPickerOpen] = useState(false);
  const [titleEditorOpen, setTitleEditorOpen] = useState(false);
  const [guestPopupOpen, setGuestPopupOpen] = useState(false);
  const [guestColorOpen, setGuestColorOpen] = useState(false);
  const [guestDraft, setGuestDraft] = useState({ id: '', name: '', colorName: 'gray', color: '#8e99a8' });
  const dateRangeRef = useRef(null);
  const dialogRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const bothHoppersSelected = draft.travelers?.includes('joey') && draft.travelers?.includes('bonnie');

  useEffect(() => {
    if (draft._fromTouched) return;
    const homeId = activeHomeBaseId(homeBases, draft);
    const home = locById[homeId];
    if (!homeId || !home) return;
    const homeText = displayLocation(home);
    if (draft.fromLocationId === homeId && draft.fromLocationText === homeText && !draft.fromCity) return;
    setDraft(current => current._fromTouched ? current : ({ ...current, fromLocationId: homeId, fromLocationText: homeText, fromCity: null, overrideFrom: false }));
  }, [draft.year, draft.month, draft.day, draft._fromTouched, draft.fromLocationId, draft.fromLocationText, homeBases, locById, setDraft]);

  useEffect(() => {
    if (draft._titleMode === 'custom') return;
    if (!automaticTitle || draft.label === automaticTitle) return;
    setDraft(current => current._titleMode === 'custom' ? current : ({ ...current, label: automaticTitle, _titleMode: 'auto' }));
  }, [automaticTitle, draft._titleMode, draft.label, setDraft]);

  useEffect(() => {
    if (!dateRangeOpen) return;
    function handlePointerDown(event) {
      if (dateRangeRef.current && !dateRangeRef.current.contains(event.target) && !event.target.closest?.('.date-range-field')) {
        setDateRangeOpen(false);
      }
    }
    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [dateRangeOpen]);

  useEffect(() => {
    if (!draft.year && !draft.month) return;
    setCalendarCursor({
      year: Number(draft.year) || new Date().getFullYear(),
      month: Number(draft.month) || 1
    });
  }, [draft.year, draft.month]);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusable = () => [...dialog.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
      .filter(element => element.offsetParent !== null);
    const first = focusable()[0];
    window.setTimeout(() => first?.focus(), 0);

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current?.();
        return;
      }
      if (event.key !== 'Tab') return;
      const items = focusable();
      if (!items.length) return;
      const current = items.indexOf(document.activeElement);
      if (event.shiftKey && current <= 0) {
        event.preventDefault();
        items[items.length - 1].focus();
      } else if (!event.shiftKey && current === items.length - 1) {
        event.preventDefault();
        items[0].focus();
      }
    }
    dialog.addEventListener('keydown', handleKeyDown);
    return () => dialog.removeEventListener('keydown', handleKeyDown);
  }, [mode, draft.id]);

  function openGuestPopup() {
    setGuestDraft({ id: createStableId('guest'), name: '', colorName: 'gray', color: '#8e99a8' });
    setGuestColorOpen(false);
    setGuestPopupOpen(true);
  }
  function chooseGuestColor(name, customColor) {
    if (name === 'custom') {
      const color = normalizeHexColor(customColor || guestDraft.color || '#00e5ff');
      setGuestDraft(g => ({ ...g, colorName: 'custom', color }));
      return;
    }
    const c = (normalizedHoppers?.palette || []).find(x => x.name === name) || { name, color: guestDraft.color || '#00e5ff' };
    setGuestDraft(g => ({ ...g, colorName: c.name, color: c.color }));
  }
  function addGuestFromPopup() {
    setFormError('');
    if (!guestDraft.name.trim()) return;
    setDraft(d => ({ ...d, guestHoppers: [...(d.guestHoppers || []), { ...guestDraft, name: guestDraft.name.trim() }] }));
    setGuestPopupOpen(false);
  }
  function setTrailStyle(style) {
    setDraft(d => ({ ...d, trailStyle: style, trailColorMode: currentHopSquad && !(d.guestHoppers || []).length && style === 'solid' ? 'squad' : 'members', _trailStyleTouched: true }));
  }
  function setTrailColorMode(mode) {
    setDraft(d => ({
      ...d,
      trailColorMode: mode,
      trailStyle: mode === 'squad' ? 'solid' : (d.trailStyle || 'solid')
    }));
  }

  function selectCalendarDay(day) {
    const selected = { year: calendarCursor.year, month: calendarCursor.month, day };
    if (rangePhase === 'start') {
      setDraft({ ...draft, ...selected, endYear: null, endMonth: null, endDay: null });
      setRangePhase('end');
    } else {
      const startKey = dateKey(draft.year, draft.month, draft.day);
      const endKey = dateKey(selected.year, selected.month, selected.day);
      if (startKey && endKey && endKey < startKey) {
        setDraft({ ...draft, ...selected, endYear: draft.year || selected.year, endMonth: draft.month || selected.month, endDay: draft.day || selected.day });
      } else {
        setDraft({ ...draft, endYear: selected.year, endMonth: selected.month, endDay: selected.day });
      }
      setDateRangeOpen(false);
      setRangePhase('start');
    }
  }

  return <div className={`studio-modal-backdrop ${closing ? 'is-closing' : ''}`}>
    {formError && <div className="studio-error-toast glass" role="alert">
      <strong>Almost there</strong>
      <span>{formError}</span>
      <button type="button" className="primary" onClick={() => setFormError('')}>OK</button>
    </div>}
    <div ref={dialogRef} className={`studio-modal glass studio-modal--wide ${batchMode ? 'studio-modal--batch' : ''} ${closing ? 'is-closing' : ''}`} role="dialog" aria-modal="true" aria-labelledby="studio-modal-title">
      <div className="studio-modal-sticky">
        <div className="studio-modal-header studio-modal-header--with-actions">
          <div className="studio-title-block">
            <p className="eyebrow">{mode === 'add' ? `Add ${addTripNoun}` : batchMode ? 'Batch Add Hops' : 'Edit Hop'}</p>
            <div className="studio-generated-title-row"><h2 id="studio-modal-title" title={title}>{title}</h2><button type="button" className="secondary compact studio-title-edit-button" onClick={() => setTitleEditorOpen(value => !value)}>{titleEditorOpen ? 'Done' : 'Edit Title'}</button></div>
            {titleEditorOpen && <div className="studio-title-editor"><input aria-label="Hop title" value={draft.label || ''} onChange={event => setDraft(current => ({ ...current, label: event.target.value, _titleMode: 'custom' }))} />{draft._titleMode === 'custom' && <button type="button" className="secondary compact" onClick={() => setDraft(current => ({ ...current, label: automaticTitle, _titleMode: 'auto' }))}>Use Automatic Title</button>}</div>}
            <small className="studio-modal-trip-id">Trip ID: {draft.id || ((mode === 'add' || batchMode) ? 'new-unsaved-hop' : 'unknown')}</small>
          </div>
          <div className="studio-modal-top-actions">
            {onDelete && <button className="danger" disabled={busy} onClick={onDelete}>Delete hop</button>}
            {mode === 'add' && <button className="secondary" type="button" onClick={onOpenBatch}>Batch Add Hops</button>}
            <button onClick={onClose}>Cancel</button>
            {!batchMode && <button className="primary" disabled={busy || routeReview.status === 'working'} onClick={onSave}>{busy ? 'Saving…' : routeReview.status === 'working' ? 'Checking routes…' : 'Save Hop'}</button>}
          </div>
        </div>

        <div className="studio-form-grid studio-form-grid--sticky-fields studio-form-grid--dates">
          <BubbleSelect label="Month" value={draft.month || ''} display={monthLabel(draft.month) || 'Choose month'} options={MONTH_OPTIONS.filter(m => m.value).map(m => ({ value: m.value, label: m.label }))} open={monthPickerOpen} setOpen={setMonthPickerOpen} onChoose={(value) => setDraft(current => {
            const month = Number(value);
            const maxDay = new Date(Number(current.year) || new Date().getFullYear(), month, 0).getDate();
            return { ...current, month, day: current.day ? Math.min(Number(current.day), maxDay) : null };
          })} required variant="month" />
          <BubbleSelect label="Year" value={draft.year || ''} display={draft.year || 'Choose year'} options={yearOptions.map(y => ({ value: y, label: String(y) }))} open={yearPickerOpen} setOpen={setYearPickerOpen} onChoose={(value) => setDraft({...draft, year:Number(value)})} required variant="year" />
          <label className="date-range-field">Exact Hop Dates <span className="optional-field-badge">Optional</span><button type="button" className="date-range-button" onClick={() => { setCalendarCursor({ year: Number(draft.year) || new Date().getFullYear(), month: Number(draft.month) || 1 }); setDateRangeOpen(v => !v); setRangePhase('start'); }}>{dateRangeLabel || 'Choose Exact Hop Dates'}<span>▾</span></button>
            {dateRangeOpen && <DateRangePopover
              popoverRef={dateRangeRef}
              draft={draft}
              cursor={calendarCursor}
              setCursor={setCalendarCursor}
              phase={rangePhase}
              onClose={() => setDateRangeOpen(false)}
              onSelectDay={selectCalendarDay}
            />}
          </label>
        </div>
      </div>

      <div className={`studio-modal-scroll-content studio-modal-layout ${batchMode ? 'studio-modal-layout--batch' : ''}`}>
        <div className="studio-modal-maincol">
          <section className="studio-pick-section compact-section travelers-section">
            <div className="section-heading-inline">
              <h3>Hoppers</h3>
              {currentHopSquad && <span className="active-squad-badge" style={{ '--accent': currentHopSquadColor }}><span></span>{currentHopSquad.name}</span>}
            </div>
            <div className="pill-selectors">
              {((normalizedHoppers?.hoppers?.length ? normalizedHoppers.hoppers : [{ id:'joey', name:'Joey', color:'#ff8a00' }, { id:'bonnie', name:'Bonnie', color:'#ff4fd8' }])).map(t => {
                const selected = draft.travelers?.includes(t.id);
                const chipColor = selected && currentHopSquadColor ? currentHopSquadColor : t.color;
                return <button key={t.id} type="button" className={`traveler-pill ${selected ? 'is-selected' : ''} ${selected && currentHopSquad ? 'is-squad-active' : ''}`} style={{ '--accent': chipColor }} onClick={() => onTravelerToggle(t.id)}><span className="traveler-dot"></span>{t.name}</button>;
              })}
                {(draft.guestHoppers || []).map(g => <span key={g.id} className="traveler-pill guest-hopper-chip is-selected" style={{ '--accent': g.color }}><span className="traveler-dot"></span>{g.name}<button type="button" onClick={(e) => { e.stopPropagation(); setFormError(''); setDraft(d => ({ ...d, guestHoppers: (d.guestHoppers || []).filter(x => x.id !== g.id) })); }}>×</button></span>)}
                <button type="button" className="traveler-pill add-guest-hopper" onClick={openGuestPopup}>+ Add Guest Hopper</button>
                {guestPopupOpen && <div className="guest-hopper-popover glass">
                  <label>Name<input autoFocus value={guestDraft.name} placeholder="Name" onChange={e => setGuestDraft(g => ({ ...g, name: e.target.value }))} /></label>
                  <div className="guest-color-row"><span>Color</span><ColorPopover colors={normalizedHoppers?.palette || []} value={guestDraft.colorName} color={guestDraft.color} open={guestColorOpen} onToggle={() => setGuestColorOpen(v => !v)} onChoose={(name, customColor) => { chooseGuestColor(name, customColor); if (name !== 'custom') setGuestColorOpen(false); }} /></div>
                  <div className="guest-popover-actions"><button type="button" className="secondary" onClick={() => setGuestPopupOpen(false)}>Cancel</button><button type="button" className="primary" onClick={addGuestFromPopup}>Add Guest</button></div>
                </div>}
            </div>
          </section>

          <section className="studio-pick-section compact-section transport-triptype-row">
            <div className="transport-choice-group"><h3>Mode of Transportation</h3>
            <div className="mode-selectors">
              {MODE_OPTIONS.map(m => <button key={m.id} type="button" className={`mode-tile ${draft.mode === m.id ? 'is-selected' : ''}`} onClick={() => setDraft(current => ({
                ...current,
                mode: m.id,
                returnMode: !current.returnMode || current.returnMode === current.mode ? m.id : current.returnMode
              }))}><span>{m.icon}</span>{m.label}</button>)}
            </div></div>
            <div className="trip-type-selector"><h3>Hop type</h3>
              <div className="trip-type-options">
                <button type="button" className={`trip-type-tile ${draft.roundTrip ? 'is-selected' : ''}`} onClick={() => setDraft({...draft, roundTrip: true})}><span>↩</span> Round Trip</button>
                <button type="button" className={`trip-type-tile ${!draft.roundTrip ? 'is-selected' : ''}`} onClick={() => setDraft({...draft, roundTrip: false})}><span>→</span> One Way</button>
              </div>
            </div>
          </section>

          <section className="studio-pick-section route-section compact-section">
            <h3>Route</h3>
            <div className="route-form">
              <div className="start-entry-block">
                <AutocompleteField prominent label="Start Location" value={draft.fromLocationText || displayLocation(locById[draft.fromLocationId]) || ''} onChange={v => { setDraft(d => ({...d, fromLocationText:v, fromLocationId:'', fromCity:null, overrideFrom:false, _fromTouched:true})); if (String(v).trim().length >= 2) onRequestCitySuggestions(v); }} matches={fromMatches} onChoose={onChooseFrom} resetToken={`${draft.id || 'new'}:from:${draft.fromLocationId || 'unselected'}`} />
                <small>Pre-filled from the active home base for this date. Type another location to change it.</small>
              </div>
              <div className="destination-entry-block">
                <div className="destination-entry-heading">
                  <strong>Destination</strong>
                  <button type="button" className="secondary compact" onClick={() => setDraft(current => ({
                    ...current,
                    toCustomEnabled: !current.toCustomEnabled,
                    toLocationId: '',
                    toCity: null,
                    toLocationText: ''
                  }))}>{draft.toCustomEnabled ? 'Use city search' : 'Use exact coordinates'}</button>
                </div>
                {draft.toCustomEnabled ? <div className="custom-coordinate-grid">
                  <label>Location name<input value={draft.toCustomName || ''} onChange={event => setDraft(current => ({ ...current, toCustomName: event.target.value }))} placeholder="Private marina, island, landmark…" /></label>
                  <label>Latitude<input type="number" min="-90" max="90" step="0.00001" value={draft.toCustomLat ?? ''} onChange={event => setDraft(current => ({ ...current, toCustomLat: event.target.value }))} placeholder="32.71570" /></label>
                  <label>Longitude<input type="number" min="-180" max="180" step="0.00001" value={draft.toCustomLon ?? ''} onChange={event => setDraft(current => ({ ...current, toCustomLon: event.target.value }))} placeholder="-117.16110" /></label>
                  <small>Custom points require valid coordinates and are saved into locations.json. GlobeHoppers will never substitute 0,0.</small>
                </div> : <AutocompleteField prominent label="Destination" resetToken={`${draft.id || 'new'}:to:${draft.toLocationId || 'unselected'}`} value={draft.toLocationText || ''} onChange={v => { setDraft(d => ({...d, toLocationText:v, toLocationId:'', toCity:null})); if (String(v).trim().length >= 2) onRequestCitySuggestions(v); }} matches={destinationMatches} onChoose={onChooseDestination} />}
              </div>
            </div>
          </section>

          <section className="studio-pick-section additional-legs-section compact-section">
            <h3>Additional Legs</h3>
            <div className="legs-block">
              <div className="legs-header">
                <div className="legs-header-actions legs-header-actions--left">
                  {!!(draft.extraLegs || []).length && <button type="button" className="secondary compact" onClick={() => setDraft(current => ({
                    ...current,
                    extraLegs: (current.extraLegs || []).map(leg => ({ ...leg, modeFromPrevious: current.mode || 'plane' })),
                    returnMode: current.roundTrip ? (current.mode || 'plane') : current.returnMode
                  }))}>Apply {MODE_OPTIONS.find(option => option.id === draft.mode)?.label || 'mode'} to all legs</button>}
                  <button className="add-leg-button" type="button" onClick={onAddLeg}><span>＋</span> Add Leg</button>
                </div>
              </div>
              {(draft.extraLegs || []).length >= 12 && <div className="studio-form-warning">This Hop has many legs. The route and repository geometry may take longer to calculate and save.</div>}
              {(draft.extraLegs || []).map((leg, index) => <div className="leg-row" key={leg.draftId || leg.legId || leg.pointId || index}>
                <select value={leg.modeFromPrevious || draft.mode || 'plane'} onChange={e => onSetExtraLeg(index, { modeFromPrevious: e.target.value })}>{MODE_OPTIONS.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}</select>
                <AutocompleteField compact label={`Leg ${index + 2} destination`} resetToken={`${leg.draftId || leg.legId || index}:${leg.locationId || 'unselected'}`} value={leg.locationText || displayLocation(locById[leg.locationId]) || ''} onChange={v => { onSetExtraLeg(index, { locationText: v, locationId: '', city: null }); if (String(v).trim().length >= 2) onRequestCitySuggestions(v); }} matches={locationSuggestions(locs, leg.locationText || '', cityMatchesFor(leg.locationText), true, cityLoadingFor(leg.locationText))} onChoose={loc => onChooseExtraLeg(index, loc)} />
                <button type="button" onClick={() => onRemoveLeg(index)}>Remove</button>
              </div>)}
            </div>
            {draft.roundTrip && <div className="return-mode-card">
              <div>
                <span>Return home method</span>
                <small>Defaults to Leg 1, but can be changed for chained trips.</small>
              </div>
              <div className="return-mode-options">
                {MODE_OPTIONS.map(m => <button key={m.id} type="button" className={(draft.returnMode || draft.mode || 'plane') === m.id ? 'is-selected' : ''} onClick={() => onSetReturnMode(m.id)}><span>{m.icon}</span>{m.label}</button>)}
              </div>
            </div>}
          </section>

          <div className="studio-form-grid single compact-section">
            <label>Notes<textarea value={draft.notes || ''} onChange={e => setDraft({...draft, notes:e.target.value})} placeholder="Vacation, work trip, birthday, etc." /></label>
          </div>
        </div>

        {!batchMode && <div className="studio-modal-sidecol">
          <TripRoutePreview draft={draft} locById={locById} locs={locs} startLocation={effectiveStart} destination={effectiveDestination} onSetLegMode={onSetPreviewLegMode} hopperData={normalizedHoppers} />
          {!!routeReviewLegs.length && <RouteReviewPanel review={routeReview} legs={routeReviewLegs} currentSignature={currentReviewSignature} onReview={onReviewRoutes} />}
          <TrailStylePanel draft={draft} currentHopSquad={currentHopSquad} currentDraftVisual={currentDraftVisual} selectedTravelerCount={selectedTravelerCount} effectiveTrailColorMode={effectiveTrailColorMode} effectiveTrailStyle={effectiveTrailStyle} onSetTrailStyle={setTrailStyle} onSetTrailColorMode={setTrailColorMode} />
        </div>}
        {batchMode && <>
          <div className="batch-inline-panels">
            {!!routeReviewLegs.length && <RouteReviewPanel review={routeReview} legs={routeReviewLegs} currentSignature={currentReviewSignature} onReview={onReviewRoutes} />}
            <TrailStylePanel draft={draft} currentHopSquad={currentHopSquad} currentDraftVisual={currentDraftVisual} selectedTravelerCount={selectedTravelerCount} effectiveTrailColorMode={effectiveTrailColorMode} effectiveTrailStyle={effectiveTrailStyle} onSetTrailStyle={setTrailStyle} onSetTrailColorMode={setTrailColorMode} />
          </div>
          <BatchHopTable rows={batchRows} activeStageId={batchEditingStageId} baseLocations={locs} hopperData={normalizedHoppers} busy={busy} routeWorking={routeReview.status === 'working'} draftBlank={isDraftMeaningfullyBlank(draft)} onStage={onSave} onSaveBatch={onSaveBatch} onAddAnother={onAddAnotherBatchHop} onEdit={onEditBatchHop} onDelete={onDeleteBatchHop} />
        </>}

      </div>
    </div>
  </div>;
}


function BatchHopTable({ rows = [], activeStageId = null, baseLocations = [], hopperData = {}, busy = false, routeWorking = false, draftBlank = false, onStage = () => {}, onSaveBatch = () => {}, onAddAnother = () => {}, onEdit = () => {}, onDelete = () => {} }) {
  const sortedRows = sortBatchRows(rows);
  return <section className="batch-hop-section compact-section">
    <div className="batch-hop-heading">
      <div>
        <p className="eyebrow">Staged Hops</p>
        <h3>{sortedRows.length ? `${sortedRows.length} Hop${sortedRows.length === 1 ? '' : 's'} ready` : 'No Hops staged yet'}</h3>
      </div>
      <div className="batch-hop-actions">
        <button type="button" className="secondary" disabled={busy || routeWorking} onClick={onStage}>{busy ? 'Working…' : activeStageId ? 'Update Current Hop' : 'Done with Hop'}</button>
        <button type="button" className="primary" disabled={busy} onClick={onAddAnother}>＋ Add Another Hop</button>
        <button type="button" className="primary batch-save-button" disabled={busy || (!rows.length && draftBlank)} onClick={onSaveBatch}>{busy ? 'Saving…' : `Save Hop Batch${rows.length ? ` (${rows.length})` : ''}`}</button>
      </div>
    </div>
    <p className="batch-hop-help">Hops are shown chronologically. Routes are calculated when each Hop is staged, and the entire batch is saved in one repository update.</p>
    <div className="batch-hop-table-wrap" role="region" aria-label="Staged Hops" tabIndex="0">
      <table className="batch-hop-table">
        <thead><tr>
          <th>Hop title</th><th>Year</th><th>Month</th><th>Dates</th><th>Hopper</th><th>Start location</th><th>Legs & vessels</th><th>Trail type</th><th>Actions</th>
        </tr></thead>
        <tbody>
          {sortedRows.map(row => {
            const locations = mergeLocationsById(baseLocations, row.addedLocations || []);
            const byId = Object.fromEntries(locations.map(location => [location.id, location]));
            const route = Array.isArray(row.trip?.route) ? row.trip.route : [];
            const start = byId[route[0]?.locationId];
            const visual = resolveTripVisual(row.trip || {}, hopperData || {});
            return <tr key={row.stageId} className={row.stageId === activeStageId ? 'is-active' : ''}>
              <td><strong>{row.trip?.label || 'Untitled Hop'}</strong></td>
              <td>{row.trip?.year || ''}</td>
              <td>{monthLabel(row.trip?.month)}</td>
              <td>{formatDateRangeLabel(row.trip || {}) || row.trip?.displayDate || ''}</td>
              <td><span className="batch-hopper-dot" style={{ '--accent': visual.color || '#00e5ff' }}></span>{visual.name}</td>
              <td>{displayLocation(start) || start?.name || 'Home base'}</td>
              <td className="batch-route-cell">{route.slice(1).map((point, index) => {
                const destination = byId[point.locationId];
                const mode = point.modeFromPrevious || row.trip?.mode || 'plane';
                const isReturn = index === route.length - 2 && row.trip?.roundTrip && point.locationId === route[0]?.locationId;
                return <span className="batch-route-line" key={point.legId || point.pointId || `${point.locationId}-${index}`}>
                  <b>{isReturn ? 'Return' : `Leg ${index + 1}`}:</b> {displayLocation(destination) || destination?.name || point.locationId}<small>{modeIcon(mode)} {MODE_OPTIONS.find(option => option.id === mode)?.label || mode}</small>
                </span>;
              })}</td>
              <td>{trailStyleLabel(row.trip?.trailStyle)}</td>
              <td><div className="batch-row-actions"><button type="button" className="secondary" onClick={() => onEdit(row.stageId)}>Edit</button><button type="button" className="danger" onClick={() => onDelete(row.stageId)}>Delete</button></div></td>
            </tr>;
          })}
          {!sortedRows.length && <tr><td colSpan="9" className="batch-empty-row">Complete the Hop above and select <strong>Done with Hop</strong>.</td></tr>}
        </tbody>
      </table>
    </div>
  </section>;
}

function trailStyleLabel(style = 'solid') {
  return ({ solid: 'Solid Trail', stripe: 'Stripe Trail', ribbon: 'Ribbon Trail', spiral: 'Spiral Trail' })[style] || style;
}

function activeDraftSquad(draft = {}, hopperData = {}) {
  const travelers = Array.isArray(draft.travelers) ? draft.travelers : [];
  const guests = Array.isArray(draft.guestHoppers) ? draft.guestHoppers : [];
  if (!travelers.length || guests.length) return null;
  const squads = Array.isArray(hopperData?.hopSquads) ? hopperData.hopSquads : [];
  const selectedKey = [...new Set(travelers.filter(Boolean))].sort().join('|');
  return squads.find(s => [...new Set((s.hopperIds || []).filter(Boolean))].sort().join('|') === selectedKey) || null;
}

function previewGroupLabel(draft = {}, visual = {}) {
  const permanentCount = Array.isArray(draft.travelers) ? draft.travelers.length : 0;
  const guestCount = Array.isArray(draft.guestHoppers) ? draft.guestHoppers.length : 0;
  if (visual?.isEmpty || permanentCount + guestCount === 0) return 'Required';
  if (visual?.isSquad) return 'Hop Squad';
  if (guestCount > 0 || permanentCount > 1) return 'Group hop';
  return 'Solo hop';
}

function previewDotBackground(colors = [], fallback = '#5d7288', glossy = false) {
  return segmentedCircleBackground(colors, fallback, glossy);
}

function TripRoutePreview({ draft, locById, locs, startLocation, destination, onSetLegMode, hopperData }) {
  const rows = [];
  rows.push({ label: 'Start location', place: displayLocation(startLocation) || startLocation?.name || 'Auto-derived start', mode: null, target: null });
  rows.push({ label: 'Leg 1', place: displayLocation(destination) || destination?.name || draft.toLocationText || 'Destination pending', mode: draft.mode || 'plane', target: 'main' });
  const previewExtraLegs = (draft.extraLegs || []);
  previewExtraLegs.forEach((leg, i) => {
    const loc = locById[leg.locationId] || findLocationByText(locs, leg.locationText) || { name: leg.locationText };
    rows.push({ label: `Leg ${i + 2}`, place: displayLocation(loc) || loc?.name || 'Destination pending', mode: leg.modeFromPrevious || draft.mode || 'plane', target: i });
  });
  const lastExtra = previewExtraLegs.length ? previewExtraLegs[previewExtraLegs.length - 1] : null;
  const lastExtraLoc = lastExtra ? (locById[lastExtra.locationId] || findLocationByText(locs, lastExtra.locationText) || { name: lastExtra.locationText }) : null;
  const endPlace = draft.roundTrip
    ? (displayLocation(startLocation) || startLocation?.name || 'Return to start')
    : previewExtraLegs.length
      ? (displayLocation(lastExtraLoc) || lastExtraLoc?.name || 'End pending')
      : (displayLocation(destination) || destination?.name || draft.toLocationText || 'Destination pending');
  if (draft.roundTrip) {
    rows.push({ label: 'Return home', place: endPlace, mode: draft.returnMode || draft.mode || 'plane', target: 'return' });
  }
  rows.push({ label: 'End location', place: endPlace, mode: null, target: null, pin: true });
  const visual = resolveTripVisual(draft, hopperData || {});
  const noHoppers = !!visual.isEmpty;
  const mixedColors = (visual.colors || []).filter(Boolean);
  const borderColors = (visual.squadMemberColors || visual.circleColors || visual.memberColors || visual.colors || [visual.color]).filter(Boolean);
  const accentColor = visual.accentColors?.[0] || mixedColors[1] || visual.color || '#5d7288';
  const accentColor3 = visual.accentColors?.[1] || mixedColors[2] || 'transparent';
  const accentColor4 = visual.accentColors?.[2] || mixedColors[3] || 'transparent';
  const isMixed = !visual.isSquad && mixedColors.length > 1;
  return <aside className={`route-preview-card ${noHoppers ? 'route-preview-card--empty' : ''} ${isMixed ? 'route-preview-card--mixed' : ''}`} style={{ '--trip-accent': visual.color || tripAccent(draft, hopperData), '--trip-accent-2': accentColor, '--trip-accent-3': accentColor3, '--trip-accent-4': accentColor4, '--trip-gradient': colorGradient(mixedColors, visual.color || '#5d7288'), '--trip-border': segmentedBorderGradient(borderColors, visual.color || '#5d7288') }}>
    <p className="eyebrow">Hop preview</p>
    <div className="route-preview-title-row">
      <h3>{draft.label || destination?.name || 'Add Hop'}</h3>
      <b className={`route-preview-title-dot ${isMixed ? 'is-group-dot' : ''}`} style={{ background: noHoppers ? 'transparent' : previewDotBackground(visual.circleColors || mixedColors, visual.color, true) }}></b>
    </div>
    <div className="route-preview-meta">
      <span>{formatDateRangeLabel(draft) || (draft.year ? [monthLabel(draft.month), draft.year].filter(Boolean).join(' ') : 'Dates pending')}</span>
      <span>{visual.name} · {previewGroupLabel(draft, visual)}</span>
      {(draft.notes || draft.occasion) && <span>{draft.notes || draft.occasion}</span>}
    </div>
    <div className="route-preview-list">
      {rows.map((r, i) => <div className={`route-preview-row ${isMixed ? 'is-mixed' : ''}`} style={{ '--row-gradient': colorGradient(mixedColors, visual.color || '#5d7288'), '--row-accent': visual.color || '#5d7288', '--row-accent-2': accentColor }} key={`${r.label}-${i}`}>
        <PreviewModeButton mode={r.mode} target={r.target} onSetLegMode={onSetLegMode} />
        <div><strong>{r.label}</strong><small>{r.place}</small></div>
        <span className="route-preview-people">{visual.name}</span>
      </div>)}
    </div>
  </aside>;
}


function RouteReviewPanel({ review = emptyRouteReview(), legs = [], currentSignature = '', onReview = () => {} }) {
  const isCurrent = Boolean(review.signature && review.signature === currentSignature);
  const hasErrors = (review.results || []).some(result => (result?.errors || []).length || (!result?.geometry?.length && !result?.cachedRoute));
  const hasWarnings = (review.results || []).some(result => (result?.warnings || []).length);
  const complete = isCurrent && review.status === 'ready' && review.results.length === legs.length && !hasErrors;
  const statusLabel = review.status === 'working'
    ? 'Calculating'
    : hasErrors || review.status === 'error'
      ? 'Needs attention'
      : complete && hasWarnings
        ? 'Approximate'
        : complete
          ? 'Ready'
          : review.status === 'stale'
            ? 'Updating'
            : 'Automatic';

  return <section className={`route-review-panel compact-section route-review-panel--${complete ? (hasWarnings ? 'warning' : 'ready') : review.status || 'idle'}`} aria-live="polite">
    <div className="route-review-heading">
      <div>
        <p className="eyebrow">Automatic route check</p>
        <h3>Road, rail & water</h3>
      </div>
      <span className="route-review-status">{statusLabel}</span>
    </div>
    <p className="route-review-intro">GlobeHoppers calculates and validates surface routes automatically. No approval is required.</p>

    <details className="route-review-details" open={hasErrors || review.status === 'error'}>
      <summary>{review.status === 'working' ? 'Calculating route details…' : `View route details (${legs.length})`}</summary>
      <div className="route-review-list">
        {legs.map((leg, index) => {
          const result = (review.results || []).find(row => String(row?.legId || '') === String(leg.legId || leg.id || '')) || review.results?.[index];
          const warnings = result?.warnings || [];
          const errors = result?.errors || [];
          const state = errors.length ? 'error' : warnings.length ? 'warning' : result ? 'ok' : 'pending';
          return <article className={`route-review-leg route-review-leg--${state}`} key={leg.legId || leg.id || index}>
            <div className="route-review-leg-head">
              <span className="route-review-mode">{modeIcon(leg.mode)}</span>
              <div>
                <strong>Leg {index + 1}: {leg.from?.name || 'Origin'} → {leg.to?.name || 'Destination'}</strong>
                <small>{MODE_OPTIONS.find(option => option.id === leg.mode)?.label || leg.mode}</small>
              </div>
              <span className="route-review-confidence">{result?.confidence || 'pending'}</span>
            </div>
            <RouteReviewMiniMap geometry={result?.geometry} mode={leg.mode} />
            {result && <div className="route-review-metrics">
              <span><b>{Math.round(Number(result.routeMiles || result.directMiles || 0)).toLocaleString()}</b> mi</span>
              <span><b>{formatReviewDuration(result.estimatedMinutes)}</b> estimated</span>
              <span><b>{routeSourceLabel(result.source)}</b></span>
            </div>}
            {!!errors.length && <ul className="route-review-messages route-review-messages--error">{errors.map((message, messageIndex) => <li key={`${message}-${messageIndex}`}>{message}</li>)}</ul>}
            {!!warnings.length && <ul className="route-review-messages route-review-messages--warning">{warnings.map((message, messageIndex) => <li key={`${message}-${messageIndex}`}>{message}</li>)}</ul>}
            {!result && review.status !== 'working' && <p className="route-review-pending">Route will be calculated automatically before saving.</p>}
            {!result && review.status === 'working' && <p className="route-review-pending">Calculating this route…</p>}
          </article>;
        })}
      </div>
    </details>

    {review.error && <p className="route-review-error" role="alert">{review.error}</p>}
    <div className="route-review-actions">
      <button type="button" className="secondary" disabled={review.status === 'working'} onClick={() => onReview(Boolean(review.results?.length))}>
        {review.status === 'working' ? 'Calculating routes…' : review.results?.length ? 'Recalculate' : `Calculate ${legs.length} route${legs.length === 1 ? '' : 's'}`}
      </button>
    </div>
    <p className="route-review-attribution">Driving routes use OpenStreetMap data through Valhalla when available. Mapbox and local routing are fallbacks.</p>
  </section>;
}

function RouteReviewMiniMap({ geometry, mode }) {
  const points = routePreviewSvgPoints(geometry);
  if (!points) return <div className="route-review-map route-review-map--empty"><span>{modeIcon(mode)}</span><small>Route preview appears after calculation</small></div>;
  return <svg className="route-review-map" viewBox="0 0 300 86" role="img" aria-label="Generated route geometry preview" preserveAspectRatio="none">
    <path className="route-review-map-grid" d="M0 22H300M0 43H300M0 64H300M75 0V86M150 0V86M225 0V86" />
    <polyline points={points} className={`route-review-map-line route-review-map-line--${mode}`} />
    <circle cx={points.split(' ')[0].split(',')[0]} cy={points.split(' ')[0].split(',')[1]} r="4" className="route-review-map-endpoint" />
    <circle cx={points.split(' ').at(-1).split(',')[0]} cy={points.split(' ').at(-1).split(',')[1]} r="4" className="route-review-map-endpoint" />
  </svg>;
}

function routePreviewSvgPoints(geometry = []) {
  const clean = (geometry || [])
    .map(point => Array.isArray(point) ? [Number(point[0]), Number(point[1])] : null)
    .filter(point => point && Number.isFinite(point[0]) && Number.isFinite(point[1]));
  if (clean.length < 2) return '';
  const unwrapped = [clean[0]];
  for (let index = 1; index < clean.length; index++) {
    let lon = clean[index][0];
    const previousLon = unwrapped[index - 1][0];
    while (lon - previousLon > 180) lon -= 360;
    while (lon - previousLon < -180) lon += 360;
    unwrapped.push([lon, clean[index][1]]);
  }
  const minLon = Math.min(...unwrapped.map(point => point[0]));
  const maxLon = Math.max(...unwrapped.map(point => point[0]));
  const minLat = Math.min(...unwrapped.map(point => point[1]));
  const maxLat = Math.max(...unwrapped.map(point => point[1]));
  const lonSpan = Math.max(0.001, maxLon - minLon);
  const latSpan = Math.max(0.001, maxLat - minLat);
  const stride = Math.max(1, Math.floor(unwrapped.length / 120));
  const sampled = unwrapped.filter((_, index) => index === 0 || index === unwrapped.length - 1 || index % stride === 0);
  return sampled.map(point => {
    const x = 12 + ((point[0] - minLon) / lonSpan) * 276;
    const y = 74 - ((point[1] - minLat) / latSpan) * 62;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
}

function TrailStylePanel({ draft, currentHopSquad, currentDraftVisual, selectedTravelerCount, effectiveTrailColorMode, effectiveTrailStyle, onSetTrailStyle, onSetTrailColorMode }) {
  const squadMemberColors = (currentDraftVisual?.squadMemberColors || currentDraftVisual?.memberColors || []).filter(Boolean);
  const squadColor = currentHopSquad?.color || currentDraftVisual?.color;
  const memberColors = (squadMemberColors.length ? squadMemberColors : (currentDraftVisual?.circleColors || currentDraftVisual?.colors || []).filter(Boolean));
  const availableColorCount = memberColors.length || selectedTravelerCount;
  const showMultiOptions = availableColorCount > 1;
  const styleOptions = [
    { id: 'solid', label: 'Solid Trail', disabled: false, colors: [squadColor || currentDraftVisual?.color || '#5d7288'].filter(Boolean), colorMode: currentHopSquad ? 'squad' : 'members' },
    { id: 'stripe', label: 'Stripe Trail', disabled: !showMultiOptions, colors: memberColors, colorMode: 'members' },
    { id: 'ribbon', label: 'Ribbon Trail', disabled: !showMultiOptions, colors: memberColors, colorMode: 'members' },
    { id: 'spiral', label: 'Spiral Trail', disabled: !showMultiOptions, colors: memberColors, colorMode: 'members' }
  ];
  return <section className="trail-style-panel compact-section">
    <div className="section-heading-inline">
      <h3>Trail style</h3>
      <span className="trail-style-summary">{showMultiOptions ? `${availableColorCount} colors available` : 'Solo trail'}</span>
    </div>
    <div className="trail-style-options">
      {styleOptions.map(option => <button key={option.id} type="button" disabled={option.disabled} aria-disabled={option.disabled ? 'true' : 'false'} className={`trail-style-option ${effectiveTrailStyle === option.id ? 'is-selected' : ''} ${option.disabled ? 'is-disabled' : ''}`} onClick={() => { if (!option.disabled) onSetTrailStyle(option.id); }}>
        <span className={`trail-style-swatch trail-style-swatch--${option.id}`} style={{ '--trail-preview': colorGradient(option.colors, currentDraftVisual?.color || '#5d7288'), '--trail-color': (option.colors || [])[0] || currentHopSquad?.color || currentDraftVisual?.color || '#5d7288', '--trail-member-count': Math.max(1, (option.colors || []).length || selectedTravelerCount || 1) }}></span>
        <strong>{option.label}</strong>
      </button>)}
    </div>
  </section>;
}

function PreviewModeButton({ mode, target, onSetLegMode }) {
  if (!mode || target == null) return <span className="route-preview-icon route-preview-pin" title="Location marker">📍</span>;
  const currentIndex = Math.max(0, MODE_OPTIONS.findIndex(m => m.id === mode));
  const current = MODE_OPTIONS[currentIndex] || MODE_OPTIONS[0];
  function cycle() {
    const next = MODE_OPTIONS[(currentIndex + 1) % MODE_OPTIONS.length]?.id || 'plane';
    onSetLegMode?.(target, next);
  }
  return <button type="button" className="route-preview-icon route-preview-icon-button" title={`Change ${current.label} leg mode`} onClick={cycle}>
    <span>{current.icon}</span>
  </button>;
}

function DateRangePopover({ popoverRef, draft, cursor, setCursor, phase, onClose, onSelectDay }) {
  const days = calendarDays(cursor.year, cursor.month);
  const monthName = new Date(cursor.year, cursor.month - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const startKey = dateKey(draft.year, draft.month, draft.day);
  const endKey = dateKey(draft.endYear, draft.endMonth, draft.endDay);
  function move(delta) {
    const d = new Date(cursor.year, cursor.month - 1 + delta, 1);
    setCursor({ year: d.getFullYear(), month: d.getMonth() + 1 });
  }
  return <div ref={popoverRef} className="date-range-popover glass">
    <div className="date-range-head"><button type="button" onClick={() => move(-1)}>‹</button><strong>{monthName}</strong><button type="button" onClick={() => move(1)}>›</button></div>
    <p>{phase === 'start' ? 'Choose a start date' : 'Choose an end date'}</p>
    <div className="date-weekdays">{['S','M','T','W','T','F','S'].map(d => <span key={d}>{d}</span>)}</div>
    <div className="date-grid">{days.map((d, i) => d ? <button key={i} type="button" className={`${dateKey(cursor.year, cursor.month, d) === startKey ? 'is-start' : ''} ${dateKey(cursor.year, cursor.month, d) === endKey ? 'is-end' : ''}`} onClick={() => onSelectDay(d)}>{d}</button> : <span key={i}></span>)}</div>
    <div className="date-range-foot"><button type="button" onClick={onClose}>Done</button></div>
  </div>;
}

function AutocompleteField({ label, value, onChange, matches, onChoose, compact, prominent, resetToken = '' }) {
  const [hideSuggestions, setHideSuggestions] = useState(true);
  const [userEdited, setUserEdited] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef(null);
  const listIdRef = useRef(`autocomplete-${Math.random().toString(36).slice(2)}`);
  const visibleMatches = hideSuggestions || !userEdited ? [] : (matches || []).slice(0, 10);

  useEffect(() => {
    if (userEdited) return;
    setHideSuggestions(true);
    setActiveIndex(-1);
  }, [label, resetToken, userEdited]);

  useEffect(() => {
    function handlePointerDown(event) {
      if (rootRef.current && !rootRef.current.contains(event.target)) {
        setHideSuggestions(true);
        setActiveIndex(-1);
      }
    }
    document.addEventListener('pointerdown', handlePointerDown);
    return () => document.removeEventListener('pointerdown', handlePointerDown);
  }, []);

  function choose(option) {
    if (!option || option._source === 'loading') return;
    setHideSuggestions(true);
    setUserEdited(false);
    setActiveIndex(-1);
    onChoose(option);
  }

  function handleKeyDown(event) {
    if (event.key === 'Escape') {
      setHideSuggestions(true);
      setActiveIndex(-1);
      return;
    }
    if (!visibleMatches.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex(index => Math.min(visibleMatches.length - 1, index + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex(index => Math.max(0, index <= 0 ? visibleMatches.length - 1 : index - 1));
    } else if (event.key === 'Enter' && activeIndex >= 0) {
      event.preventDefault();
      choose(visibleMatches[activeIndex]);
    }
  }

  return <label ref={rootRef} className={`autocomplete-field ${compact ? 'compact' : ''} ${prominent ? 'is-prominent' : ''}`}>{label}
    <input
      value={value}
      role="combobox"
      aria-autocomplete="list"
      aria-expanded={visibleMatches.length > 0}
      aria-controls={visibleMatches.length ? listIdRef.current : undefined}
      aria-activedescendant={activeIndex >= 0 ? `${listIdRef.current}-${activeIndex}` : undefined}
      onFocus={() => { if (!userEdited) setHideSuggestions(true); }}
      onBlur={() => window.setTimeout(() => {
        setHideSuggestions(true);
        setActiveIndex(-1);
      }, 120)}
      onKeyDown={handleKeyDown}
      onChange={event => {
        setUserEdited(true);
        setHideSuggestions(false);
        setActiveIndex(-1);
        onChange(event.target.value);
      }}
      placeholder="Start typing a destination"
    />
    {!!value && visibleMatches.length > 0 && <div id={listIdRef.current} role="listbox" className="autocomplete-menu autocomplete-menu--cities">
      {visibleMatches.map((option, index) => <button
        type="button"
        role="option"
        aria-selected={index === activeIndex}
        id={`${listIdRef.current}-${index}`}
        key={`${option._source || 'saved'}-${option.id}`}
        className={`autocomplete-option autocomplete-option--${option._source || 'saved'} ${index === activeIndex ? 'is-active' : ''}`}
        onPointerDown={event => event.preventDefault()}
        onClick={() => choose(option)}
      >
        <strong>{suggestionDisplayText(option)}</strong>
        <em>{option._label || 'Saved'}</em>
      </button>)}
    </div>}
  </label>;
}

function compactRoutePoints(route = []) {
  return (route || []).filter(point => point?.locationId);
}
function hasAdjacentDuplicateRoutePoint(route = []) {
  const points = compactRoutePoints(route);
  return points.some((point, index) => index > 0 && point.locationId === points[index - 1]?.locationId);
}

function normalizeTrip(draft, trips, locations, homeBases, hopperData = {}) {
  if (!validDateParts(draft.year, draft.month, draft.day)) {
    throw new Error('Choose a valid start date. The selected day must exist in the selected month and year.');
  }
  const hasAnyEndDate = Boolean(draft.endYear || draft.endMonth || draft.endDay);
  if (hasAnyEndDate) {
    if (!validDateParts(draft.endYear, draft.endMonth, draft.endDay)) {
      throw new Error('Choose a complete and valid end date.');
    }
    if (compareDateParts(
      { year: draft.endYear, month: draft.endMonth, day: draft.endDay || 1 },
      { year: draft.year, month: draft.month, day: draft.day || 1 }
    ) < 0) {
      throw new Error('The end date cannot be before the start date.');
    }
  }
  if (!draft.travelers?.length && !(draft.guestHoppers || []).length) {
    throw new Error('Select at least one Hopper or Guest Hopper before saving.');
  }

  let nextLocations = [...(locations || [])];

  const resolveSelectedLocation = (locationId, city, text, fieldLabel, custom = null) => {
    if (custom?.enabled) {
      const customResult = ensureCustomCoordinateLocation(nextLocations, custom, fieldLabel);
      nextLocations = customResult.locations;
      return customResult.id;
    }
    if (locationId) {
      const existing = nextLocations.find(location => location.id === locationId);
      if (!isResolvedLocation(existing)) throw new Error(`${fieldLabel} does not have valid map coordinates.`);
      return existing.id;
    }
    if (city) {
      const result = ensureLocationForCity(nextLocations, city, text);
      nextLocations = result.locations;
      const added = nextLocations.find(location => location.id === result.id);
      if (!isResolvedLocation(added)) throw new Error(`${fieldLabel} could not be resolved to valid coordinates.`);
      return result.id;
    }
    const exact = findLocationByText(nextLocations, text);
    if (exact && isResolvedLocation(exact)) return exact.id;
    if (String(text || '').trim()) {
      throw new Error(`${fieldLabel} is not resolved. Select a city from the suggestions or choose a saved location before saving.`);
    }
    throw new Error(`Choose ${fieldLabel.toLowerCase()} before saving.`);
  };

  const toLocationId = resolveSelectedLocation(
    draft.toLocationId,
    draft.toCity,
    draft.toLocationText,
    'Destination',
    {
      enabled: draft.toCustomEnabled,
      name: draft.toCustomName,
      lat: draft.toCustomLat,
      lon: draft.toCustomLon
    }
  );
  const derivedHomeId = activeHomeBaseId(homeBases, draft);
  const fromLocationId = (draft.fromLocationId || draft.fromCity || String(draft.fromLocationText || '').trim())
    ? resolveSelectedLocation(draft.fromLocationId, draft.fromCity, draft.fromLocationText, 'Start location')
    : derivedHomeId;
  const homeId = fromLocationId || derivedHomeId;
  const home = nextLocations.find(location => location.id === homeId);
  if (!homeId || !isResolvedLocation(home)) {
    throw new Error('Choose a valid start location before saving.');
  }

  const route = [
    {
      pointId: draft.startPointId || createStableId('point'),
      locationId: homeId,
      modeFromPrevious: null
    },
    {
      pointId: draft.mainPointId || createStableId('point'),
      legId: draft.mainLegId || createStableId('leg'),
      locationId: toLocationId,
      modeFromPrevious: draft.mode || 'plane'
    }
  ];

  const extraLegs = (draft.extraLegs || []).filter(leg => leg.locationId || leg.locationText || leg.city);
  for (let index = 0; index < extraLegs.length; index++) {
    const leg = extraLegs[index];
    const locationId = resolveSelectedLocation(leg.locationId, leg.city, leg.locationText, `Leg ${index + 2} destination`);
    route.push({
      pointId: leg.pointId || createStableId('point'),
      legId: leg.legId || createStableId('leg'),
      locationId,
      modeFromPrevious: leg.modeFromPrevious || draft.mode || 'plane'
    });
  }

  if (draft.roundTrip && route[route.length - 1]?.locationId !== homeId) {
    route.push({
      pointId: draft.returnPointId || createStableId('point'),
      legId: draft.returnLegId || createStableId('leg'),
      locationId: homeId,
      modeFromPrevious: draft.returnMode || draft.mode || 'plane'
    });
  }

  const compactRoute = compactRoutePoints(route);
  if (hasAdjacentDuplicateRoutePoint(compactRoute)) {
    throw new Error('This route includes the same location twice in a row. Remove the duplicate leg before saving.');
  }
  const missingRouteIds = compactRoute
    .map(point => point.locationId)
    .filter(id => !nextLocations.some(location => location.id === id));
  if (missingRouteIds.length) {
    throw new Error(`Route contains location IDs missing from locations.json: ${Array.from(new Set(missingRouteIds)).join(', ')}`);
  }

  const count = trips.filter(t => Number(t.year) === Number(draft.year)).length + 1;
  const travelerCount = ((draft.travelers || []).length + (draft.guestHoppers || []).length);
  const finalTrailStyle = draft.trailStyle || (travelerCount >= 2 ? 'ribbon' : 'solid');
  const derivedTrailColorMode = finalTrailStyle === 'solid'
    && activeDraftSquad(draft, hopperData || {})
    && !((draft.guestHoppers || []).length)
    ? 'squad'
    : 'members';
  const automaticLabel = automaticHopTitle(draft, Object.fromEntries(nextLocations.map(location => [location.id, location])), nextLocations);
  const label = draft._titleMode === 'custom' && String(draft.label || '').trim()
    ? String(draft.label).trim()
    : automaticLabel || draft.label || displayNameFromLocation(nextLocations.find(location => location.id === toLocationId)) || draft.toLocationText || 'Trip';

  const clean = normalizeTripForV61({
    id: draft.id || uniqueTripId(trips),
    routeModelVersion: 2,
    year: Number(draft.year),
    month: Number(draft.month),
    day: draft.day ? Number(draft.day) : null,
    endYear: hasAnyEndDate ? Number(draft.endYear) : null,
    endMonth: hasAnyEndDate ? Number(draft.endMonth) : null,
    endDay: hasAnyEndDate && draft.endDay ? Number(draft.endDay) : null,
    displayDate: formatDisplayDate(draft),
    displayEndDate: hasAnyEndDate ? formatEndDisplayDate(draft) : '',
    sortKey: buildSortKey(draft, count),
    label,
    travelers: draft.travelers || [],
    guestHoppers: draft.guestHoppers || [],
    mode: draft.mode || 'plane',
    roundTrip: !!draft.roundTrip,
    returnMode: draft.roundTrip ? (draft.returnMode || draft.mode || 'plane') : '',
    fromLocationId: homeId === derivedHomeId ? null : homeId,
    toLocationId,
    route: compactRoute,
    notes: draft.notes || '',
    occasion: draft.occasion || '',
    trailStyle: finalTrailStyle,
    trailColorMode: derivedTrailColorMode,
    routeReview: draft.routeReview || null
  }, homeBases);

  return { trip: clean, nextLocations };
}

function uniqueTripId(trips = []) {
  const used = new Set((trips || []).map(t => String(t.id || '').toLowerCase()).filter(Boolean));
  for (let i = 0; i < 40; i++) {
    const id = randomTripId();
    if (!used.has(id.toLowerCase())) return id;
  }
  return randomTripId();
}
function randomTripId() {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint32Array(6);
  try {
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(bytes);
    else throw new Error('crypto unavailable');
  } catch {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 0xffffffff);
  }
  return Array.from(bytes, n => alphabet[n % alphabet.length]).join('');
}

function buildYearOptions(locs, currentYear) {
  const thisYear = new Date().getFullYear();
  const years = [];
  for (let y = 2012; y <= thisYear + 5; y++) years.push(y);
  if (currentYear && !years.includes(Number(currentYear))) years.push(Number(currentYear));
  return years.sort((a,b) => b - a);
}
function toDateInputValue(year, month, day) {
  if (!year || !month || !day) return '';
  return `${String(year).padStart(4,'0')}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}
function datePartsFromInput(value, prefix = '') {
  if (!value) return prefix === 'end' ? { endYear: null, endMonth: null, endDay: null } : { year: new Date().getFullYear(), month: null, day: null };
  const [year, month, day] = value.split('-').map(Number);
  if (prefix === 'end') return { endYear: year, endMonth: month, endDay: day };
  return { year, month, day };
}
function formatEndDisplayDate(t) {
  if (!t.endYear) return '';
  return formatDisplayDate({ year: t.endYear, month: t.endMonth, day: t.endDay });
}
function tripAccent(trip, hopperData) {
  return resolveTripVisual(trip, hopperData || {}).color || '#5d7288';
}


function ColorPopover({ colors = [], value, color, open, onToggle, onChoose }) {
  const currentColor = normalizeHexColor(color || '#00e5ff');
  const [customOpen, setCustomOpen] = useState(false);
  const [draftColor, setDraftColor] = useState(currentColor);
  useEffect(() => {
    if (open) {
      setCustomOpen(false);
      setDraftColor(currentColor);
    }
  }, [open, currentColor]);

  const draft = hexToRgbDraft(draftColor);
  const hue = rgbToHslDraft(draft.r, draft.g, draft.b).h;
  const hueColor = rgbHueColor(draft.r, draft.g, draft.b);

  function openCustomPicker() {
    setDraftColor(currentColor);
    setCustomOpen(true);
  }

  function cancelCustom() {
    setDraftColor(currentColor);
    setCustomOpen(false);
  }

  function applyCustom() {
    const clean = normalizeHexColor(draftColor);
    onChoose?.('custom', clean);
    setCustomOpen(false);
    onToggle?.();
  }

  function setDraftRgb(part, value) {
    const next = { ...draft, [part]: clampRgb(value) };
    setDraftColor(rgbToHexDraft(next.r, next.g, next.b));
  }

  function setHueFromInput(e) {
    const nextHue = Number(e.target.value) || 0;
    const currentHsv = rgbToHsvDraft(draft.r, draft.g, draft.b);
    const rgb = hsvToRgbDraft(nextHue / 360, currentHsv.s || 0.75, currentHsv.v || 0.85);
    setDraftColor(rgbToHexDraft(rgb.r, rgb.g, rgb.b));
  }

  function chooseFromField(e) {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
    const y = Math.max(0, Math.min(1, (e.clientY - rect.top) / Math.max(1, rect.height)));
    const rgb = hsvToRgbDraft(hue, x, 1 - y);
    setDraftColor(rgbToHexDraft(rgb.r, rgb.g, rgb.b));
  }

  return <span className="color-popover">
    <button type="button" className="color-popover__trigger" style={{ '--swatch': currentColor }} onClick={onToggle} title="Choose color" />
    {open && <span className="color-popover__menu glass color-popover__menu--custom">
      {colors.map(c => <button key={c.name} type="button" className={value === c.name ? 'is-selected' : ''} style={{ '--swatch': c.color }} title={c.label || c.name} onClick={() => onChoose?.(c.name, c.color)} />)}
      <button type="button" className={value === 'custom' ? 'custom-rainbow-swatch is-selected' : 'custom-rainbow-swatch'} style={{ '--custom-swatch': value === 'custom' ? currentColor : 'transparent' }} title="Custom color" onClick={openCustomPicker} />
      {customOpen && <span className="custom-color-panel glass">
        <span
          className="custom-color-field"
          style={{ '--hue-color': hueColor }}
          onPointerDown={(e) => { e.currentTarget.setPointerCapture?.(e.pointerId); chooseFromField(e); }}
          onPointerMove={(e) => { if (e.buttons) chooseFromField(e); }}
        >
          <span className="custom-color-field-cursor" style={{ left: `${Math.max(0, Math.min(1, rgbToHsvDraft(draft.r, draft.g, draft.b).s)) * 100}%`, top: `${(1 - Math.max(0, Math.min(1, rgbToHsvDraft(draft.r, draft.g, draft.b).v))) * 100}%` }} />
        </span>
        <span className="custom-color-row">
          <span className="custom-color-preview" style={{ '--swatch': draftColor }} />
          <input className="custom-hue-slider" type="range" min="0" max="360" value={Math.round(hue * 360)} onChange={setHueFromInput} />
        </span>
        <span className="custom-rgb-row">
          <label><input value={draft.r} onChange={(e) => setDraftRgb('r', e.target.value)} /><b>R</b></label>
          <label><input value={draft.g} onChange={(e) => setDraftRgb('g', e.target.value)} /><b>G</b></label>
          <label><input value={draft.b} onChange={(e) => setDraftRgb('b', e.target.value)} /><b>B</b></label>
        </span>
        <span className="custom-color-actions">
          <button type="button" className="custom-color-cancel" onClick={cancelCustom}>Cancel</button>
          <button type="button" className="custom-color-ok" onClick={applyCustom}>OK</button>
        </span>
      </span>}
    </span>}
  </span>;
}


function hexToRgbDraft(hex = '#00e5ff') {
  const clean = normalizeHexColor(hex).slice(1);
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16)
  };
}
function clampRgb(value) {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(255, n));
}
function rgbToHexDraft(r, g, b) {
  return '#' + [r, g, b].map(v => clampRgb(v).toString(16).padStart(2, '0')).join('');
}
function rgbHueColor(r, g, b) {
  const h = rgbToHslDraft(r, g, b).h;
  const rgb = hslToRgbDraft(h, 0.82, 0.52);
  return rgbToHexDraft(rgb.r, rgb.g, rgb.b);
}
function rgbToHsvDraft(r, g, b) {
  r = clampRgb(r) / 255; g = clampRgb(g) / 255; b = clampRgb(b) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)); break;
      case g: h = ((b - r) / d + 2); break;
      default: h = ((r - g) / d + 4); break;
    }
    h /= 6;
  }
  return { h, s: max === 0 ? 0 : d / max, v: max };
}
function hsvToRgbDraft(h, s, v) {
  h = ((Number(h) || 0) % 1 + 1) % 1;
  s = Math.max(0, Math.min(1, Number(s) || 0));
  v = Math.max(0, Math.min(1, Number(v) || 0));
  const i = Math.floor(h * 6);
  const f = h * 6 - i;
  const p = v * (1 - s);
  const q = v * (1 - f * s);
  const t = v * (1 - (1 - f) * s);
  let r, g, b;
  switch (i % 6) {
    case 0: r = v; g = t; b = p; break;
    case 1: r = q; g = v; b = p; break;
    case 2: r = p; g = v; b = t; break;
    case 3: r = p; g = q; b = v; break;
    case 4: r = t; g = p; b = v; break;
    default: r = v; g = p; b = q; break;
  }
  return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
}

function rgbToHslDraft(r, g, b) {
  r = clampRgb(r) / 255; g = clampRgb(g) / 255; b = clampRgb(b) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)); break;
      case g: h = ((b - r) / d + 2); break;
      default: h = ((r - g) / d + 4); break;
    }
    h /= 6;
  }
  return { h, s, l };
}
function hslToRgbDraft(h, s, l) {
  let r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return { r: Math.round(r * 255), g: Math.round(g * 255), b: Math.round(b * 255) };
}

function normalizeHexColor(value = '#00e5ff') {
  const raw = String(value || '').trim();
  if (/^#[0-9a-f]{6}$/i.test(raw)) return raw.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(raw)) return '#' + raw.slice(1).split('').map(ch => ch + ch).join('').toLowerCase();
  return '#00e5ff';
}

function automaticHopTitle(draft = {}, locById = {}, locs = []) {
  const shortName = (location, fallback = '') => {
    const raw = location?.name || location?.city?.name || fallback || '';
    return String(raw).split(',')[0].trim();
  };
  const destinations = [];
  if (draft.toCustomEnabled) destinations.push(shortName(null, draft.toCustomName));
  else destinations.push(shortName(locById[draft.toLocationId] || findLocationByText(locs, draft.toLocationText), draft.toLocationText));
  for (const leg of draft.extraLegs || []) {
    destinations.push(shortName(locById[leg.locationId] || findLocationByText(locs, leg.locationText), leg.locationText));
  }
  const names = destinations.map(value => String(value || '').trim()).filter(Boolean);
  const year = String(draft.year || new Date().getFullYear());
  if (!names.length) return `New Trip ${year}`;
  const month = monthLabel(draft.month);
  const destinationTitle = names.join(' + ').trim();
  return `${destinationTitle}${month ? ` ${month}` : ''} ${year}`
    .replace(/\s+/g, ' ')
    .trim();
}

function monthLabel(month) {
  if (month == null || String(month).trim() === '') return '';
  const numeric = Number(month);
  if (!Number.isFinite(numeric) || numeric < 1 || numeric > 12) return '';
  return MONTH_OPTIONS.find(m => Number(m.value) === numeric)?.label || '';
}
function modeIcon(mode) { return MODE_OPTIONS.find(m => m.id === mode)?.icon || '•'; }
function travelerSummary(travelers = [], guestHoppers = [], hopperData = {}) {
  return resolveTripVisual({ travelers, guestHoppers }, hopperData || {}).name || 'No hoppers selected';
}
function groupNameForHoppers(travelers = [], guestHoppers = [], visual = {}) {
  const permanentCount = Array.isArray(travelers) ? travelers.length : 0;
  const guestCount = Array.isArray(guestHoppers) ? guestHoppers.length : 0;
  if (visual?.isEmpty || permanentCount + guestCount === 0) return 'Required';
  if (visual?.isSquad) return 'Hop Squad';
  return (guestCount > 0 || permanentCount > 1) ? 'Group hop' : 'Solo hop';
}
function formatDateRangeLabel(t) {
  const start = toDateInputValue(t.year, t.month, t.day);
  const end = toDateInputValue(t.endYear, t.endMonth, t.endDay);
  const fmt = { month: 'long', day: 'numeric', year: 'numeric' };
  if (start && end) return `${new Date(start + 'T00:00:00').toLocaleDateString(undefined, fmt)} → ${new Date(end + 'T00:00:00').toLocaleDateString(undefined, fmt)}`;
  if (start) return new Date(start + 'T00:00:00').toLocaleDateString(undefined, fmt);
  return '';
}
function dateKey(year, month, day) {
  if (!year || !month || !day) return '';
  return `${String(year).padStart(4,'0')}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
}
function calendarDays(year, month) {
  const first = new Date(year, month - 1, 1);
  const last = new Date(year, month, 0).getDate();
  const out = Array(first.getDay()).fill(null);
  for (let d = 1; d <= last; d++) out.push(d);
  return out;
}

function buildNewTripSortKey(draft, trips, count) {
  return buildSortKey(draft, count);
}
function insertChronologically(trips) {
  return sortTripsForEditor(trips).map((t, i) => ({ ...t, sortKey: buildSortKey(t, i + 1) }));
}
function bucketKey(t) {
  const year = String(Number(t.year) || 9999).padStart(4,'0');
  const month = String(Number(t.month) || 13).padStart(2,'0');
  const day = String(Number(t.day) || 99).padStart(2,'0');
  const endYear = String(Number(t.endYear || t.year) || 9999).padStart(4,'0');
  const endMonth = String(Number(t.endMonth || t.month) || 13).padStart(2,'0');
  const endDay = String(Number(t.endDay || t.day) || 99).padStart(2,'0');
  return `${year}-${month}-${day}-${endYear}-${endMonth}-${endDay}`;
}
function buildSortKey(t, n) { return `${bucketKey(t)}-${String(n).padStart(3,'0')}`; }
function sortTripsForEditor(rows) {
  return [...(rows || [])].sort((a,b) => {
    const aKey = `${bucketKey(a)}-${String(a.label || a.toLocationName || a.toLocationId || '')}-${String(a.id || '')}`;
    const bKey = `${bucketKey(b)}-${String(b.label || b.toLocationName || b.toLocationId || '')}-${String(b.id || '')}`;
    return aKey.localeCompare(bKey);
  });
}
function activeHomeBaseId(homeBases, trip) { const key = `${trip.year}-${String(trip.month || 1).padStart(2,'0')}`; return (homeBases || []).find(h => h.start <= key && (!h.end || h.end >= key))?.locationId || 'melbourne-fl'; }
function formatDisplayDate(t) { if (t.month && t.day) return new Date(t.year, t.month - 1, t.day).toLocaleDateString(undefined, { month:'long', day:'numeric', year:'numeric' }); if (t.month) return new Date(t.year, t.month - 1, 1).toLocaleDateString(undefined, { month:'long', year:'numeric' }); return String(t.year); }
function formatTripDate(t) { return t.displayDate || formatDisplayDate(t); }
function countryNameFromCode(code) {
  const clean = String(code || '').toUpperCase();
  if (!clean) return '';
  if (clean === 'US') return 'United States';
  try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(clean) || clean; } catch { return clean; }
}
function locationCountry(l) { return l?.country || countryNameFromCode(l?.countryCode); }
function isUnitedStatesLocation(l) { return String(l?.countryCode || '').toUpperCase() === 'US' || locationCountry(l) === 'United States'; }
function displayLocation(l) { return selectedLocationText(l); }
function selectedLocationText(l) {
  if (!l) return '';
  const country = locationCountry(l);
  const region = l.region && regionShort(l.region);
  if (isUnitedStatesLocation(l)) return [l.name, region].filter(Boolean).join(', ');
  return [l.name, country].filter(Boolean).join(', ');
}
function suggestionDisplayText(l) {
  if (!l) return '';
  if (l._source === 'loading') return l.name || 'Loading city suggestions…';
  const country = locationCountry(l);
  const region = l.region && regionShort(l.region);
  if (isUnitedStatesLocation(l)) return [l.name, region, 'United States'].filter(Boolean).join(', ');
  return [l.name, country].filter(Boolean).join(', ');
}
function displayNameFromLocation(l) { return l?.name || ''; }
function summarizeTrip(t, locById, hopperData) { const to = locById[t.toLocationId]; const people = resolveTripVisual(t, hopperData || {}).name || 'No hoppers'; return `${MODE_OPTIONS.find(m => m.id === t.mode)?.label || t.mode} · ${people} · ${displayLocation(to) || t.toLocationName || t.toLocationId || 'Unmapped destination'}`; }
function normalizeSearchText(value) { return String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim(); }
function filterLocations(locs, q) {
  const needle = normalizeSearchText(q);
  if (!needle) return locs.slice(0, 6);
  return locs.filter(l => normalizeSearchText(`${l.name} ${l.region} ${l.country} ${l.id}`).includes(needle));
}
function locationSuggestions(locs, q, cityDb = [], cityDbLoaded = false, cityDbLoading = false) {
  const needle = normalizeSearchText(q);
  const saved = (!needle || needle.length < 2)
    ? filterLocations(locs, q).slice(0, 8).map(l => ({ ...l, _source: 'saved', _label: 'Saved' }))
    : filterLocations(locs, q).slice(0, 5).map((l, i) => ({ ...l, _source: 'saved', _label: 'Saved', _score: 500 - i }));

  if (!needle || needle.length < 2 || !cityDbLoaded || !Array.isArray(cityDb) || cityDb.length === 0) {
    if (cityDbLoading && needle.length >= 2) return [...saved, { id: `city-loading-${slug(q)}`, name: 'Loading city suggestions…', region: '', country: '', _source: 'loading', _label: 'City' }];
    return saved;
  }

  const cityMatches = [];
  for (const city of cityDb) {
    const score = citySuggestionScore(city, needle);
    if (score > 0) cityMatches.push({ ...citySuggestionToOption(city), _score: score });
    if (cityMatches.length > 160) break;
  }
  const existingKeys = new Set(saved.map(l => normalizeSearchText(`${l.name}|${regionShort(l.region)}|${l.country || l.countryCode || ''}`)));
  const cities = cityMatches
    .filter(l => !existingKeys.has(normalizeSearchText(`${l.name}|${regionShort(l.region)}|${l.country || l.countryCode || ''}`)))
    .sort((a,b) => b._score - a._score)
    .slice(0, 7);
  return [...saved, ...cities].slice(0, 10);
}
function cityField(city, key, fallback = '') {
  if (!city) return fallback;
  const compact = { id:'i', name:'n', asciiName:'a', aliases:'x', lat:'la', lon:'lo', countryCode:'cc', region:'r', featureCode:'f', population:'p', timezone:'tz' };
  return city[key] ?? city[compact[key]] ?? fallback;
}
function citySuggestionScore(city, needle) {
  const name = normalizeSearchText(cityField(city, 'name'));
  const ascii = normalizeSearchText(cityField(city, 'asciiName'));
  const region = normalizeSearchText(cityField(city, 'region'));
  const country = normalizeSearchText(cityField(city, 'countryCode'));
  const aliases = Array.isArray(cityField(city, 'aliases', [])) ? cityField(city, 'aliases', []).map(normalizeSearchText) : [];
  let score = 0;
  if (name === needle || ascii === needle) score = 240;
  else if (name.startsWith(needle) || ascii.startsWith(needle)) score = 190;
  else if (aliases.some(a => a === needle)) score = 175;
  else if (aliases.some(a => a.startsWith(needle))) score = 130;
  else if (name.includes(needle) || ascii.includes(needle)) score = 95;
  else if (`${name} ${region} ${country}`.includes(needle)) score = 55;
  if (!score) return 0;
  const pop = Math.max(0, Number(cityField(city, 'population', 0)) || 0);
  const popBoost = Math.min(45, Math.log10(pop + 10) * 7);
  const feature = cityField(city, 'featureCode');
  const capitalBoost = feature === 'PPLC' ? 24 : feature === 'PPLA' ? 12 : 0;
  return score + popBoost + capitalBoost;
}
function citySuggestionToOption(city) {
  const cc = cityField(city, 'countryCode');
  const country = countryNameFromCode(cc);
  return {
    id: `city-${cityField(city, 'id')}`,
    name: cityField(city, 'name'),
    region: cityField(city, 'region') || '',
    country,
    countryCode: cc,
    lat: cityField(city, 'lat'),
    lon: cityField(city, 'lon'),
    _source: 'city',
    _label: 'City',
    city
  };
}
function autocompleteMeta(l) {
  return suggestionDisplayText(l);
}
function findLocationByText(locs, text) {
  const q = normalizeSearchText(text);
  if (!q) return null;
  return (locs || []).find(location => [location.id, location.name, displayLocation(location)]
    .some(value => normalizeSearchText(value) === q)) || null;
}
function ensureLocationForCity(locations, city, fallbackText = '') {
  const option = citySuggestionToOption(city);
  const geonameId = Number(cityField(city, 'id'));
  const existingByGeoname = (locations || []).find(location => location.geonameId && Number(location.geonameId) === geonameId);
  const existing = existingByGeoname || findLocationByText(locations, displayLocation(option));
  if (existing) return { id: existing.id, locations };
  const cc = cityField(city, 'countryCode');
  const country = countryNameFromCode(cc);
  const base = {
    id: cityLocationId(city, fallbackText),
    name: cityField(city, 'name') || String(fallbackText || 'New destination').split(',')[0].trim(),
    region: cityField(city, 'region') || '',
    country,
    countryCode: cc || '',
    continent: '',
    lat: Number(cityField(city, 'lat')),
    lon: Number(cityField(city, 'lon')),
    geonameId,
    population: Number(cityField(city, 'population', 0)) || 0,
    timezone: cityField(city, 'timezone') || ''
  };
  const used = new Set(locations.map(l => l.id));
  let id = base.id;
  let n = 2;
  while (used.has(id)) id = `${base.id}-${n++}`;
  const loc = { ...base, id };
  return { id: loc.id, locations: [...locations, loc] };
}
function cityLocationId(city, fallbackText = '') {
  const cc = String(cityField(city, 'countryCode') || '').toLowerCase();
  const region = String(cityField(city, 'region') || '').toLowerCase();
  return slug([cityField(city, 'asciiName') || cityField(city, 'name') || fallbackText, region || cc].filter(Boolean).join('-'));
}
function regionShort(region) { const map = { California:'CA', Florida:'FL', Georgia:'GA', Illinois:'IL', 'New York':'NY', Texas:'TX', Nevada:'NV', Arizona:'AZ', Colorado:'CO', Tennessee:'TN', Kentucky:'KY', Washington:'WA', Massachusetts:'MA', Michigan:'MI', 'North Carolina':'NC', 'South Carolina':'SC', Pennsylvania:'PA', Maryland:'MD', Hawaii:'HI' }; return map[region] || region; }
function slug(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'') || `location-${Date.now()}`; }
function githubHeaders(token) { return { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }; }
function wait(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function toBase64(str) { return btoa(unescape(encodeURIComponent(str))); }
