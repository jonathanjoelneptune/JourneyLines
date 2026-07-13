import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import TravelMap from './components/TravelMap.jsx';
import PlaybackControls from './components/PlaybackControls.jsx';
import HopResultCards from './components/HopResultCards.jsx';
import TripCard from './components/TripCard.jsx';
import { sortTrips } from './utils/dateUtils.js';
import { expandTrip, flattenLegs, getTravelerKey } from './utils/tripExpansion.js';
import { legDurationMs } from './utils/routeTiming.js';
import { milesBetween } from './utils/distanceUtils.js';
import { auditHopperData, normalizeHopperData, resolveTripVisual, travelerListForLegacy, multiMemberCircleBackground, segmentedBorderGradient } from './utils/hopperUtils.js';
import baseTrips from './data/trips.json';
import baseLocations from './data/locations.json';
import homeBases from './data/homeBases.json';
import baseHoppers from './data/hoppers.json';
import settings from './data/settings.json';
import parameters from './data/parameters.json';
import routeDetails from './data/routeDetails.json';
import { buildRouteDetailsPayload, summarizeRouteDetails } from './utils/routeDetails.js';
import { playbackEngine } from './utils/playbackEngine.js';
import { getRoutingStatus, prewarmRoutingEngine, prewarmWhenIdle, restartRoutingEngine, subscribeRoutingStatus } from './utils/routingClient.js';
import { normalizeTripsForV61 } from './utils/tripModel.js';
import { DEFAULT_GLOBE_SPIN_SPEED, clampGlobeSpinSpeed, locationIdsVisitedByTrip, shouldEnterIdleMode } from './utils/globeInteraction.js';

const AdminPanel = lazy(() => import('./components/AdminPanel.jsx'));

const DEFAULT_TRAIL_TUNING = {
  solidThickness: 2.4,
  solidGlow: 0.5,
  solidActiveThickness: 2.4,
  solidActiveGlow: 0.5,
  solidActiveOpacity: 1.0,
  solidPassiveThickness: 1.15,
  solidPassiveGlow: 0.05,
  solidPassiveOpacity: 0.55,
  borderThickness: 1.35,
  borderZoomFade: 1.0,
  stripeThickness: 2.5,
  stripeSegmentMiles: 80,
  routeStackingEnabled: true,
  stripeSeparator: 0.45,
  stripeGlow: 0.75,
  stripeBevel: 0.45,
  stripeLaneEffect: 0.4,
  stripeActiveThickness: 2.5,
  stripeActiveSegmentMiles: 80,
  stripeActiveSeparator: 0.45,
  stripeActiveGlow: 0.75,
  stripeActiveBevel: 0.45,
  stripeActiveLaneEffect: 0.4,
  stripeActiveOpacity: 1.0,
  stripePassiveThickness: 1.25,
  stripePassiveSegmentMiles: 120,
  stripePassiveSeparator: 0.28,
  stripePassiveGlow: 0.04,
  stripePassiveBevel: 0.18,
  stripePassiveLaneEffect: 0.18,
  stripePassiveOpacity: 0.58,
  ribbonThickness: 5.0,
  ribbonGap: 0.75,
  ribbonSpread: 2.5,
  ribbonGlow: 0.0,
  ribbonActiveThickness: 5.0,
  ribbonActiveSpread: 2.5,
  ribbonActiveGap: 0.75,
  ribbonActiveGlow: 0.0,
  ribbonActiveOpacity: 1.0,
  ribbonPassiveThickness: 1.65,
  ribbonPassiveSpread: 0.65,
  ribbonPassiveGap: 0.25,
  ribbonPassiveGlow: 0.0,
  ribbonPassiveOpacity: 0.58,
  ribbonPassiveUseStripe: false,
  spiralThickness: 1.55,
  spiralSegmentMiles: 50,
  spiralAmplitude: 0.3,
  spiralGlow: 1.2,
  spiralAnimate: false,
  spiralActiveThickness: 1.55,
  spiralActiveSegmentMiles: 50,
  spiralActiveAmplitude: 0.3,
  spiralActiveGlow: 1.2,
  spiralActiveOpacity: 1.0,
  spiralActiveAnimate: false,
  spiralPassiveThickness: 1.0,
  spiralPassiveSegmentMiles: 120,
  spiralPassiveAmplitude: 0.18,
  spiralPassiveGlow: 0.0,
  spiralPassiveOpacity: 0.55,
  spiralPassiveAnimate: false
};

const DEFAULT_TIMELINE_TUNING = {
  inactiveHeadSize: 14,
  inactiveStemLength: 20,
  activeHeadSize: 16,
  activeStemLength: 37,
  activeLift: 15,
  pinBaseY: 1,
  playbackBarHeight: 10,
  yearOffsetY: -7,
  tooltipOffsetY: 70,
  animationMs: 450,
  animationOvershoot: 1.12
};


const PARAMETER_STORAGE_SIGNATURE_KEY = 'globehoppers.parametersSignature';
const GLOBEHOPPERS_V63 = true;

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function parameterSignatureFor(source = {}) {
  return stableStringify({
    updatedAt: source?.updatedAt || '',
    version: source?.version || '',
    showTrails: source?.showTrails ?? null,
    placeBackgroundsEnabled: source?.placeBackgroundsEnabled ?? null,
    routeStackingEnabled: source?.routeStackingEnabled ?? null,
    trailTuning: source?.trailTuning || {},
    timelineTuning: source?.timelineTuning || {}
  });
}

const REPO_PARAMETER_SIGNATURE = parameterSignatureFor(parameters);

function legIdentityForEntry(entry, index = 0, progress = 0) {
  return {
    tripId: entry?.trip?.id || null,
    legId: entry?.legId || entry?.leg?.legId || entry?.leg?.id || null,
    legIndex: Number.isFinite(Number(entry?.legIndex)) ? Number(entry.legIndex) : 0,
    progress: Math.max(0, Math.min(1, Number(progress) || 0)),
    index
  };
}

function playbackLegsConnect(previousLeg, nextLeg, toleranceMiles = 3.5) {
  if (!previousLeg?.to || !nextLeg?.from) return false;
  if (previousLeg.to.id && nextLeg.from.id && previousLeg.to.id === nextLeg.from.id) return true;
  const gap = milesBetween(previousLeg.to, nextLeg.from);
  return Number.isFinite(gap) && gap <= toleranceMiles;
}

function findLegIndexByIdentity(legs = [], identity = {}) {
  if (!identity?.tripId) return -1;
  if (identity?.legId) {
    const stable = (legs || []).findIndex(item => item?.trip?.id === identity.tripId && String(item?.legId || item?.leg?.legId || item?.leg?.id || '') === String(identity.legId));
    if (stable >= 0) return stable;
  }
  return (legs || []).findIndex(item => item?.trip?.id === identity.tripId && Number(item?.legIndex || 0) === Number(identity.legIndex || 0));
}

function dataSignatureForTrips(source = []) {
  try {
    const rows = (source || []).map(t => [
      t?.id || '',
      t?.sortKey || '',
      t?.year ?? '',
      t?.month ?? '',
      t?.day ?? '',
      t?.label || '',
      t?.toLocationId || '',
      Array.isArray(t?.route) ? t.route.map(r => `${r?.pointId || ''}:${r?.legId || ''}:${r?.locationId || ''}:${r?.modeFromPrevious || ''}`).join('>') : ''
    ].join('~'));
    return `${source?.length || 0}:${stableStringify(rows)}`;
  } catch {
    return `${source?.length || 0}:unknown`;
  }
}

const REPO_TRIPS_SIGNATURE = dataSignatureForTrips(normalizeTripsForV61(baseTrips, homeBases));
const REPO_LOCATIONS_SIGNATURE = `${baseLocations?.length || 0}:${stableStringify((baseLocations || []).map(l => [l?.id || '', l?.name || '', l?.lat ?? '', l?.lon ?? '']))}`;
const REPO_HOPPERS_SIGNATURE = stableStringify({
  hoppers: baseHoppers?.hoppers || [],
  hopSquads: baseHoppers?.hopSquads || []
});

function clearStaleTripCaches() {
  try {
    const previous = localStorage.getItem('journeylines.repoTripsSignature');
    if (previous !== REPO_TRIPS_SIGNATURE) {
      localStorage.removeItem('journeylines.trips');
      localStorage.removeItem('journeylines.locations');
      localStorage.removeItem('globehoppers.hoppers');
      localStorage.removeItem('journeylines.tripOrder');
      localStorage.removeItem('globehoppers.tripOrder');
      localStorage.setItem('journeylines.repoTripsSignature', REPO_TRIPS_SIGNATURE);
      localStorage.setItem('journeylines.repoLocationsSignature', REPO_LOCATIONS_SIGNATURE);
      localStorage.setItem('journeylines.repoHoppersSignature', REPO_HOPPERS_SIGNATURE);
    }
  } catch {}
}

function localParametersAreCurrent() {
  try {
    return localStorage.getItem(PARAMETER_STORAGE_SIGNATURE_KEY) === REPO_PARAMETER_SIGNATURE;
  } catch {
    return false;
  }
}

function readSyncedBoolean(key, repoDefault = false) {
  try {
    if (!localParametersAreCurrent()) return Boolean(repoDefault);
    const saved = localStorage.getItem(key);
    return saved == null ? Boolean(repoDefault) : saved === 'true';
  } catch {
    return Boolean(repoDefault);
  }
}

function readSyncedObject(key, repoDefault = {}) {
  try {
    if (!localParametersAreCurrent()) return repoDefault || {};
    const saved = JSON.parse(localStorage.getItem(key) || 'null');
    return saved && typeof saved === 'object' ? saved : (repoDefault || {});
  } catch {
    return repoDefault || {};
  }
}

function writeSyncedLocal(key, value, signature = REPO_PARAMETER_SIGNATURE) {
  try {
    localStorage.setItem(key, typeof value === 'string' ? value : JSON.stringify(value));
    localStorage.setItem(PARAMETER_STORAGE_SIGNATURE_KEY, signature);
  } catch {}
}

function writeSyncedBoolean(key, value, signature = REPO_PARAMETER_SIGNATURE) {
  try {
    localStorage.setItem(key, String(Boolean(value)));
    localStorage.setItem(PARAMETER_STORAGE_SIGNATURE_KEY, signature);
  } catch {}
}

function syncParameterLocalsFromRepoOnce() {
  try {
    if (localStorage.getItem(PARAMETER_STORAGE_SIGNATURE_KEY) === REPO_PARAMETER_SIGNATURE) return;
    localStorage.setItem('globehoppers.showTrails', String(parameters?.showTrails ?? true));
    localStorage.setItem('globehoppers.placeBackgroundsEnabled', String(Boolean(parameters?.placeBackgroundsEnabled)));
    localStorage.setItem('globehoppers.routeStackingEnabled', String(parameters?.routeStackingEnabled ?? true));
    localStorage.setItem('globehoppers.trailTuning', JSON.stringify({ ...DEFAULT_TRAIL_TUNING, ...(parameters?.trailTuning || {}) }));
    localStorage.setItem('globehoppers.timelineTuning', JSON.stringify({ ...DEFAULT_TIMELINE_TUNING, ...(parameters?.timelineTuning || {}) }));
    localStorage.setItem(PARAMETER_STORAGE_SIGNATURE_KEY, REPO_PARAMETER_SIGNATURE);
  } catch {}
}


export default function App() {
  syncParameterLocalsFromRepoOnce();
  clearStaleTripCaches();
  const [trips, setTrips] = useState(() => normalizeTripsForV61(baseTrips, homeBases));
  const [locations, setLocations] = useState(() => baseLocations);
  const [hopperData, setHopperData] = useState(() => baseHoppers);
  const [isPlaying, setIsPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [activeIndex, setActiveIndex] = useState(999999);
  const [legProgress, setLegProgress] = useState(1);
  const [projection, setProjection] = useState(settings.defaultProjection);
  const [cameraMode, setCameraMode] = useState('follow');
  const [showTrails, setShowTrails] = useState(() => readSyncedBoolean('globehoppers.showTrails', parameters?.showTrails ?? true));
  const [speed, setSpeed] = useState(settings.playbackSpeed);
  const [filter, setFilter] = useState('all');
  const [admin, setAdmin] = useState(false);
  const [tripDrawerOpen, setTripDrawerOpen] = useState(false);
  const [studioEditTripId, setStudioEditTripId] = useState(null);
  const [studioModalOnly, setStudioModalOnly] = useState(false);
  const [studioAddRequestId, setStudioAddRequestId] = useState(0);
  const [studioTimelineRequestId, setStudioTimelineRequestId] = useState(0);
  const [relocationTransition, setRelocationTransition] = useState(null);
  const tripDrawerScrollRef = useRef(0);
  const studioDrawerScrollRef = useRef(0);
  const [introLaunching, setIntroLaunching] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem('globehoppers.theme') || 'bold-dark');
  const [timelineView, setTimelineView] = useState(() => localStorage.getItem('globehoppers.timelineView') || 'expanded');
  const [showHero, setShowHero] = useState(true);
  const [globeOverview, setGlobeOverview] = useState(false);
  const [globeDisplayMode, setGlobeDisplayMode] = useState('both');
  const [globeSpinSpeed, setGlobeSpinSpeed] = useState(() => clampGlobeSpinSpeed(localStorage.getItem('globehoppers.globeSpinSpeed.v7.3') || DEFAULT_GLOBE_SPIN_SPEED));
  const [globeSpinPaused, setGlobeSpinPaused] = useState(false);
  const [idleMode, setIdleMode] = useState(false);
  const [idleExitMode, setIdleExitMode] = useState('none');
  const [idleActivityNonce, setIdleActivityNonce] = useState(0);
  const [destinationSelection, setDestinationSelection] = useState(null);
  const [jumpFade, setJumpFade] = useState(false);
  const addTripNoun = 'Hop';
  const [hopperEditorOpen, setHopperEditorOpen] = useState(false);
  const [resetNonce, setResetNonce] = useState(0);
  const [trailTuningOpen, setTrailTuningOpen] = useState(false);
  const [timelineTuningOpen, setTimelineTuningOpen] = useState(false);
  const [trailTuning, setTrailTuning] = useState(() => ({ ...DEFAULT_TRAIL_TUNING, ...(parameters?.trailTuning || {}), ...readSyncedObject('globehoppers.trailTuning', {}) }));
  const [timelineTuning, setTimelineTuning] = useState(() => ({ ...DEFAULT_TIMELINE_TUNING, ...(parameters?.timelineTuning || {}), ...readSyncedObject('globehoppers.timelineTuning', {}) }));
  const [routeStackingEnabled, setRouteStackingEnabled] = useState(() => readSyncedBoolean('globehoppers.routeStackingEnabled', parameters?.routeStackingEnabled ?? true));
  const [placeBackgroundsEnabled, setPlaceBackgroundsEnabled] = useState(() => readSyncedBoolean('globehoppers.placeBackgroundsEnabled', parameters?.placeBackgroundsEnabled ?? false));
  const [routeDetailsMessage, setRouteDetailsMessage] = useState('');
  const [routeDetailsBusy, setRouteDetailsBusy] = useState(false);
  const [repoSaveStatus, setRepoSaveStatus] = useState({ state: 'idle', label: 'No recent repository save', detail: '', startedAt: null, completedAt: null, error: null });
  const [routingStatus, setRoutingStatus] = useState(() => getRoutingStatus());
  const [liveRouteDetails, setLiveRouteDetails] = useState(() => routeDetails);
  const [playbackGeneration, setPlaybackGeneration] = useState(0);
  const clickRef = useRef(0);
  const tRef = useRef({ last: null, elapsed: 0 });
  const activeIndexRef = useRef(activeIndex);
  const legsRef = useRef([]);
  const speedRef = useRef(speed);
  const isPlayingRef = useRef(isPlaying);
  const playbackUiThrottleRef = useRef(0);
  const advancePlaybackRef = useRef(() => {});
  const playbackGenerationRef = useRef(0);
  const configuredPlaybackKeyRef = useRef('');
  const jumpTimersRef = useRef([]);
  const activePlaybackRef = useRef({ tripId: null, legId: null, legIndex: 0, progress: 1, index: null, generation: 0 });
  const pendingPlaySavedTripRef = useRef(null);
  const resumeAfterStudioRef = useRef(false);
  const resumeAfterTabHiddenRef = useRef(false);
  const relocationTransitionRef = useRef(null);
  const relocationSequenceRef = useRef(0);
  const idleTimerRef = useRef(null);
  const idleSnapshotRef = useRef(null);
  const destinationSelectionRef = useRef(null);
  const SETTLE_MS = settings.arrivalSettleMs || 4000;

  // Committed trip/location/hopper data comes from deployed repo JSON.
  // Do not let older browser localStorage override the repository timeline/order.
  useEffect(() => {
    try {
      localStorage.setItem('journeylines.repoTripsSignature', REPO_TRIPS_SIGNATURE);
      localStorage.setItem('journeylines.repoLocationsSignature', REPO_LOCATIONS_SIGNATURE);
      localStorage.setItem('journeylines.repoHoppersSignature', REPO_HOPPERS_SIGNATURE);
    } catch {}
  }, []);
  useEffect(() => localStorage.setItem('globehoppers.theme', theme), [theme]);
  useEffect(() => writeSyncedLocal('globehoppers.trailTuning', trailTuning), [trailTuning]);
  useEffect(() => writeSyncedBoolean('globehoppers.showTrails', showTrails), [showTrails]);
  useEffect(() => writeSyncedLocal('globehoppers.timelineTuning', timelineTuning), [timelineTuning]);
  useEffect(() => writeSyncedBoolean('globehoppers.routeStackingEnabled', routeStackingEnabled), [routeStackingEnabled]);
  useEffect(() => writeSyncedBoolean('globehoppers.placeBackgroundsEnabled', placeBackgroundsEnabled), [placeBackgroundsEnabled]);
  useEffect(() => localStorage.setItem('globehoppers.timelineView', timelineView), [timelineView]);
  useEffect(() => localStorage.setItem('globehoppers.globeSpinSpeed.v7.3', String(globeSpinSpeed)), [globeSpinSpeed]);
  useEffect(() => { destinationSelectionRef.current = destinationSelection; }, [destinationSelection]);
  useEffect(() => subscribeRoutingStatus(setRoutingStatus), []);
  useEffect(() => {
    const handleRouteDetailsUpdate = event => {
      if (event?.detail?.routes) setLiveRouteDetails(event.detail);
    };
    window.addEventListener('globehoppers-route-details-updated', handleRouteDetailsUpdate);
    return () => window.removeEventListener('globehoppers-route-details-updated', handleRouteDetailsUpdate);
  }, []);
  useEffect(() => {
    const handleRoutePreparationFailure = event => {
      const message = event?.detail?.message || 'Detailed route unavailable.';
      setRouteDetailsMessage(`Hop saved, but its detailed route could not be prepared: ${message}`);
    };
    window.addEventListener('globehoppers-route-preparation-failed', handleRoutePreparationFailure);
    return () => window.removeEventListener('globehoppers-route-preparation-failed', handleRoutePreparationFailure);
  }, []);
  useEffect(() => {
    prewarmWhenIdle();
    const warm = () => prewarmRoutingEngine('Add/Edit Hop').catch(() => {});
    window.addEventListener('globehoppers-open-new-trip', warm);
    window.addEventListener('globehoppers-open-edit-trip', warm);
    return () => {
      window.removeEventListener('globehoppers-open-new-trip', warm);
      window.removeEventListener('globehoppers-open-edit-trip', warm);
    };
  }, []);
  useEffect(() => {
    const closeStudio = () => {
      setAdmin(false);
      setStudioModalOnly(false);
      if (resumeAfterStudioRef.current) {
        resumeAfterStudioRef.current = false;
        tRef.current.last = null;
        setIsPlaying(true);
      }
    };
    window.addEventListener('globehoppers-close-studio', closeStudio);
    return () => window.removeEventListener('globehoppers-close-studio', closeStudio);
  }, []);


  const sortedTrips = useMemo(() => sortTrips(trips).filter(t => !t?.isHomeMove && t?.mode !== 'move' && !String(t?.id || '').startsWith('home-move-')), [trips]);
  const filteredTrips = useMemo(() => sortedTrips.filter(t => {
    const hasJ = t.travelers?.includes('joey'), hasB = t.travelers?.includes('bonnie');
    if (filter === 'joey') return hasJ;
    if (filter === 'bonnie') return hasB;
    if (filter === 'together') return hasJ && hasB;
    return true;
  }), [sortedTrips, filter]);
  const locById = useMemo(() => Object.fromEntries(locations.map(l => [l.id, l])), [locations]);
  const normalizedHoppers = useMemo(() => normalizeHopperData(hopperData), [hopperData]);
  const hopperIntegrity = useMemo(() => auditHopperData(normalizedHoppers, trips), [normalizedHoppers, trips]);
  const travelers = useMemo(() => travelerListForLegacy(normalizedHoppers), [normalizedHoppers]);
  const travById = useMemo(() => Object.fromEntries(travelers.map(t => [t.id, t])), [travelers]);
  const legs = useMemo(() => flattenLegs(filteredTrips, locById, homeBases), [filteredTrips, locById]);
  const tripTimeline = useMemo(() => buildTripTimeline(filteredTrips, legs, locById, normalizedHoppers), [filteredTrips, legs, locById, normalizedHoppers]);
  const timelineMarkers = useMemo(() => buildTimelineMarkers(tripTimeline, legs.length), [tripTimeline, legs.length]);
  const timelineYearSegments = useMemo(() => buildTimelineYearSegments(tripTimeline, legs.length), [tripTimeline, legs.length]);
  const timelineMonthTicks = useMemo(() => buildTimelineMonthTicks(tripTimeline, legs.length), [tripTimeline, legs.length]);
  const timelineYearSpan = useMemo(() => buildTimelineYearSpan(tripTimeline), [tripTimeline]);
  const tripCardRows = useMemo(() => buildTripCardRows(tripTimeline, activeIndex), [tripTimeline, activeIndex]);
  const routeDetailsStatus = useMemo(() => summarizeRouteDetails(liveRouteDetails, legs.length), [liveRouteDetails, legs.length]);
  const tripsDataStatus = useMemo(() => {
    const repoFirst = baseTrips?.[0];
    const activeFirst = trips?.[0];
    const sortedFirst = sortedTrips?.[0];
    const signatureMatches = dataSignatureForTrips(trips) === REPO_TRIPS_SIGNATURE;
    return {
      source: 'repo JSON',
      trips: trips?.length || 0,
      filteredTrips: sortedTrips?.length || 0,
      legs: legs?.length || 0,
      signatureMatches,
      repoSignature: REPO_TRIPS_SIGNATURE.slice(0, 18),
      firstRepo: repoFirst ? `${repoFirst.displayDate || repoFirst.year || ''} ${repoFirst.label || ''}`.trim() : '',
      firstLoaded: activeFirst ? `${activeFirst.displayDate || activeFirst.year || ''} ${activeFirst.label || ''}`.trim() : '',
      firstTimeline: sortedFirst ? `${sortedFirst.displayDate || sortedFirst.year || ''} ${sortedFirst.label || ''}`.trim() : ''
    };
  }, [trips, sortedTrips, legs.length]);
  const current = started && activeIndex >= 0 && activeIndex < legs.length ? legs[activeIndex] : null;
  const expanded = current ? expandTrip(current.trip, locById, homeBases) : null;
  const traveler = current ? resolveTripVisual(current.trip, normalizedHoppers) : null;

  activeIndexRef.current = activeIndex;
  legsRef.current = legs;
  speedRef.current = speed;
  isPlayingRef.current = isPlaying;
  relocationTransitionRef.current = relocationTransition;

  advancePlaybackRef.current = () => {
    const currentLegs = legsRef.current || [];
    if (!currentLegs.length || relocationTransitionRef.current) return;
    const identity = activePlaybackRef.current;
    const resolved = findLegIndexByIdentity(currentLegs, identity);
    const baseIndex = resolved >= 0 ? resolved : Math.max(0, Math.min(activeIndexRef.current, currentLegs.length - 1));
    const nextIndex = baseIndex + 1;
    if (nextIndex >= currentLegs.length) {
      const finalEntry = currentLegs[Math.max(0, currentLegs.length - 1)];
      activePlaybackRef.current = { ...legIdentityForEntry(finalEntry, currentLegs.length - 1, 1), generation: activePlaybackRef.current.generation || playbackGenerationRef.current };
      setLegProgress(1);
      setIsPlaying(false);
      return;
    }

    const currentEntry = currentLegs[baseIndex];
    const nextEntry = currentLegs[nextIndex];
    if (!playbackLegsConnect(currentEntry?.leg, nextEntry?.leg)) {
      playbackEngine.pause();
      setIsPlaying(false);
      setLegProgress(1);
      activePlaybackRef.current = { ...legIdentityForEntry(currentEntry, baseIndex, 1), generation: activePlaybackRef.current.generation || playbackGenerationRef.current };
      const id = `relocation-${++relocationSequenceRef.current}`;
      const transition = {
        id,
        from: currentEntry?.leg?.to || null,
        to: nextEntry?.leg?.from || null,
        nextIndex,
        nextTripId: nextEntry?.trip?.id || null,
        nextLegId: nextEntry?.legId || nextEntry?.leg?.legId || nextEntry?.leg?.id || null,
        nextMode: nextEntry?.leg?.mode || 'plane',
        distanceMiles: milesBetween(currentEntry?.leg?.to || {}, nextEntry?.leg?.from || {})
      };
      relocationTransitionRef.current = transition;
      setRelocationTransition(transition);
      return;
    }

    activePlaybackRef.current = { ...legIdentityForEntry(nextEntry, nextIndex, 0), generation: activePlaybackRef.current.generation || playbackGenerationRef.current };
    setLegProgress(0);
    setActiveIndex(nextIndex);
  };

  useEffect(() => {
    if (!legs.length) {
      activePlaybackRef.current = { tripId: null, legId: null, legIndex: 0, progress: 1, index: null, generation: playbackGenerationRef.current };
      setActiveIndex(0);
      setLegProgress(1);
      tRef.current = { last: null, elapsed: 0 };
      return;
    }

    const identity = activePlaybackRef.current;
    if (!identity?.tripId) {
      const clamped = Math.max(0, Math.min(activeIndex, legs.length - 1));
      if (clamped !== activeIndex) setActiveIndex(clamped);
      return;
    }

    const resolvedIndex = findLegIndexByIdentity(legs, identity);
    if (resolvedIndex >= 0) {
      if (resolvedIndex !== activeIndex) {
        const progress = Math.max(0, Math.min(1, Number(identity.progress) || 0));
        const resolvedLeg = legs[resolvedIndex]?.leg;
        const dur = legDurationMs(resolvedLeg?.miles || 500, speed, resolvedLeg?.mode);
        setActiveIndex(resolvedIndex);
        setLegProgress(progress);
        tRef.current = { last: null, elapsed: progress * dur };
      }
      return;
    }

    const fallbackTripIndex = legs.findIndex(item => item?.trip?.id === identity.tripId);
    if (fallbackTripIndex >= 0) {
      setActiveIndex(fallbackTripIndex);
      setLegProgress(0);
      tRef.current = { last: null, elapsed: 0 };
      activePlaybackRef.current = { ...legIdentityForEntry(legs[fallbackTripIndex], fallbackTripIndex, 0), generation: activePlaybackRef.current.generation || playbackGenerationRef.current };
      return;
    }

    const clamped = Math.max(0, Math.min(activeIndex, legs.length - 1));
    if (clamped !== activeIndex) {
      setActiveIndex(clamped);
      setLegProgress(0);
      tRef.current = { last: null, elapsed: 0 };
      activePlaybackRef.current = { ...legIdentityForEntry(legs[clamped], clamped, 0), generation: activePlaybackRef.current.generation || playbackGenerationRef.current };
    }
  }, [legs]);

  useEffect(() => {
    const safeIndex = Math.max(0, Math.min(activeIndex, Math.max(0, legs.length - 1)));
    const entry = legs[safeIndex];
    if (entry) {
      activePlaybackRef.current = {
        ...legIdentityForEntry(entry, safeIndex, legProgress),
        generation: activePlaybackRef.current.generation || playbackGenerationRef.current
      };
    }
  }, [activeIndex, legProgress]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        if (isPlaying) {
          resumeAfterTabHiddenRef.current = true;
          freezePlaybackClock();
          tRef.current.last = null;
          setIsPlaying(false);
        }
        return;
      }
      if (resumeAfterTabHiddenRef.current) {
        resumeAfterTabHiddenRef.current = false;
        tRef.current.last = null;
        setIsPlaying(true);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [isPlaying, activeIndex, legProgress, legs, speed]);

  useEffect(() => {
    const pauseForHopModal = () => {
      resumeAfterStudioRef.current = isPlaying;
      if (isPlaying) freezePlaybackClock();
      tRef.current.last = null;
      setIsPlaying(false);
    };
    const resumeAfterHopModal = () => {
      if (pendingPlaySavedTripRef.current) {
        resumeAfterStudioRef.current = false;
        return;
      }
      if (resumeAfterStudioRef.current) {
        resumeAfterStudioRef.current = false;
        tRef.current.last = null;
        setIsPlaying(true);
      }
    };
    window.addEventListener('globehoppers-pause-for-hop-modal', pauseForHopModal);
    window.addEventListener('globehoppers-resume-after-hop-modal', resumeAfterHopModal);
    return () => {
      window.removeEventListener('globehoppers-pause-for-hop-modal', pauseForHopModal);
      window.removeEventListener('globehoppers-resume-after-hop-modal', resumeAfterHopModal);
    };
  }, [isPlaying, activeIndex, legProgress, legs, speed]);


  const cancelDestinationSelection = useCallback((reason = 'cancel') => {
    const selection = destinationSelectionRef.current;
    if (!selection) return;
    destinationSelectionRef.current = null;
    setDestinationSelection(null);
    const snapshot = selection.snapshot || {};
    setStarted(Boolean(snapshot.started));
    setActiveIndex(Number.isFinite(snapshot.activeIndex) ? snapshot.activeIndex : activeIndexRef.current);
    setLegProgress(Number.isFinite(snapshot.legProgress) ? snapshot.legProgress : 0);
    setGlobeOverview(Boolean(snapshot.globeOverview));
    setCameraMode(snapshot.cameraMode || 'follow');
    setShowHero(Boolean(snapshot.showHero));
    setGlobeSpinPaused(Boolean(snapshot.globeSpinPaused));
    setIsPlaying(Boolean(snapshot.isPlaying));
    if (snapshot.camera) {
      window.dispatchEvent(new CustomEvent('globehoppers-restore-camera', { detail: { camera: snapshot.camera, reason } }));
    }
  }, []);

  useEffect(() => {
    const handleDestinationClick = event => {
      if (relocationTransitionRef.current || admin) return;
      window.dispatchEvent(new CustomEvent('globehoppers-close-search'));
      const locationId = event?.detail?.locationId;
      if (!locationId) return;
      const matches = tripTimeline.filter(row => row.destinationLocationIds?.includes(locationId));
      if (!matches.length) return;
      if (matches.length === 1) {
        setDestinationSelection(null);
        jumpToLeg(matches[0].firstIndex || 0, 0, true);
        return;
      }
      freezePlaybackClock();
      const selection = {
        locationId,
        locationName: event?.detail?.locationName || 'Destination',
        matches,
        snapshot: {
          started,
          activeIndex,
          legProgress,
          isPlaying,
          globeOverview,
          cameraMode,
          showHero,
          globeSpinPaused,
          camera: event?.detail?.camera || null
        }
      };
      destinationSelectionRef.current = selection;
      setDestinationSelection(selection);
      setIsPlaying(false);
      setGlobeSpinPaused(true);
    };
    window.addEventListener('globehoppers-destination-click', handleDestinationClick);
    return () => window.removeEventListener('globehoppers-destination-click', handleDestinationClick);
  }, [tripTimeline, admin, started, activeIndex, legProgress, isPlaying, globeOverview, cameraMode, showHero, globeSpinPaused]);

  useEffect(() => {
    const closeDestinationForSearch = () => {
      if (!destinationSelectionRef.current) return;
      destinationSelectionRef.current = null;
      setDestinationSelection(null);
    };
    window.addEventListener('globehoppers-search-opened', closeDestinationForSearch);
    return () => window.removeEventListener('globehoppers-search-opened', closeDestinationForSearch);
  }, []);

  useEffect(() => {
    if (!destinationSelection) return;
    const cancelOnOutside = event => {
      const target = event.target;
      if (target?.closest?.('.destination-trip-queue, .timeline-marker.is-destination-match, .jl-map-pin.is-selected-destination')) return;
      cancelDestinationSelection('outside-click');
    };
    const cancelOnEscape = event => {
      if (event.key === 'Escape') cancelDestinationSelection('escape');
    };
    window.addEventListener('pointerdown', cancelOnOutside, true);
    window.addEventListener('keydown', cancelOnEscape);
    return () => {
      window.removeEventListener('pointerdown', cancelOnOutside, true);
      window.removeEventListener('keydown', cancelOnEscape);
    };
  }, [destinationSelection, cancelDestinationSelection]);

  const enterIdleMode = useCallback(() => {
    if (!shouldEnterIdleMode({ isPlaying: isPlayingRef.current, isRelocating: Boolean(relocationTransitionRef.current), adminOpen: admin, destinationSelectionActive: Boolean(destinationSelectionRef.current) })) return;
    if (idleMode) return;
    idleSnapshotRef.current = {
      started,
      activeIndex,
      legProgress,
      globeOverview,
      cameraMode,
      showHero
    };
    setIdleExitMode('none');
    setIdleMode(true);
    setGlobeOverview(true);
    setGlobeSpinPaused(false);
    setCameraMode('global');
  }, [admin, idleMode, started, activeIndex, legProgress, globeOverview, cameraMode, showHero]);

  const exitIdleMode = useCallback((mode = 'restore') => {
    if (!idleMode) return false;
    const snapshot = idleSnapshotRef.current || {};
    setIdleExitMode(mode);
    setIdleMode(false);
    const preserveOverview = mode === 'selection';
    setGlobeOverview(mode === 'play' ? false : (preserveOverview ? true : Boolean(snapshot.globeOverview)));
    setCameraMode(mode === 'play'
      ? (snapshot.cameraMode === 'global' ? 'follow' : (snapshot.cameraMode || 'follow'))
      : (preserveOverview ? 'global' : (snapshot.cameraMode || 'follow')));
    setShowHero(Boolean(snapshot.showHero));
    window.setTimeout(() => setIdleExitMode('none'), 4800);
    return true;
  }, [idleMode]);

  useEffect(() => {
    window.clearTimeout(idleTimerRef.current);
    if (!shouldEnterIdleMode({ isPlaying, isRelocating: Boolean(relocationTransition), adminOpen: admin || hopperEditorOpen, destinationSelectionActive: Boolean(destinationSelection) })) return;
    idleTimerRef.current = window.setTimeout(enterIdleMode, 30000);
    return () => window.clearTimeout(idleTimerRef.current);
  }, [isPlaying, relocationTransition, admin, hopperEditorOpen, destinationSelection, started, activeIndex, legProgress, idleActivityNonce, enterIdleMode]);

  useEffect(() => {
    const activity = event => {
      window.clearTimeout(idleTimerRef.current);
      const playControl = event.target?.closest?.('.controls-play-pill');
      if (idleMode && !playControl) {
        const destinationMarker = event.target?.closest?.('.jl-map-pin');
        exitIdleMode(destinationMarker ? 'selection' : 'restore');
      }
      if (!playControl) setIdleActivityNonce(value => value + 1);
    };
    for (const name of ['pointerdown', 'wheel', 'keydown', 'touchstart']) window.addEventListener(name, activity, { capture: true, passive: name !== 'keydown' });
    return () => {
      for (const name of ['pointerdown', 'wheel', 'keydown', 'touchstart']) window.removeEventListener(name, activity, true);
    };
  }, [idleMode, exitIdleMode]);

  useEffect(() => {
    return playbackEngine.subscribe(frame => {
      const identity = activePlaybackRef.current;
      const metadata = frame?.metadata || {};
      const matchesIdentity = Boolean(
        identity?.tripId
        && metadata.tripId === identity.tripId
        && (!identity.legId || String(metadata.legId || '') === String(identity.legId))
        && Number(metadata.legIndex || 0) === Number(identity.legIndex || 0)
        && Number(frame.generation || metadata.generation || 0) === Number(identity.generation || 0)
      );
      if (!matchesIdentity) return;

      activePlaybackRef.current = {
        ...identity,
        progress: Math.max(0, Math.min(1, Number(frame.progress) || 0))
      };
      const now = Number(frame.timestamp || performance.now());
      const shouldUpdateUi = !frame.playing || now - playbackUiThrottleRef.current >= 100 || frame.rawProgress >= 1;
      if (shouldUpdateUi) {
        playbackUiThrottleRef.current = now;
        setLegProgress(Number(frame.rawProgress || 0));
      }
    });
  }, []);

  useEffect(() => {
    if (!legs.length || activeIndex < 0 || activeIndex >= legs.length) return;
    const entry = legs[activeIndex];
    const identity = activePlaybackRef.current;
    const sameLeg = identity?.tripId === entry?.trip?.id
      && (identity?.legId
        ? String(identity.legId) === String(entry?.legId || entry?.leg?.legId || entry?.leg?.id || '')
        : Number(identity?.legIndex || 0) === Number(entry?.legIndex || 0));
    const snapshot = playbackEngine.snapshot();
    const snapshotMatches = sameLeg
      && snapshot?.metadata?.tripId === entry?.trip?.id
      && (!entry?.legId || String(snapshot?.metadata?.legId || '') === String(entry?.legId || entry?.leg?.legId || entry?.leg?.id || ''))
      && Number(snapshot?.metadata?.legIndex || 0) === Number(entry?.legIndex || 0);
    const progress = snapshotMatches
      ? Math.max(0, Number(snapshot.rawProgress || 0))
      : sameLeg
        ? Number(identity.progress || 0)
        : Math.max(0, Math.min(1, Number(legProgress) || 0));
    const duration = legDurationMs(entry?.leg?.miles || 500, speed, entry?.leg?.mode);
    const settle = SETTLE_MS / Math.max(0.25, Number(speed) || 1);
    const playbackKey = `${entry?.trip?.id || ''}:${entry?.legId || entry?.leg?.legId || entry?.legIndex || 0}`;
    const generation = playbackEngine.configure({
      duration,
      settle,
      progress,
      metadata: { index: activeIndex, tripId: entry?.trip?.id || null, legId: entry?.legId || entry?.leg?.legId || entry?.leg?.id || null, legIndex: entry?.legIndex || 0 },
      onComplete: () => advancePlaybackRef.current?.()
    });
    playbackGenerationRef.current = generation;
    setPlaybackGeneration(generation);
    configuredPlaybackKeyRef.current = playbackKey;
    activePlaybackRef.current = {
      ...legIdentityForEntry(entry, activeIndex, Math.min(1, progress)),
      generation
    };
    if (isPlayingRef.current) playbackEngine.play();
  }, [activeIndex, legs, speed]);

  useEffect(() => {
    if (isPlaying) playbackEngine.play();
    else playbackEngine.pause();
  }, [isPlaying]);


  const completeRelocationTransition = useCallback((requestId) => {
    const transition = relocationTransitionRef.current;
    if (!transition || transition.id !== requestId) return;
    const currentLegs = legsRef.current || [];
    const nextIndex = Math.max(0, Math.min(Number(transition.nextIndex) || 0, Math.max(0, currentLegs.length - 1)));
    const nextEntry = currentLegs[nextIndex];
    relocationTransitionRef.current = null;
    setRelocationTransition(null);
    if (!nextEntry) {
      setIsPlaying(false);
      return;
    }
    activePlaybackRef.current = { ...legIdentityForEntry(nextEntry, nextIndex, 0), generation: activePlaybackRef.current.generation || playbackGenerationRef.current };
    setLegProgress(0);
    setActiveIndex(nextIndex);
    setIsPlaying(true);
  }, []);

  function freezePlaybackClock() {
    const snapshot = playbackEngine.snapshot();
    playbackEngine.pause();
    const progress = Math.max(0, Math.min(1, Number(snapshot?.progress ?? legProgress) || 0));
    setLegProgress(progress);
    activePlaybackRef.current = { ...activePlaybackRef.current, progress };
    tRef.current = { last: null, elapsed: Number(snapshot?.elapsed || 0) };
  }

  function play() {
    if (relocationTransitionRef.current) return;
    const wasIdle = idleMode;
    if (wasIdle) exitIdleMode('play');
    if (!legs.length) {
      setIsPlaying(false);
      setIntroLaunching(false);
      setStarted(false);
      setShowHero(true);
      return;
    }

    const wasGlobeOverview = globeOverview;
    const finalLegComplete = activeIndex >= legs.length - 1 && Number(legProgress || 0) >= 0.999999;
    if (started && finalLegComplete) {
      playbackEngine.pause();
      setIsPlaying(false);
      setIntroLaunching(false);
      return;
    }
    setGlobeOverview(false);
    setCameraMode(prev => prev === 'global' ? 'follow' : (prev || 'follow'));
    setShowHero(false);
    setAdmin(false);
    setStudioModalOnly(false);
    setTripDrawerOpen(false);

    if (wasIdle && started && activeIndex >= 0 && activeIndex < legs.length) {
      setIsPlaying(false);
      setIntroLaunching(true);
      return;
    }

    if (!started || activeIndex < 0 || activeIndex >= legs.length) {
      setActiveIndex(0);
      setLegProgress(0);
      activePlaybackRef.current = { ...legIdentityForEntry(legs[0], 0, 0), generation: playbackGenerationRef.current };
      tRef.current = { last: null, elapsed: 0 };
      setStarted(true);
      setIsPlaying(false);
      setIntroLaunching(true);
      return;
    }

    const currentLeg = legs[activeIndex]?.leg;
    const dur = legDurationMs(currentLeg?.miles || 500, speed, currentLeg?.mode);
    tRef.current = { last: null, elapsed: Math.max(0, Number(legProgress) || 0) * dur };
    if (wasGlobeOverview) {
      setIsPlaying(false);
      setIntroLaunching(true);
    } else {
      setIsPlaying(true);
    }
  }
  const completeIntroLaunch = useCallback(() => {
    setIntroLaunching(false);
    setIdleExitMode('none');
    const currentProgress = Math.max(0, Math.min(1, legProgress));
    playbackEngine.seek(currentProgress);
    setLegProgress(currentProgress);
    setIsPlaying(true);
  }, [legProgress]);
  function editTravelHistory() {
    if (destinationSelectionRef.current) cancelDestinationSelection('open-timeline');
    relocationTransitionRef.current = null;
    setRelocationTransition(null);
    setGlobeOverview(false);
    setShowHero(false);
    setTripDrawerOpen(false);
    setStudioEditTripId(null);
    setStudioAddRequestId(0);
    setStudioTimelineRequestId(value => value + 1);
    setStudioModalOnly(false);
    setAdmin(true);
    setStarted(true);
    setIntroLaunching(false);
  }

  function editTimelineMarker(marker) {
    relocationTransitionRef.current = null;
    setRelocationTransition(null);
    prewarmRoutingEngine('Edit Hop').catch(() => {});
    const tripId = marker?.id || marker?.tripId;
    if (!tripId) return;
    resumeAfterStudioRef.current = isPlaying;
    freezePlaybackClock();
    setGlobeOverview(false);
    setShowHero(false);
    setTripDrawerOpen(false);
    setTimelineTuningOpen(false);
    setTrailTuningOpen(false);
    setStudioModalOnly(!admin);
    setStudioAddRequestId(0);
    setStudioEditTripId(tripId);
    setAdmin(true);
    setStarted(true);
    setIntroLaunching(false);
    setIsPlaying(false);
  }
  function addTravelTimelineEntry() {
    if (destinationSelectionRef.current) cancelDestinationSelection('add-hop');
    if (idleMode) exitIdleMode('restore');
    relocationTransitionRef.current = null;
    setRelocationTransition(null);
    prewarmRoutingEngine('Add Hop').catch(() => {});
    resumeAfterStudioRef.current = isPlaying;
    freezePlaybackClock();
    setGlobeOverview(false);
    setShowHero(false);
    setTripDrawerOpen(false);
    setStudioEditTripId(null);
    setStudioModalOnly(true);
    setStudioAddRequestId(value => value + 1);
    setAdmin(true);
    setStarted(true);
    setIntroLaunching(false);
    tRef.current.last = null;
    setIsPlaying(false);
  }
  function pause() { resumeAfterTabHiddenRef.current = false; freezePlaybackClock(); setIsPlaying(false); }
  function viewGlobe() {
    if (destinationSelectionRef.current) cancelDestinationSelection('view-globe');
    if (idleMode) exitIdleMode('restore');
    relocationTransitionRef.current = null;
    setRelocationTransition(null);
    resumeAfterStudioRef.current = isPlaying;
    freezePlaybackClock();
    setAdmin(false);
    setTripDrawerOpen(false);
    setProjection('globe');
    setCameraMode('global');
    setGlobeOverview(true);
    setGlobeSpinPaused(false);
    setIsPlaying(false);
    setIntroLaunching(false);
    setShowHero(false);
    window.dispatchEvent(new CustomEvent('globehoppers-force-globe-overview'));
    window.setTimeout(() => window.dispatchEvent(new CustomEvent('globehoppers-force-globe-overview')), 12);
  }
  function restartJourney() {
    destinationSelectionRef.current = null;
    setDestinationSelection(null);
    idleSnapshotRef.current = null;
    setIdleMode(false);
    setIdleExitMode('none');
    relocationTransitionRef.current = null;
    setRelocationTransition(null);
    cancelPendingJumpTimers();
    resumeAfterStudioRef.current = false;
    resumeAfterTabHiddenRef.current = false;
    playbackEngine.stop(1);
    setIsPlaying(false);
    setIntroLaunching(false);
    setStarted(false);
    setShowHero(true);
    setGlobeOverview(false);
    setAdmin(false);
    setTripDrawerOpen(false);
    setStudioEditTripId(null);
    setStudioModalOnly(false);
    setTrailTuningOpen(false);
    setTimelineTuningOpen(false);
    setActiveIndex(999999);
    setLegProgress(1);
    tRef.current = { last: null, elapsed: 0 };
    activePlaybackRef.current = { tripId: null, legId: null, legIndex: 0, progress: 1, index: null, generation: playbackGenerationRef.current };
    setCameraMode('global');
    setResetNonce(n => n + 1);
  }
  function cancelPendingJumpTimers() {
    for (const timer of jumpTimersRef.current) window.clearTimeout(timer);
    jumpTimersRef.current = [];
  }

  function jumpToLeg(index, progressWithinLeg = 0, autoPlay = false) {
    relocationTransitionRef.current = null;
    setRelocationTransition(null);
    if (!legs.length) return;
    const safeIndex = Math.max(0, Math.min(legs.length - 1, Math.floor(index)));
    const safeProgress = Math.max(0, Math.min(1, progressWithinLeg));
    const selectedLeg = legs[safeIndex]?.leg;
    const dur = legDurationMs(selectedLeg?.miles || 500, speed, selectedLeg?.mode);

    const applyJump = () => {
      setGlobeOverview(false);
      setCameraMode(prev => prev === 'global' ? 'follow' : (prev || 'follow'));
      playbackEngine.pause();
      setStarted(true);
      setActiveIndex(safeIndex);
      setLegProgress(safeProgress);
      activePlaybackRef.current = { ...legIdentityForEntry(legs[safeIndex], safeIndex, safeProgress), generation: activePlaybackRef.current.generation || playbackGenerationRef.current };
      tRef.current = { last: null, elapsed: safeProgress * dur };
      playbackEngine.seek(safeProgress);
      setIsPlaying(Boolean(autoPlay));

      window.setTimeout(() => {
        if (selectedLeg?.from) {
          window.dispatchEvent(new CustomEvent('globehoppers-jump-to-leg-start', {
            detail: { lon: selectedLeg.from.lon, lat: selectedLeg.from.lat, mode: selectedLeg.mode, forceScene: true }
          }));
        }
      }, 0);
    };

    cancelPendingJumpTimers();
    setJumpFade(true);
    const applyTimer = window.setTimeout(applyJump, 115);
    const fadeTimer = window.setTimeout(() => {
      setJumpFade(false);
      jumpTimersRef.current = [];
    }, 360);
    jumpTimersRef.current = [applyTimer, fadeTimer];
  }
  useEffect(() => {
    const pending = pendingPlaySavedTripRef.current;
    if (!pending?.tripId || !legs.length) return;
    const index = legs.findIndex(item => item?.trip?.id === pending.tripId);
    if (index < 0) {
      if (Date.now() - Number(pending.requestedAt || 0) > 5000) pendingPlaySavedTripRef.current = null;
      return;
    }
    pendingPlaySavedTripRef.current = null;
    resumeAfterStudioRef.current = false;
    jumpToLeg(index, 0, true);
  }, [legs]);

  function handleTripSavedPlayback({ tripId, action, label, shouldAutoPlay = action === 'add', changeKind = 'metadata' } = {}) {
    if (!tripId) return;
    resumeAfterStudioRef.current = false;
    if (!shouldAutoPlay) {
      pendingPlaySavedTripRef.current = null;
      return;
    }
    pendingPlaySavedTripRef.current = { tripId, action, label, changeKind, requestedAt: Date.now() };
    setGlobeOverview(false);
    setShowHero(false);
    setStarted(true);
    setIntroLaunching(false);
  }

  function seekTimeline(fraction) {
    if (!legs.length) return;
    const p = Math.max(0, Math.min(0.999999, Number(fraction) || 0));
    const raw = p * legs.length;
    const index = Math.max(0, Math.min(legs.length - 1, Math.floor(raw)));
    const withinLeg = raw - index;
    jumpToLeg(index, withinLeg, isPlaying);
  }
  function openStudioForTrip(tripId) {
    prewarmRoutingEngine('Edit Hop').catch(() => {});
    setTripDrawerOpen(false);
    setStudioAddRequestId(0);
    setStudioEditTripId(tripId);
    setAdmin(true);
    setStarted(true);
    setIntroLaunching(false);
    setIsPlaying(false);
  }

  function playTripFromStudio(tripId) {
    const index = legs.findIndex(item => item?.trip?.id === tripId);
    if (index < 0) return;
    jumpToLeg(index, 0, true);
  }

  async function saveParametersToRepo() {
    const repo = localStorage.getItem('journeylines.githubRepo') || localStorage.getItem('journeylines.repo') || 'jonathanjoelneptune/JourneyLines';
    const token = localStorage.getItem('journeylines.githubToken') || '';
    const payload = { version: '4.21', updatedAt: new Date().toISOString(), trailTuning, timelineTuning, routeStackingEnabled, placeBackgroundsEnabled, showTrails };
    if (!token) return false;
    await commitSingleJsonFile(repo, token, 'journeylines/src/data/parameters.json', payload, 'Update GlobeHoppers parameters');
    const savedSignature = parameterSignatureFor(payload);
    writeSyncedLocal('globehoppers.trailTuning', trailTuning, savedSignature);
    writeSyncedLocal('globehoppers.timelineTuning', timelineTuning, savedSignature);
    writeSyncedBoolean('globehoppers.showTrails', showTrails, savedSignature);
    writeSyncedBoolean('globehoppers.routeStackingEnabled', routeStackingEnabled, savedSignature);
    writeSyncedBoolean('globehoppers.placeBackgroundsEnabled', placeBackgroundsEnabled, savedSignature);
    return true;
  }

  async function rebuildRouteDetailsToRepo() {
    const repo = localStorage.getItem('journeylines.githubRepo') || localStorage.getItem('journeylines.repo') || 'jonathanjoelneptune/JourneyLines';
    const token = localStorage.getItem('journeylines.githubToken') || '';
    if (!token) {
      setRouteDetailsMessage('Add a GitHub token in Repository Settings first.');
      return false;
    }
    try {
      setRouteDetailsBusy(true);
      setRouteDetailsMessage('Rebuilding route details…');
      const payload = buildRouteDetailsPayload(trips, locations, homeBases, liveRouteDetails);
      await commitSingleJsonFile(repo, token, 'journeylines/src/data/routeDetails.json', payload, 'Rebuild GlobeHoppers route details');
      try { localStorage.setItem('journeylines.routeDetails', JSON.stringify(payload)); } catch {}
      setLiveRouteDetails(payload);
      window.dispatchEvent(new CustomEvent('globehoppers-route-details-updated', { detail: payload }));
      const summary = summarizeRouteDetails(payload, legs.length);
      setRouteDetailsMessage(`Route details rebuilt: ${summary.records} legs, ${summary.geometries} geometries (${summary.detailed} detailed, ${summary.simple} simple, ${summary.missing} missing). Refresh after deploy/update to load the committed file.`);
      return true;
    } catch (error) {
      setRouteDetailsMessage(error?.message || String(error));
      return false;
    } finally {
      setRouteDetailsBusy(false);
    }
  }

  function titleClick() {
    clickRef.current += 1;
    setTimeout(() => { clickRef.current = 0; }, 900);
    if (clickRef.current >= settings.adminClickCount) {
      setTrailTuningOpen(v => !v);
      setTimelineTuningOpen(false);
      setAdmin(false);
      setTripDrawerOpen(false);
      setShowHero(false);
      setGlobeOverview(true);
      setCameraMode('global');
      setStarted(true);
      setIntroLaunching(false);
      setIsPlaying(false);
      clickRef.current = 0;
    }
  }

  const progress = legs.length ? Math.min(1, (Math.min(activeIndex, legs.length - 1) + Math.min(1, legProgress)) / legs.length) : 1;
  const timelineComplete = started && legs.length > 0 && activeIndex >= legs.length - 1 && Number(legProgress || 0) >= 0.999999;
  const hasPlaybackStarted = started && !introLaunching && activeIndex >= 0 && activeIndex < legs.length && !timelineComplete;
  const isRelocating = Boolean(relocationTransition);
  const topbarPlaybackTitle = isRelocating
    ? 'Moving to the next Hop'
    : timelineComplete
      ? 'Timeline Complete — Use Restart Journey'
      : (isPlaying ? 'Pause' : (hasPlaybackStarted ? 'Resume Travel History' : 'Play Travel History'));

  return <main className={`app ${isPlaying ? 'is-playing' : ''} ${isRelocating ? 'is-relocating' : ''}`} data-theme={theme}>
    <header className="topbar">
      <button className="brand" onClick={titleClick} title="GlobeHoppers">GlobeHoppers</button>
      <div className="tagline">All your hops, skips & jumps.</div>
      <button className="topbar-pill topbar-add" onClick={addTravelTimelineEntry}>Add Hop</button>
      <button className="topbar-pill topbar-old-timeline" aria-hidden="true" tabIndex={-1} onClick={() => { setAdmin(false); setTripDrawerOpen(v => !v); }}>Old Timeline</button>
      <button className="topbar-pill topbar-hoppers" onClick={() => { if (destinationSelectionRef.current) cancelDestinationSelection('hoppers'); setStudioAddRequestId(0); setHopperEditorOpen(true); setAdmin(false); setTripDrawerOpen(false); }}><span className="topbar-hoppers-icon" aria-hidden="true">👤</span><span>Hoppers</span></button>
      <button className="topbar-pill" onClick={editTravelHistory}>GlobeHopper Timeline</button>
      <div className="topbar-globe-menu">
        <button className="topbar-pill topbar-icon-pill topbar-globe-button" title="View Globe" onClick={() => { setGlobeDisplayMode('both'); viewGlobe(); }}>🌐</button>
        <div className="topbar-globe-menu__panel" role="menu" aria-label="Globe view options">
          <button type="button" role="menuitem" onClick={() => { setGlobeDisplayMode('routes'); viewGlobe(); }}>Routes only</button>
          <button type="button" role="menuitem" onClick={() => { setGlobeDisplayMode('locations'); viewGlobe(); }}>Locations only</button>
        </div>
      </div>
      <button className="topbar-pill topbar-icon-pill topbar-fullscreen" title={document.fullscreenElement ? 'Exit fullscreen' : 'Fullscreen'} onClick={() => document.fullscreenElement ? document.exitFullscreen?.() : document.documentElement.requestFullscreen?.()}><span className="fullscreen-corners" aria-hidden="true"><i></i><i></i><i></i><i></i></span></button>
      <button className="topbar-pill topbar-icon-pill" title={topbarPlaybackTitle} aria-label={topbarPlaybackTitle} disabled={isRelocating} onClick={isPlaying ? pause : play}>{isRelocating ? '…' : isPlaying ? '⏸' : '▶'}</button>
    </header>
    <div className={`timeline-jump-fade ${jumpFade ? 'is-active' : ''}`} />
    <TravelMap routeDetailsData={liveRouteDetails} playbackGeneration={playbackGeneration} trips={filteredTrips} locations={locations} homeBases={homeBases} travelers={travelers} activeIndex={activeIndex} legProgress={legProgress} projectionName={projection} hopperData={normalizedHoppers} cameraMode={cameraMode} showTrails={showTrails} trailOpacity={settings.trailOpacity} trailWidth={settings.trailWidth} trailTuningOpen={trailTuningOpen} trailTuning={{ ...trailTuning, routeStackingEnabled }} placeBackgroundsEnabled={placeBackgroundsEnabled} isPlaying={isPlaying} isStarted={started} introLaunching={introLaunching} relocationTransition={relocationTransition} onRelocationComplete={completeRelocationTransition} onIntroLaunchComplete={completeIntroLaunch} resetNonce={resetNonce} globeOverview={globeOverview} globeDisplayMode={globeDisplayMode} globeSpinSpeed={globeSpinSpeed} globeSpinPaused={globeSpinPaused} idleMode={idleMode} idleExitMode={idleExitMode} destinationSelectionEnabled={!isRelocating && !admin} destinationSelectionActive={Boolean(destinationSelection)} selectedDestinationId={destinationSelection?.locationId || null} onMapClick={() => { if (destinationSelectionRef.current) { cancelDestinationSelection('map-click'); return; } if (admin) window.dispatchEvent(new CustomEvent('globehoppers-request-close-studio')); if (tripDrawerOpen) setTripDrawerOpen(false); }} />
    {!started && showHero && <section className="hero glass">
      <button type="button" className="hero-close" aria-label="Close welcome popup" title="Close" onClick={() => setShowHero(false)}>×</button>
      <p className="eyebrow">{filteredTrips.length} trips · lifetime travel archive</p>
      <h1>GlobeHoppers</h1>
      <p>All your hops, skips & jumps, replayed across a living globe.</p>
      <div className="hero-actions">
        <button className="primary big" onClick={play}>Start the Journey</button>
        <button className="primary big hero-add-hop" onClick={addTravelTimelineEntry}>Add Hop</button>
        <button className="secondary big" onClick={() => { setGlobeDisplayMode('both'); viewGlobe(); }}>Explore the Globe</button>
      </div>
    </section>}
    {destinationSelection && <DestinationTripQueue selection={destinationSelection} onSelect={(row) => { destinationSelectionRef.current = null; setDestinationSelection(null); setGlobeSpinPaused(Boolean(destinationSelection.snapshot?.globeSpinPaused)); jumpToLeg(row.firstIndex || 0, 0, true); }} onCancel={() => cancelDestinationSelection('queue-cancel')} />}
    <TripCard trip={current?.trip} expanded={expanded} traveler={traveler} isPlaying={isPlaying} rows={tripCardRows} onJumpToTrip={(index) => jumpToLeg(index, 0, true)} onOpenTrips={() => { setAdmin(false); setTripDrawerOpen(true); }} />
    <PlaybackControls isPlaying={isPlaying} hasPlaybackStarted={hasPlaybackStarted} timelineComplete={timelineComplete} isRelocating={isRelocating} onPlay={play} onPause={pause} onReset={restartJourney} onViewGlobe={viewGlobe} globeControlsVisible={!isPlaying && (!started || globeOverview || idleMode)} globeSpinSpeed={globeSpinSpeed} onGlobeSpinSpeedChange={(value) => setGlobeSpinSpeed(clampGlobeSpinSpeed(value))} globeSpinPaused={globeSpinPaused} onToggleGlobeSpin={() => setGlobeSpinPaused(value => !value)} onGlobeZoom={(delta) => window.dispatchEvent(new CustomEvent('globehoppers-globe-zoom', { detail: { delta } }))} progress={progress} onSeekProgress={seekTimeline} onMarkerJump={(marker) => { if (destinationSelectionRef.current) { const selection = destinationSelectionRef.current; const match = selection.matches.find(row => row.id === marker.id); if (match) { destinationSelectionRef.current = null; setDestinationSelection(null); setGlobeSpinPaused(Boolean(selection.snapshot?.globeSpinPaused)); jumpToLeg(match.firstIndex || 0, 0, true); return; } } jumpToLeg(marker.firstIndex || 0, 0, true); }} onMarkerEdit={editTimelineMarker} destinationMatchIds={destinationSelection?.matches?.map(row => row.id) || []} speed={speed} setSpeed={setSpeed} filter={filter} setFilter={(value) => {
      freezePlaybackClock();
      setIsPlaying(false);
      setFilter(value);
    }} projection={projection} setProjection={setProjection} cameraMode={cameraMode} setCameraMode={setCameraMode} showTrails={showTrails} setShowTrails={setShowTrails} routeStackingEnabled={routeStackingEnabled} setRouteStackingEnabled={setRouteStackingEnabled} placeBackgroundsEnabled={placeBackgroundsEnabled} setPlaceBackgroundsEnabled={setPlaceBackgroundsEnabled} theme={theme} setTheme={setTheme} onToggleTripDrawer={() => { setAdmin(false); setTripDrawerOpen(v => !v); }} onToggleTimelineUtility={() => { setTimelineTuningOpen(v => !v); setTrailTuningOpen(false); }} timelineTuning={timelineTuning} tripMarkers={timelineMarkers} activeMarkerId={globeOverview ? null : (current?.trip?.id || null)} yearSegments={timelineYearSegments} monthTicks={timelineMonthTicks} timelineYearSpan={timelineYearSpan} searchRows={tripTimeline} routeDetailsStatus={routeDetailsStatus} routingStatus={routingStatus} onRetryRouting={() => restartRoutingEngine('manual retry').catch(() => {})} tripsDataStatus={tripsDataStatus} hopperIntegrity={hopperIntegrity} repoSaveStatus={repoSaveStatus}
        onRetryRepoSave={() => {
          setAdmin(true);
          setStudioModalOnly(false);
          window.dispatchEvent(new CustomEvent('globehoppers-retry-repo-save'));
          window.setTimeout(() => window.dispatchEvent(new CustomEvent('globehoppers-retry-repo-save')), 650);
        }} routeDetailsMessage={routeDetailsMessage} routeDetailsBusy={routeDetailsBusy} onRebuildRouteDetails={rebuildRouteDetailsToRepo} />
    {trailTuningOpen && <TrailTuningUtility values={trailTuning} onChange={setTrailTuning} onClose={() => setTrailTuningOpen(false)} onReset={() => setTrailTuning(DEFAULT_TRAIL_TUNING)} onSave={saveParametersToRepo} />}
    {timelineTuningOpen && <TimelineTuningUtility values={timelineTuning} onChange={setTimelineTuning} onClose={() => setTimelineTuningOpen(false)} onReset={() => setTimelineTuning(DEFAULT_TIMELINE_TUNING)} onSave={saveParametersToRepo} />}
    <TripTimelineDrawer open={tripDrawerOpen} rows={tripTimeline} activeIndex={activeIndex} initialScroll={studioDrawerScrollRef.current || tripDrawerScrollRef.current} onScrollStore={(y) => { tripDrawerScrollRef.current = y; }} onClose={() => setTripDrawerOpen(false)} onJump={(index) => jumpToLeg(index, 0, true)} onEditTrip={openStudioForTrip} viewType={timelineView} onViewTypeChange={setTimelineView} />
    <section className="about glass">
      <strong>About</strong> GlobeHoppers is an animated travel-history map for all your hops, skips & jumps. Five-click the title to open GlobeHoppers Studio.
    </section>
    {hopperEditorOpen && <HopperEditorPanel hopperData={hopperData} setHopperData={setHopperData} onClose={() => setHopperEditorOpen(false)} repo={""} />}
    {admin && <Suspense fallback={<div className="studio-loading-overlay"><div className="studio-loading-card glass"><strong>Opening GlobeHoppers Studio…</strong><span>Loading editor tools</span></div></div>}><AdminPanel trips={trips} setTrips={setTrips} locations={locations} setLocations={setLocations} homeBases={homeBases} initialEditTripId={studioEditTripId} initialAddRequestId={studioAddRequestId} initialTimelineRequestId={studioTimelineRequestId} initialScroll={tripDrawerScrollRef.current || studioDrawerScrollRef.current} onScrollStore={(y) => { studioDrawerScrollRef.current = y; }} onConsumedInitialEdit={() => setStudioEditTripId(null)} viewType={timelineView} onViewTypeChange={setTimelineView} addTripNoun={addTripNoun} hopperData={hopperData} setHopperData={setHopperData} activeTripId={current?.trip?.id} onPlayTrip={playTripFromStudio} onTripSaved={handleTripSavedPlayback} modalOnly={studioModalOnly} onRepoSaveStatus={setRepoSaveStatus} /></Suspense>}
  </main>;
}




function DestinationTripQueue({ selection, onSelect, onCancel }) {
  return <aside className="destination-trip-queue" role="dialog" aria-label={`Trips to ${selection.locationName}`}>
    <div className="destination-trip-queue__head">
      <div><p className="eyebrow">Choose a Hop</p><h3>{selection.locationName}</h3></div>
      <button type="button" aria-label="Cancel destination selection" onClick={onCancel}>×</button>
    </div>
    <p className="destination-trip-queue__hint">This destination appears in {selection.matches.length} Hops. Choose a card to play it.</p>
    <div className="destination-trip-queue__list">
      <HopResultCards rows={selection.matches} onSelect={onSelect} />
    </div>
  </aside>;
}


function TrailTuningUtility({ values, onChange, onClose, onReset, onSave }) {
  const [tab, setTab] = useState('active');
  const update = (key, value) => onChange(v => ({ ...v, [key]: value }));
  const row = (key, label, min, max, step = 0.05, suffix = 'x') => (
    <label className="trail-tuning-row">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={values[key] ?? 0} onChange={e => update(key, Number(e.target.value))} />
      <b>{Number(values[key] ?? 0).toFixed(step >= 1 ? 0 : 2)}{suffix}</b>
    </label>
  );
  const check = (key, label) => (
    <label className="trail-tuning-check"><input type="checkbox" checked={!!values[key]} onChange={e => update(key, e.target.checked)} /> {label}</label>
  );
  const prefix = tab === 'active' ? 'Active' : 'Passive';
  const isActive = tab === 'active';
  return <aside className="trail-tuning glass">
    <div className="trail-tuning__head">
      <div><p className="eyebrow">Trail Utility</p><h3>Trail tuning</h3></div>
      <button type="button" onClick={onClose} aria-label="Close trail tuning">×</button>
    </div>
    <p className="trail-tuning__note">Demo mode shows each trail twice: active on top, passive below. Active trails fade out while passive trails fade in when a trip completes.</p>
    <div className="trail-tuning-tabs" role="tablist" aria-label="Trail tuning mode">
      <button type="button" className={isActive ? 'active' : ''} onClick={() => setTab('active')}>Active</button>
      <button type="button" className={!isActive ? 'active' : ''} onClick={() => setTab('passive')}>Passive</button>
    </div>
    <section>
      <h4>Solid {tab}</h4>
      {row(`solid${prefix}Thickness`, 'Thickness', 0.6, 5.0, 0.05, 'x')}
      {row(`solid${prefix}Glow`, 'Glow', 0, 2, 0.05, 'x')}
      {row(`solid${prefix}Opacity`, 'Opacity', 0.05, 1.25, 0.05, 'x')}
    </section>
    <section>
      <h4>All trails</h4>
      {row('borderThickness', 'Black border', 0, 3, 0.05, 'px')}
      {row('borderZoomFade', 'Border zoom fade', 0, 1, 0.05, 'x')}
    </section>
    <section>
      <h4>Stripe {tab}</h4>
      {row(`stripe${prefix}Thickness`, 'Thickness', 0.8, 5.0, 0.05, 'x')}
      {row(`stripe${prefix}SegmentMiles`, 'Segment length', 5, 650, 5, ' mi')}
      {row(`stripe${prefix}Separator`, 'Dark transition', 0, 2.4, 0.05, 'x')}
      {row(`stripe${prefix}Glow`, 'Glow', 0, 2, 0.05, 'x')}
      {row(`stripe${prefix}Bevel`, 'Bevel/highlight', 0, 1.5, 0.05, 'x')}
      {row(`stripe${prefix}LaneEffect`, 'Lane contrast', 0, 2, 0.05, 'x')}
      {row(`stripe${prefix}Opacity`, 'Opacity', 0.05, 1.25, 0.05, 'x')}
    </section>
    <section>
      <h4>Ribbon {tab}</h4>
      {row(`ribbon${prefix}Thickness`, 'Thickness', 0.9, 5.0, 0.05, 'x')}
      {row(`ribbon${prefix}Spread`, 'Spread', 0, 3.0, 0.05, 'x')}
      {row(`ribbon${prefix}Gap`, 'Dark separation', 0, 1.4, 0.05, 'x')}
      {row(`ribbon${prefix}Glow`, 'Glow', 0, 2, 0.05, 'x')}
      {row(`ribbon${prefix}Opacity`, 'Opacity', 0.05, 1.25, 0.05, 'x')}
      {!isActive && check('ribbonPassiveUseStripe', 'Use passive Stripe for passive Ribbon')}
    </section>
    <section>
      <h4>Spiral {tab}</h4>
      {row(`spiral${prefix}Thickness`, 'Thickness', 0.9, 3.2, 0.05, 'x')}
      {row(`spiral${prefix}SegmentMiles`, 'Twist length', 50, 360, 10, ' mi')}
      {row(`spiral${prefix}Amplitude`, 'Twist depth', 0.05, 2.4, 0.05, 'x')}
      {row(`spiral${prefix}Glow`, 'Glow', 0, 2, 0.05, 'x')}
      {row(`spiral${prefix}Opacity`, 'Opacity', 0.05, 1.25, 0.05, 'x')}
      {check(`spiral${prefix}Animate`, `Animate ${tab} spiral`)}
    </section>
    <div className="trail-tuning__actions">
      <button type="button" className="secondary" onClick={onReset}>Reset</button>
      <button type="button" className="secondary" onClick={onClose}>Cancel</button>
      <button type="button" className="primary" onClick={async () => { await onSave?.(); onClose?.(); }}>Save</button>
    </div>
  </aside>;
}


function TimelineTuningUtility({ values, onChange, onClose, onReset, onSave }) {
  const update = (key, value) => onChange(v => ({ ...v, [key]: value }));
  const row = (key, label, min, max, step = 1, suffix = 'px') => (
    <label className="trail-tuning-row timeline-tuning-row">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={values[key]} onChange={e => update(key, Number(e.target.value))} />
      <b>{Number(values[key]).toFixed(step >= 1 ? 0 : 2)}{suffix}</b>
    </label>
  );
  return <aside className="trail-tuning timeline-tuning glass">
    <div className="trail-tuning__head">
      <div><p className="eyebrow">Timeline Utility</p><h3>Timeline tuning</h3></div>
      <button type="button" onClick={onClose} aria-label="Close timeline tuning">×</button>
    </div>
    <p className="trail-tuning__note">Adjust the live bottom timeline without hiding the real timeline.</p>
    <section>
      <h4>Inactive pins</h4>
      {row('inactiveHeadSize', 'Head size', 8, 22, 1)}
      {row('inactiveStemLength', 'Stem length', 0, 28, 1)}
    </section>
    <section>
      <h4>Active pin</h4>
      {row('activeHeadSize', 'Head size', 8, 26, 1)}
      {row('activeStemLength', 'Stem length', 8, 72, 1)}
      {row('activeLift', 'Lift height', 0, 80, 1)}
      {row('tooltipOffsetY', 'Pill height', 24, 120, 1)}
      {row('animationMs', 'Animation time', 120, 900, 10, 'ms')}
      {row('animationOvershoot', 'Overshoot', 1.0, 1.5, 0.01, 'x')}
    </section>
    <section>
      <h4>Playback bar</h4>
      {row('pinBaseY', 'Pin vertical position', -20, 20, 1)}
      {row('playbackBarHeight', 'Bar height', 2, 14, 1)}
      {row('yearOffsetY', 'Year offset', -8, 20, 1)}
    </section>
    <div className="trail-tuning__actions">
      <button type="button" className="secondary" onClick={onReset}>Reset</button>
      <button type="button" className="secondary" onClick={onClose}>Cancel</button>
      <button type="button" className="primary" onClick={async () => { await onSave?.(); onClose?.(); }}>Save</button>
    </div>
  </aside>;
}

function HopperEditorPanel({ hopperData, setHopperData, onClose }) {
  const { hoppers, hopSquads, palette } = normalizeHopperData(hopperData);
  const [closing, setClosing] = useState(false);
  const [draft, setDraft] = useState(() => JSON.parse(JSON.stringify({ hoppers, hopSquads, palette })));
  const [busy, setBusy] = useState(false);
  const [openPicker, setOpenPicker] = useState(null);
  const [confirmRequest, setConfirmRequest] = useState(null);
  const token = localStorage.getItem('journeylines.githubToken') || '';
  const repo = localStorage.getItem('journeylines.repo') || '';
  const colors = palette?.length ? palette : [
    { name: 'red', label: 'Red', color: '#ff3b30' },
    { name: 'orange', label: 'Orange', color: '#ff8a00' },
    { name: 'yellow', label: 'Yellow', color: '#ffd60a' },
    { name: 'gold', label: 'Gold', color: '#d7a300' },
    { name: 'green', label: 'Green', color: '#44f48a' },
    { name: 'blue', label: 'Blue', color: '#2f80ff' },
    { name: 'pink', label: 'Pink', color: '#ff4fd8' },
    { name: 'purple', label: 'Purple', color: '#9b5cff' },
    { name: 'gray', label: 'Gray', color: '#8e99a8' },
    { name: 'black', label: 'Black', color: '#050607' },
    { name: 'cyan', label: 'Cyan', color: '#00e5ff' }
  ];

  function pickColor(colorName) { return colors.find(c => c.name === colorName) || colors.find(c => c.name === 'blue') || colors[0]; }
  function updateHopper(id, patch) { setDraft(d => ({ ...d, hoppers: d.hoppers.map(h => h.id === id ? { ...h, ...patch } : h) })); }
  function deleteHopper(id) {
    const hopper = draft.hoppers.find(h => h.id === id);
    const label = hopper?.name || 'this Hopper';
    setConfirmRequest({
      title: 'Delete Hopper?',
      message: `Delete ${label}? This will also remove them from any HopSquads.`,
      confirmLabel: 'Delete Hopper',
      onConfirm: () => setDraft(d => ({ ...d, hoppers: d.hoppers.filter(h => h.id !== id), hopSquads: d.hopSquads.map(s => ({ ...s, hopperIds: (s.hopperIds || []).filter(x => x !== id) })) }))
    });
  }
  function addHopper() {
    const id = `hopper-${Date.now().toString(36)}`;
    setDraft(d => ({ ...d, hoppers: [...d.hoppers, { id, name: 'New Hopper', colorName: 'blue', color: '#2f80ff' }] }));
  }
  function updateSquad(id, patch) { setDraft(d => ({ ...d, hopSquads: d.hopSquads.map(s => s.id === id ? { ...s, ...patch } : s) })); }
  function deleteSquad(id) {
    const squad = draft.hopSquads.find(s => s.id === id);
    const label = squad?.name || 'this Hop Squad';
    setConfirmRequest({
      title: 'Delete Hop Squad?',
      message: `Delete ${label}? Hoppers will stay saved, but this Hop Squad will be removed.`,
      confirmLabel: 'Delete Squad',
      onConfirm: () => setDraft(d => ({ ...d, hopSquads: d.hopSquads.filter(s => s.id !== id) }))
    });
  }
  function addSquad() {
    const id = `squad-${Date.now().toString(36)}`;
    setDraft(d => ({ ...d, hopSquads: [...d.hopSquads, { id, name: 'New Hop Squad', hopperIds: [], colorName: 'cyan', color: '#00e5ff' }] }));
  }
  function setColor(kind, id, colorName, customColor) {
    if (colorName === 'custom') {
      const color = normalizeHexColor(customColor || '#00e5ff');
      if (kind === 'hopper') updateHopper(id, { colorName: 'custom', color });
      else updateSquad(id, { colorName: 'custom', color });
      return;
    }
    const c = pickColor(colorName);
    if (kind === 'hopper') updateHopper(id, { colorName: c.name, color: c.color });
    else updateSquad(id, { colorName: c.name, color: c.color });
    setOpenPicker(null);
  }
  function requestClose() {
    setClosing(true);
    window.setTimeout(() => onClose?.(), 240);
  }
  async function save() {
    const clean = {
      ...draft,
      hoppers: draft.hoppers.map(h => ({ ...h, id: h.id || slugify(h.name), name: h.name || 'Hopper' })),
      hopSquads: draft.hopSquads.map(s => ({ ...s, id: s.id || slugify(s.name), name: s.name || 'Hop Squad', hopperIds: s.hopperIds || [] }))
    };
    setHopperData(clean);
    localStorage.setItem('globehoppers.hoppers', JSON.stringify(clean));
    if (token && repo) {
      try {
        setBusy(true);
        await commitSingleJsonFile(repo, token, 'journeylines/src/data/hoppers.json', clean, 'Update hoppers from GlobeHoppers');
      } catch (err) {
        alert(`Saved locally, but GitHub commit failed: ${err.message || err}`);
      } finally { setBusy(false); }
    }
    onClose?.();
  }
  return <section className={`hopper-editor-backdrop hopper-editor-drawer-backdrop ${closing ? 'is-closing' : ''}`} onClick={requestClose}>
    <div className={`hopper-editor glass hopper-editor--compact hopper-editor-drawer ${closing ? 'is-closing' : ''}`} onClick={e => e.stopPropagation()}>
      <header className="hopper-editor__header">
        <p className="eyebrow">GlobeHoppers Studio</p>
        <h2>Hoppers/HopSquads</h2>
        <button className="drawer-close-button" onClick={requestClose}>Close</button>
      </header>
      <div className="hopper-editor__body">
        <section>
          <div className="hopper-section-title"><h3>Hoppers</h3><button className="primary small" onClick={addHopper}>Add Hopper</button></div>
          <div className="hopper-list">
            {draft.hoppers.map(h => <article className="hopper-card hopper-card--row" key={h.id} style={{ '--accent': h.color }}>
              <input aria-label="Hopper name" value={h.name} onChange={e => updateHopper(h.id, { name: e.target.value })} />
              <span className="hopper-color-label">Color:</span>
              <ColorPopover colors={colors} value={h.colorName || 'blue'} color={h.color || '#2f80ff'} open={openPicker === `hopper:${h.id}`} onToggle={() => setOpenPicker(openPicker === `hopper:${h.id}` ? null : `hopper:${h.id}`)} onChoose={(name, customColor) => setColor('hopper', h.id, name, customColor)} />
              <button className="danger compact-delete" type="button" onClick={() => deleteHopper(h.id)}>Delete</button>
            </article>)}
          </div>
        </section>
        <section>
          <div className="hopper-section-title"><h3>HopSquads</h3><button className="primary small" onClick={addSquad}>Add Squad</button></div>
          <div className="hopper-list">
            {draft.hopSquads.map(s => <article className="hopper-card hopper-card--squad" key={s.id} style={{ '--accent': s.color }}>
              <div className="squad-row-top">
                <input value={s.name} onChange={e => updateSquad(s.id, { name: e.target.value })} />
                <span className="hopper-color-label">Color:</span>
                <ColorPopover colors={colors} value={s.colorName || 'cyan'} color={s.color || '#00e5ff'} open={openPicker === `squad:${s.id}`} onToggle={() => setOpenPicker(openPicker === `squad:${s.id}` ? null : `squad:${s.id}`)} onChoose={(name, customColor) => setColor('squad', s.id, name, customColor)} />
                <button className="danger compact-delete" type="button" onClick={() => deleteSquad(s.id)}>Delete</button>
              </div>
              <div className="squad-members">
                {draft.hoppers.map(h => {
                  const selected = (s.hopperIds || []).includes(h.id);
                  return <button type="button" key={h.id} className={selected ? 'is-selected' : 'is-unselected'} style={{ '--accent': h.color }} onClick={() => {
                    const ids = new Set(s.hopperIds || []);
                    selected ? ids.delete(h.id) : ids.add(h.id);
                    updateSquad(s.id, { hopperIds: [...ids] });
                  }}><span />{h.name}</button>;
                })}
              </div>
            </article>)}
          </div>
        </section>
      </div>
      <footer className="hopper-editor__footer"><button className="secondary" onClick={requestClose}>Cancel</button><button className="primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save Hoppers'}</button></footer>
    </div>
    {confirmRequest && <HopperConfirmPopup request={confirmRequest} busy={busy} onCancel={() => setConfirmRequest(null)} onConfirm={() => { const action = confirmRequest.onConfirm; setConfirmRequest(null); action?.(); }} />}
  </section>;
}

function HopperConfirmPopup({ request, busy, onCancel, onConfirm }) {
  return <div className="studio-confirm-backdrop" role="presentation" onClick={onCancel}>
    <div className="studio-confirm-popup glass" role="dialog" aria-modal="true" aria-labelledby="hopper-confirm-title" onClick={(e) => e.stopPropagation()}>
      <p className="eyebrow">Please confirm</p>
      <h3 id="hopper-confirm-title">{request.title || 'Confirm action'}</h3>
      <p>{request.message}</p>
      <div className="studio-confirm-actions">
        <button type="button" className="secondary" disabled={busy} onClick={onCancel}>Cancel</button>
        <button type="button" className="danger" disabled={busy} onClick={onConfirm}>{busy ? 'Working…' : (request.confirmLabel || 'Confirm')}</button>
      </div>
    </div>
  </div>;
}

function ColorPopover({ colors = [], value, color, open, onToggle, onChoose }) {
  const currentColor = normalizeHexColor(color || '#00e5ff');
  const [customOpen, setCustomOpen] = useState(false);
  const [draftColor, setDraftColor] = useState(currentColor);
  const [customPlacement, setCustomPlacement] = useState('below');
  const menuRef = useRef(null);
  const panelRef = useRef(null);

  useEffect(() => {
    if (open) {
      setCustomOpen(false);
      setDraftColor(currentColor);
      setCustomPlacement('below');
    }
  }, [open, currentColor]);

  useEffect(() => {
    if (!open || !customOpen) return;
    function updatePlacement() {
      const menuRect = menuRef.current?.getBoundingClientRect();
      const panelRect = panelRef.current?.getBoundingClientRect();
      if (!menuRect) return;
      const panelHeight = panelRect?.height || 248;
      const gap = 10;
      const spaceBelow = window.innerHeight - menuRect.bottom - gap;
      const spaceAbove = menuRect.top - gap;
      setCustomPlacement(spaceBelow >= panelHeight || spaceBelow >= spaceAbove ? 'below' : 'above');
    }
    updatePlacement();
    window.addEventListener('resize', updatePlacement);
    window.addEventListener('scroll', updatePlacement, true);
    return () => {
      window.removeEventListener('resize', updatePlacement);
      window.removeEventListener('scroll', updatePlacement, true);
    };
  }, [open, customOpen]);

  const draft = hexToRgbDraft(draftColor);
  const hue = rgbToHslDraft(draft.r, draft.g, draft.b).h;
  const hueColor = rgbHueColor(draft.r, draft.g, draft.b);

  function openCustomPicker() {
    setDraftColor(currentColor);
    setCustomPlacement('below');
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
    {open && <span ref={menuRef} className="color-popover__menu glass color-popover__menu--custom">
      {colors.map(c => <button key={c.name} type="button" className={value === c.name ? 'is-selected' : ''} style={{ '--swatch': c.color }} title={c.label || c.name} onClick={() => onChoose?.(c.name, c.color)} />)}
      <button type="button" className={value === 'custom' ? 'custom-rainbow-swatch is-selected' : 'custom-rainbow-swatch'} style={{ '--custom-swatch': value === 'custom' ? currentColor : 'transparent' }} title="Custom color" onClick={openCustomPicker} />
      {customOpen && <span ref={panelRef} className={`custom-color-panel glass ${customPlacement === 'above' ? 'custom-color-panel--above' : 'custom-color-panel--below'}`}>
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

function slugify(value = '') {
  return String(value).trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || `id-${Date.now().toString(36)}`;
}

async function commitSingleJsonFile(repo, token, path, data, message) {
  const headers = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28'
  };
  const encodedPath = encodeURIComponent(path).replaceAll('%2F', '/');
  const content = btoa(unescape(encodeURIComponent(JSON.stringify(data, null, 2) + '\n')));

  async function currentSha() {
    const res = await fetch(`https://api.github.com/repos/${repo}/contents/${encodedPath}?ref=main`, { headers, cache: 'no-store' });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(await res.text());
    const json = await res.json();
    return json.sha || null;
  }

  let lastError = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const sha = await currentSha();
    const body = { message, content, branch: 'main' };
    if (sha) body.sha = sha;
    const res = await fetch(`https://api.github.com/repos/${repo}/contents/${encodedPath}`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(body)
    });
    if (res.ok) return await res.json();
    const msg = await res.text();
    lastError = new Error(msg);
    if (![409, 422].includes(res.status)) throw lastError;
    await new Promise(resolve => setTimeout(resolve, 350 + attempt * 350));
  }
  throw lastError || new Error('GitHub commit failed');
}



function timelineBorderColorsForTrip(trip, hopperData) {
  const traveler = resolveTripVisual(trip, hopperData);
  const colors = (traveler?.squadMemberColors || traveler?.circleColors || traveler?.memberColors || traveler?.colors || [traveler?.color || '#00e5ff'])
    .filter(Boolean);
  const unique = [...new Set(colors)];
  return unique.length ? unique : [traveler?.color || '#00e5ff'];
}

function splitTimelineBorderColors(colors = [], fallback = '#00e5ff') {
  const list = [...new Set((colors || []).filter(Boolean))];
  if (!list.length) return [fallback];
  return list;
}

function borderSegmentForSide(colors, side, fallback = '#00e5ff') {
  const list = splitTimelineBorderColors(colors, fallback);
  if (list.length === 1) return list[0];

  if (list.length === 2) {
    if (side === 'left') return list[0];
    if (side === 'right') return list[1];
    return `linear-gradient(90deg, ${list[0]} 0 50%, ${list[1]} 50% 100%)`;
  }

  // Perimeter order starts at top-left, moves clockwise around the card.
  // This is intentionally simple and foreground-rendered so it cannot be
  // hidden by older row background/hover styles.
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

  if (side === 'top') {
    const stops = [topLeft, ...extra.filter((_, i) => i % 2 === 0), topRight];
    return linearStops(stops, '90deg');
  }
  if (side === 'right') {
    const stops = [topRight, ...extra.filter((_, i) => i % 2 === 1), bottomRight];
    return linearStops(stops, '180deg');
  }
  if (side === 'bottom') {
    const stops = [bottomLeft, ...extra.filter((_, i) => i % 2 === 0).reverse(), bottomRight];
    return linearStops(stops, '90deg');
  }
  return linearStops([topLeft, bottomLeft], '180deg');
}

function linearStops(colors = [], direction = '90deg') {
  const list = splitTimelineBorderColors(colors);
  if (list.length === 1) return list[0];
  const step = 100 / list.length;
  return `linear-gradient(${direction}, ${list.map((color, index) => `${color} ${Math.max(0, index * step)}% ${Math.min(100, (index + 1) * step)}%`).join(', ')})`;
}

function TimelineRowBorder({ colors = [], fallback = '#00e5ff' }) {
  const list = splitTimelineBorderColors(colors, fallback);
  return <span
    className="gh-timeline-row-border"
    aria-hidden="true"
    style={{
      '--gh-row-border-top': borderSegmentForSide(list, 'top', fallback),
      '--gh-row-border-right': borderSegmentForSide(list, 'right', fallback),
      '--gh-row-border-bottom': borderSegmentForSide(list, 'bottom', fallback),
      '--gh-row-border-left': borderSegmentForSide(list, 'left', fallback)
    }}
  >
    <span className="gh-row-border-strip gh-row-border-strip--top" />
    <span className="gh-row-border-strip gh-row-border-strip--right" />
    <span className="gh-row-border-strip gh-row-border-strip--bottom" />
    <span className="gh-row-border-strip gh-row-border-strip--left" />
  </span>;
}

function buildTripTimeline(trips, legs, locById, hopperData) {
  const firstLegByTrip = new Map();
  for (let i = 0; i < legs.length; i++) {
    const id = legs[i]?.trip?.id;
    if (id && !firstLegByTrip.has(id)) firstLegByTrip.set(id, i);
  }
  return trips.map(trip => {
    const firstIndex = firstLegByTrip.get(trip.id) ?? 0;
    const tripLegs = legs.filter(l => l.trip.id === trip.id);
    const destinationLocationIds = locationIdsVisitedByTrip(trip, tripLegs);
    const from = tripLegs[0]?.leg?.from;
    const to = tripLegs[0]?.leg?.to || locById[trip.toLocationId];
    const traveler = resolveTripVisual(trip, hopperData);
    return {
      id: trip.id,
      firstIndex,
      title: trip.label || to?.name || 'Trip',
      date: trip.displayDate || String(trip.year || ''),
      mode: trip.mode || tripLegs[0]?.leg?.mode || 'plane',
      traveler: traveler?.name || 'Travel',
      color: traveler?.color || '#00e5ff',
      borderColors: timelineBorderColorsForTrip(trip, hopperData),
      borderGradient: segmentedBorderGradient((traveler?.squadMemberColors || traveler?.circleColors || traveler?.memberColors || traveler?.colors || [traveler?.color || '#00e5ff']).filter(Boolean), traveler?.color || '#00e5ff'),
      markerBackground: multiMemberCircleBackground(traveler?.circleColors || traveler?.memberColors || traveler?.colors || [traveler?.color || '#00e5ff'], traveler?.color || '#00e5ff', true),
      route: from && to ? `${formatLocation(from)} → ${formatLocation(to)}` : formatLocation(to),
      legCount: tripLegs.length,
      destinationLocationIds,
      year: trip.year || String(trip.date || '').slice(0, 4) || '',
      month: normalizeTimelineMonth(trip.month, trip.displayDate || trip.date),
      day: normalizeTimelineDay(trip.day, trip.startDay, trip.displayDate || trip.date),
      toLocationId: trip.toLocationId,
      notes: trip.notes || trip.occasion || '',
      trip
    };
  });
}


function buildTimelineMarkers(rows = [], totalLegs = 0) {
  const denom = Math.max(1, totalLegs - 1);
  return (rows || []).map((row) => ({
    id: row.id,
    title: row.title || 'Trip',
    date: row.date || row.year || '',
    color: row.color || '#00e5ff',
    markerBackground: row.markerBackground || row.color || '#00e5ff',
    firstIndex: row.firstIndex || 0,
    destinationLocationIds: row.destinationLocationIds || [],
    progress: Math.max(0, Math.min(1, (row.firstIndex || 0) / Math.max(1, totalLegs)))
  }));
}

function buildTimelineYearSegments(rows = [], totalLegs = 0) {
  const denom = Math.max(1, totalLegs - 1);
  const starts = [];
  const seen = new Set();
  for (const row of rows || []) {
    const year = String(row.year || row.date || '').match(/\d{4}/)?.[0];
    if (!year || seen.has(year)) continue;
    seen.add(year);
    starts.push({ year, start: Math.max(0, Math.min(1, (row.firstIndex || 0) / denom)) });
  }
  return starts.map((seg, index) => ({
    year: seg.year,
    start: seg.start,
    end: index < starts.length - 1 ? starts[index + 1].start : 1
  }));
}


function buildTimelineMonthTicks(rows = [], totalLegs = 0) {
  const dated = (rows || []).map((row, index) => {
    const year = Number(String(row.year || row.date || '').match(/\d{4}/)?.[0]);
    if (!Number.isFinite(year)) return null;
    const month = Math.max(1, Math.min(12, Number(row.month) || 7));
    const day = Math.max(1, Math.min(28, Number(row.day) || 15));
    return {
      row,
      index,
      time: Date.UTC(year, month - 1, day),
      progress: Math.max(0, Math.min(1, Number(row.firstIndex || 0) / Math.max(1, totalLegs)))
    };
  }).filter(Boolean).sort((a, b) => a.time - b.time || a.index - b.index);
  if (dated.length < 2) return [];

  const first = new Date(dated[0].time);
  const last = new Date(dated[dated.length - 1].time);
  const cursor = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1));
  const end = new Date(Date.UTC(last.getUTCFullYear(), last.getUTCMonth() + 1, 1));
  const ticks = [];
  while (cursor <= end) {
    const year = cursor.getUTCFullYear();
    const monthIndex = cursor.getUTCMonth();
    const targetTime = Date.UTC(year, monthIndex, 15);
    let progress = dated[0].progress;
    if (targetTime >= dated[dated.length - 1].time) progress = dated[dated.length - 1].progress;
    else if (targetTime > dated[0].time) {
      let upperIndex = 1;
      while (upperIndex < dated.length && dated[upperIndex].time < targetTime) upperIndex += 1;
      const lower = dated[Math.max(0, upperIndex - 1)];
      const upper = dated[Math.min(dated.length - 1, upperIndex)];
      const fraction = upper.time === lower.time ? 0 : (targetTime - lower.time) / (upper.time - lower.time);
      progress = lower.progress + (upper.progress - lower.progress) * Math.max(0, Math.min(1, fraction));
    }
    ticks.push({
      id: `${year}-${String(monthIndex + 1).padStart(2, '0')}`,
      year,
      month: monthIndex + 1,
      label: new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' }).format(cursor),
      progress: Math.max(0, Math.min(1, progress))
    });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return ticks;
}

function buildTimelineYearSpan(rows = []) {
  const values = (rows || []).map(row => {
    const year = Number(String(row.year || row.date || '').match(/\d{4}/)?.[0]);
    if (!Number.isFinite(year)) return null;
    const month = Math.max(1, Math.min(12, Number(row.month) || 7));
    return year + (month - 1) / 12;
  }).filter(Number.isFinite);
  if (values.length < 2) return 1;
  return Math.max(1 / 12, Math.max(...values) - Math.min(...values) + 1 / 12);
}

function normalizeTimelineMonth(value, dateText = '') {
  const numeric = Number(value);
  if (numeric >= 1 && numeric <= 12) return numeric;
  const text = String(dateText || '').toLowerCase();
  const names = ['january','february','march','april','may','june','july','august','september','october','november','december'];
  const index = names.findIndex(name => text.includes(name) || text.includes(name.slice(0, 3)));
  return index >= 0 ? index + 1 : 7;
}

function normalizeTimelineDay(...values) {
  for (const value of values) {
    const numeric = Number(value);
    if (numeric >= 1 && numeric <= 31) return numeric;
    const match = String(value || '').match(/\b([12]?\d|3[01])\b/);
    if (match) return Number(match[1]);
  }
  return 15;
}

function TripTimelineDrawer({ open, rows, activeIndex, initialScroll, onScrollStore, onClose, onJump, onEditTrip, viewType = 'expanded', onViewTypeChange }) {
  const [menu, setMenu] = useState(null);
  const listRef = useRef(null);
  const userScrollingRef = useRef(false);
  const scrollTimerRef = useRef(null);
  useEffect(() => {
    if (!open || !listRef.current) return;
    requestAnimationFrame(() => { if (listRef.current) listRef.current.scrollTop = initialScroll || 0; });
  // Restore only when opening. During playback, App re-renders should not
  // continuously force scrollTop and fight the user's scrollbar.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    window.addEventListener('click', close);
    window.addEventListener('keydown', close);
    return () => { window.removeEventListener('click', close); window.removeEventListener('keydown', close); };
  }, [menu]);
  function openMenu(e, row) {
    e.preventDefault();
    e.stopPropagation();
    const x = Math.min(e.clientX || window.innerWidth - 180, window.innerWidth - 170);
    const y = Math.min(e.clientY || 120, window.innerHeight - 90);
    setMenu({ x, y, row });
  }
  function editFromMenu() {
    const id = menu?.row?.id;
    setMenu(null);
    if (id) onEditTrip?.(id);
  }
  const grouped = groupRowsByYear(rows);
  return <>
    <aside className={`trip-drawer glass ${open ? 'is-open' : ''} trip-drawer--${viewType}`} aria-hidden={!open}>
      <div className="trip-drawer__header drawer-header-unified">
        <p className="eyebrow">GlobeHoppers Studio</p>
        <ViewTypeSelector value={viewType} onChange={onViewTypeChange} />
        <button className="drawer-close-button" onClick={() => { setMenu(null); onClose(); }}>Close</button>
        <h2>GlobeHopper Timeline</h2>
      </div>
      <div ref={listRef} className={`trip-drawer__list trip-drawer__list--${viewType}`} onPointerDown={(e) => e.stopPropagation()} onWheel={(e) => { userScrollingRef.current = true; e.stopPropagation(); }} onScroll={(e) => { userScrollingRef.current = true; window.clearTimeout(scrollTimerRef.current); scrollTimerRef.current = window.setTimeout(() => { userScrollingRef.current = false; }, 180); onScrollStore?.(e.currentTarget.scrollTop); }}>
        {viewType === 'card' ? grouped.map(group => <section className="timeline-year-section" key={group.year}>
          <h3>{group.year}</h3>
          <div className="timeline-card-grid">
            {group.rows.map(row => <TripDrawerRow key={row.id} row={row} activeIndex={activeIndex} onJump={onJump} openMenu={openMenu} viewType={viewType} />)}
          </div>
        </section>) : rows.map(row => <TripDrawerRow key={row.id} row={row} activeIndex={activeIndex} onJump={onJump} openMenu={openMenu} viewType={viewType} />)}
      </div>
    </aside>
    {menu && <div className="trip-context-menu glass" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()} onContextMenu={(e) => e.preventDefault()}>
      <button onClick={editFromMenu}>Edit</button>
    </div>}
  </>;
}

function TripDrawerRow({ row, activeIndex, onJump, openMenu, viewType }) {
  const active = activeIndex >= row.firstIndex && activeIndex < row.firstIndex + Math.max(1, row.legCount || 1);
  return <div
    role="button"
    tabIndex={0}
    className={`gh-timeline-trip-row ${active ? 'is-active' : ''} gh-timeline-trip-row--${viewType}`}
    style={{ '--accent': row.color, '--trip-border': row.borderGradient || row.color }}
    onClick={() => onJump(row.firstIndex)}
    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onJump(row.firstIndex); } }}
    onContextMenu={(e) => openMenu(e, row)}
    title="Click to play from here. Right-click or use ⋯ to edit."
  >
    <span className="trip-drawer__date">{row.date}</span>
    <span className="trip-drawer__main">
      <strong>{row.title}</strong>
      <small>{row.route}</small>
    </span>
    <span className="trip-drawer__meta">{row.mode}{row.legCount > 1 ? ` · ${row.legCount} legs` : ''}<br />{row.traveler}</span>
    {viewType !== 'card' && <button className="trip-drawer__more" type="button" aria-label={`Edit ${row.title}`} onClick={(e) => openMenu(e, row)}>⋯</button>}
    <TimelineRowBorder colors={row.borderColors} fallback={row.color} />
  </div>;
}

function ViewTypeSelector({ value, onChange }) {
  return <div className="view-type-selector" role="group" aria-label="Timeline view type">
    {[['expanded','Expanded'], ['compact','Compact'], ['card','Card']].map(([id, label]) => <button key={id} type="button" className={value === id ? 'is-selected' : ''} onClick={() => onChange?.(id)}>{label}</button>)}
  </div>;
}

function groupRowsByYear(rows = []) {
  const groups = [];
  const byYear = new Map();
  for (const row of rows) {
    const year = String(row.year || row.date || 'Trips').match(/\d{4}/)?.[0] || 'Trips';
    if (!byYear.has(year)) { const group = { year, rows: [] }; byYear.set(year, group); groups.push(group); }
    byYear.get(year).rows.push(row);
  }
  return groups;
}


function buildTripCardRows(rows, activeIndex) {
  if (!rows?.length) return [];
  let currentIdx = rows.findIndex(row => activeIndex >= row.firstIndex && activeIndex < row.firstIndex + Math.max(1, row.legCount || 1));
  if (currentIdx < 0) currentIdx = Math.max(0, Math.min(rows.length - 1, rows.findIndex(row => row.firstIndex >= activeIndex)));
  if (currentIdx < 0) currentIdx = 0;
  const yearCounts = new Map();
  const destinationCounts = new Map();
  const enriched = rows.map((row, i) => {
    const year = String(row.year || '').match(/\d{4}/)?.[0] || 'Trips';
    const yCount = (yearCounts.get(year) || 0) + 1;
    yearCounts.set(year, yCount);
    const key = row.toLocationId || row.title;
    const vCount = (destinationCounts.get(key) || 0) + 1;
    destinationCounts.set(key, vCount);
    return { ...row, totalIndex: i + 1, totalTrips: rows.length, tripOfYear: yCount, visitCount: vCount, visitDestination: row.title };
  });
  return enriched.slice(currentIdx, currentIdx + 4);
}

function formatLocation(loc) {
  if (!loc) return '';
  const abbr = {
    Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA', Colorado: 'CO', Connecticut: 'CT', Delaware: 'DE', Florida: 'FL', Georgia: 'GA', Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL', Indiana: 'IN', Iowa: 'IA', Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA', Maine: 'ME', Maryland: 'MD', Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN', Mississippi: 'MS', Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH', Oklahoma: 'OK', Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC', 'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT', Virginia: 'VA', Washington: 'WA', 'Washington DC': 'DC', 'District of Columbia': 'DC', 'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY'
  };
  if (loc.country === 'United States' && loc.region) return `${loc.name}, ${abbr[loc.region] || loc.region}`;
  return loc.name || '';
}
