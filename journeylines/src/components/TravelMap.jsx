import { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { geoInterpolate } from 'd3-geo';
import LegacySvgMap from './LegacySvgMap.jsx';
import { flattenLegs, getTravelerKey } from '../utils/tripExpansion.js';
import { resolveTripVisual, resolveTrailVisual } from '../utils/hopperUtils.js';
import { milesBetween } from '../utils/distanceUtils.js';
import routeOverrides from '../data/routeOverrides.json';
import routingSettings from '../data/routingSettings.json';
import generatedRoutes from '../data/generatedRoutes.json';
import baseRouteDetails from '../data/routeDetails.json';
import { applyRouteDetailsToEntries, routeDetailsGeometryCache } from '../utils/routeDetails.js';
import { peekRecoloredVesselIconUrl, primeRecoloredVesselIcon, preloadBaseVesselIcons } from '../utils/vesselIcons.js';
import { buildPlaybackPlanInWorker, routeLegInWorker, routingMemoryGeometry, ROUTING_VERSION } from '../utils/routingClient.js';
import { routeCacheKeyV6 } from '../utils/routeCacheIndexedDb.js';
import { playbackEngine } from '../utils/playbackEngine.js';
import { anchorRouteGeometryToEndpoints, buildSurfacePresentationGeometry, isSurfaceRouteMode, stableRoutePrefix } from '../utils/routePresentation.js';
import { bidirectionalRouteKey, canonicalGeometryForLeg, geometryForLegDirection } from '../utils/routeReuse.js';
import { measurePlaybackEvent, recordPlaybackEvent, recordPlaybackFrame } from '../utils/playbackPerformance.js';
import { applyVesselSpriteOffset } from '../utils/vehicleOrientation.js';
import { autoLevelGlobeCamera, captureCameraState, clampGlobeSpinSpeed } from '../utils/globeInteraction.js';

const INTRO_GLOBE_CENTER = [-100, 37];
const INTRO_GLOBE_ZOOM = 4.20;
const IDLE_SPIN_GLOBE_ZOOM = 4.20;
const CONTINUOUS_HANDOFF_HOLD_MS = 900;
const CONTINUOUS_HANDOFF_RELEASE_MS = 2600;
const TIMELINE_COMPLETE_GLOBE_DURATION_MS = 2200;
const RELOCATION_GLIDE_MIN_MS = 1900;
const RELOCATION_GLIDE_MAX_MS = 5200;
const AUTO_LEVEL_DELAY_MS = 3600;
const AUTO_LEVEL_DURATION_MS = 2400;

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
  routeStackingEnabled: false,
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


const COMPLETED_ROUTE_FEATURE_CACHE = new Map();
const COMPLETED_ROUTE_FEATURE_CACHE_LIMIT = 1200;
let STATIC_ROUTE_LOD = 'regional';

const MAP_STYLE = {
  version: 8,
  name: 'GlobeHoppers Terrain Globe',
  sources: {
    terrainImagery: {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
      ],
      tileSize: 256,
      attribution: 'Tiles &copy; Esri'
    },
    countryBoundaries: {
      type: 'geojson',
      data: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_boundary_lines_land.geojson'
    },
    stateBoundaries: {
      type: 'geojson',
      data: 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_50m_admin_1_states_provinces_lines.geojson'
    },
    // v2.3: base-map city label raster removed. Active trip endpoints are labeled by the app overlay instead.
  },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#020814' } },
    {
      id: 'terrain-imagery',
      type: 'raster',
      source: 'terrainImagery',
      minzoom: 0,
      maxzoom: 19,
      paint: {
        'raster-opacity': 0.92,
        'raster-saturation': -0.18,
        'raster-contrast': 0.08,
        'raster-brightness-min': 0.0,
        'raster-brightness-max': 0.78,
        'raster-fade-duration': 650
      }
    },
    {
      id: 'country-boundaries-subtle',
      type: 'line',
      source: 'countryBoundaries',
      minzoom: 0,
      paint: {
        'line-color': 'rgba(205, 236, 255, 0.62)',
        'line-width': ['interpolate', ['linear'], ['zoom'], 0, 0.25, 3, 0.45, 6, 0.75],
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 0, 0.10, 2, 0.16, 6, 0.24]
      }
    },
    {
      id: 'state-boundaries-subtle',
      type: 'line',
      source: 'stateBoundaries',
      minzoom: 2.2,
      paint: {
        'line-color': 'rgba(195, 230, 255, 0.54)',
        'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.18, 4, 0.34, 7, 0.58],
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 2, 0.06, 4, 0.12, 7, 0.20]
      }
    }
  ]
};

export default function TravelMap(props) {
  if (props.projectionName !== 'globe') return <LegacySvgMap {...props} />;
  return <MapLibreGlobe {...props} />;
}

function MapLibreGlobe({ trips, locations, homeBases, travelers, hopperData, activeIndex, legProgress, routeDetailsData = baseRouteDetails, playbackGeneration = 0, cameraMode, showTrails, trailOpacity = 0.28, trailWidth = 1.55, trailTuningOpen = false, trailTuning = DEFAULT_TRAIL_TUNING, placeBackgroundsEnabled = true, isPlaying = false, isStarted = false, introLaunching = false, globeOverview = false, globeDisplayMode = 'both', globeSpinSpeed = 0.32, globeSpinPaused = false, idleMode = false, idleExitMode = 'none', destinationSelectionEnabled = false, destinationSelectionActive = false, selectedDestinationId = null, relocationTransition = null, onRelocationComplete = () => {}, onIntroLaunchComplete = () => {}, resetNonce = 0, onMapClick = () => {} }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const vehicleRef = useRef(null);
  const airArcRef = useRef(null);
  const liveTrailConnectorRef = useRef(null);
  const originLabelRef = useRef(null);
  const destLabelRef = useRef(null);
  const pulseRef = useRef(null);
  const overlayRef = useRef(null);
  const visitedLabelsRef = useRef(null);
  const persistentLabelElsRef = useRef(new Map());
  const droppedPinIdsRef = useRef(new Set());
  const lastVisitedSigRef = useRef('');
  const lastCameraRef = useRef(null);
  const arrivalTimerRef = useRef(null);
  const routeRequestsRef = useRef(new Set());
  const currentOverlayStateRef = useRef(null);
  const userCameraOverrideRef = useRef(false);
  const playbackOwnsOverlayRef = useRef(false);
  const tilePreloadRef = useRef(new Set());
  const lastActiveRouteUpdateRef = useRef(0);
  const zoomReadoutThrottleRef = useRef(0);
  const labelRefreshThrottleRef = useRef({ t: 0, camera: null });
  const labelVisibilityStateRef = useRef(new Map());
  const placardRuntimeRef = useRef({ playback: false, overview: false, activeIds: new Set() });
  const introLaunchRef = useRef({ active: false, key: null });
  const timelineCompletionRef = useRef({ key: '', timer: null });
  const relocationGlideRef = useRef({ id: null, timer: null, finish: null });
  const resetAnimatingRef = useRef(false);
  const forceSceneJumpRef = useRef(false);
  const manualSpinPauseRef = useRef(false);
  const manualSpinResumeTimerRef = useRef(null);
  const manualSpinGestureRef = useRef({ camera: null, zoomChanged: false });
  const manualGestureRef = useRef({ pointerDown: false, lastWheelAt: 0, wheelTimer: null });
  const playbackCameraReturnRef = useRef(createPlaybackReturnState());
  const latestDesiredCameraRef = useRef(null);
  const idleCameraRef = useRef(null);
  const idleModePreviousRef = useRef(false);
  const overviewLockTimersRef = useRef(new Set());
  const destinationSelectionActiveRef = useRef(false);
  const trailTuningFramedRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);
  const [zoomReadout, setZoomReadout] = useState(INTRO_GLOBE_ZOOM);
  const fadeTrailRef = useRef({ active: false, features: [], started: 0, duration: 520, raf: 0, timer: 0, key: '' });
  const trailProfileMorphRef = useRef({ active: false, tripId: '', started: 0, duration: 1800, raf: 0, timer: 0 });
  const previousActiveRouteRef = useRef({ key: '', active: null, progress: 0, features: [] });
  const completedRouteRenderRef = useRef({ signature: '' });
  const playbackPlansRef = useRef(new Map());
  const routedGeometriesRef = useRef({});
  const latestFrameContextRef = useRef(null);
  const frameRenderStatsRef = useRef({
    lastTrail: 0,
    lastPulse: false,
    lastRouteKey: '',
    lastFrame: 0,
    lastCamera: 0,
    lastTrailProgress: -1,
    lastPlanCheck: 0,
    playbackPlan: null,
    lastActiveEntry: null,
    transitionStartedAt: 0,
    transitionKind: 'initial',
    transitionStartCamera: null,
    frozenEntry: null
  });
  const [routedGeometries, setRoutedGeometries] = useState(() => loadInitialRouteCache());


  const clearOverviewLockTimers = () => {
    for (const timer of overviewLockTimersRef.current) window.clearTimeout(timer);
    overviewLockTimersRef.current.clear();
  };
  const scheduleOverviewLock = (callback, delay) => {
    const timer = window.setTimeout(() => {
      overviewLockTimersRef.current.delete(timer);
      callback();
    }, delay);
    overviewLockTimersRef.current.add(timer);
    return timer;
  };
  const playbackHasCameraPriority = () => Boolean(
    playbackOwnsOverlayRef.current
    || introLaunchRef.current.active
    || latestFrameContextRef.current?.isPlaying
    || latestFrameContextRef.current?.introLaunching
  );
  const trailTuningConfig = useMemo(() => ({ ...DEFAULT_TRAIL_TUNING, ...(trailTuning || {}) }), [trailTuning]);

  useEffect(() => { preloadBaseVesselIcons(); }, []);


  const locById = useMemo(() => Object.fromEntries(locations.map(l => [l.id, l])), [locations]);
  const travById = useMemo(() => Object.fromEntries(travelers.map(t => [t.id, t])), [travelers]);
  const legs = useMemo(() => applyRouteDetailsToEntries(flattenLegs(trips, locById, homeBases), routeDetailsData), [trips, locById, homeBases, routeDetailsData]);

  const hasActivePlayback = Boolean(isStarted || isPlaying || introLaunching);
  const completedMode = hasActivePlayback && activeIndex >= legs.length;
  const overviewMode = Boolean(globeOverview);
  const safeActiveIndex = hasActivePlayback ? Math.min(activeIndex, Math.max(0, legs.length - 1)) : -1;
  const active = safeActiveIndex >= 0 ? legs[safeActiveIndex] : null;
  const nextActive = hasActivePlayback && !completedMode ? legs[Math.min(activeIndex + 1, Math.max(0, legs.length - 1))] : null;
  const scene = active && !completedMode && !overviewMode ? getScene(active, legProgress, cameraMode, nextActive, routedGeometries, Boolean(trailTuning?.routeStackingEnabled)) : null;
  const completedLegs = useMemo(() => {
    if (!hasActivePlayback) return legs;
    return overviewMode || completedMode ? legs : legs.slice(0, Math.max(0, activeIndex));
  }, [hasActivePlayback, overviewMode, completedMode, legs, activeIndex]);
  const visibleLegs = useMemo(() => {
    if (!hasActivePlayback) return legs;
    return overviewMode || completedMode ? legs : legs.slice(0, Math.max(0, activeIndex + 1));
  }, [hasActivePlayback, overviewMode, completedMode, legs, activeIndex]);
  const labelCompletedMode = !hasActivePlayback || overviewMode || completedMode;
  latestFrameContextRef.current = {
    active,
    nextActive,
    completedMode,
    overviewMode,
    routedGeometries,
    routeStackingEnabled: Boolean(trailTuning?.routeStackingEnabled),
    cameraMode,
    hopperVisuals: hopperData || travById,
    trailTuningConfig,
    trailWidth,
    trailOpacity,
    showTrails,
    isPlaying,
    introLaunching,
    playbackGeneration
  };
  useEffect(() => { routedGeometriesRef.current = routedGeometries; }, [routedGeometries]);


  const routePrefetchIndex = safeActiveIndex >= 0 ? safeActiveIndex : 0;

  useEffect(() => {
    if (!legs.length) return;
    let cancelled = false;
    // Begin resolving the first surface routes while the globe is still idle so
    // a user who presses Play does not outrun the routing worker. Continue to
    // keep the current leg and the next few legs warm during playback.
    const queue = legs.slice(routePrefetchIndex, routePrefetchIndex + 4);
    (async () => {
      for (const entry of queue) {
        if (cancelled) break;
        const leg = entry?.leg;
        if (!leg?.from || !leg?.to) continue;
        let geometry = getRoutedGeometry(leg, routedGeometriesRef.current);
        if (!geometry?.length && isNaturalEarthVesselMode(leg.mode)) {
          try {
            geometry = await routeLegInWorker(leg, { reason: 'current/next trip prefetch' });
            if (cancelled || !geometry?.length) continue;
            const key = leg.routeCacheKey || routeCacheKey(leg);
            const pairKey = isSurfaceRouteMode(leg.mode) ? bidirectionalRouteKey(leg) : '';
            const canonicalGeometry = pairKey ? canonicalGeometryForLeg(leg, geometry) : null;
            setRoutedGeometries(previous => {
              if (previous[key] === geometry && (!pairKey || previous[pairKey] === canonicalGeometry)) return previous;
              return { ...previous, [key]: geometry, ...(pairKey && canonicalGeometry ? { [pairKey]: canonicalGeometry } : {}) };
            });
          } catch {}
        }
        try {
          const plan = await buildPlaybackPlanInWorker(leg, geometry, { reason: 'current/next playback plan' });
          if (!cancelled && plan) playbackPlansRef.current.set(playbackPlanKey(leg, geometry), plan);
        } catch {}
      }
    })();
    return () => { cancelled = true; };
  }, [routePrefetchIndex, legs, active?.trip?.id, active?.legIndex]);

  useEffect(() => {
    const ids = new Set();
    if (active?.leg?.from?.id) ids.add(active.leg.from.id);
    if (active?.leg?.to?.id) ids.add(active.leg.to.id);
    placardRuntimeRef.current = {
      playback: Boolean(isPlaying && !overviewMode && !completedMode),
      overview: Boolean(overviewMode || completedMode),
      activeIds: ids,
      focus: currentOverlayStateRef.current?.scene?.vehicle || active?.leg?.from || null,
      selectable: Boolean(destinationSelectionEnabled),
      selectedDestinationId: selectedDestinationId || null
    };
    destinationSelectionActiveRef.current = Boolean(destinationSelectionActive);
  }, [isPlaying, overviewMode, completedMode, active?.leg?.from?.id, active?.leg?.to?.id, destinationSelectionEnabled, destinationSelectionActive, selectedDestinationId]);


  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: INTRO_GLOBE_CENTER,
      zoom: INTRO_GLOBE_ZOOM,
      bearing: 0,
      pitch: 0,
      attributionControl: false,
      interactive: true,
      renderWorldCopies: false,
      fadeDuration: 700,
      maxTileCacheSize: 1200,
      refreshExpiredTiles: false,
      prefetchZoomDelta: 2
    });

    mapRef.current = map;
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');

    map.on('load', () => {
      try { map.setProjection({ type: 'globe' }); } catch {}
      const updateZoomReadout = () => {
        // Avoid React state updates while the playback engine owns the camera.
        // The readout catches up immediately when playback pauses.
        if (playbackOwnsOverlayRef.current) return;
        const now = performance.now();
        if (now - (zoomReadoutThrottleRef.current || 0) < 180) return;
        zoomReadoutThrottleRef.current = now;
        setZoomReadout(Number(map.getZoom?.() || INTRO_GLOBE_ZOOM));
      };
      setZoomReadout(Number(map.getZoom?.() || INTRO_GLOBE_ZOOM));
      map.on('move', updateZoomReadout);
      map.on('zoom', updateZoomReadout);
      try {
        map.setFog({
          color: '#071421',
          'horizon-blend': 0.20,
          'space-color': '#000000',
          'star-intensity': 0.0
        });
      } catch {}
      addRouteSourcesAndLayers(map);
      addPulseLayer(map);
      if (trailTuningOpen) syncTrailTuningDemo(map, trailTuningConfig, trailWidth);
      else syncCompletedRoutes(map, completedLegs, hopperData || travById, showTrails, trailOpacity, trailWidth, routedGeometries, trailTuningConfig, [], active?.trip?.id || null);
      const visited = trailTuningOpen ? [] : buildVisitedLocations(completedLegs, active, labelCompletedMode, scene, hopperData || travById, homeBases);
      syncVisitedPoints(map, visited, lastVisitedSigRef);
      if (!trailTuningOpen) updatePersistentLabels(map, visited, persistentLabelElsRef, visitedLabelsRef, colorForLeg(active, hopperData || travById), null, droppedPinIdsRef);
      setMapReady(true);
    });

    return () => {
      clearTimeout(arrivalTimerRef.current);
      clearTimeout(timelineCompletionRef.current?.timer);
      clearTimeout(manualSpinResumeTimerRef.current);
      clearTimeout(playbackCameraReturnRef.current?.timer);
      clearOverviewLockTimers();
      clearTimeout(manualGestureRef.current?.wheelTimer);
      clearTimeout(fadeTrailRef.current?.timer);
      clearTimeout(trailProfileMorphRef.current?.timer);
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    try {
      userCameraOverrideRef.current = false;
      manualSpinPauseRef.current = false;
      clearTimeout(manualSpinResumeTimerRef.current);
      resetAnimatingRef.current = true;
      lastCameraRef.current = null;
      map.stop();
      map.easeTo({ center: INTRO_GLOBE_CENTER, zoom: IDLE_SPIN_GLOBE_ZOOM, pitch: 0, bearing: 0, duration: 1850, essential: true, easing: t => 1 - Math.pow(1 - t, 3) });
      window.setTimeout(() => { resetAnimatingRef.current = false; }, 1925);
    } catch { resetAnimatingRef.current = false; }
  }, [resetNonce, mapReady]);


  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || isStarted || introLaunching) return;
    try {
      userCameraOverrideRef.current = false;
      manualSpinPauseRef.current = false;
      clearTimeout(manualSpinResumeTimerRef.current);
      resetAnimatingRef.current = true;
      lastCameraRef.current = null;
      map.stop();
      map.jumpTo({ center: INTRO_GLOBE_CENTER, zoom: INTRO_GLOBE_ZOOM, pitch: 0, bearing: 0, essential: true });
      window.setTimeout(() => { resetAnimatingRef.current = false; }, 120);
    } catch { resetAnimatingRef.current = false; }
  }, [isStarted, introLaunching, mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !globeOverview || idleMode || isPlaying || introLaunching) return;
    try {
      userCameraOverrideRef.current = false;
      manualSpinPauseRef.current = false;
      clearTimeout(manualSpinResumeTimerRef.current);
      resetAnimatingRef.current = true;
      lastCameraRef.current = null;
      clearOverviewLockTimers();
      map.stop();
      map.easeTo({ center: INTRO_GLOBE_CENTER, zoom: IDLE_SPIN_GLOBE_ZOOM, pitch: 0, bearing: 0, duration: 1500, essential: true, easing: t => 1 - Math.pow(1 - t, 3) });
      scheduleOverviewLock(() => {
        if (playbackHasCameraPriority()) return;
        try { map.jumpTo({ center: INTRO_GLOBE_CENTER, zoom: IDLE_SPIN_GLOBE_ZOOM, pitch: 0, bearing: 0, essential: true }); } catch {}
        resetAnimatingRef.current = false;
      }, 1580);
    } catch { resetAnimatingRef.current = false; }
  }, [globeOverview, mapReady, idleMode, isPlaying, introLaunching]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    function handleForceGlobeOverview() {
      if (playbackHasCameraPriority()) return;
      try {
        userCameraOverrideRef.current = false;
        resetAnimatingRef.current = true;
        lastCameraRef.current = null;
        if (pulseRef.current) {
          pulseRef.current.classList.remove('is-active');
          pulseRef.current.style.opacity = '0';
        }
        manualSpinPauseRef.current = false;
        clearTimeout(manualSpinResumeTimerRef.current);
        clearOverviewLockTimers();
        map.stop();
        map.easeTo({ center: INTRO_GLOBE_CENTER, zoom: IDLE_SPIN_GLOBE_ZOOM, pitch: 0, bearing: 0, duration: 2200, essential: true, easing: t => 1 - Math.pow(1 - t, 3) });
        // Preserve ownership until the zoom-out completes, then lock the exact
        // globe overview zoom before idle spin resumes.
        scheduleOverviewLock(() => {
          if (playbackHasCameraPriority()) return;
          try { map.jumpTo({ center: INTRO_GLOBE_CENTER, zoom: IDLE_SPIN_GLOBE_ZOOM, pitch: 0, bearing: 0, essential: true }); } catch {}
          resetAnimatingRef.current = false;
        }, 2280);
      } catch { resetAnimatingRef.current = false; }
    }
    window.addEventListener('globehoppers-force-globe-overview', handleForceGlobeOverview);
    return () => window.removeEventListener('globehoppers-force-globe-overview', handleForceGlobeOverview);
  }, [mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    function handleJumpToLegStart(event) {
      const { lon, lat, mode, forceScene } = event.detail || {};
      if (lon == null || lat == null) return;
      try {
        userCameraOverrideRef.current = false;
        forceSceneJumpRef.current = Boolean(forceScene);
        lastCameraRef.current = null;
        const zoom = mode === 'drive' ? 6.4 : mode === 'boat' || mode === 'train' ? 5.2 : 4.6;
        map.stop();
        map.jumpTo({ center: [lon, lat], zoom, pitch: 52, bearing: 0, essential: true });
      } catch {}
    }
    window.addEventListener('globehoppers-jump-to-leg-start', handleJumpToLegStart);
    return () => window.removeEventListener('globehoppers-jump-to-leg-start', handleJumpToLegStart);
  }, [mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    function handlePreviewLocation(event) {
      const { lon, lat } = event.detail || {};
      if (lon == null || lat == null) return;
      try {
        userCameraOverrideRef.current = true;
        map.easeTo({ center: [lon, lat], zoom: Math.max(map.getZoom(), 5.8), pitch: 58, bearing: 0, duration: 1400, easing: t => t * (2 - t) });
      } catch {}
    }
    window.addEventListener('globehoppers-preview-location', handlePreviewLocation);
    return () => window.removeEventListener('globehoppers-preview-location', handlePreviewLocation);
  }, [mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const spinAvailable = !trailTuningOpen && !isPlaying && !introLaunching && (!isStarted || globeOverview || idleMode);
    if (!spinAvailable) return;
    let raf;
    let last;
    const spin = (ts) => {
      if (last == null) last = ts;
      const dt = Math.min(64, ts - last);
      last = ts;
      try {
        if (!resetAnimatingRef.current && !manualSpinPauseRef.current && !globeSpinPaused && !destinationSelectionActiveRef.current) {
          const c = map.getCenter();
          const degreesPerSecond = clampGlobeSpinSpeed(globeSpinSpeed);
          map.setCenter([c.lng + degreesPerSecond * dt / 1000, c.lat]);
        }
      } catch {}
      raf = requestAnimationFrame(spin);
    };
    raf = requestAnimationFrame(spin);
    return () => cancelAnimationFrame(raf);
  }, [mapReady, isPlaying, introLaunching, isStarted, globeOverview, idleMode, trailTuningOpen, globeSpinSpeed, globeSpinPaused]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const canvas = map.getCanvas?.();

    const cancelPlaybackReturn = () => {
      clearTimeout(playbackCameraReturnRef.current.timer);
      playbackCameraReturnRef.current = createPlaybackReturnState();
    };
    const schedulePlaybackReturn = () => {
      manualGestureRef.current.pointerDown = false;
      if (!isPlaying) return;
      clearTimeout(playbackCameraReturnRef.current.timer);
      playbackCameraReturnRef.current.timer = window.setTimeout(() => {
        if (!isPlaying || manualGestureRef.current.pointerDown || relocationGlideRef.current.id || introLaunchRef.current.active) return;
        const from = captureCameraState(map);
        if (!from || !latestDesiredCameraRef.current) {
          userCameraOverrideRef.current = false;
          return;
        }
        const target = { ...latestDesiredCameraRef.current, center: [...latestDesiredCameraRef.current.center] };
        const safeZoom = Math.min(Number(from.zoom), Number(target.zoom));
        playbackCameraReturnRef.current = {
          active: true,
          stage: 'reacquire',
          stageStart: performance.now(),
          stageDuration: 1500,
          from,
          stageFrom: from,
          target,
          safeZoom,
          settledFrames: 0,
          timer: null
        };
      }, 500);
    };
    const latchManualCamera = (event = null) => {
      if (relocationGlideRef.current.id || introLaunchRef.current.active) return false;
      const genuineGesture = Boolean(
        event?.originalEvent
        || manualGestureRef.current.pointerDown
        || performance.now() - Number(manualGestureRef.current.lastWheelAt || 0) < 320
      );
      if (event && !genuineGesture) return false;
      resetAnimatingRef.current = false;
      manualSpinPauseRef.current = true;
      clearTimeout(manualSpinResumeTimerRef.current);
      cancelPlaybackReturn();
      userCameraOverrideRef.current = true;
      if (!isPlaying) lastCameraRef.current = null;
      return true;
    };
    const beginPointerGesture = event => {
      manualGestureRef.current.pointerDown = true;
      if (!latchManualCamera(event)) return;
      try { map.stop(); } catch {}
    };
    const endPointerGesture = () => schedulePlaybackReturn();
    const beginWheelGesture = event => {
      const now = performance.now();
      const previousWheelAt = Number(manualGestureRef.current.lastWheelAt || 0);
      manualGestureRef.current.lastWheelAt = now;
      if (!latchManualCamera(event)) return;
      if (now - previousWheelAt > 180) {
        try { map.stop(); } catch {}
      }
      clearTimeout(manualGestureRef.current.wheelTimer);
      manualGestureRef.current.wheelTimer = window.setTimeout(() => {
        manualGestureRef.current.lastWheelAt = 0;
        schedulePlaybackReturn();
      }, 260);
    };
    const latchFromMap = event => { latchManualCamera(event); };

    map.on('movestart', latchFromMap);
    map.on('dragstart', latchFromMap);
    map.on('zoomstart', latchFromMap);
    map.on('rotatestart', latchFromMap);
    map.on('pitchstart', latchFromMap);
    map.on('dragend', schedulePlaybackReturn);
    map.on('zoomend', schedulePlaybackReturn);
    map.on('rotateend', schedulePlaybackReturn);
    map.on('pitchend', schedulePlaybackReturn);
    canvas?.addEventListener('pointerdown', beginPointerGesture, { passive: true, capture: true });
    canvas?.addEventListener('pointerup', endPointerGesture, { passive: true });
    canvas?.addEventListener('pointercancel', endPointerGesture, { passive: true });
    canvas?.addEventListener('touchstart', beginPointerGesture, { passive: true, capture: true });
    canvas?.addEventListener('touchend', endPointerGesture, { passive: true });
    canvas?.addEventListener('wheel', beginWheelGesture, { passive: true });
    canvas?.addEventListener('dblclick', beginWheelGesture, { passive: true });
    canvas?.addEventListener('keydown', latchFromMap);
    return () => {
      map.off('movestart', latchFromMap);
      map.off('dragstart', latchFromMap);
      map.off('zoomstart', latchFromMap);
      map.off('rotatestart', latchFromMap);
      map.off('pitchstart', latchFromMap);
      map.off('dragend', schedulePlaybackReturn);
      map.off('zoomend', schedulePlaybackReturn);
      map.off('rotateend', schedulePlaybackReturn);
      map.off('pitchend', schedulePlaybackReturn);
      canvas?.removeEventListener('pointerdown', beginPointerGesture, true);
      canvas?.removeEventListener('pointerup', endPointerGesture);
      canvas?.removeEventListener('pointercancel', endPointerGesture);
      canvas?.removeEventListener('touchstart', beginPointerGesture, true);
      canvas?.removeEventListener('touchend', endPointerGesture);
      canvas?.removeEventListener('wheel', beginWheelGesture);
      canvas?.removeEventListener('dblclick', beginWheelGesture);
      canvas?.removeEventListener('keydown', latchFromMap);
      clearTimeout(manualGestureRef.current.wheelTimer);
      clearTimeout(playbackCameraReturnRef.current.timer);
    };
  }, [mapReady, isPlaying]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const idleSpinAvailable = !trailTuningOpen && !isPlaying && !introLaunching && (!isStarted || globeOverview || idleMode);
    if (!idleSpinAvailable) {
      manualSpinPauseRef.current = false;
      manualSpinGestureRef.current = { camera: null, zoomChanged: false };
      clearTimeout(manualSpinResumeTimerRef.current);
      return;
    }

    const pauseSpin = event => {
      const userInitiated = Boolean(
        event?.originalEvent
        || manualGestureRef.current.pointerDown
        || performance.now() - Number(manualGestureRef.current.lastWheelAt || 0) < 320
      );
      // Programmatic easeTo/jumpTo events must not latch the spin in a paused
      // state. Only an actual pointer, touch, or wheel gesture owns auto-level.
      if (!userInitiated) return;
      manualSpinPauseRef.current = true;
      resetAnimatingRef.current = false;
      clearTimeout(manualSpinResumeTimerRef.current);
      if (!manualSpinGestureRef.current.camera) {
        manualSpinGestureRef.current = { camera: captureCameraState(map), zoomChanged: false };
      }
      if (event?.type === 'zoomstart' || event?.originalEvent?.type === 'wheel') {
        manualSpinGestureRef.current.zoomChanged = true;
      }
    };
    const resumeAfterIdle = () => {
      if (!manualSpinGestureRef.current.camera) return;
      clearTimeout(manualSpinResumeTimerRef.current);
      manualSpinResumeTimerRef.current = window.setTimeout(() => {
        if (destinationSelectionActiveRef.current || relocationGlideRef.current.id || introLaunchRef.current.active) {
          resumeAfterIdle();
          return;
        }
        try {
          const current = captureCameraState(map);
          const gesture = manualSpinGestureRef.current;
          const preservedZoom = gesture.zoomChanged
            ? current?.zoom
            : (gesture.camera?.zoom ?? current?.zoom ?? IDLE_SPIN_GLOBE_ZOOM);
          const target = autoLevelGlobeCamera(current || {}, { zoom: preservedZoom });
          resetAnimatingRef.current = true;
          map.easeTo({
            ...target,
            duration: AUTO_LEVEL_DURATION_MS,
            essential: true,
            easing: t => t * t * (3 - 2 * t)
          });
          window.setTimeout(() => {
            resetAnimatingRef.current = false;
            manualSpinPauseRef.current = false;
            manualSpinGestureRef.current = { camera: null, zoomChanged: false };
          }, AUTO_LEVEL_DURATION_MS + 80);
        } catch {
          resetAnimatingRef.current = false;
          manualSpinPauseRef.current = false;
          manualSpinGestureRef.current = { camera: null, zoomChanged: false };
        }
      }, AUTO_LEVEL_DELAY_MS);
    };

    map.on('mousedown', pauseSpin);
    map.on('touchstart', pauseSpin);
    map.on('dragstart', pauseSpin);
    map.on('rotatestart', pauseSpin);
    map.on('pitchstart', pauseSpin);
    map.on('zoomstart', pauseSpin);
    map.on('mouseup', resumeAfterIdle);
    map.on('touchend', resumeAfterIdle);
    map.on('dragend', resumeAfterIdle);
    map.on('rotateend', resumeAfterIdle);
    map.on('pitchend', resumeAfterIdle);
    map.on('zoomend', resumeAfterIdle);
    return () => {
      map.off('mousedown', pauseSpin);
      map.off('touchstart', pauseSpin);
      map.off('dragstart', pauseSpin);
      map.off('rotatestart', pauseSpin);
      map.off('pitchstart', pauseSpin);
      map.off('zoomstart', pauseSpin);
      map.off('mouseup', resumeAfterIdle);
      map.off('touchend', resumeAfterIdle);
      map.off('dragend', resumeAfterIdle);
      map.off('rotateend', resumeAfterIdle);
      map.off('pitchend', resumeAfterIdle);
      map.off('zoomend', resumeAfterIdle);
      clearTimeout(manualSpinResumeTimerRef.current);
    };
  }, [mapReady, isPlaying, introLaunching, isStarted, globeOverview, idleMode, trailTuningOpen]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const handleZoom = event => {
      const delta = Number(event?.detail?.delta || 0);
      if (!delta) return;
      try {
        manualSpinPauseRef.current = true;
        resetAnimatingRef.current = true;
        clearTimeout(manualSpinResumeTimerRef.current);
        map.easeTo({ zoom: Math.max(1.2, Math.min(8.5, map.getZoom() + delta)), duration: 900, essential: true, easing: t => t * (2 - t) });
        manualSpinResumeTimerRef.current = window.setTimeout(() => {
          resetAnimatingRef.current = false;
          manualSpinPauseRef.current = false;
        }, 980);
      } catch {
        resetAnimatingRef.current = false;
        manualSpinPauseRef.current = false;
      }
    };
    const restoreCamera = event => {
      const camera = event?.detail?.camera;
      if (!camera?.center) return;
      try {
        resetAnimatingRef.current = true;
        map.stop();
        map.easeTo({ ...camera, duration: 2200, essential: true, easing: t => t * t * (3 - 2 * t) });
        window.setTimeout(() => { resetAnimatingRef.current = false; }, 2280);
      } catch { resetAnimatingRef.current = false; }
    };
    window.addEventListener('globehoppers-globe-zoom', handleZoom);
    window.addEventListener('globehoppers-restore-camera', restoreCamera);
    return () => {
      window.removeEventListener('globehoppers-globe-zoom', handleZoom);
      window.removeEventListener('globehoppers-restore-camera', restoreCamera);
    };
  }, [mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const wasIdle = idleModePreviousRef.current;
    idleModePreviousRef.current = Boolean(idleMode);
    if (isPlaying) {
      idleCameraRef.current = null;
      try { map.stop(); } catch {}
      return;
    }
    if (idleMode && !wasIdle) {
      idleCameraRef.current = captureCameraState(map);
      manualSpinPauseRef.current = true;
      resetAnimatingRef.current = true;
      try {
        const center = map.getCenter();
        map.stop();
        map.easeTo({ center: [center.lng, Math.max(-34, Math.min(34, center.lat))], zoom: Math.min(map.getZoom(), 3.25), pitch: 0, bearing: 0, duration: 3200, essential: true, easing: t => t * t * (3 - 2 * t) });
        window.setTimeout(() => { resetAnimatingRef.current = false; manualSpinPauseRef.current = false; }, 3280);
      } catch { resetAnimatingRef.current = false; manualSpinPauseRef.current = false; }
      return;
    }
    if (!idleMode && wasIdle && idleExitMode === 'restore' && idleCameraRef.current) {
      const camera = idleCameraRef.current;
      idleCameraRef.current = null;
      manualSpinPauseRef.current = true;
      resetAnimatingRef.current = true;
      try {
        map.stop();
        map.easeTo({ ...camera, duration: 2600, essential: true, easing: t => t * t * (3 - 2 * t) });
        window.setTimeout(() => { resetAnimatingRef.current = false; manualSpinPauseRef.current = false; }, 2680);
      } catch { resetAnimatingRef.current = false; manualSpinPauseRef.current = false; }
    }
    if (!idleMode && wasIdle && idleExitMode === 'play') idleCameraRef.current = null;
  }, [idleMode, idleExitMode, mapReady, isPlaying]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const refresh = () => {
      throttledRefreshPersistentPinPositions(map, persistentLabelElsRef, labelRefreshThrottleRef, labelVisibilityStateRef, placardRuntimeRef);
      // map.jumpTo() emits move/render events synchronously. During playback the
      // playback engine already updates the vehicle once per display frame, so
      // these listeners must not repeat the same projection and DOM work.
      if (playbackOwnsOverlayRef.current) return;
      const state = currentOverlayStateRef.current;
      if (!state) return;
      updateOverlay(map, state.active, state.scene, state.color);
      updateAirArcOverlay(map, airArcRef.current, state.active, state.scene, state.color);
      const destPt = state.active?.leg?.to ? map.project([state.active.leg.to.lon, state.active.leg.to.lat]) : null;
      if (destPt) updatePulseOverlay(pulseRef.current, destPt, state.color, state.scene?.pulseActive);
    };
    map.on('move', refresh);
    map.on('zoom', refresh);
    return () => {
      map.off('move', refresh);
      map.off('zoom', refresh);
    };
  }, [mapReady]);

  useEffect(() => {
    playbackOwnsOverlayRef.current = Boolean(isPlaying);
    if (!isPlaying && mapRef.current) setZoomReadout(Number(mapRef.current.getZoom?.() || INTRO_GLOBE_ZOOM));
    return () => { playbackOwnsOverlayRef.current = false; };
  }, [isPlaying]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    setCompletedRoutePaintState(map, { multiplier: 1, duration: 180, playback: Boolean(isPlaying) });
  }, [mapReady, isPlaying]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // v7.5: direct manipulation remains available during playback. A gesture
    // temporarily releases the cinematic camera and the frame loop glides back
    // to the vessel after the user lets go.
    const methods = [map.dragPan, map.scrollZoom, map.boxZoom, map.keyboard, map.doubleClickZoom, map.touchZoomRotate, map.dragRotate];
    for (const method of methods) {
      try { method.enable(); } catch {}
    }
    try { map.touchZoomRotate.enableRotation(); } catch {}
    try { map.scrollZoom?.setWheelZoomRate?.(1 / 360); } catch {}
    try { map.scrollZoom?.setZoomRate?.(1 / 70); } catch {}
    if (isPlaying) {
      // Playback is the sole camera owner once a Hop begins. Cancel any delayed
      // View Globe lock, idle restore, or residual ease before the frame loop
      // starts; otherwise a stale overview callback can snap back to Zoom 4.20
      // a few seconds into the route.
      clearOverviewLockTimers();
      clearTimeout(playbackCameraReturnRef.current.timer);
      playbackCameraReturnRef.current = createPlaybackReturnState();
      userCameraOverrideRef.current = false;
      manualSpinPauseRef.current = false;
      idleCameraRef.current = null;
      resetAnimatingRef.current = false;
      clearTimeout(manualSpinResumeTimerRef.current);
      try { map.stop(); } catch {}
      const liveCamera = captureCameraState(map);
      if (liveCamera) {
        lastCameraRef.current = { ...liveCamera, center: [...liveCamera.center] };
        latestDesiredCameraRef.current = { ...liveCamera, center: [...liveCamera.center] };
      }
      frameRenderStatsRef.current.lastCamera = 0;
    } else {
      clearTimeout(playbackCameraReturnRef.current.timer);
      playbackCameraReturnRef.current = createPlaybackReturnState();
    }
  }, [isPlaying]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    // Completed route history is static map data. Route prefetch can update
    // routedGeometries several times while the current vehicle is moving; those
    // cache-only updates must not serialize the entire historical timeline.
    const lastCompleted = completedLegs[completedLegs.length - 1];
    const completedStructureSignature = [
      completedLegs.length,
      lastCompleted?.trip?.id || '',
      lastCompleted?.legId || lastCompleted?.leg?.legId || lastCompleted?.legIndex || '',
      showTrails ? 1 : 0,
      active?.trip?.id || '',
      Number(trailOpacity || 0).toFixed(3),
      Number(trailWidth || 0).toFixed(3),
      trailTuningOpen ? 1 : 0
    ].join('|');
    if (isPlaying && showTrails && !trailTuningOpen && !fadeTrailRef.current.active && !trailProfileMorphRef.current.active
      && completedRouteRenderRef.current.signature === completedStructureSignature) return;

    if (trailTuningOpen) syncTrailTuningDemo(map, trailTuningConfig, trailWidth);
    else {
      if (showTrails) {
        fadeTrailRef.current.active = false;
        window.cancelAnimationFrame(fadeTrailRef.current.raf || 0);
      window.clearTimeout(fadeTrailRef.current.timer || 0);
        if (trailProfileMorphRef.current.active) return;
      }
      const heldTripId = fadeTrailRef.current?.key ? String(fadeTrailRef.current.key).split(':')[0] : '';
      const activeTripId = active?.trip?.id || '';
      const heldFeatures = (!showTrails && isPlaying && !fadeTrailRef.current.active && heldTripId && heldTripId === activeTripId)
        ? (fadeTrailRef.current.features || [])
        : [];
      if (!fadeTrailRef.current.active && !showTrails && heldFeatures.length === 0 && heldTripId && heldTripId !== activeTripId) {
        fadeTrailRef.current = { ...fadeTrailRef.current, active: false, features: [], key: '' };
      }
      if (!fadeTrailRef.current.active) {
        syncCompletedRoutes(map, completedLegs, hopperData || travById, showTrails, trailOpacity, trailWidth, routedGeometries, trailTuningConfig, heldFeatures, active?.trip?.id || null);
      }
    }
    completedRouteRenderRef.current.signature = completedStructureSignature;
  }, [mapReady, completedLegs, travById, showTrails, trailOpacity, trailWidth, routedGeometries, trailTuningOpen, trailTuningConfig, isPlaying, active?.trip?.id]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    if (!trailTuningOpen) {
      trailTuningFramedRef.current = false;
      return;
    }
    if (trailTuningFramedRef.current) return;
    trailTuningFramedRef.current = true;
    try {
      manualSpinPauseRef.current = true;
      clearTimeout(manualSpinResumeTimerRef.current);
      userCameraOverrideRef.current = true;
      resetAnimatingRef.current = true;
      map.stop();
      map.easeTo({ center: [-98.2, 37.7], zoom: 3.35, bearing: 0, pitch: 0, duration: 850, essential: true, easing: t => 1 - Math.pow(1 - t, 3) });
      window.setTimeout(() => { resetAnimatingRef.current = false; }, 920);
    } catch { resetAnimatingRef.current = false; }
  }, [mapReady, trailTuningOpen]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    // Visited points and labels change only when the timeline reaches a new
    // destination, not on every animation frame.
    if (trailTuningOpen) {
      syncVisitedPoints(map, [], lastVisitedSigRef);
      updatePersistentLabels(map, [], persistentLabelElsRef, visitedLabelsRef, 'transparent', null, droppedPinIdsRef);
      return;
    }
    const visited = buildVisitedLocations(completedLegs, active, labelCompletedMode, scene, hopperData || travById, homeBases);
    syncVisitedPoints(map, visited, lastVisitedSigRef);
    updatePersistentLabels(map, visited, persistentLabelElsRef, visitedLabelsRef, colorForLeg(active, hopperData || travById), scene?.newArrivalId || null, droppedPinIdsRef);
  }, [mapReady, completedLegs, activeIndex, active?.trip?.id, active?.legIndex, labelCompletedMode, scene?.newArrivalId, travById, isStarted, introLaunching, isPlaying, globeOverview, trailTuningOpen]);

  useEffect(() => {
    const map = mapRef.current;
    const request = relocationTransition;
    if (!mapReady || !map || !request?.id) return;

    const destination = request.to;
    const lon = Number(destination?.lon);
    const lat = Number(destination?.lat);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) {
      onRelocationComplete?.(request.id, { status: 'invalid-target' });
      return;
    }

    if (relocationGlideRef.current.id === request.id) return;
    if (relocationGlideRef.current.finish) relocationGlideRef.current.finish('superseded');

    userCameraOverrideRef.current = false;
    manualSpinPauseRef.current = true;
    clearTimeout(manualSpinResumeTimerRef.current);
    resetAnimatingRef.current = true;
    map.stop();

    const distance = Math.max(0, Number(request.distanceMiles) || milesBetween(request.from || destination, destination));
    const targetZoom = relocationTargetZoom(distance, request.nextMode, cameraMode);
    const overviewZoom = relocationOverviewZoom(distance);
    const zoomOutDuration = Math.round(clamp(1500 + Math.sqrt(Math.max(1, distance)) * 14, 1800, 3000));
    const repositionDuration = Math.round(clamp(1800 + Math.sqrt(Math.max(1, distance)) * 17, 2300, 4300));
    const zoomInDuration = Math.round(clamp(1900 + Math.sqrt(Math.max(1, distance)) * 16, 2200, 3800));
    const totalDuration = zoomOutDuration + repositionDuration + zoomInDuration;
    let finished = false;
    let stageCleanup = null;

    const clearStage = () => {
      stageCleanup?.();
      stageCleanup = null;
      window.clearTimeout(relocationGlideRef.current.timer);
      relocationGlideRef.current.timer = null;
    };
    const finish = (status = 'complete') => {
      if (finished) return;
      finished = true;
      clearStage();
      relocationGlideRef.current = { id: null, timer: null, finish: null };
      resetAnimatingRef.current = false;
      manualSpinPauseRef.current = false;
      const settledCenter = map.getCenter?.();
      lastCameraRef.current = {
        center: Number.isFinite(settledCenter?.lng) && Number.isFinite(settledCenter?.lat) ? [settledCenter.lng, settledCenter.lat] : [lon, lat],
        zoom: Number(map.getZoom?.() || targetZoom),
        bearing: Number(map.getBearing?.() || 0),
        pitch: Number(map.getPitch?.() || 0)
      };
      onRelocationComplete?.(request.id, { status, duration: totalDuration });
    };

    const runEaseStage = (options, timeoutMs, next) => {
      clearStage();
      let completed = false;
      const completeStage = () => {
        if (completed || finished || relocationGlideRef.current.id !== request.id) return;
        completed = true;
        clearStage();
        next?.();
      };
      const handleMoveEnd = () => completeStage();
      map.once?.('moveend', handleMoveEnd);
      stageCleanup = () => map.off?.('moveend', handleMoveEnd);
      relocationGlideRef.current.timer = window.setTimeout(completeStage, timeoutMs + 500);
      map.easeTo({ ...options, duration: timeoutMs, essential: true, easing: t => 1 - Math.pow(1 - t, 3) });
    };

    const zoomInAtDestination = () => {
      if (finished || relocationGlideRef.current.id !== request.id) return;
      runEaseStage({ center: [lon, lat], zoom: targetZoom, pitch: 52, bearing: 0 }, zoomInDuration, () => finish('complete'));
    };
    const glideAtOverview = () => {
      if (finished || relocationGlideRef.current.id !== request.id) return;
      // Keep the globe at overview altitude and visibly glide across it. A jump
      // here was the remaining cut between disconnected trips.
      runEaseStage({ center: [lon, lat], zoom: overviewZoom, pitch: 18, bearing: 0 }, repositionDuration, zoomInAtDestination);
    };

    relocationGlideRef.current = { id: request.id, timer: null, finish };
    try {
      const currentCenter = map.getCenter?.();
      const center = Number.isFinite(currentCenter?.lng) && Number.isFinite(currentCenter?.lat)
        ? [currentCenter.lng, currentCenter.lat]
        : [Number(request.from?.lon) || lon, Number(request.from?.lat) || lat];
      runEaseStage({ center, zoom: overviewZoom, pitch: 18, bearing: 0 }, zoomOutDuration, glideAtOverview);
    } catch {
      glideAtOverview();
    }

    return () => {
      if (relocationGlideRef.current.id !== request.id) return;
      clearStage();
      try { map.stop(); } catch {}
      relocationGlideRef.current = { id: null, timer: null, finish: null };
      resetAnimatingRef.current = false;
      manualSpinPauseRef.current = false;
    };
  }, [mapReady, relocationTransition?.id, cameraMode, onRelocationComplete]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    if (!completedMode && timelineCompletionRef.current.key) {
      clearTimeout(timelineCompletionRef.current.timer);
      timelineCompletionRef.current = { key: '', timer: null };
      resetAnimatingRef.current = false;
    }

    if (trailTuningOpen) {
      syncTrailTuningDemo(map, trailTuningConfig, trailWidth);
      syncActiveRoute(map, null);
      syncPulse(map, null, 'transparent');
      currentOverlayStateRef.current = null;
      setOverlayVisibility(false);
      return;
    }

    if (!scene || !active) {
      syncActiveRoute(map, null);
      syncPulse(map, null, 'transparent');
      currentOverlayStateRef.current = null;
      setOverlayVisibility(false);
      if (!isPlaying && !showTrails) {
        fadeTrailRef.current = { ...fadeTrailRef.current, active: false, features: [], key: '' };
        syncCompletedRoutes(map, completedLegs, hopperData || travById, false, trailOpacity, trailWidth, routedGeometries, trailTuningConfig, []);
      }
      if (completedMode && !globeOverview) {
        const finalEntry = completedLegs[completedLegs.length - 1] || previousActiveRouteRef.current?.active || null;
        const finalDestination = finalEntry?.leg?.to || null;
        const finalKey = `${finalEntry?.trip?.id || 'timeline'}:${finalEntry?.legId || finalEntry?.leg?.legId || finalEntry?.legIndex || 'final'}:${playbackGeneration}`;

        if (timelineCompletionRef.current.key !== finalKey) {
          clearTimeout(timelineCompletionRef.current.timer);
          userCameraOverrideRef.current = false;
          manualSpinPauseRef.current = false;
          clearTimeout(manualSpinResumeTimerRef.current);
          resetAnimatingRef.current = true;

          const liveCenter = map.getCenter?.();
          const liveZoom = Number(map.getZoom?.() || IDLE_SPIN_GLOBE_ZOOM);
          const completionCenter = Number.isFinite(liveCenter?.lng) && Number.isFinite(liveCenter?.lat)
            ? [liveCenter.lng, liveCenter.lat]
            : [Number(finalDestination?.lon || INTRO_GLOBE_CENTER[0]), Number(finalDestination?.lat || INTRO_GLOBE_CENTER[1])];
          const completionZoom = Math.min(liveZoom, IDLE_SPIN_GLOBE_ZOOM);

          map.stop();
          map.easeTo({
            center: completionCenter,
            zoom: completionZoom,
            bearing: 0,
            pitch: 0,
            duration: TIMELINE_COMPLETE_GLOBE_DURATION_MS,
            essential: true,
            easing: t => 1 - Math.pow(1 - t, 3)
          });

          const timer = window.setTimeout(() => {
            resetAnimatingRef.current = false;
            const settledCenter = map.getCenter?.();
            lastCameraRef.current = {
              center: Number.isFinite(settledCenter?.lng) && Number.isFinite(settledCenter?.lat)
                ? [settledCenter.lng, settledCenter.lat]
                : completionCenter,
              zoom: Number(map.getZoom?.() || IDLE_SPIN_GLOBE_ZOOM),
              bearing: Number(map.getBearing?.() || 0),
              pitch: Number(map.getPitch?.() || 0)
            };
          }, TIMELINE_COMPLETE_GLOBE_DURATION_MS + 80);

          timelineCompletionRef.current = { key: finalKey, timer };
        }
      }
      return;
    }

    const color = colorForLeg(active, hopperData || travById);

    if (introLaunching) {
      const launchKey = `${active.trip.id}:${active.legId || active.leg?.legId || active.legIndex}`;
      if (introLaunchRef.current.key !== launchKey || !introLaunchRef.current.active) {
        introLaunchRef.current = { active: true, key: launchKey };
        syncActiveRoute(map, null);
        syncPulse(map, null, 'transparent');
        currentOverlayStateRef.current = null;
        setOverlayVisibility(false);
        lastCameraRef.current = null;
        map.stop();
        map.easeTo({ ...scene.camera, duration: 6200, essential: true, easing: t => 1 - Math.pow(1 - t, 3) });
        window.clearTimeout(introLaunchRef.current.timer);
        introLaunchRef.current.timer = window.setTimeout(() => {
          lastCameraRef.current = scene.camera;
          introLaunchRef.current.active = false;
          onIntroLaunchComplete?.();
        }, 6280);
      }
      return;
    } else if (introLaunchRef.current.active) {
      window.clearTimeout(introLaunchRef.current.timer);
      introLaunchRef.current.active = false;
    }

    if (relocationTransition?.id) {
      const color = colorForLeg(active, hopperData || travById);
      syncActiveRoute(map, active, Math.max(0.999, scene.lineProgress || 1), color, routedGeometries, hopperData || travById, trailTuningConfig);
      syncPulse(map, active.leg.to, color);
      currentOverlayStateRef.current = { active, scene, color };
      updateOverlay(map, active, scene, color);
      updateAirArcOverlay(map, airArcRef.current, active, scene, color);
      return;
    }

    const now = performance.now();
    const activeRouteKey = `${active?.trip?.id || ''}:${active?.legId || active?.leg?.legId || active?.legIndex || ''}`;
    const prevRoute = previousActiveRouteRef.current || {};
    if (prevRoute.key && prevRoute.key !== activeRouteKey && showTrails && isPlaying) {
      const previousTripId = prevRoute.active?.trip?.id || '';
      const currentTripId = active?.trip?.id || '';
      if (previousTripId && currentTripId && previousTripId !== currentTripId) {
        startTrailProfileMorph(map, trailProfileMorphRef, previousTripId, completedLegs, hopperData || travById, showTrails, trailOpacity, trailWidth, routedGeometries, trailTuningConfig, currentTripId);
      }
    }
    if (prevRoute.key && prevRoute.key !== activeRouteKey && !showTrails && isPlaying && prevRoute.features?.length) {
      const sameTrip = prevRoute.active?.trip?.id && prevRoute.active.trip.id === active?.trip?.id;
      window.cancelAnimationFrame(fadeTrailRef.current.raf || 0);
      window.clearTimeout(fadeTrailRef.current.timer || 0);
      if (sameTrip) {
        // Within one trip, keep all completed legs from that same trip visible
        // while the return/next leg plays. This preserves the round-trip visual.
        const heldSameTripFeatures = mergeHeldRouteFeatures(fadeTrailRef.current.features || [], prevRoute.features || []);
        fadeTrailRef.current = { ...fadeTrailRef.current, active: false, features: heldSameTripFeatures, key: prevRoute.key };
        syncCompletedRoutes(map, completedLegs, hopperData || travById, false, trailOpacity, trailWidth, routedGeometries, trailTuningConfig, heldSameTripFeatures);
      } else {
        // When we switch to a different trip with Trails off, fade out the entire
        // previous trip route set (including any held outbound/return legs), then
        // remove it completely. Only the current active trip may remain afterward.
        const previousTripFeatures = mergeHeldRouteFeatures(fadeTrailRef.current.features || [], prevRoute.features || []);
        fadeTrailRef.current = { ...fadeTrailRef.current, active: true, features: previousTripFeatures, key: prevRoute.key };
        startCompletedRouteFade(map, fadeTrailRef, previousTripFeatures, completedLegs, hopperData || travById, trailOpacity, trailWidth, routedGeometries, trailTuningConfig);
      }
    }
    // During active playback the singleton playback engine drives camera,
    // vessel, and active-trail rendering directly at display refresh rate.
    // This React effect still handles route transitions/fades, but does not
    // compete with the frame loop.
    if (isPlaying) return;

    if (now - lastActiveRouteUpdateRef.current > 16 || scene.lineProgress >= 0.995 || prevRoute.key !== activeRouteKey) {
      const activeFeatures = syncActiveRoute(map, active, scene.lineProgress, color, routedGeometries, hopperData || travById, trailTuningConfig);
      previousActiveRouteRef.current = {
        key: activeRouteKey,
        active,
        progress: scene.lineProgress,
        features: activeRouteFeaturesForFadeFromFeatures(activeFeatures)
      };
      lastActiveRouteUpdateRef.current = now;
    }
    syncPulse(map, active.leg.to, scene.pulseActive ? color : 'transparent');

    // v2.26: glide faster toward the route lead point. The old smoothing was so
    // conservative that the camera could fall behind the vessel and then catch
    // up in visible steps. These values still ease, but keep the camera ahead.
    const smoothing = scene.phase === 'settle' ? 0.014 : scene.phase === 'predeparture' ? 0.010 : scene.phase === 'takeoff' ? 0.020 : scene.phase === 'arrival' ? 0.022 : 0.020;
    const transitionStats = frameRenderStatsRef.current;
    const transitionAge = Math.max(0, now - Number(transitionStats.transitionStartedAt || 0));
    let targetCamera = scene.camera;

    if (transitionStats.transitionKind === 'continuous' && transitionStats.transitionStartCamera && transitionAge < CONTINUOUS_HANDOFF_HOLD_MS + CONTINUOUS_HANDOFF_RELEASE_MS) {
      const releaseProgress = Math.max(0, Math.min(1, (transitionAge - CONTINUOUS_HANDOFF_HOLD_MS) / CONTINUOUS_HANDOFF_RELEASE_MS));
      const releaseEase = releaseProgress * releaseProgress * (3 - 2 * releaseProgress);
      const preservedZoom = lerp(transitionStats.transitionStartCamera.zoom, scene.camera.zoom, releaseEase);
      targetCamera = { ...scene.camera, zoom: Math.max(scene.camera.zoom, preservedZoom) };
    }

    let camera;
    if (forceSceneJumpRef.current) {
      camera = scene.camera;
      forceSceneJumpRef.current = false;
    } else {
      camera = smoothCamera(lastCameraRef.current, targetCamera, smoothing);
    }
    lastCameraRef.current = camera;
    if (!userCameraOverrideRef.current) {
      map.jumpTo({ ...camera, essential: true });
    }

    currentOverlayStateRef.current = { active, scene, color };
    updateOverlay(map, active, scene, color);
    updateAirArcOverlay(map, airArcRef.current, active, scene, color);
  }, [mapReady, scene?.frameKey, active, completedMode, completedLegs, travById, routedGeometries, introLaunching, onIntroLaunchComplete, globeOverview, relocationTransition?.id, trailTuningOpen, trailTuningConfig, trailWidth, trailOpacity, showTrails, isPlaying, playbackGeneration]);

  useEffect(() => {
    if (!mapReady) return;
    return playbackEngine.subscribe(frame => {
      if (!frame?.playing) return;
      const map = mapRef.current;
      const context = latestFrameContextRef.current;
      const activeEntry = context?.active;
      if (!map || !activeEntry || context.completedMode || context.overviewMode || context.introLaunching || trailTuningOpen) return;

      const routeKey = `${activeEntry?.trip?.id || ''}:${activeEntry?.legId || activeEntry?.leg?.legId || activeEntry?.legIndex || ''}`;
      const metadata = frame?.metadata || {};
      if (metadata.tripId !== activeEntry?.trip?.id) return;
      const activeLegId = activeEntry?.legId || activeEntry?.leg?.legId || activeEntry?.leg?.id || null;
      if (activeLegId && String(metadata.legId || '') !== String(activeLegId)) return;
      if (Number(metadata.legIndex || 0) !== Number(activeEntry?.legIndex || 0)) return;
      if (Number(frame.generation || metadata.generation || 0) !== Number(context.playbackGeneration || 0)) return;

      const now = Number(frame.timestamp || performance.now());
      const quality = frame.quality || 'high';
      const trailInterval = quality === 'high' ? 84 : quality === 'medium' ? 100 : 125;
      const cameraInterval = quality === 'high' ? 28 : quality === 'medium' ? 35 : 44;
      const stats = frameRenderStatsRef.current;
      recordPlaybackFrame(now, quality);

      if (stats.lastRouteKey !== routeKey) {
        const previousEntry = stats.lastActiveEntry;
        // A route transition must begin with no arrival pulse. The old map-layer
        // pulse could otherwise survive until the first settle-state frame.
        syncPulse(map, null, 'transparent');
        if (pulseRef.current) {
          pulseRef.current.classList.remove('is-active');
          pulseRef.current.style.opacity = '0';
        }
        stats.lastPulse = false;
        const liveGeometry = getRoutedGeometry(activeEntry.leg, routedGeometriesRef.current);
        const livePlan = playbackPlansRef.current.get(playbackPlanKey(activeEntry.leg, liveGeometry)) || null;
        const transitionScene = getScene(
          activeEntry,
          Number(frame.rawProgress || 0),
          context.cameraMode,
          context.nextActive,
          routedGeometriesRef.current,
          context.routeStackingEnabled,
          livePlan
        );
        const capturedTransitionCamera = lastCameraRef.current
          ? { ...lastCameraRef.current, center: [...lastCameraRef.current.center] }
          : null;
        // A disconnected leg has already completed its dedicated relocation glide.
        // Never seed playback from a stale overview/idle camera after that glide.
        const connectedTransition = previousEntry && legsConnect(previousEntry?.leg, activeEntry?.leg);
        stats.transitionStartCamera = connectedTransition && capturedTransitionCamera
          ? { ...capturedTransitionCamera, zoom: Math.max(Number(capturedTransitionCamera.zoom || 0), Number(transitionScene.camera.zoom || 0)) }
          : { ...transitionScene.camera, center: [...transitionScene.camera.center] };
        if (!connectedTransition) {
          lastCameraRef.current = { ...transitionScene.camera, center: [...transitionScene.camera.center] };
          latestDesiredCameraRef.current = { ...transitionScene.camera, center: [...transitionScene.camera.center] };
        }
        stats.transitionKind = connectedTransition ? 'continuous' : previousEntry ? 'relocation' : 'initial';
        stats.transitionStartedAt = now;
        stats.lastRouteKey = routeKey;
        stats.lastTrail = 0;
        stats.lastCamera = 0;
        stats.lastTrailProgress = -1;
        stats.lastPlanCheck = now;
        stats.playbackPlan = livePlan;
        stats.frozenEntry = freezeActiveEntryGeometry(activeEntry, routedGeometriesRef.current, livePlan);
        stats.lastActiveEntry = activeEntry;
      } else if ((!stats.playbackPlan || !stats.frozenEntry?.leg?.presentationGeometry) && now - Number(stats.lastPlanCheck || 0) >= 500) {
        // Late route/plan promotion is polled at a low rate. Do not rebuild route
        // keys and geometry signatures on every animation frame.
        const liveGeometry = getRoutedGeometry(activeEntry.leg, routedGeometriesRef.current);
        const livePlan = playbackPlansRef.current.get(playbackPlanKey(activeEntry.leg, liveGeometry)) || null;
        stats.lastPlanCheck = now;
        if (livePlan) stats.playbackPlan = livePlan;
        if (!stats.frozenEntry?.leg?.presentationGeometry && liveGeometry?.length > 1) {
          stats.frozenEntry = freezeActiveEntryGeometry(activeEntry, routedGeometriesRef.current, livePlan);
        }
      }

      const renderEntry = stats.frozenEntry || activeEntry;
      const plan = stats.playbackPlan || null;
      const sceneState = getScene(
        renderEntry,
        Number(frame.rawProgress || 0),
        context.cameraMode,
        context.nextActive,
        routedGeometriesRef.current,
        context.routeStackingEnabled,
        plan
      );
      const color = colorForLeg(renderEntry, context.hopperVisuals);

      const trailMoved = stats.lastTrailProgress < 0 || Math.abs(sceneState.lineProgress - stats.lastTrailProgress) >= 1 / 240;
      if ((trailMoved && now - stats.lastTrail >= trailInterval) || sceneState.lineProgress >= 0.995) {
        const activeFeatures = syncActiveRoute(map, renderEntry, sceneState.lineProgress, color, routedGeometriesRef.current, context.hopperVisuals, context.trailTuningConfig);
        previousActiveRouteRef.current = {
          key: routeKey,
          active: renderEntry,
          progress: sceneState.lineProgress,
          features: activeRouteFeaturesForFadeFromFeatures(activeFeatures)
        };
        stats.lastTrail = now;
        stats.lastTrailProgress = sceneState.lineProgress;
        recordPlaybackEvent('activeTrailUpdates');
      }

      if (sceneState.pulseActive !== stats.lastPulse) {
        syncPulse(map, sceneState.visibleDestination || renderEntry.leg.to, sceneState.pulseActive ? color : 'transparent');
        stats.lastPulse = sceneState.pulseActive;
      }

      const transitionAge = Math.max(0, now - Number(stats.transitionStartedAt || 0));
      const cameraDue = now - Number(stats.lastCamera || 0) >= cameraInterval || stats.lastCamera === 0;
      if (cameraDue) {
        let smoothing = adaptiveCameraSmoothing(sceneState.phase, quality);
        if ((sceneState.legMode === 'plane' || sceneState.legMode === 'move') && sceneState.distance > 1500 && Number(frame.rawProgress || 0) < 0.28) {
          smoothing = Math.min(smoothing, quality === 'low' ? 0.008 : 0.012);
        }
        if (transitionAge < CONTINUOUS_HANDOFF_HOLD_MS && stats.transitionKind !== 'continuous') {
          smoothing = Math.min(smoothing, 0.018);
        }

        // Connected legs use the same continuous follow target. Do not hold or
        // release a second zoom target across the handoff; that produced the
        // repeated accelerate/brake sensation when selecting a new pin.
        const targetCamera = sceneState.camera;

        const returnState = playbackCameraReturnRef.current;
        const desiredPrevious = returnState.active ? latestDesiredCameraRef.current : lastCameraRef.current;
        let camera = smoothCamera(desiredPrevious, targetCamera, smoothing);
        // During staged reacquisition the live map is intentionally looking away
        // from the vessel. Screen-space constraint math against that temporary
        // camera would tug the desired target every frame and cause visible jitter.
        if (!returnState.active) camera = constrainCameraToVessel(map, camera, sceneState.vehicle, quality);
        latestDesiredCameraRef.current = camera;
        if (returnState.active && returnState.stageFrom) {
          const returnCamera = stagedPlaybackReturnCamera(returnState, camera, now);
          if (returnCamera && cameraChangedEnough(captureCameraState(map), returnCamera)) {
            map.jumpTo({ ...returnCamera, essential: true });
          }
          lastCameraRef.current = returnCamera || lastCameraRef.current;
          if (!returnState.active) {
            playbackCameraReturnRef.current = createPlaybackReturnState();
            userCameraOverrideRef.current = false;
            lastCameraRef.current = returnCamera || camera;
          }
        } else {
          if (!userCameraOverrideRef.current && cameraChangedEnough(captureCameraState(map), camera)) {
            map.jumpTo({ ...camera, essential: true });
          }
          lastCameraRef.current = camera;
        }
        stats.lastCamera = now;
        recordPlaybackEvent('cameraUpdates');
      }

      currentOverlayStateRef.current = { active: renderEntry, scene: sceneState, color };
      placardRuntimeRef.current.focus = sceneState.vehicle;
      updateOverlay(map, renderEntry, sceneState, color);
      recordPlaybackEvent('overlayUpdates');
      if ((renderEntry.leg.mode === 'plane' || renderEntry.leg.mode === 'move')
        && (quality !== 'low' || Math.floor(now / 66) % 2 === 0)) {
        updateAirArcOverlay(map, airArcRef.current, renderEntry, sceneState, color);
      }
      stats.lastFrame = now;
    });
  }, [mapReady, trailTuningOpen]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !active || completedMode || !scene?.pulseActive) return;
    const color = colorForLeg(active, hopperData || travById);
    clearTimeout(arrivalTimerRef.current);
    syncPulse(map, active.leg.to, color);
    arrivalTimerRef.current = setTimeout(() => syncPulse(map, active.leg.to, 'transparent'), 900);
    return () => clearTimeout(arrivalTimerRef.current);
  }, [mapReady, activeIndex, scene?.pulseActive, active, completedMode, travById]);


  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || completedMode) return;
    preloadTilesForLeg(active?.leg, map, tilePreloadRef.current, 'active', routedGeometries);
    preloadTilesForLeg(nextActive?.leg, map, tilePreloadRef.current, 'next', routedGeometries);
  }, [mapReady, active?.trip?.id, active?.legIndex, nextActive?.trip?.id, nextActive?.legIndex, completedMode, routedGeometries]);


  function setOverlayVisibility(visible) {
    for (const ref of [vehicleRef, pulseRef, airArcRef, liveTrailConnectorRef]) {
      if (ref.current) ref.current.style.opacity = visible ? '1' : '0';
    }
  }

  function updateOverlay(map, activeLeg, sceneState, color) {
    if (!vehicleRef.current) return;
    const { leg } = activeLeg;
    const vehiclePt = map.project([sceneState.vehicle.lon, sceneState.vehicle.lat]);

    const mode = leg.mode;
    const iconMode = mode === 'move' ? 'plane' : mode;
    // v2.22: all top-down PNG vessel icons are authored nose-up. Rotate the icon so
    // the nose points along the current projected route segment. This applies to
    // plane/car/boat/train; the route itself remains north-up.
    const tangentRotation = projectedHeadingFromScene(map, sceneState);
    // Screen-space movement includes camera motion. Using it as a heading made
    // cars and boats rotate wildly whenever the follow camera moved. Route
    // tangent is camera-stable and remains the single source of orientation.
    const projectedRotation = tangentRotation;
    const rawRotation = applyVesselSpriteOffset(projectedRotation, iconMode);
    const previousRotation = Number(vehicleRef.current.__jlVehicleRotation);
    const rotationBlend = iconMode === 'plane' ? 0.34 : iconMode === 'car' ? 0.30 : iconMode === 'train' ? 0.26 : 0.22;
    const rotation = Number.isFinite(previousRotation)
      ? lerpAngle(previousRotation, rawRotation, rotationBlend)
      : rawRotation;
    vehicleRef.current.__jlVehicleRotation = rotation;
    const iconKey = `${iconMode}:${String(color || '#00e5ff')}`;
    if (vehicleRef.current.__jlVehicleIconKey !== iconKey) {
      const requestId = Number(vehicleRef.current.__jlVehicleIconRequestId || 0) + 1;
      vehicleRef.current.__jlVehicleIconRequestId = requestId;
      const iconUrl = peekRecoloredVesselIconUrl(iconMode, color);
      // Never flash the blue source icon for a red/pink/etc. Hop. Use the
      // currentColor SVG silhouette for the first frame, then swap in the exact
      // recolored PNG as soon as its cached generation completes.
      const nextMarkup = iconUrl ? `<img class="jl-vehicle-img" src="${escapeHtml(iconUrl)}" alt="" draggable="false" />` : vehicleSvg(iconMode);
      if (vehicleRef.current.__jlVehicleMarkup !== nextMarkup) {
        vehicleRef.current.innerHTML = nextMarkup;
        vehicleRef.current.__jlVehicleMarkup = nextMarkup;
      }
      vehicleRef.current.__jlVehicleIconKey = iconKey;
      vehicleRef.current.dataset.mode = iconMode;
      vehicleRef.current.dataset.iconColor = String(color || '#00e5ff');
      vehicleRef.current.style.setProperty('--vehicle-color', color);
      // The first synchronous lookup may still be the blue base asset while the
      // requested color is being generated. Update the live icon when the async
      // recolor finishes, but only if this vessel/color request is still current.
      primeRecoloredVesselIcon(iconMode, color).then((resolvedUrl) => {
        const el = vehicleRef.current;
        if (!el || el.__jlVehicleIconKey !== iconKey || Number(el.__jlVehicleIconRequestId || 0) !== requestId) return;
        const resolvedMarkup = resolvedUrl ? `<img class="jl-vehicle-img" src="${escapeHtml(resolvedUrl)}" alt="" draggable="false" />` : vehicleSvg(iconMode);
        if (el.__jlVehicleMarkup !== resolvedMarkup) {
          el.innerHTML = resolvedMarkup;
          el.__jlVehicleMarkup = resolvedMarkup;
        }
      }).catch(() => {});
    }
    vehicleRef.current.style.transform = `translate3d(${vehiclePt.x}px, ${vehiclePt.y}px, 0) translate(-50%, -50%) rotate(${rotation}deg) perspective(900px) rotateX(${sceneState.vehiclePitchDeg || 0}deg) scale(${sceneState.vehicleScale})`;
    vehicleRef.current.style.opacity = sceneState.vehicleVisible && isCoordinateVisibleOnGlobe(map, sceneState.vehicle.lon, sceneState.vehicle.lat) ? '1' : '0';

    if (liveTrailConnectorRef.current) {
      const lastProgress = Number(frameRenderStatsRef.current.lastTrailProgress);
      const currentProgress = Number(sceneState.lineProgress);
      if (isSurfaceRouteMode(mode) && Number.isFinite(lastProgress) && lastProgress >= 0 && currentProgress > lastProgress + 0.00001 && sceneState.vehicleVisible) {
        const anchor = pointAtVisualRouteProgress(leg, lastProgress, routedGeometriesRef.current, Boolean(trailTuningConfig?.routeStackingEnabled));
        const anchorPt = map.project([anchor.lon, anchor.lat]);
        liveTrailConnectorRef.current.setAttribute('d', `M ${anchorPt.x.toFixed(2)} ${anchorPt.y.toFixed(2)} L ${vehiclePt.x.toFixed(2)} ${vehiclePt.y.toFixed(2)}`);
        liveTrailConnectorRef.current.style.stroke = color || '#00e5ff';
        liveTrailConnectorRef.current.style.opacity = '1';
      } else {
        liveTrailConnectorRef.current.style.opacity = '0';
        liveTrailConnectorRef.current.setAttribute('d', '');
      }
    }

    if (sceneState.pulseActive) {
      const destPt = map.project([leg.to.lon, leg.to.lat]);
      updatePulseOverlay(pulseRef.current, destPt, color, true);
    } else if (pulseRef.current) {
      pulseRef.current.classList.remove('is-active');
      pulseRef.current.style.opacity = '0';
    }
  }

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    const hideRoutes = globeDisplayMode === 'locations';
    const hideLocations = globeDisplayMode === 'routes';
    const routeLayers = ['completed-routes-glow-wide','completed-routes-glow','completed-routes','active-route-glow-wide','active-route-glow','active-route'];
    const locationLayers = ['visited-points-glow','visited-points-halo','visited-points'];
    for (const id of routeLayers) { try { if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', hideRoutes ? 'none' : 'visible'); } catch {} }
    for (const id of locationLayers) { try { if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', hideLocations ? 'none' : 'visible'); } catch {} }
  }, [mapReady, globeDisplayMode]);

  return <div className={`maplibre-shell terrain-mode space-mode globe-display-${globeDisplayMode} ${isPlaying ? 'playback-active is-playing' : ''} ${placeBackgroundsEnabled === false ? 'placards-no-bg' : ''}`} onPointerDown={(e) => { if (!e.target?.closest?.('.jl-map-pin, .destination-trip-queue, .timeline-search-panel, button, input, textarea, select')) onMapClick?.(); }}>
    <div className="zoom-readout" aria-label="Current map zoom">Zoom {Number(zoomReadout || 0).toFixed(2)}<span>Initial {INTRO_GLOBE_ZOOM.toFixed(2)} · Spin {IDLE_SPIN_GLOBE_ZOOM.toFixed(2)}</span></div>
    <div className="jl-space-field" aria-hidden="true"><span className="star-layer star-layer-a" /><span className="star-layer star-layer-b" /><span className="star-layer star-layer-c" /></div>
    <div className="maplibre-map" ref={containerRef} />
    <div className="cinema-vignette" />
    <div className="map-overlay" ref={overlayRef}>
      <svg className="jl-live-trail-overlay" aria-hidden="true"><path ref={liveTrailConnectorRef} /></svg>
      <svg className="jl-air-arc-overlay" aria-hidden="true"><path ref={airArcRef} /></svg>
      <div className="jl-arrival-ripple" ref={pulseRef} />
      <div className="jl-vehicle-overlay" ref={vehicleRef} />
      <div className="jl-visited-labels-overlay" ref={visitedLabelsRef} />
    </div>
  </div>;
}

function routeWidthExpression(prop) {
  return ['interpolate', ['linear'], ['zoom'],
    2, ['*', ['coalesce', ['get', prop], 1], 0.46],
    4, ['*', ['coalesce', ['get', prop], 1], 0.64],
    5.5, ['*', ['coalesce', ['get', prop], 1], 0.82],
    7, ['coalesce', ['get', prop], 1]
  ];
}

function routeOpacityExpression(prop, multiplier = 1) {
  const opacityAtZoom = (detailScale) => ['*', ['coalesce', ['get', prop], 1], detailScale, multiplier];
  return ['interpolate', ['linear'], ['zoom'],
    2, opacityAtZoom(['case', ['==', ['get', 'trailRole'], 'border'], ['+', ['-', 1, ['coalesce', ['get', 'borderZoomFade'], 1]], ['*', ['coalesce', ['get', 'borderZoomFade'], 1], 0.26]], ['==', ['get', 'trailRole'], 'separator'], 0.26, ['==', ['get', 'trailRole'], 'detail'], 0.18, 0.42]),
    4, opacityAtZoom(['case', ['==', ['get', 'trailRole'], 'border'], ['+', ['-', 1, ['coalesce', ['get', 'borderZoomFade'], 1]], ['*', ['coalesce', ['get', 'borderZoomFade'], 1], 0.44]], ['==', ['get', 'trailRole'], 'separator'], 0.44, ['==', ['get', 'trailRole'], 'detail'], 0.34, 0.66]),
    5.5, opacityAtZoom(['case', ['==', ['get', 'trailRole'], 'border'], ['+', ['-', 1, ['coalesce', ['get', 'borderZoomFade'], 1]], ['*', ['coalesce', ['get', 'borderZoomFade'], 1], 0.72]], ['==', ['get', 'trailRole'], 'separator'], 0.72, ['==', ['get', 'trailRole'], 'detail'], 0.66, 0.86]),
    7, ['*', ['coalesce', ['get', prop], 1], ['case', ['==', ['get', 'trailRole'], 'border'], 1, ['==', ['get', 'trailRole'], 'separator'], 1, ['==', ['get', 'trailRole'], 'detail'], 0.9, 1], multiplier]
  ];
}

function addRouteSourcesAndLayers(map) {
  const zoomScale = (low, mid, high) => ['interpolate', ['linear'], ['zoom'], 2, low, 4, mid, 7, high];
  const widthExpr = routeWidthExpression;
  const opacityExpr = routeOpacityExpression;
  if (!map.getSource('completed-routes')) {
    map.addSource('completed-routes', { type: 'geojson', data: emptyCollection() });
    map.addLayer({ id: 'completed-routes-glow-wide', type: 'line', source: 'completed-routes', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': widthExpr('outerGlowWidth'), 'line-opacity': opacityExpr('outerGlowOpacity'), 'line-blur': 18, 'line-offset': ['coalesce', ['get', 'lineOffset'], 0] } });
    map.addLayer({ id: 'completed-routes-glow', type: 'line', source: 'completed-routes', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': widthExpr('glowWidth'), 'line-opacity': opacityExpr('glowOpacity'), 'line-blur': 8.5, 'line-offset': ['coalesce', ['get', 'lineOffset'], 0] } });
    map.addLayer({ id: 'completed-routes', type: 'line', source: 'completed-routes', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': widthExpr('width'), 'line-opacity': opacityExpr('opacity'), 'line-offset': ['coalesce', ['get', 'lineOffset'], 0] } });
  }
  if (!map.getSource('active-route')) {
    map.addSource('active-route', { type: 'geojson', data: emptyCollection() });
    map.addLayer({ id: 'active-route-glow-wide', type: 'line', source: 'active-route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': widthExpr('outerGlowWidth'), 'line-opacity': opacityExpr('outerGlowOpacity'), 'line-blur': 18, 'line-offset': ['coalesce', ['get', 'lineOffset'], 0] } });
    map.addLayer({ id: 'active-route-glow', type: 'line', source: 'active-route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': widthExpr('glowWidth'), 'line-opacity': opacityExpr('glowOpacity'), 'line-blur': 10, 'line-offset': ['coalesce', ['get', 'lineOffset'], 0] } });
    map.addLayer({ id: 'active-route', type: 'line', source: 'active-route', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': ['get', 'color'], 'line-width': widthExpr('width'), 'line-opacity': opacityExpr('opacity'), 'line-offset': ['coalesce', ['get', 'lineOffset'], 0] } });
  }
  if (!map.getSource('visited-points')) {
    map.addSource('visited-points', { type: 'geojson', data: emptyCollection() });
    map.addLayer({ id: 'visited-points-glow', type: 'circle', source: 'visited-points', paint: { 'circle-radius': ['case', ['boolean', ['get', 'isNew'], false], 16, 11.5], 'circle-color': ['get', 'color'], 'circle-opacity': 0.0, 'circle-blur': 0.7 } });
    map.addLayer({ id: 'visited-points-halo', type: 'circle', source: 'visited-points', paint: { 'circle-radius': 8.5, 'circle-color': '#061224', 'circle-opacity': 0.0 } });
    map.addLayer({ id: 'visited-points', type: 'circle', source: 'visited-points', paint: { 'circle-radius': 5.1, 'circle-color': ['get', 'color'], 'circle-stroke-color': '#f6feff', 'circle-stroke-width': 1.8, 'circle-opacity': 0 } });
    // Persistent stylized pins are rendered in the HTML overlay so they move with globe pan/zoom and do not use MapLibre glyphs.

  }
}

function addPulseLayer(map) {
  if (map.getSource('arrival-pulse')) return;
  map.addSource('arrival-pulse', { type: 'geojson', data: emptyCollection() });
  // The arrival animation is rendered by the HTML overlay. Keep this legacy
  // source/layer inert so an old GeoJSON point cannot linger at a vessel start
  // position or follow the vehicle between legs.
  map.addLayer({ id: 'arrival-pulse', type: 'circle', source: 'arrival-pulse', paint: { 'circle-radius': 0, 'circle-color': '#00e5ff', 'circle-opacity': 0 } });
}

function syncCompletedRoutes(map, completedLegs, travelersById, showTrails, opacity, width, routedGeometries = {}, trailTuning = DEFAULT_TRAIL_TUNING, fadeFeatures = [], activeTripId = null, morphTripId = null, morphProgress = null) {
  const zoom = Number(map?.getZoom?.() || 4);
  const nextLod = zoom < 4.35 ? 'overview' : zoom < 6.2 ? 'regional' : 'detail';
  if (STATIC_ROUTE_LOD !== nextLod) {
    STATIC_ROUTE_LOD = nextLod;
    COMPLETED_ROUTE_FEATURE_CACHE.clear();
  }
  const features = showTrails ? completedLegs.flatMap((l, i) => {
    const trail = trailVisualForLeg(l, travelersById);
    const isCurrentTrip = Boolean(activeTripId && l?.trip?.id === activeTripId);
    const isMorphTrip = Boolean(morphTripId && l?.trip?.id === morphTripId && !isCurrentTrip);
    // Current/morphing trips stay dynamic. Everything else can use the
    // passive completed-route feature cache so Trails-on overview does not
    // rebuild stripe/ribbon/spiral feature sets over and over.
    if (isCurrentTrip || isMorphTrip) {
      return routeFeaturesForTrail(l.leg, trail, l.trip.id, i, Math.max(0.9, opacity), width, isCurrentTrip, 1, routedGeometries, trailTuning, isMorphTrip ? morphProgress : null);
    }
    return cachedCompletedRouteFeatures(l, i, trail, Math.max(0.9, opacity), width, routedGeometries, trailTuning);
  }) : (fadeFeatures || []);
  measurePlaybackEvent('completedRouteSetData', () => {
    map.getSource('completed-routes')?.setData({ type: 'FeatureCollection', features });
  });
  recordPlaybackEvent('completedRouteSetDataCalls', 0, { features: features.length });
  return features;
}

function cachedCompletedRouteFeatures(entry, index, trail, opacity, width, routedGeometries = {}, trailTuning = DEFAULT_TRAIL_TUNING) {
  const key = completedRouteFeatureCacheKey(entry, index, trail, opacity, width, trailTuning);
  const cached = COMPLETED_ROUTE_FEATURE_CACHE.get(key);
  if (cached) return cached;
  const features = routeFeaturesForTrail(entry.leg, trail, entry.trip.id, index, opacity, width, false, 1, routedGeometries, trailTuning, null);
  COMPLETED_ROUTE_FEATURE_CACHE.set(key, features);
  if (COMPLETED_ROUTE_FEATURE_CACHE.size > COMPLETED_ROUTE_FEATURE_CACHE_LIMIT) {
    const firstKey = COMPLETED_ROUTE_FEATURE_CACHE.keys().next().value;
    if (firstKey) COMPLETED_ROUTE_FEATURE_CACHE.delete(firstKey);
  }
  return features;
}

function completedRouteFeatureCacheKey(entry, index, trail, opacity, width, trailTuning = DEFAULT_TRAIL_TUNING) {
  const leg = entry?.leg || {};
  const tripId = entry?.trip?.id || '';
  const detailKey = leg.routeDetailsKey || `${tripId}:${entry?.legIndex ?? index}`;
  const geomKey = leg.routeCacheKey || `${leg?.from?.id || ''}->${leg?.to?.id || ''}:${leg?.mode || ''}`;
  const stack = Number(leg.routeStackOffset || 0).toFixed(3);
  const colors = (trail?.colors || []).join(',');
  return [
    'passive',
    STATIC_ROUTE_LOD,
    detailKey,
    geomKey,
    leg.mode || '',
    trail?.style || 'solid',
    trail?.baseColor || '',
    colors,
    stack,
    Number(opacity || 0).toFixed(3),
    Number(width || 0).toFixed(3),
    routeTuningCacheSignature(trailTuning)
  ].join('|');
}

function routeTuningCacheSignature(config = DEFAULT_TRAIL_TUNING) {
  // Include only trail-rendering keys that affect completed passive route output.
  const keys = [
    'routeStackingEnabled',
    'borderThickness',
    'borderZoomFade',
    'solidPassiveThickness',
    'solidPassiveGlow',
    'solidPassiveOpacity',
    'stripePassiveThickness',
    'stripePassiveSegmentMiles',
    'stripePassiveSeparator',
    'stripePassiveGlow',
    'stripePassiveBevel',
    'stripePassiveLaneEffect',
    'stripePassiveOpacity',
    'ribbonPassiveThickness',
    'ribbonPassiveSpread',
    'ribbonPassiveGap',
    'ribbonPassiveGlow',
    'ribbonPassiveOpacity',
    'ribbonPassiveUseStripe',
    'spiralPassiveThickness',
    'spiralPassiveSegmentMiles',
    'spiralPassiveAmplitude',
    'spiralPassiveGlow',
    'spiralPassiveOpacity'
  ];
  return keys.map(key => `${key}:${config?.[key] ?? ''}`).join(';');
}

function syncActiveRoute(map, active, progress = 1, color = '#00e5ff', routedGeometries = {}, travelerData = null, trailTuning = DEFAULT_TRAIL_TUNING) {
  if (!active) {
    map.getSource('active-route')?.setData(emptyCollection());
    return [];
  }
  const trail = travelerData ? trailVisualForLeg(active, travelerData) : { style: 'solid', colors: [color], baseColor: color };
  const featureList = routeFeaturesForTrail(active.leg, trail, active.trip.id, active.legIndex, 1, 2, true, progress, routedGeometries, trailTuning);
  measurePlaybackEvent('activeRouteSetData', () => {
    map.getSource('active-route')?.setData({ type: 'FeatureCollection', features: featureList });
  });
  return featureList;
}

function activeRouteFeaturesForFade(active, progress = 1, routedGeometries = {}, travelerData = null, trailTuning = DEFAULT_TRAIL_TUNING) {
  if (!active) return [];
  const fallback = colorForLeg(active, travelerData || {});
  const trail = travelerData ? trailVisualForLeg(active, travelerData) : { style: 'solid', colors: [fallback], baseColor: fallback };
  return activeRouteFeaturesForFadeFromFeatures(routeFeaturesForTrail(active.leg, trail, active.trip.id, `fade-${active.legIndex}`, 1, 2, false, Math.max(0.01, Math.min(1, progress || 1)), routedGeometries, trailTuning));
}

function activeRouteFeaturesForFadeFromFeatures(features = []) {
  return features.map(f => ({
    ...f,
    properties: {
      ...(f.properties || {}),
      opacity: Math.min(Number(f.properties?.opacity) || 1, 0.96),
      glowOpacity: Math.min(Number(f.properties?.glowOpacity) || 0, 0.28),
      outerGlowOpacity: Math.min(Number(f.properties?.outerGlowOpacity) || 0, 0.10)
    }
  }));
}

function scaledRouteFeatures(features = [], scale = 1) {
  const s = Math.max(0, Math.min(1, Number(scale) || 0));
  return (features || []).map(f => ({
    ...f,
    properties: {
      ...(f.properties || {}),
      opacity: (Number(f.properties?.opacity) || 0) * s,
      glowOpacity: (Number(f.properties?.glowOpacity) || 0) * s,
      outerGlowOpacity: (Number(f.properties?.outerGlowOpacity) || 0) * s
    }
  }));
}

function mergeHeldRouteFeatures(...featureGroups) {
  const out = [];
  const seen = new Set();
  for (const group of featureGroups || []) {
    for (const feature of group || []) {
      const props = feature?.properties || {};
      const coords = feature?.geometry?.coordinates || [];
      const first = coords[0] || [];
      const last = coords[coords.length - 1] || [];
      const key = [
        props.tripId ?? '',
        props.index ?? '',
        props.color ?? '',
        props.mode ?? '',
        Number(props.lineOffset || 0).toFixed(3),
        `${Number(first[0] || 0).toFixed(4)},${Number(first[1] || 0).toFixed(4)}`,
        `${Number(last[0] || 0).toFixed(4)},${Number(last[1] || 0).toFixed(4)}`
      ].join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(feature);
    }
  }
  return out;
}

function setCompletedRoutePaintState(map, { multiplier = 1, duration = 0, playback = false } = {}) {
  if (!map) return;
  const layers = [
    ['completed-routes-glow-wide', 'outerGlowOpacity', playback ? 0 : multiplier],
    ['completed-routes-glow', 'glowOpacity', multiplier * (playback ? 0.42 : 1)],
    ['completed-routes', 'opacity', multiplier * (playback ? 0.88 : 1)]
  ];
  for (const [layer, property, value] of layers) {
    if (!map.getLayer?.(layer)) continue;
    try {
      map.setPaintProperty(layer, 'line-opacity-transition', { duration: Math.max(0, duration), delay: 0 });
      map.setPaintProperty(layer, 'line-opacity', routeOpacityExpression(property, value));
      if (layer === 'completed-routes-glow') map.setPaintProperty(layer, 'line-blur', playback ? 4.5 : 8.5);
    } catch {}
  }
}

function startCompletedRouteFade(map, fadeRef, features = [], completedLegs = [], travelersById = {}, opacity = 0.28, width = 1.55, routedGeometries = {}, trailTuning = DEFAULT_TRAIL_TUNING) {
  if (!map || !fadeRef?.current || !features?.length) return;
  window.cancelAnimationFrame(fadeRef.current.raf || 0);
  window.clearTimeout(fadeRef.current.timer || 0);
  const duration = fadeRef.current.duration || 520;
  fadeRef.current = { ...fadeRef.current, active: true, features, started: performance.now(), timer: 0 };
  measurePlaybackEvent('completedRouteFadeSetData', () => {
    map.getSource('completed-routes')?.setData({ type: 'FeatureCollection', features });
  });
  setCompletedRoutePaintState(map, { multiplier: 1, duration: 0, playback: true });
  requestAnimationFrame(() => setCompletedRoutePaintState(map, { multiplier: 0, duration, playback: true }));
  fadeRef.current.timer = window.setTimeout(() => {
    if (!fadeRef.current.active) return;
    fadeRef.current.active = false;
    fadeRef.current.features = [];
    fadeRef.current.key = '';
    map.getSource('completed-routes')?.setData(emptyCollection());
    setCompletedRoutePaintState(map, { multiplier: 1, duration: 0, playback: true });
  }, duration + 50);
}

function startTrailProfileMorph(map, morphRef, morphTripId, completedLegs, travelersById, showTrails, opacity, width, routedGeometries = {}, trailTuning = DEFAULT_TRAIL_TUNING, activeTripId = null) {
  if (!map || !morphRef?.current || !morphTripId || !showTrails) return;
  window.cancelAnimationFrame(morphRef.current.raf || 0);
  window.clearTimeout(morphRef.current.timer || 0);
  const duration = Math.min(1800, morphRef.current.duration || 1800);
  morphRef.current = { ...morphRef.current, active: true, tripId: morphTripId, started: performance.now(), duration };
  // Seed the completed source with the just-finished active profile so the line
  // does not snap the instant the next Hop begins. Advance through a small number
  // of cached profile states instead of rebuilding the route every animation frame.
  const steps = 8;
  let step = 0;
  syncCompletedRoutes(map, completedLegs, travelersById, true, opacity, width, routedGeometries, trailTuning, [], activeTripId, morphTripId, 0);
  setCompletedRoutePaintState(map, { multiplier: 1, duration: 180, playback: true });
  morphRef.current.timer = window.setInterval(() => {
    if (morphRef.current.tripId !== morphTripId) {
      window.clearInterval(morphRef.current.timer);
      return;
    }
    step += 1;
    const raw = Math.min(1, step / steps);
    const eased = raw * raw * (3 - 2 * raw);
    syncCompletedRoutes(map, completedLegs, travelersById, true, opacity, width, routedGeometries, trailTuning, [], activeTripId, morphTripId, eased);
    if (raw >= 1) {
      window.clearInterval(morphRef.current.timer);
      morphRef.current.active = false;
      morphRef.current.tripId = '';
      syncCompletedRoutes(map, completedLegs, travelersById, true, opacity, width, routedGeometries, trailTuning, [], activeTripId);
    }
  }, Math.max(120, Math.round(duration / steps)));
}

function syncPulse(map, loc, color) {
  // v7.3.1: the DOM ripple is the single owner of arrival pulses. Always clear
  // the retired map-layer source to prevent a stale cyan circle from surviving
  // a route transition.
  map.getSource('arrival-pulse')?.setData(emptyCollection());
}

function trailVisualForLeg(active, travelerData) {
  if (active?.trip?.isHomeMove || active?.leg?.mode === 'move') return { style: 'solid', colors: ['#050607'], baseColor: '#050607' };
  if (travelerData?.hoppers || travelerData?.hopSquads) return resolveTrailVisual(active?.trip || {}, travelerData);
  const color = travelerData?.[getTravelerKey(active.trip)]?.color || '#00e5ff';
  return { style: 'solid', colors: [color], baseColor: color };
}

function withTrailGlow(config, glow = 1, baseWidth = 2) {
  return { ...config, _ghTrailGlow: Number(glow) || 0, _ghGlowBaseWidth: Math.max(1, Number(baseWidth) || 2) };
}

function trailBorderThickness(config) {
  return Math.max(0, Number(config?.borderThickness) || 0);
}


function profileTrailConfig(config = DEFAULT_TRAIL_TUNING, active = false, style = 'solid') {
  const base = { ...DEFAULT_TRAIL_TUNING, ...(config || {}) };
  const mode = active ? 'Active' : 'Passive';
  const out = { ...base, _ghTrailProfile: active ? 'active' : 'passive' };
  const copy = (from, to) => { if (base[from] !== undefined) out[to] = base[from]; };
  copy(`${style}${mode}Thickness`, `${style}Thickness`);
  copy(`${style}${mode}Glow`, `${style}Glow`);
  copy(`${style}${mode}Opacity`, `${style}Opacity`);
  if (style === 'stripe') {
    copy(`stripe${mode}SegmentMiles`, 'stripeSegmentMiles');
    copy(`stripe${mode}Separator`, 'stripeSeparator');
    copy(`stripe${mode}Bevel`, 'stripeBevel');
    copy(`stripe${mode}LaneEffect`, 'stripeLaneEffect');
  }
  if (style === 'ribbon') {
    copy(`ribbon${mode}Spread`, 'ribbonSpread');
    copy(`ribbon${mode}Gap`, 'ribbonGap');
  }
  if (style === 'spiral') {
    copy(`spiral${mode}SegmentMiles`, 'spiralSegmentMiles');
    copy(`spiral${mode}Amplitude`, 'spiralAmplitude');
    copy(`spiral${mode}Animate`, 'spiralAnimate');
  }
  const opacityKey = `${style}${mode}Opacity`;
  out._ghProfileOpacity = base[opacityKey] === undefined ? (active ? 1 : 0.58) : Number(base[opacityKey]);
  return out;
}

function lerpNumber(a, b, t) {
  const av = Number(a);
  const bv = Number(b);
  if (!Number.isFinite(av) && !Number.isFinite(bv)) return 0;
  if (!Number.isFinite(av)) return bv;
  if (!Number.isFinite(bv)) return av;
  return av + (bv - av) * Math.max(0, Math.min(1, Number(t) || 0));
}

function scaledFeatureOpacities(features = [], scale = 1) {
  const s = Math.max(0, Math.min(1.5, Number(scale) || 0));
  return (features || []).map(feature => ({
    ...feature,
    properties: {
      ...(feature.properties || {}),
      opacity: (Number(feature.properties?.opacity) || 0) * s,
      glowOpacity: (Number(feature.properties?.glowOpacity) || 0) * s,
      outerGlowOpacity: (Number(feature.properties?.outerGlowOpacity) || 0) * s
    }
  }));
}

function profileTrailConfigMorph(config = DEFAULT_TRAIL_TUNING, style = 'solid', progress = 1) {
  const t = Math.max(0, Math.min(1, Number(progress) || 0));
  const activeConfig = profileTrailConfig(config, true, style);
  const passiveConfig = profileTrailConfig(config, false, style);
  const out = { ...activeConfig, _ghTrailProfile: 'morph' };
  const blend = (key) => { out[key] = lerpNumber(activeConfig[key], passiveConfig[key], t); };
  blend(`${style}Thickness`);
  blend(`${style}Glow`);
  if (style === 'stripe') {
    blend('stripeSegmentMiles');
    blend('stripeSeparator');
    blend('stripeBevel');
    blend('stripeLaneEffect');
  }
  if (style === 'ribbon') {
    blend('ribbonSpread');
    blend('ribbonGap');
  }
  if (style === 'spiral') {
    blend('spiralSegmentMiles');
    blend('spiralAmplitude');
    out.spiralAnimate = false;
  }
  out._ghProfileOpacity = lerpNumber(activeConfig._ghProfileOpacity, passiveConfig._ghProfileOpacity, t);
  return out;
}

function passiveTrailVisualForTrail(trail = {}, config = DEFAULT_TRAIL_TUNING) {
  if ((trail?.style || 'solid') === 'ribbon' && config?.ribbonPassiveUseStripe) {
    return { ...trail, style: 'stripe' };
  }
  return trail;
}

function staticRouteSamples(detail, regional, overview) {
  if (STATIC_ROUTE_LOD === 'overview') return overview;
  if (STATIC_ROUTE_LOD === 'regional') return regional;
  return detail;
}

function routeFeaturesForTrail(leg, trail, tripId, index, opacity, width, active = false, progress = 1, routedGeometries = {}, trailTuning = DEFAULT_TRAIL_TUNING, morphProgress = null) {
  const requestedStyle = trail?.style || 'solid';
  const passiveVisualTrail = passiveTrailVisualForTrail(trail, trailTuning);
  const passiveStyle = passiveVisualTrail?.style || requestedStyle || 'solid';
  const isMorph = morphProgress !== null && morphProgress !== undefined;
  const t = Math.max(0, Math.min(1, Number(morphProgress) || 0));

  // If the passive representation changes trail type, such as Ribbon -> passive Stripe,
  // do a controlled crossfade. Same-style transitions below morph the parameters.
  if (isMorph && passiveStyle !== requestedStyle) {
    const activeFeatures = routeFeaturesForTrail(leg, trail, tripId, `${index}-morph-active`, opacity, width, true, progress, routedGeometries, trailTuning, null);
    const passiveFeatures = routeFeaturesForTrail(leg, trail, tripId, `${index}-morph-passive`, opacity, width, false, progress, routedGeometries, trailTuning, null);
    return [...scaledFeatureOpacities(activeFeatures, 1 - t), ...scaledFeatureOpacities(passiveFeatures, t)];
  }

  const visualTrail = isMorph ? trail : (active ? trail : passiveVisualTrail);
  const style = isMorph ? requestedStyle : (visualTrail?.style || requestedStyle || 'solid');
  const config = isMorph ? profileTrailConfigMorph(trailTuning, style, t) : profileTrailConfig(trailTuning, active, style);
  const profileOpacity = Math.max(0, Math.min(1.5, Number(config._ghProfileOpacity) || (active ? 1 : 0.58)));
  const renderOpacity = opacity * profileOpacity;
  const stackOffset = config.routeStackingEnabled ? (Number(leg?.routeStackOffset) || 0) : 0;
  const colors = (visualTrail?.colors || trail?.colors || []).filter(Boolean);
  const baseColor = visualTrail?.baseColor || trail?.baseColor || colors[0] || '#00e5ff';
  const renderAsActive = active && !isMorph;
  if (style === 'ribbon' && colors.length > 1) return ribbonRouteFeatures(leg, colors, tripId, index, renderOpacity, width, renderAsActive, progress, routedGeometries, config, stackOffset);
  if (style === 'stripe' && colors.length > 1) return stripeRouteFeatures(leg, colors, tripId, index, renderOpacity, width, renderAsActive, progress, routedGeometries, config, stackOffset);
  if (style === 'spiral' && colors.length > 1) return spiralRouteFeatures(leg, colors, tripId, index, renderOpacity, width, renderAsActive, progress, routedGeometries, config, stackOffset);
  const solidWidth = width * Math.max(0.2, Number(config.solidThickness) || 1);
  const border = trailBorderThickness(config);
  const solidCoords = stackedRouteCoordinates(leg, progress, renderAsActive ? 420 : staticRouteSamples(210, 130, 72), routedGeometries, stackOffset);
  const out = [];
  if (border > 0) out.push(routeFeatureFromCoordinates(solidCoords, '#020407', tripId, `${index}-solid-border`, renderOpacity, solidWidth + border * 2, false, leg.mode, 0, withTrailGlow(config, 0, width)));
  out.push(routeFeatureFromCoordinates(solidCoords, baseColor, tripId, index, renderOpacity, solidWidth, renderAsActive, leg.mode, 0, withTrailGlow(config, config.solidGlow, width)));
  return out;
}

function stripeRouteFeatures(leg, colors, tripId, index, opacity, width, active = false, progress = 1, routedGeometries = {}, config = DEFAULT_TRAIL_TUNING, stackOffset = 0) {
  const coords = stackedRouteCoordinates(leg, progress, active ? 520 : staticRouteSamples(340, 210, 110), routedGeometries, stackOffset);
  if (coords.length < 2) return [routeFeature(leg, colors[0], tripId, index, opacity, width, active, progress, routedGeometries, 0, config)];
  const stripeWidth = width * Math.max(0.6, Number(config.stripeThickness) || 1);
  const separatorWidth = Math.max(0, Number(config.stripeSeparator) || 0);
  const border = trailBorderThickness(config);
  const segmentMiles = Math.max(5, Number(config.stripeSegmentMiles) || 260);
  const features = [];
  const segments = splitRouteIntoUniformSegments(coords, segmentMiles);
  if (border > 0) features.push(routeFeatureFromCoordinates(coords, '#020407', tripId, `${index}-stripe-border`, opacity, stripeWidth + border * 2, false, leg.mode, 0, withTrailGlow(config, 0, width)));
  const bevel = Math.max(0, Number(config.stripeBevel) || 0);
  const laneEffect = Math.max(0, Number(config.stripeLaneEffect) || 0);
  if ((Number(config.stripeGlow) || 0) > 0) {
    features.push(routeFeatureFromCoordinates(coords, averageColor(colors, colors[0]), tripId, `${index}-stripe-glow`, Math.max(0.02, opacity * 0.08 * (Number(config.stripeGlow) || 1)), stripeWidth + Math.max(0.4, Number(config.stripeGlow) || 1), false, leg.mode, 0, withTrailGlow(config, config.stripeGlow * 0.45, width)));
  }
  segments.forEach((segment, segmentIndex) => {
    const color = colors[segmentIndex % colors.length];
    features.push(routeFeatureFromCoordinates(segment, color, tripId, `${index}-stripe-${segmentIndex}`, opacity, stripeWidth, active, leg.mode, 0, withTrailGlow(config, config.stripeGlow, width)));
    if (bevel > 0) {
      features.push(routeFeatureFromCoordinates(segment, 'rgba(255,255,255,0.34)', tripId, `${index}-stripe-bevel-${segmentIndex}`, Math.min(0.38, opacity * 0.18 * bevel), Math.max(0.8, stripeWidth * 0.18 * bevel), false, leg.mode, -0, withTrailGlow(config, 0, width)));
    }
    if (laneEffect > 0) {
      features.push(routeFeatureFromCoordinates(segment, 'rgba(0,0,0,0.30)', tripId, `${index}-stripe-edge-${segmentIndex}`, Math.min(0.32, opacity * 0.16 * laneEffect), Math.max(0.6, stripeWidth * 0.12 * laneEffect), false, leg.mode, 0, withTrailGlow(config, 0, width)));
    }
    if (separatorWidth > 0) {
      const boundary = boundarySegmentAroundJoin(segment, segments[segmentIndex + 1]);
      if (boundary) features.push(routeFeatureFromCoordinates(boundary, 'rgba(4,8,16,0.86)', tripId, `${index}-stripe-boundary-${segmentIndex}`, Math.max(0.12, opacity * 0.22), stripeWidth + separatorWidth, false, leg.mode, 0, withTrailGlow(config, 0, width)));
    }
  });
  return features.length ? features : [routeFeature(leg, colors[0], tripId, index, opacity, stripeWidth, active, progress, routedGeometries, 0, withTrailGlow(config, config.stripeGlow, width))];
}

function ribbonRouteFeatures(leg, colors, tripId, index, opacity, width, active = false, progress = 1, routedGeometries = {}, config = DEFAULT_TRAIL_TUNING, stackOffset = 0) {
  const total = colors.length;
  const totalWidth = Math.max(width * (Number(config.ribbonThickness) || 1.45), width + 1.0);
  const spread = Math.max(0, Number(config.ribbonSpread) || 0);
  const slotWidth = totalWidth / total;
  const gap = Math.max(0, Number(config.ribbonGap) || 0) + spread * Math.min(1.8, slotWidth * 0.55);
  const lineWidth = Math.max(0.75, slotWidth - gap);
  const sharedColor = averageColor(colors, colors[0]);
  const border = trailBorderThickness(config);
  const out = [];
  const coords = stackedRouteCoordinates(leg, progress, active ? 420 : staticRouteSamples(220, 140, 78), routedGeometries, stackOffset);
  if (border > 0) out.push(routeFeatureFromCoordinates(coords, '#020407', tripId, `${index}-ribbon-border`, opacity, totalWidth + border * 2, false, leg.mode, 0, withTrailGlow(config, 0, width)));
  out.push(routeFeatureFromCoordinates(coords, sharedColor, tripId, `${index}-ribbon-glow`, Math.max(0.08, opacity * 0.16 * (Number(config.ribbonGlow) || 1)), totalWidth + Math.max(0.5, Number(config.ribbonGlow) || 1), false, leg.mode, 0, withTrailGlow(config, config.ribbonGlow, width)));
  out.push(...colors.map((color, ribbonIndex) => {
    const offset = (ribbonIndex - (total - 1) / 2) * slotWidth;
    return routeFeatureFromCoordinates(coords, color, tripId, `${index}-ribbon-${ribbonIndex}`, opacity, lineWidth, active, leg.mode, offset, withTrailGlow(config, config.ribbonGlow, width));
  }));
  return out;
}

function spiralRouteFeatures(leg, colors, tripId, index, opacity, width, active = false, progress = 1, routedGeometries = {}, config = DEFAULT_TRAIL_TUNING, stackOffset = 0) {
  const coords = stackedRouteCoordinates(leg, progress, active ? 480 : staticRouteSamples(300, 190, 104), routedGeometries, stackOffset);
  if (coords.length < 2) return [routeFeature(leg, colors[0], tripId, index, opacity, width, active, progress, routedGeometries, 0, config)];
  const totalWidth = Math.max(width * (Number(config.spiralThickness) || 1.55), width + 1.0);
  const amplitude = Math.max(0.2, totalWidth * (Number(config.spiralAmplitude) || 1.15) * 0.55);
  const segmentWidth = Math.max(1.55, totalWidth / Math.max(colors.length * 0.9, 1.9));
  const sharedColor = averageColor(colors, colors[0]);
  const segments = splitRouteIntoUniformSegments(coords, Number(config.spiralSegmentMiles) || 120);
  const phaseOffset = (active && config.spiralAnimate) ? Math.floor((Math.max(0, Math.min(1, progress)) * segments.length) * 1.35) : 0;
  const border = trailBorderThickness(config);
  const features = [];
  if (border > 0) features.push(routeFeatureFromCoordinates(coords, '#020407', tripId, `${index}-spiral-border`, opacity, totalWidth + border * 2, false, leg.mode, 0, withTrailGlow(config, 0, width)));
  features.push(routeFeatureFromCoordinates(coords, sharedColor, tripId, `${index}-spiral-glow`, Math.max(0.08, opacity * 0.18 * (Number(config.spiralGlow) || 1)), totalWidth + Math.max(0.6, Number(config.spiralGlow) || 1), false, leg.mode, 0, withTrailGlow(config, config.spiralGlow, width)));
  segments.forEach((segment, segmentIndex) => {
    const phase = segmentIndex + phaseOffset;
    const color = colors[phase % colors.length];
    const angle = (phase / Math.max(colors.length, 2)) * Math.PI * 1.8;
    const offset = Math.sin(angle) * amplitude;
    features.push(routeFeatureFromCoordinates(segment, color, tripId, `${index}-spiral-${phase}`, opacity, segmentWidth, active, leg.mode, offset, withTrailGlow(config, config.spiralGlow, width)));
  });
  return features.length ? features : [routeFeature(leg, colors[0], tripId, index, opacity, totalWidth, active, progress, routedGeometries, 0, withTrailGlow(config, config.spiralGlow, width))];
}

function syncTrailTuningDemo(map, config = DEFAULT_TRAIL_TUNING, width = 2) {
  if (!map?.getSource('completed-routes')) return;
  const fromLon = -124.2;
  const toLon = -72.2;
  const demoWidth = Math.max(2.6, width * 1.8);
  const rows = [
    { style: 'solid', lat: 44.8, colors: ['#44f48a'], label: 'Solid' },
    { style: 'stripe', lat: 39.8, colors: ['#ff8a00', '#ff4fd8', '#ff5548'], label: 'Stripe' },
    { style: 'ribbon', lat: 34.8, colors: ['#2f80ff', '#ffffff', '#ff3b30'], label: 'Ribbon' },
    { style: 'spiral', lat: 29.8, colors: ['#00e5ff', '#9b5cff', '#ffd60a'], label: 'Spiral' }
  ];
  const features = rows.flatMap((row, index) => {
    const activeLeg = {
      mode: 'plane',
      from: { id: `tune-west-${index}-active`, name: `${row.label} Active West`, lon: fromLon, lat: row.lat },
      to: { id: `tune-east-${index}-active`, name: `${row.label} Active East`, lon: toLon, lat: row.lat + 0.22 }
    };
    const passiveLeg = {
      mode: 'plane',
      from: { id: `tune-west-${index}-passive`, name: `${row.label} Passive West`, lon: fromLon, lat: row.lat - 1.0 },
      to: { id: `tune-east-${index}-passive`, name: `${row.label} Passive East`, lon: toLon, lat: row.lat - 0.78 }
    };
    const trail = { style: row.style, colors: row.colors, baseColor: row.colors[0] };
    return [
      ...routeFeaturesForTrail(activeLeg, trail, `tune-${row.style}-active`, `${index}-active`, 1, demoWidth, true, 1, {}, config),
      ...routeFeaturesForTrail(passiveLeg, trail, `tune-${row.style}-passive`, `${index}-passive`, 1, demoWidth, false, 1, {}, config)
    ];
  });
  map.getSource('completed-routes')?.setData({ type: 'FeatureCollection', features });
  map.getSource('active-route')?.setData(emptyCollection());
  map.getSource('arrival-pulse')?.setData(emptyCollection());
}

function averageColor(colors = [], fallback = '#00e5ff') {
  const list = (colors || []).filter(Boolean);
  if (!list.length) return fallback;
  const rgb = list.reduce((acc, color) => {
    const hex = String(color).replace('#', '').trim();
    const normalized = hex.length === 3 ? hex.split('').map(ch => ch + ch).join('') : hex;
    if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return acc;
    acc.r += parseInt(normalized.slice(0, 2), 16);
    acc.g += parseInt(normalized.slice(2, 4), 16);
    acc.b += parseInt(normalized.slice(4, 6), 16);
    return acc;
  }, { r: 0, g: 0, b: 0 });
  const count = Math.max(1, list.length);
  const toHex = (value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');
  return `#${toHex(rgb.r / count)}${toHex(rgb.g / count)}${toHex(rgb.b / count)}`;
}

function splitRouteIntoUniformSegments(coords = [], segmentMiles = 150) {
  if (!Array.isArray(coords) || coords.length < 2) return [];
  const target = Math.max(5, Number(segmentMiles) || 150);
  const out = [];
  let current = [coords[0]];
  let carried = 0;
  for (let i = 1; i < coords.length; i++) {
    let start = current[current.length - 1];
    const end = coords[i];
    let remaining = milesBetween({ lon: start[0], lat: start[1] }, { lon: end[0], lat: end[1] });
    if (!remaining) continue;
    while (remaining > 0.0001) {
      const room = target - carried;
      if (remaining > room && room > 0.0001) {
        const t = room / remaining;
        const cut = [lerp(start[0], end[0], t), lerp(start[1], end[1], t)];
        current.push(cut);
        if (current.length > 1) out.push(current);
        current = [cut];
        start = cut;
        remaining = milesBetween({ lon: start[0], lat: start[1] }, { lon: end[0], lat: end[1] });
        carried = 0;
      } else {
        current.push(end);
        carried += remaining;
        remaining = 0;
      }
    }
  }
  if (current.length > 1) out.push(current);
  return out.filter(segment => segment.length > 1);
}

function boundarySegmentAroundJoin(previousSegment, nextSegment) {
  if (!previousSegment || !nextSegment) return null;
  const prevA = previousSegment[previousSegment.length - 2];
  const prevB = previousSegment[previousSegment.length - 1];
  const nextB = nextSegment[1];
  if (!prevA || !prevB || !nextB) return null;
  return [prevA, prevB, nextB];
}


function stackedRouteCoordinates(leg, progress = 1, n = 64, routedGeometries = {}, stackOffset = 0) {
  // Build and offset the complete presentation route once, then reveal an
  // immutable prefix. Offsetting a growing prefix changed the route's reference
  // latitude and tangent normals every update, which made already-laid boat/car
  // trails drift and left the vessel visually detached from its line.
  const fullRoute = routeCoordinates(leg, 1, n, routedGeometries);
  const fullStacked = stackOffset && fullRoute.length > 1
    ? taperStackedCoordinates(fullRoute, stackOffset, Number(leg?.miles) || polylineMiles(fullRoute))
    : fullRoute;
  return stableRoutePrefix(fullStacked, progress);
}

function taperStackedCoordinates(coords = [], stackOffset = 0, totalMilesHint = 0) {
  if (!Array.isArray(coords) || coords.length < 2 || !stackOffset) return coords;
  const totalMiles = Math.max(0.1, Number(totalMilesHint) || polylineMiles(coords));
  const taperMiles = Math.min(totalMiles * 0.40, clamp(totalMiles * 0.12, 5, 42));
  const offsetKm = routeStackOffsetKilometers(stackOffset, totalMiles);
  if (Math.abs(offsetKm) < 0.0001 || taperMiles <= 0) return coords;
  const refLat = coords.reduce((sum, c) => sum + Number(c?.[1] || 0), 0) / Math.max(1, coords.length);
  const refLon = coords[0]?.[0] || 0;
  const origin = projectLocalPoint([refLon, refLat], refLat, refLon);
  const projected = coords.map(c => projectLocalPoint(c, refLat, refLon));
  const cumulative = [0];
  for (let i = 1; i < coords.length; i++) {
    cumulative[i] = cumulative[i - 1] + milesBetween({ lon: coords[i - 1][0], lat: coords[i - 1][1] }, { lon: coords[i][0], lat: coords[i][1] });
  }
  return projected.map((pt, index) => {
    const prev = projected[Math.max(0, index - 1)];
    const next = projected[Math.min(projected.length - 1, index + 1)];
    const dx = next.x - prev.x;
    const dy = next.y - prev.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = -dy / len;
    const ny = dx / len;
    const distFromStart = cumulative[index] || 0;
    const distFromEnd = Math.max(0, totalMiles - distFromStart);
    const startFactor = smoothstepRange(0, taperMiles, distFromStart);
    const endFactor = smoothstepRange(0, taperMiles, distFromEnd);
    const strength = Math.min(startFactor, endFactor);
    return unprojectLocalPoint({ x: pt.x + nx * offsetKm * strength, y: pt.y + ny * offsetKm * strength }, refLat, refLon);
  });
}

function projectLocalPoint(coord, refLat = 0, refLon = 0) {
  const lon = Number(coord?.[0] || 0);
  const lat = Number(coord?.[1] || 0);
  const kmPerDegLat = 110.574;
  const kmPerDegLon = 111.320 * Math.cos((refLat || 0) * Math.PI / 180);
  return {
    x: (lon - refLon) * kmPerDegLon,
    y: (lat - refLat) * kmPerDegLat
  };
}

function unprojectLocalPoint(point, refLat = 0, refLon = 0) {
  const kmPerDegLat = 110.574;
  const kmPerDegLon = Math.max(0.0001, 111.320 * Math.cos((refLat || 0) * Math.PI / 180));
  return [
    refLon + (Number(point?.x || 0) / kmPerDegLon),
    refLat + (Number(point?.y || 0) / kmPerDegLat)
  ];
}

function polylineMiles(coords = []) {
  let total = 0;
  for (let i = 1; i < (coords || []).length; i++) {
    total += milesBetween({ lon: coords[i - 1][0], lat: coords[i - 1][1] }, { lon: coords[i][0], lat: coords[i][1] });
  }
  return total;
}

function routeStackOffsetKilometers(stackOffset = 0, totalMiles = 0) {
  const base = Math.abs(Number(stackOffset) || 0);
  if (!base) return 0;
  const routeScale = clamp(Math.sqrt(Math.max(1, totalMiles)) / 9.0, 0.75, 1.35);
  return Math.sign(stackOffset) * base * 0.20 * routeScale;
}

function smoothstepRange(edge0, edge1, x) {
  const t = clamp((x - edge0) / Math.max(0.00001, edge1 - edge0), 0, 1);
  return t * t * (3 - 2 * t);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function routeFeature(leg, color, tripId, index, opacity, width, active = false, progress = 1, routedGeometries = {}, lineOffset = 0, config = DEFAULT_TRAIL_TUNING) {
  const mode = leg.mode;
  const isAir = mode === 'plane' || mode === 'move';
  const role = trailRoleForFeature(index, color);
  const isRoadSupportLayer = mode === 'car' && role !== 'main';
  const mainOpacity = isRoadSupportLayer ? 0 : (active && isAir ? Math.max(0.36, opacity * 0.66) : active ? Math.max(0.9, opacity) : Math.max(0, opacity));
  const mainWidth = active ? (isAir ? Math.max(width, 1.25) : Math.max(width, 1.4)) : Math.max(width, 1.15);
  const glowMult = isRoadSupportLayer ? 0 : Math.max(0, Number(config?._ghTrailGlow ?? 1));
  const glowBase = Math.max(1, Number(config?._ghGlowBaseWidth ?? 2));
  return {
    type: 'Feature',
    properties: {
      tripId,
      index,
      color,
      mode,
      width: mainWidth,
      opacity: mainOpacity,
      glowWidth: active ? (isAir ? Math.max(glowBase * 4.2 * glowMult, 6.5 * glowMult) : Math.max(glowBase * 4.4 * glowMult, 7.2 * glowMult)) : Math.max(glowBase * 5.2 * glowMult, 7.4 * glowMult),
      glowOpacity: active ? (isAir ? 0.56 * glowMult : 0.62 * glowMult) : Math.max(0.0, opacity * 0.58 * glowMult),
      outerGlowWidth: active ? Math.max(glowBase * 8.1 * glowMult, 12 * glowMult) : Math.max(glowBase * 9.0 * glowMult, 14 * glowMult),
      outerGlowOpacity: active ? ((isAir ? 0.20 : 0.24) * glowMult) : Math.max(0.0, opacity * 0.18 * glowMult),
      dash: dashForMode(mode),
      lineOffset,
      borderZoomFade: Number(config?.borderZoomFade ?? 1),
      trailRole: role
    },
    geometry: mapLineGeometry(routeCoordinates(leg, progress, active ? 420 : staticRouteSamples(200, 120, 68), routedGeometries))
  };
}

function routeFeatureFromCoordinates(coords, color, tripId, index, opacity, width, active = false, mode = 'plane', lineOffset = 0, config = DEFAULT_TRAIL_TUNING) {
  const isAir = mode === 'plane' || mode === 'move';
  const role = trailRoleForFeature(index, color);
  const isRoadSupportLayer = mode === 'car' && role !== 'main';
  const mainWidth = active ? (isAir ? Math.max(width, 1.25) : Math.max(width, 1.4)) : Math.max(width, 1.15);
  const glowMult = isRoadSupportLayer ? 0 : Math.max(0, Number(config?._ghTrailGlow ?? 1));
  const glowBase = Math.max(1, Number(config?._ghGlowBaseWidth ?? 2));
  return {
    type: 'Feature',
    properties: {
      tripId,
      index,
      color,
      mode,
      width: mainWidth,
      opacity: isRoadSupportLayer ? 0 : (active && isAir ? Math.max(0.36, opacity * 0.66) : active ? Math.max(0.9, opacity) : Math.max(0, opacity)),
      glowWidth: active ? (isAir ? Math.max(glowBase * 4.2 * glowMult, 6.5 * glowMult) : Math.max(glowBase * 4.4 * glowMult, 7.2 * glowMult)) : Math.max(glowBase * 5.2 * glowMult, 7.4 * glowMult),
      glowOpacity: active ? (isAir ? 0.56 * glowMult : 0.62 * glowMult) : Math.max(0.0, opacity * 0.58 * glowMult),
      outerGlowWidth: active ? Math.max(glowBase * 7.8 * glowMult, 12 * glowMult) : Math.max(glowBase * 9.0 * glowMult, 14 * glowMult),
      outerGlowOpacity: active ? ((isAir ? 0.20 : 0.24) * glowMult) : Math.max(0.0, opacity * 0.18 * glowMult),
      dash: dashForMode(mode),
      lineOffset,
      borderZoomFade: Number(config?.borderZoomFade ?? 1),
      trailRole: role
    },
    geometry: mapLineGeometry(coords)
  };
}


function mapLineGeometry(coords = []) {
  const segments = splitLineAtAntimeridian(coords);
  if (segments.length <= 1) return { type: 'LineString', coordinates: segments[0] || [[0, 0], [0, 0]] };
  return { type: 'MultiLineString', coordinates: segments };
}

function splitLineAtAntimeridian(coords = []) {
  if (!Array.isArray(coords) || coords.length < 2) return [coords || []];
  const segments = [];
  let current = [[normalizeMapLongitude(coords[0][0]), Number(coords[0][1])]];
  for (let index = 1; index < coords.length; index += 1) {
    const previousRaw = coords[index - 1];
    const nextRaw = coords[index];
    const previousLon = Number(previousRaw?.[0]);
    const nextLon = Number(nextRaw?.[0]);
    const previousLat = Number(previousRaw?.[1]);
    const nextLat = Number(nextRaw?.[1]);
    if (![previousLon, nextLon, previousLat, nextLat].every(Number.isFinite)) continue;
    const normalizedPrevious = normalizeMapLongitude(previousLon);
    const normalizedNext = normalizeMapLongitude(nextLon);
    const normalizedDelta = normalizedNext - normalizedPrevious;
    const crosses = Math.abs(normalizedDelta) > 180;
    if (!crosses) {
      current.push([normalizedNext, nextLat]);
      continue;
    }

    const crossesEastward = normalizedPrevious > 0 && normalizedNext < 0;
    const boundary = crossesEastward ? 180 : -180;
    const adjustedNext = crossesEastward ? normalizedNext + 360 : normalizedNext - 360;
    const denominator = adjustedNext - normalizedPrevious;
    const t = Math.abs(denominator) < 1e-9 ? 0.5 : clamp((boundary - normalizedPrevious) / denominator, 0, 1);
    const boundaryLat = lerp(previousLat, nextLat, t);
    current.push([boundary, boundaryLat]);
    if (current.length > 1) segments.push(current);
    current = [[-boundary, boundaryLat], [normalizedNext, nextLat]];
  }
  if (current.length > 1) segments.push(current);
  return segments.length ? segments : [[[normalizeMapLongitude(coords[0][0]), Number(coords[0][1])], [normalizeMapLongitude(coords.at(-1)[0]), Number(coords.at(-1)[1])]]];
}

function normalizeMapLongitude(value) {
  const numeric = Number(value) || 0;
  return ((numeric + 540) % 360) - 180;
}

function trailRoleForFeature(index, color) {
  const key = String(index || '').toLowerCase();
  const c = String(color || '').toLowerCase();
  if (key.includes('border') || c === '#020407' || c === '#000000') return 'border';
  if (key.includes('separator') || key.includes('boundary')) return 'separator';
  if (key.includes('glow') || key.includes('underlay')) return 'glow';
  if (key.includes('bevel') || key.includes('edge')) return 'detail';
  return 'main';
}

function pointAtPlaybackPlan(plan, t) {
  const positions = plan?.positions;
  const count = Number(plan?.sampleCount || (positions?.length || 0) / 2);
  if (!positions || count < 2) return { lon: 0, lat: 0 };
  const scaled = Math.max(0, Math.min(1, t)) * (count - 1);
  const i = Math.min(count - 2, Math.floor(scaled));
  const u = scaled - i;
  return {
    lon: lerpAngle(positions[i * 2], positions[(i + 1) * 2], u),
    lat: lerp(positions[i * 2 + 1], positions[(i + 1) * 2 + 1], u)
  };
}


function pointAtAnchoredPlaybackPlan(plan, t, leg) {
  const u = Math.max(0, Math.min(1, Number(t) || 0));
  const endpointWindow = 0.035;
  if (u <= endpointWindow) {
    const from = { lon: Number(leg?.from?.lon), lat: Number(leg?.from?.lat) };
    const routePoint = pointAtPlaybackPlan(plan, endpointWindow);
    return blendGeo(from, routePoint, smoothstep(u / endpointWindow));
  }
  if (u >= 1 - endpointWindow) {
    const routePoint = pointAtPlaybackPlan(plan, 1 - endpointWindow);
    const to = { lon: Number(leg?.to?.lon), lat: Number(leg?.to?.lat) };
    return blendGeo(routePoint, to, smoothstep((u - (1 - endpointWindow)) / endpointWindow));
  }
  return pointAtPlaybackPlan(plan, u);
}

function cameraPointAtPlaybackPlan(plan, t) {
  const camera = plan?.camera;
  const count = Number(plan?.sampleCount || (camera?.length || 0) / 2);
  if (!camera || count < 2) return pointAtPlaybackPlan(plan, t);
  const scaled = Math.max(0, Math.min(1, t)) * (count - 1);
  const i = Math.min(count - 2, Math.floor(scaled));
  const u = scaled - i;
  return {
    lon: lerpAngle(camera[i * 2], camera[(i + 1) * 2], u),
    lat: lerp(camera[i * 2 + 1], camera[(i + 1) * 2 + 1], u)
  };
}

function headingAtPlaybackPlan(plan, t) {
  const headings = plan?.headings;
  const count = Number(plan?.sampleCount || headings?.length || 0);
  if (!headings || count < 1) return 0;
  const index = Math.max(0, Math.min(count - 1, Math.round(Math.max(0, Math.min(1, t)) * (count - 1))));
  return Number(headings[index] || 0);
}

function getScene(active, rawProgress, cameraMode, nextActive, routedGeometries = {}, routeStackingEnabled = false, playbackPlan = null) {
  const raw = Math.max(0, rawProgress);
  const visibleP = Math.max(0, Math.min(1, raw));
  const departureWarmup = 0.085;
  const p = Math.max(0, Math.min(1, (visibleP - departureWarmup) / (1 - departureWarmup)));
  const warmupT = Math.max(0, Math.min(1, visibleP / departureWarmup));
  const settleT = Math.max(0, Math.min(1, (raw - 1) / 0.28));
  const leg = active.leg;
  const distance = milesBetween(leg.from, leg.to);
  const routeProgress = takeoffCruiseLandingEase(p);
  const lineProgress = isSurfaceRouteMode(leg.mode) ? routeProgress : lineProgressBehindVehicle(leg.mode, distance, routeProgress, p);
  // Surface vessels must travel on the exact same presentation polyline that
  // renders their trail. Equal-distance playback samples can bridge across a
  // sharp corner between samples, which made boats/cars visibly drift away from
  // the line. Air routes may continue to use the prepared cinematic plan.
  const usePlan = playbackPlan?.positions?.length >= 4 && !routeStackingEnabled && !isSurfaceRouteMode(leg.mode);
  const vehicle = usePlan ? pointAtAnchoredPlaybackPlan(playbackPlan, routeProgress, leg) : pointAtVisualRouteProgress(leg, routeProgress, routedGeometries, routeStackingEnabled);
  const tangentWindow = surfaceTangentWindow(leg.mode, distance, p);
  const behind = usePlan ? pointAtAnchoredPlaybackPlan(playbackPlan, Math.max(0, routeProgress - tangentWindow), leg) : pointAtVisualRouteProgress(leg, Math.max(0, routeProgress - tangentWindow), routedGeometries, routeStackingEnabled);
  const future = usePlan ? pointAtAnchoredPlaybackPlan(playbackPlan, Math.min(1, routeProgress + Math.max(tangentWindow, lookAhead(distance, p, leg.mode))), leg) : pointAtVisualRouteProgress(leg, Math.min(1, routeProgress + Math.max(tangentWindow, lookAhead(distance, p, leg.mode))), routedGeometries, routeStackingEnabled);
  const routeMid = usePlan ? pointAtAnchoredPlaybackPlan(playbackPlan, 0.5, leg) : pointAtVisualRouteProgress(leg, 0.5, routedGeometries, routeStackingEnabled);
  const visibleDestination = { lon: Number(leg.to.lon), lat: Number(leg.to.lat) };
  const phase = raw > 1 ? 'settle' : visibleP < departureWarmup ? 'predeparture' : p < 0.18 ? 'takeoff' : p > 0.82 ? 'arrival' : 'cruise';
  const endpointBias = Math.max(0, 1 - Math.min(p, 1 - p) / 0.22);
  const leadBias = cameraLeadBias(leg.mode, distance, phase, p);
  let cinematicFocus = usePlan && playbackPlan?.camera?.length >= 4 ? cameraPointAtPlaybackPlan(playbackPlan, routeProgress) : blendGeo(vehicle, future, leadBias);

  if (phase === 'settle') {
    // Arrival owns the camera. Hold the destination calmly for the full settle
    // period instead of drifting toward the next leg or overshooting the city.
    const driftRadius = distance > 1500 ? 0.0025 : 0.0012;
    cinematicFocus = {
      lon: Number(leg.to.lon) + Math.sin(settleT * Math.PI * 0.65) * driftRadius,
      lat: Number(leg.to.lat) + Math.cos(settleT * Math.PI * 0.55) * driftRadius * 0.45
    };
  }

  if (phase === 'predeparture') {
    const smallOrbit = { lon: leg.from.lon + Math.sin(warmupT * Math.PI * 0.8) * 0.08, lat: leg.from.lat + Math.cos(warmupT * Math.PI * 0.7) * 0.045 };
    cinematicFocus = blendGeo(smallOrbit, leg.to, 0.035 * smoothstep(warmupT));
  }

  let center = cinematicFocus;
  if (cameraMode === 'global') center = blendGeo(routeMid, cinematicFocus, 0.2);
  if (cameraMode === 'route') center = blendGeo(routeMid, cinematicFocus, 0.52);
  if (cameraMode === 'continent') center = blendGeo(routeMid, cinematicFocus, 0.4);

  const heading = usePlan ? headingAtPlaybackPlan(playbackPlan, routeProgress) : headingAlongVisualRoute(leg, routeProgress, routedGeometries, routeStackingEnabled);
  const bearing = 0; // North-up. No route-heading camera rotation.
  const requestedZoom = cameraZoom(cameraMode, distance, endpointBias, p, phase, settleT, leg.mode);
  const activeFollowFloor = cameraMode === 'follow'
    ? (isSurfaceRouteMode(leg.mode) ? (distance > 1500 ? 5.15 : 5.75) : (distance > 3500 ? 4.72 : distance > 1500 ? 5.10 : 5.65))
    : requestedZoom;
  const zoom = Math.max(requestedZoom, activeFollowFloor);
  const pitch = cameraPitch(cameraMode, phase, distance, settleT);
  const arrived = phase === 'settle';

  return {
    phase,
    routeProgress,
    lineProgress,
    vehicle,
    routeBehind: behind,
    routeAhead: future,
    heading,
    screenHeading: headingToScreenRotation(heading, bearing),
    vehicleScale: vehicleScale(leg.mode, phase, endpointBias, p),
    vehiclePitchDeg: vehiclePitchDeg(leg.mode, phase, p),
    vehicleVisible: phase !== 'predeparture' && p > 0.006 && phase !== 'settle',
    visibleDestination,
    pulseActive: phase === 'settle' && settleT < 0.82,
    arrivalLabelVisible: arrived,
    newArrivalId: arrived ? leg.to.id : null,
    camera: { center: [center.lon, center.lat], zoom, pitch, bearing },
    routedGeometries,
    distance,
    legMode: leg.mode,
    frameKey: `${active.trip.id}:${active.legId || active.leg?.legId || active.legIndex}:${Math.round(raw * 1000)}:${cameraMode}`
  };
}

function updatePlaceLabel(el, name, point, color, kind) {
  el.style.setProperty('--place-color', color);
  el.classList.toggle('is-origin', kind === 'origin');
  el.classList.toggle('is-destination', kind === 'destination');
  el.innerHTML = `<span class="jl-place-dot"></span><span class="jl-place-name">${escapeHtml(name)}</span>`;
  const offsetY = kind === 'destination' ? -42 : 30;
  el.style.transform = `translate3d(${point.x}px, ${point.y + offsetY}px, 0) translate(-50%, -50%)`;
  el.style.opacity = '1';
}



function updateAirArcOverlay(map, pathEl, activeLeg, sceneState, color) {
  if (!pathEl || !activeLeg || !sceneState) return;
  const { leg } = activeLeg;
  const isAir = leg.mode === 'plane' || leg.mode === 'move';
  if (!isAir || !sceneState.vehicleVisible) {
    if (pathEl.__jlArcVisible !== false) {
      pathEl.style.opacity = '0';
      pathEl.setAttribute('d', '');
      pathEl.__jlArcVisible = false;
    }
    return;
  }
  pathEl.__jlArcVisible = true;
  const fromPt = map.project([leg.from.lon, leg.from.lat]);
  const vehiclePt = map.project([sceneState.vehicle.lon, sceneState.vehicle.lat]);
  if (!isCoordinateVisibleOnGlobe(map, sceneState.vehicle.lon, sceneState.vehicle.lat) || !isCoordinateVisibleOnGlobe(map, leg.from.lon, leg.from.lat)) {
    pathEl.style.opacity = '0';
    pathEl.setAttribute('d', '');
    return;
  }
  const heading = projectedScreenHeading(map, leg, sceneState.routeProgress, sceneState.routedGeometries);
  const rad = (heading - 90) * Math.PI / 180;
  const tailOffset = 23 * Math.max(0.55, sceneState.vehicleScale || 1);
  const tail = { x: vehiclePt.x - Math.cos(rad) * tailOffset, y: vehiclePt.y - Math.sin(rad) * tailOffset };
  const dx = tail.x - fromPt.x;
  const dy = tail.y - fromPt.y;
  const dist = Math.hypot(dx, dy);
  const canvas = map.getCanvas?.();
  const canvasWidth = canvas?.clientWidth || window.innerWidth;
  const canvasHeight = canvas?.clientHeight || window.innerHeight;
  const routeKey = `${activeLeg?.trip?.id || 'trip'}:${activeLeg?.legId || activeLeg?.legIndex || 'leg'}`;
  if (pathEl.__jlArcRouteKey !== routeKey) {
    pathEl.__jlArcRouteKey = routeKey;
    pathEl.setAttribute('d', '');
  }
  // A wrapped or nearly horizon-to-horizon projection can turn the decorative
  // takeoff arc into a stray horizontal line. The real route remains on the map;
  // suppress only this short-lived screen-space embellishment.
  const endpointMarginX = canvasWidth * 0.18;
  const endpointMarginY = canvasHeight * 0.18;
  const endpointsNearViewport = fromPt.x >= -endpointMarginX && fromPt.x <= canvasWidth + endpointMarginX
    && vehiclePt.x >= -endpointMarginX && vehiclePt.x <= canvasWidth + endpointMarginX
    && fromPt.y >= -endpointMarginY && fromPt.y <= canvasHeight + endpointMarginY
    && vehiclePt.y >= -endpointMarginY && vehiclePt.y <= canvasHeight + endpointMarginY;
  const dateLineRoute = Math.abs(Number(leg.to.lon) - Number(leg.from.lon)) > 180 || Math.abs(shortestLonDelta(Number(leg.to.lon) - Number(leg.from.lon))) > 150;
  if (!endpointsNearViewport || dateLineRoute || dist < 8 || dist > Math.hypot(canvasWidth, canvasHeight) * 0.58 || Math.abs(dx) > canvasWidth * 0.52) {
    pathEl.style.opacity = '0';
    pathEl.setAttribute('d', '');
    return;
  }
  const lift = Math.min(560, Math.max(86, dist * 0.58));
  const cx = (fromPt.x + tail.x) / 2 - dy / dist * lift;
  const cy = (fromPt.y + tail.y) / 2 + dx / dist * lift - lift * 0.98;
  pathEl.setAttribute('d', `M ${fromPt.x.toFixed(1)} ${fromPt.y.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${tail.x.toFixed(1)} ${tail.y.toFixed(1)}`);
  pathEl.style.setProperty('--air-arc-color', color);
  pathEl.style.opacity = String(Math.min(1, 0.25 + sceneState.lineProgress * 1.1));
}

function colorForLeg(active, travelerData) {
  if (active?.trip?.isHomeMove || active?.leg?.mode === 'move') return '#050607';
  if (travelerData?.hoppers || travelerData?.hopSquads) return resolveTrailVisual(active?.trip || {}, travelerData).baseColor || resolveTripVisual(active?.trip || {}, travelerData).color || '#00e5ff';
  return travelerData?.[getTravelerKey(active.trip)]?.color || '#00e5ff';
}

function buildVisitedLocations(completedLegs, active, completedMode, scene, travelersById = {}, homeBases = []) {
  const pointMap = new Map();
  const currentKey = timelineKeyForLegState(completedLegs, active, completedMode);
  const activeHome = activeHomeBaseForKey(homeBases, currentKey);
  const establishedHomes = establishedHomeBasesForKey(homeBases, currentKey);
  const establishedHomeIds = new Set(establishedHomes.map(h => h.locationId).filter(Boolean));
  const activeHomeId = activeHome?.locationId || null;

  const upsertPoint = (loc, patch = {}) => {
    if (!loc?.id) return null;
    const existing = pointMap.get(loc.id) || loc;
    const merged = {
      ...existing,
      ...loc,
      ...patch,
      visits: patch.visits || existing.visits || [],
      visitColors: patch.visitColors || existing.visitColors || []
    };
    // Any home base that has become active stays on the map. It is styled black
    // while it is acting as an inception/home point, but visit ticks remain the
    // historical traveler colors.
    if (establishedHomeIds.has(loc.id)) {
      merged.isHomeBase = true;
      merged.isActiveHomeBase = loc.id === activeHomeId;
      merged.color = '#050607';
      merged.placardColor = '#050607';
      merged.pinSegmentsOverride = '#050607';
    }
    pointMap.set(loc.id, merged);
    return merged;
  };

  const addVisit = (loc, legWrapper, isNew = false) => {
    if (!loc?.id || !legWrapper) return;
    if (shouldSkipVisitTick(loc, legWrapper, homeBases)) {
      upsertPoint(loc, { isNew: false });
      return;
    }
    const color = colorForLeg(legWrapper, travelersById);
    const existing = pointMap.get(loc.id);
    const visits = existing?.visits ? [...existing.visits] : [];
    visits.push({ color, tripId: legWrapper.trip?.id, legIndex: legWrapper.legIndex, mode: legWrapper.leg?.mode });
    upsertPoint(loc, {
      color,
      visits,
      visitColors: visits.map(v => v.color),
      isNew: Boolean(existing?.isNew || isNew)
    });
  };

  const addSeed = (loc, legWrapper, options = {}) => {
    if (!loc?.id || pointMap.has(loc.id)) return;
    const seedColor = options.homeSeed ? '#050607' : colorForLeg(legWrapper, travelersById);
    const visits = (options.homeSeed || options.previewDestination) ? [] : [{ color: seedColor, tripId: legWrapper?.trip?.id || 'seed', legIndex: -1, mode: legWrapper?.leg?.mode || 'seed' }];
    upsertPoint(loc, { color: seedColor, visits, visitColors: visits.map(v => v.color), isNew: false });
  };

  // Seed every home base that has become active by this point in the timeline.
  // This makes Melbourne black at the start and keeps Los Angeles/San Diego on
  // the map after they become inception points, even between route legs.
  for (const h of establishedHomes) {
    const loc = h.locationId ? active?.leg?.from?.id === h.locationId ? active.leg.from : null : null;
    const fromKnown = loc || findLocationInLegsById(completedLegs, active, h.locationId);
    if (fromKnown) addSeed(fromKnown, active || completedLegs?.[completedLegs.length - 1], { homeSeed: true });
  }

  const firstCompleted = completedLegs?.[0];
  if (firstCompleted?.leg?.from) addSeed(firstCompleted.leg.from, firstCompleted, { homeSeed: establishedHomeIds.has(firstCompleted.leg.from.id) });

  for (const l of completedLegs || []) {
    addVisit(l.leg.to, l, false);
  }
  if (active && !completedMode) {
    addSeed(active.leg.from, active, { homeSeed: establishedHomeIds.has(active.leg.from.id) });
    // Keep the current leg destination visible from the start of the leg.
    // It does not get a visit tick until arrival.
    addSeed(active.leg.to, active, { previewDestination: true });
    if (scene?.arrivalLabelVisible) addVisit(active.leg.to, active, true);
  }

  // If a home base was never part of completed legs yet (initial Melbourne, for
  // example), seed it from the location table carried inside home-base legs when available.
  for (const h of establishedHomes) {
    if (!h.locationId || pointMap.has(h.locationId)) continue;
    const loc = findLocationInLegsById(completedLegs, active, h.locationId);
    if (loc) addSeed(loc, active || completedLegs?.[completedLegs.length - 1], { homeSeed: true });
  }

  return [...pointMap.values()];
}

function timelineKeyForLegState(completedLegs = [], active = null, completedMode = false) {
  const sourceTrip = completedMode
    ? (completedLegs?.[completedLegs.length - 1]?.trip || active?.trip)
    : (active?.trip || completedLegs?.[completedLegs.length - 1]?.trip);
  if (!sourceTrip?.year) return '9999-12';
  return `${sourceTrip.year}-${String(sourceTrip.month || 1).padStart(2, '0')}`;
}

function activeHomeBaseForKey(homeBases = [], key = '9999-12') {
  return homeBases.find(h => h.start <= key && (!h.end || h.end >= key)) || null;
}

function establishedHomeBasesForKey(homeBases = [], key = '9999-12') {
  return homeBases.filter(h => h.locationId && h.start <= key);
}

function findLocationInLegsById(completedLegs = [], active = null, id = '') {
  if (!id) return null;
  const candidates = [];
  if (active?.leg) candidates.push(active.leg.from, active.leg.to);
  for (const l of completedLegs || []) candidates.push(l.leg?.from, l.leg?.to);
  return candidates.find(loc => loc?.id === id) || null;
}
function shouldSkipVisitTick(loc, legWrapper, homeBases = []) {
  if (!loc?.id || !legWrapper?.trip) return false;
  const trip = legWrapper.trip;
  if (trip.isHomeMove || legWrapper.leg?.mode === 'move') return true;
  const key = `${trip.year}-${String(trip.month || 1).padStart(2, '0')}`;
  const activeHome = homeBases.find(h => h.start <= key && (!h.end || h.end >= key));
  // Returning to the active home base is not a new visit. If that same city is
  // visited after it is no longer home, it will count normally because the
  // activeHome locationId will be different for that date.
  if (activeHome?.locationId && loc.id === activeHome.locationId && legWrapper.legIndex > 0) return true;
  return false;
}

function cssSegmentGradient(colors = [], fallback = '#00e5ff') {
  const clean = (colors.length ? colors : [fallback]).filter(Boolean);
  if (clean.length <= 1) return clean[0] || fallback;
  if (clean.length === 2) return `linear-gradient(90deg, ${clean[0]} 0 50%, ${clean[1]} 50% 100%)`;
  const step = 100 / clean.length;
  const stops = clean.map((c, i) => `${c} ${(i * step).toFixed(3)}% ${((i + 1) * step).toFixed(3)}%`).join(', ');
  return `conic-gradient(from -90deg, ${stops})`;
}

function syncVisitedPoints(map, visitedLocations, sigRef) {
  const sig = visitedLocations.map(l => `${l.id}:${displayNameForLocation(l)}:${(l.visitColors || [l.color || '#00e5ff']).join(',')}:${l.isNew ? 1 : 0}`).sort().join('|');
  if (sigRef?.current === sig) return;
  if (sigRef) sigRef.current = sig;
  map.getSource('visited-points')?.setData({
    type: 'FeatureCollection',
    features: visitedLocations.map(loc => ({
      type: 'Feature',
      properties: { id: loc.id, name: loc.name, displayName: displayNameForLocation(loc), showLabel: true, color: loc.color || '#00e5ff', isNew: Boolean(loc.isNew), visitCount: loc.visitColors?.length || 1 },
      geometry: { type: 'Point', coordinates: [loc.lon, loc.lat] }
    }))
  });
}

function updatePersistentLabels(map, visitedLocations, labelsRef, containerRef, color = '#00e5ff', newArrivalId = null, droppedIdsRef = { current: new Set() }) {
  if (!map) return;
  const seen = new Set();

  for (const loc of visitedLocations || []) {
    if (!loc?.id) continue;
    seen.add(loc.id);
    let el = labelsRef.current.get(loc.id);
    // Only animate a drop when this location is actually becoming a new visited
    // destination. Returning to an already-established active home base keeps the
    // home placard visible and should not re-drop the pin.
    const isNew = Boolean(loc.id === newArrivalId && !loc.isActiveHomeBase && !droppedIdsRef.current.has(loc.id));

    if (!el) {
      el = document.createElement('div');
      el.className = 'jl-map-pin';
      el.dataset.locationId = loc.id;
      // Use MapLibre's marker transform for the outer wrapper. This anchors the
      // placard to the globe on the same render path as the map and removes the
      // projection-vs-camera wobble caused by manually setting translate3d().
      el.__jlMarker = new maplibregl.Marker({ element: el, anchor: 'bottom', offset: [0, -2], occludedOpacity: 0 })
        .setLngLat([loc.lon, loc.lat])
        .addTo(map);
      try { el.__jlMarker.setOpacity?.('1', '0'); } catch {}
      el.setAttribute('role', 'button');
      el.setAttribute('tabindex', '0');
      const dispatchDestination = event => {
        if (!el.__jlSelectable || !el.__jlLocation) return;
        event?.preventDefault?.();
        event?.stopPropagation?.();
        const selected = el.__jlLocation;
        window.dispatchEvent(new CustomEvent('globehoppers-destination-click', {
          detail: {
            locationId: selected.id,
            locationName: displayNameForLocation(selected),
            camera: captureCameraState(map)
          }
        }));
      };
      el.addEventListener('pointerdown', event => {
        el.__jlPointerStart = { x: event.clientX, y: event.clientY, at: performance.now() };
        event.stopPropagation();
      });
      el.addEventListener('pointerup', event => {
        const start = el.__jlPointerStart;
        el.__jlPointerStart = null;
        if (!start || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 7) return;
        el.__jlLastPointerSelect = performance.now();
        dispatchDestination(event);
      });
      el.addEventListener('click', event => {
        if (performance.now() - Number(el.__jlLastPointerSelect || 0) < 350) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        dispatchDestination(event);
      });
      el.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') dispatchDestination(event);
      });
      labelsRef.current.set(loc.id, el);
    } else if (el.__jlMarker) {
      el.__jlMarker.setLngLat([loc.lon, loc.lat]);
    }

    const visitColors = loc.visitColors?.length ? loc.visitColors : [];
    const placardColor = loc.placardColor || loc.color || color;
    const gradient = loc.pinSegmentsOverride || cssSegmentGradient(visitColors, placardColor);
    el.style.setProperty('--place-color', placardColor);
    el.style.setProperty('--pin-segments', gradient);
    el.style.setProperty('--pin-tail-color', loc.pinSegmentsOverride || visitColors[visitColors.length - 1] || placardColor);
    el.dataset.visitCount = String(visitColors.length);
    el.dataset.homeBase = loc.isHomeBase ? 'true' : 'false';
    el.dataset.activeHomeBase = loc.isActiveHomeBase ? 'true' : 'false';
    el.classList.toggle('is-home-base', Boolean(loc.isHomeBase));
    // Keep home-base placards visually above nearby destination pins. This is
    // important for clustered places such as San Diego / Rosarito.
    el.style.zIndex = loc.isHomeBase ? (loc.isActiveHomeBase ? '1950' : '1900') : '1800';
    el.__jlLocation = loc;

    let inner = el.querySelector('.jl-map-pin-inner');
    const displayName = displayNameForLocation(loc);
    el.setAttribute('aria-label', `Show Hops to ${displayName}`);
    if (!inner) {
      el.innerHTML = `<span class="jl-map-pin-inner"><span class="jl-map-pin-dot"><span class="jl-map-pin-home-icon">⌂</span></span><span class="jl-map-pin-text"><span class="jl-map-pin-name"></span><span class="jl-map-pin-ticks"></span></span><span class="jl-map-pin-tail"></span></span>`;
      inner = el.querySelector('.jl-map-pin-inner');
    } else if (!el.querySelector('.jl-map-pin-ticks')) {
      // Upgrade older live DOM nodes to the v2.30 visit-tick structure without
      // recreating the outer MapLibre marker. This avoids placard wobble/reset.
      const nameText = el.querySelector('.jl-map-pin-name')?.textContent || displayName;
      inner.innerHTML = `<span class="jl-map-pin-dot"><span class="jl-map-pin-home-icon">⌂</span></span><span class="jl-map-pin-text"><span class="jl-map-pin-name"></span><span class="jl-map-pin-ticks"></span></span><span class="jl-map-pin-tail"></span>`;
      const upgradedName = el.querySelector('.jl-map-pin-name');
      if (upgradedName) upgradedName.textContent = nameText;
    }
    const nameEl = el.querySelector('.jl-map-pin-name');
    if (nameEl && nameEl.textContent !== displayName) nameEl.textContent = displayName;
    updateVisitTicks(el.querySelector('.jl-map-pin-ticks'), visitColors);

    if (isNew && inner) {
      droppedIdsRef.current.add(loc.id);
      inner.classList.remove('is-dropping');
      void inner.offsetWidth;
      inner.classList.add('is-dropping');
      window.setTimeout(() => inner?.classList?.remove('is-dropping'), 1600);
    }
  }

  for (const [id, el] of labelsRef.current.entries()) {
    if (!seen.has(id)) {
      el.__jlMarker?.remove?.();
      el.remove();
      labelsRef.current.delete(id);
      droppedIdsRef.current.delete(id);
    }
  }
  refreshPersistentPinPositions(map, labelsRef, null);
}

function updateVisitTicks(container, visitColors = []) {
  if (!container) return;
  const colors = (visitColors || []).filter(Boolean);
  const oldColors = container.__jlTickColors || [];
  const samePrefix = oldColors.length <= colors.length && oldColors.every((c, i) => c === colors[i]);
  if (!samePrefix) {
    container.innerHTML = '';
    container.__jlTickColors = [];
  }
  if (!colors.length) {
    container.innerHTML = '';
    container.__jlTickColors = [];
    return;
  }
  const current = container.__jlTickColors || [];
  for (let i = current.length; i < colors.length; i++) {
    const tick = document.createElement('span');
    tick.className = 'jl-visit-tick is-new';
    tick.dataset.visit = String(i + 1);
    tick.style.setProperty('--tick-color', colors[i]);
    container.appendChild(tick);
    window.setTimeout(() => tick.classList.remove('is-new'), 900);
  }
  container.__jlTickColors = colors;
}

function throttledRefreshPersistentPinPositions(map, labelsRef, throttleRef, visibilityStateRef, runtimeRef) {
  const now = performance.now();
  const runtime = runtimeRef?.current || {};
  // Playback mode favors smooth globe motion. Labels are allowed to drift with
  // their locked offsets, but horizon culling still needs to react quickly as
  // the camera crosses a hemisphere boundary.
  const minInterval = runtime.playback ? 90 : 120;
  if (throttleRef?.current?.t && now - throttleRef.current.t < minInterval) return;
  if (throttleRef) throttleRef.current = { t: now, camera: null };
  refreshPersistentPinPositions(map, labelsRef, visibilityStateRef, runtimeRef);
}

function refreshPersistentPinPositions(map, labelsRef, visibilityStateRef = null, runtimeRef = null) {
  if (!map || !labelsRef?.current) return;
  const canvas = map.getCanvas();
  const w = canvas?.clientWidth || window.innerWidth;
  const h = canvas?.clientHeight || window.innerHeight;
  const zoom = map.getZoom?.() || 1.5;
  const runtime = runtimeRef?.current || {};
  const screenBoost = clamp((Math.min(w, h) - 720) / 1500, 0, 0.28);
  const zoomBoost = clamp((zoom - 3.65) * 0.22, 0, 1.02);
  const labelScale = clamp(1 + screenBoost + zoomBoost, 1, 2.18);
  const uiScale = clamp(1 + screenBoost * 0.48 + zoomBoost * 0.16, 1, 1.30);
  const rootStyle = document.documentElement.style;
  const shellStyle = map.getContainer?.()?.closest?.('.maplibre-shell')?.style || null;
  const previousLabelScale = Number(shellStyle?.getPropertyValue('--gh-map-label-scale') || rootStyle.getPropertyValue('--gh-map-label-scale')) || 0;
  const previousUiScale = Number(shellStyle?.getPropertyValue('--gh-map-ui-scale') || rootStyle.getPropertyValue('--gh-map-ui-scale')) || 0;
  try {
    if (Math.abs(previousLabelScale - labelScale) > 0.015) {
      const value = labelScale.toFixed(3);
      rootStyle.setProperty('--gh-map-label-scale', value);
      shellStyle?.setProperty('--gh-map-label-scale', value);
    }
    if (Math.abs(previousUiScale - uiScale) > 0.015) {
      const value = uiScale.toFixed(3);
      rootStyle.setProperty('--gh-map-ui-scale', value);
      shellStyle?.setProperty('--gh-map-ui-scale', value);
    }
  } catch {}
  const visibleGlobeCenter = visualGlobeCenterCoordinate(map, w, h);
  const cameraTarget = (() => {
    try {
      const center = map.getCenter();
      return { lon: Number(center.lng) || 0, lat: Number(center.lat) || 0 };
    } catch {
      return visibleGlobeCenter;
    }
  })();
  const activeIds = runtime.activeIds || new Set();
  const playback = Boolean(runtime.playback);
  const stateMap = visibilityStateRef?.current;
  const visibleItems = [];

  for (const el of labelsRef.current.values()) {
    const loc = el.__jlLocation;
    if (!loc) continue;
    const pt = map.project([loc.lon, loc.lat]);
    // Be deliberately conservative at the globe limb. A point must belong to
    // both the map-center hemisphere and the visible screen-center hemisphere.
    // This prevents pitched views from keeping far-side aircraft or cities alive
    // merely because one projection estimate still considers them projectable.
    const visualDistance = angularDistanceDeg(visibleGlobeCenter, { lon: loc.lon, lat: loc.lat });
    const targetDistance = angularDistanceDeg(cameraTarget, { lon: loc.lon, lat: loc.lat });
    const angularDistance = Math.max(visualDistance, targetDistance);
    const activePlacard = activeIds.has(loc.id);
    const now = performance.now();
    const prior = stateMap?.get(loc.id) || { visible: false, hiddenUntil: 0, seenSafeSince: 0 };

    const onScreenLoose = pt.x > -320 && pt.x < w + 320 && pt.y > -260 && pt.y < h + 260;

    let visible;
    const focus = runtime.focus;
    const focusDistance = focus?.lon != null && focus?.lat != null
      ? angularDistanceDeg({ lon: Number(focus.lon), lat: Number(focus.lat) }, { lon: loc.lon, lat: loc.lat })
      : angularDistance;
    let markerOpacity = 1;
    if (playback) {
      // Cull before the geometric limb. Perspective and placard height make a
      // marker look behind the horizon well before 90 degrees on pitched views.
      const centerCutoff = activePlacard ? 56 : Math.min(49, hardPlacardHorizonCutoffDeg(zoom) - 14);
      const fadeStart = centerCutoff - (activePlacard ? 8 : 10);
      const focusCutoff = activePlacard ? 56 : Math.min(44, localPlacardFocusCutoffDeg(zoom) + 18);
      const safelyVisible = onScreenLoose && angularDistance <= centerCutoff && focusDistance <= focusCutoff;
      markerOpacity = safelyVisible ? clamp((centerCutoff - angularDistance) / Math.max(1, centerCutoff - fadeStart), 0, 1) : 0;
      if (!safelyVisible) {
        visible = false;
        prior.hiddenUntil = Math.max(prior.hiddenUntil || 0, now + 520);
        prior.seenSafeSince = 0;
      } else {
        if (!prior.seenSafeSince) prior.seenSafeSince = now;
        visible = now >= (prior.hiddenUntil || 0) && (now - prior.seenSafeSince) >= 60;
      }
    } else {
      const horizonCutoff = Math.min(64, hardPlacardHorizonCutoffDeg(zoom) - 4);
      visible = Boolean(onScreenLoose && angularDistance <= horizonCutoff);
    }

    prior.visible = visible;
    if (stateMap) stateMap.set(loc.id, prior);

    el.classList.toggle('is-culled', !visible);
    el.classList.toggle('is-flicker-locked', !visible);
    const selectedDestination = runtime.selectedDestinationId === loc.id;
    el.classList.toggle('is-active-placard', Boolean(activePlacard));
    el.classList.toggle('is-selected-destination', Boolean(selectedDestination));
    el.setAttribute('aria-hidden', visible ? 'false' : 'true');
    el.__jlVisible = visible;
    try { el.__jlMarker?.setOpacity?.(visible ? String(markerOpacity) : '0', '0'); } catch {}

    if (visible) {
      el.style.display = '';
      el.style.visibility = 'visible';
      // Leave opacity ownership to MapLibre's occlusion-aware Marker renderer.
      // Writing opacity:1 here defeated occludedOpacity=0 on the far hemisphere.
      if (playback && markerOpacity < 0.999) el.style.opacity = String(markerOpacity);
      else el.style.removeProperty('opacity');
      const priority = (activePlacard ? 100 : 0) + (loc.isActiveHomeBase ? 35 : 0) + (loc.isHomeBase ? 20 : 0) + Math.max(0, 20 - angularDistance / 3);
      visibleItems.push({ el, loc, pt, activePlacard, priority });
    } else {
      el.style.opacity = '0';
      el.style.visibility = 'hidden';
      el.style.display = 'none';
    }
    el.__jlSelectable = Boolean(runtime.selectable && visible);
    el.style.pointerEvents = el.__jlSelectable ? 'auto' : 'none';
    el.style.cursor = el.__jlSelectable ? 'pointer' : 'default';
  }

  resolvePersistentLabelCollisions(map, visibleItems);
}

function resolvePersistentLabelCollisions(map, items = []) {
  if (!map || !items?.length) return;
  const placed = [];
  const ordered = [...items].sort((a, b) => (b.priority || 0) - (a.priority || 0));

  const baseCandidates = [
    { name: '12', offset: [0, -4], anchor: 'bottom' },
    { name: '6', offset: [0, 24], anchor: 'top' },
    { name: '3', offset: [11, 3], anchor: 'left' },
    { name: '9', offset: [-11, 3], anchor: 'right' },
    { name: '2', offset: [13, -4], anchor: 'bottom-left' },
    { name: '10', offset: [-13, -4], anchor: 'bottom-right' },
    { name: '4', offset: [13, 21], anchor: 'top-left' },
    { name: '8', offset: [-13, 21], anchor: 'top-right' }
  ];
  const expandedCandidates = [
    ...baseCandidates,
    ...baseCandidates.map(c => ({ ...c, name: `${c.name}+`, offset: [c.offset[0] * 1.55, c.offset[1] * 1.55] })),
    ...baseCandidates.map(c => ({ ...c, name: `${c.name}++`, offset: [c.offset[0] * 2.05, c.offset[1] * 2.05] }))
  ];

  for (const item of ordered) {
    const el = item.el;
    const marker = el.__jlMarker;
    if (!marker) continue;

    // Performance rule: once a label has a collision-resolved anchor/offset,
    // keep that relative placement. Do not keep hunting/repositioning during
    // playback or map motion.
    if (el.__jlLabelPlaced && el.__jlLabelCandidate) {
      const box = estimatedMarkerBox(el, item.pt, el.__jlLabelCandidate);
      placed.push(box);
      continue;
    }

    const candidates = item.activePlacard ? baseCandidates : expandedCandidates;
    let chosen = candidates[0];
    let chosenBox = null;

    for (const candidate of candidates) {
      const box = estimatedMarkerBox(el, item.pt, candidate);
      if (!placed.some(other => rectsOverlap(box, other, 5))) {
        chosen = candidate;
        chosenBox = box;
        break;
      }
      if (!chosenBox) chosenBox = box;
    }

    try {
      marker.setAnchor?.(chosen.anchor);
      marker.setOffset?.(chosen.offset);
    } catch {}
    el.dataset.labelPosition = chosen.name;
    el.__jlLabelCandidate = chosen;
    el.__jlLabelPlaced = true;
    placed.push(chosenBox || estimatedMarkerBox(el, item.pt, chosen));
  }
}

function estimatedMarkerBox(el, point, candidate) {
  const rect = el.getBoundingClientRect?.();
  const width = Math.max(36, rect?.width || el.offsetWidth || 96);
  const height = Math.max(16, rect?.height || el.offsetHeight || 28);
  const [ox, oy] = candidate.offset || [0, 0];
  let x = point.x + ox;
  let y = point.y + oy;

  const anchor = candidate.anchor || 'bottom';
  if (anchor.includes('right')) x -= width;
  else if (!anchor.includes('left')) x -= width / 2;

  if (anchor.includes('bottom')) y -= height;
  else if (!anchor.includes('top')) y -= height / 2;

  return { x, y, width, height };
}

function rectsOverlap(a, b, pad = 0) {
  return !(a.x + a.width + pad < b.x || b.x + b.width + pad < a.x || a.y + a.height + pad < b.y || b.y + b.height + pad < a.y);
}

function isCoordinateVisibleOnGlobe(map, lon, lat, marginDeg = 58) {
  if (!map || lon == null || lat == null) return false;
  try {
    const canvas = map.getCanvas?.();
    const width = canvas?.clientWidth || window.innerWidth;
    const height = canvas?.clientHeight || window.innerHeight;
    const visualCenter = visualGlobeCenterCoordinate(map, width, height);
    const mapCenterRaw = map.getCenter?.();
    const mapCenter = Number.isFinite(mapCenterRaw?.lng) && Number.isFinite(mapCenterRaw?.lat)
      ? { lon: Number(mapCenterRaw.lng), lat: Number(mapCenterRaw.lat) }
      : visualCenter;
    const pitch = Number(map.getPitch?.() || 0);
    const conservativeCutoff = Math.min(Number(marginDeg) || 54, pitch > 45 ? 46 : pitch > 24 ? 49 : 53);
    const coordinate = { lon: Number(lon), lat: Number(lat) };
    const visualDistance = angularDistanceDeg(visualCenter, coordinate);
    const targetDistance = angularDistanceDeg(mapCenter, coordinate);
    if (Math.max(visualDistance, targetDistance) > conservativeCutoff) return false;
    const point = map.project([coordinate.lon, coordinate.lat]);
    return isVisibleOnGlobe(map, point, 0.90);
  } catch {
    return false;
  }
}

function isVisibleOnGlobe(map, point, margin = 1.06) {
  if (!map || !point) return false;
  const canvas = map.getCanvas();
  const w = canvas?.clientWidth || window.innerWidth;
  const h = canvas?.clientHeight || window.innerHeight;
  const center = { x: w / 2, y: h / 2 };
  const globeRadius = Math.min(w, h) * 0.48;
  const onScreen = point.x > -180 && point.x < w + 180 && point.y > -140 && point.y < h + 140;
  return onScreen && Math.hypot(point.x - center.x, point.y - center.y) < globeRadius * margin;
}

function shortestLongitudeDelta(a, b) {
  let d = ((b - a + 540) % 360) - 180;
  return d;
}

function cameraSubpointCoordinate(map) {
  try {
    const freeCamera = map.getFreeCameraOptions?.();
    const lngLat = freeCamera?.position?.toLngLat?.();
    if (lngLat && Number.isFinite(lngLat.lng) && Number.isFinite(lngLat.lat)) {
      return { lon: Number(lngLat.lng), lat: Number(lngLat.lat) };
    }
  } catch {}
  return null;
}

function visualGlobeCenterCoordinate(map, width = 0, height = 0) {
  try {
    const canvas = map.getCanvas?.();
    const w = Number(width) || canvas?.clientWidth || 0;
    const h = Number(height) || canvas?.clientHeight || 0;
    // With a pitched globe, MapLibre's camera center can sit below the visible
    // center of the planet. Resolve this once per placard refresh, not once per
    // location, so horizon culling remains cheap during playback.
    const visualCenter = w > 0 && h > 0 ? map.unproject([w / 2, h / 2]) : null;
    const center = visualCenter && Number.isFinite(visualCenter.lng) && Number.isFinite(visualCenter.lat)
      ? visualCenter
      : map.getCenter();
    return { lon: Number(center.lng) || 0, lat: Number(center.lat) || 0 };
  } catch {
    return { lon: 0, lat: 0 };
  }
}

function angularDistanceFromMapCenter(map, lon, lat) {
  return angularDistanceDeg(visualGlobeCenterCoordinate(map), { lon, lat });
}

function milesFromMapCenter(map, lon, lat) {
  try {
    const center = map.getCenter();
    return milesBetween({ lon: center.lng, lat: center.lat }, { lon, lat });
  } catch {
    return 0;
  }
}

function horizonCutoffDeg(zoom) {
  // v2.27: strict globe clipping. Placards should disappear before they reach
  // the visual horizon, especially with a pitched globe, while still keeping all
  // historical placards that are genuinely on the visible face.
  if (zoom < 1.7) return 50;
  if (zoom < 2.2) return 56;
  if (zoom < 3.0) return 62;
  if (zoom < 4.2) return 68;
  if (zoom < 5.5) return 73;
  return 76;
}

function horizonSafetyMarginDeg(zoom) {
  // Hide placards well before the visual horizon. Higher pitch and close zooms
  // can keep points projectable even when they visually sit behind the globe;
  // this margin prevents edge shimmer and the dim/full flicker.
  if (zoom < 2.0) return 12;
  if (zoom < 3.0) return 14;
  if (zoom < 4.5) return 16;
  if (zoom < 6.0) return 18;
  return 20;
}


function hardPlacardHorizonCutoffDeg(zoom) {
  // v2.35: slightly tighten from v2.34. The distance guard below preserves
  // useful regional labels, so this can focus on preventing true backside/edge
  // bleed-through.
  if (zoom < 1.7) return 70;
  if (zoom < 2.2) return 68;
  if (zoom < 3.0) return 60;
  if (zoom < 4.2) return 64;
  if (zoom < 5.5) return 68;
  if (zoom < 7.0) return 70;
  return 72;
}

function maxPlacardDistanceMiles(zoom) {
  // Hard distance guard against far-side placards while preserving useful
  // regional context. At closer cinematic zooms, only the current broad region
  // should label; at wide views, allow more of the visible hemisphere.
  if (zoom < 1.7) return 13000;
  if (zoom < 2.2) return 10500;
  if (zoom < 3.0) return 4700;
  if (zoom < 4.2) return 3600;
  if (zoom < 5.5) return 2300;
  if (zoom < 7.0) return 1500;
  return 950;
}

function localPlacardFocusCutoffDeg(zoom) {
  // At close/local zooms, show labels for the local region rather than distant
  // places on the same front-facing hemisphere. This prevents far-off labels
  // from hanging around during Florida/California regional scenes.
  if (zoom < 2.2) return 50;
  if (zoom < 3.0) return 42;
  if (zoom < 4.2) return 28;
  if (zoom < 5.5) return 18;
  if (zoom < 6.7) return 11;
  if (zoom < 7.8) return 7;
  return 5.2;
}

function labelFocusCutoffDeg(zoom) {
  // v2.26: make placards highly local at cinematic/road-trip zoom levels.
  // During a Florida drive, Chicago/New York should be out even though they may
  // still project onto the pitched globe. Pins/routes can remain, but placards
  // should only be near the camera's current focus region.
  if (zoom < 1.7) return 22;
  if (zoom < 2.2) return 28;
  if (zoom < 3.0) return 34;
  if (zoom < 4.2) return 18;
  if (zoom < 5.2) return 10;
  if (zoom < 6.2) return 6.5;
  return 4.8;
}

function angularDistanceDeg(a, b) {
  const toRad = d => d * Math.PI / 180;
  const toDeg = r => r * 180 / Math.PI;
  const lat1 = toRad(a.lat), lat2 = toRad(b.lat);
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return toDeg(2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h))));
}

function updatePulseOverlay(el, point, color, active) {
  if (!el) return;
  el.style.setProperty('--pulse-color', color);
  el.style.transform = `translate3d(${point.x}px, ${point.y}px, 0) translate(-50%, -50%) scaleY(0.46)`;
  el.classList.toggle('is-active', Boolean(active));
  el.style.opacity = active ? '1' : '0';
}

function routeCoordinates(leg, progress = 1, n = 64, routedGeometries = {}) {
  if (leg.mode === 'plane' || leg.mode === 'move') return routeSamples(leg.from, leg.to, progress, Math.max(2, n));
  const routed = getVisualRoutedGeometry(leg, routedGeometries);
  if (routed?.length > 1) {
    // Presentation geometry is already capped and simplified. Preserve every
    // point that has been laid down behind the vessel and only interpolate the
    // newest trail endpoint. Re-sampling the entire traveled prefix on each
    // frame made old trail segments visibly slide after the vessel passed.
    return stableRoutePrefix(routed, progress);
  }
  const pts = waypointPathForLeg(leg);
  return stableRoutePrefix(pts, progress);
}

function pointAtRouteProgress(leg, t, routedGeometries = {}) {
  if (leg.mode === 'plane' || leg.mode === 'move') return interpolateGeo(leg.from, leg.to, t);
  const routed = getVisualRoutedGeometry(leg, routedGeometries);
  const coords = routed?.length > 1 ? routed : waypointPathForLeg(leg);
  const [lon, lat] = pointOnPolyline(coords, t);
  return { lon, lat };
}

function pointAtVisualRouteProgress(leg, t, routedGeometries = {}, routeStackingEnabled = false) {
  const stackOffset = routeStackingEnabled ? Number(leg?.routeStackOffset || 0) : 0;
  if (!stackOffset) return pointAtRouteProgress(leg, t, routedGeometries);
  const coords = stackedRouteCoordinates(leg, 1, leg?.mode === 'plane' || leg?.mode === 'move' ? 140 : 180, routedGeometries, stackOffset);
  const [lon, lat] = pointOnPolyline(coords, t);
  return { lon, lat };
}

function headingAlongVisualRoute(leg, t, routedGeometries = {}, routeStackingEnabled = false) {
  const stackOffset = routeStackingEnabled ? Number(leg?.routeStackOffset || 0) : 0;
  if (!stackOffset) return headingAlongRoute(leg, t, routedGeometries);
  const coords = stackedRouteCoordinates(leg, 1, leg?.mode === 'plane' || leg?.mode === 'move' ? 140 : 180, routedGeometries, stackOffset);
  const a = pointOnPolyline(coords, Math.max(0, t - 0.008));
  const b = pointOnPolyline(coords, Math.min(1, t + 0.008));
  return bearingBetween({ lon: a[0], lat: a[1] }, { lon: b[0], lat: b[1] });
}

function headingAlongRoute(leg, t, routedGeometries = {}) {
  const a = pointAtRouteProgress(leg, Math.max(0, t - 0.008), routedGeometries);
  const b = pointAtRouteProgress(leg, Math.min(1, t + 0.008), routedGeometries);
  return bearingBetween(a, b);
}

function projectedHeadingFromScene(map, sceneState = {}) {
  const vehicle = sceneState.vehicle;
  const behind = sceneState.routeBehind || vehicle;
  const ahead = sceneState.routeAhead || vehicle;
  if (!vehicle || !map) return Number(sceneState.screenHeading || sceneState.heading || 0);
  const pa = map.project([Number(behind.lon), Number(behind.lat)]);
  const pb = map.project([Number(ahead.lon), Number(ahead.lat)]);
  const dx = Number(pb.x) - Number(pa.x);
  const dy = Number(pb.y) - Number(pa.y);
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.hypot(dx, dy) < 0.75) {
    return Number(sceneState.screenHeading || sceneState.heading || 0);
  }
  return Math.atan2(dx, -dy) * 180 / Math.PI;
}

function projectedScreenHeading(map, leg, t, routedGeometries = {}, sampleWindow = 0.01) {
  const windowSize = Math.max(0.004, Math.min(0.08, Number(sampleWindow) || 0.01));
  const a = pointAtRouteProgress(leg, Math.max(0, t - windowSize), routedGeometries);
  const b = pointAtRouteProgress(leg, Math.min(1, t + windowSize), routedGeometries);
  const pa = map.project([a.lon, a.lat]);
  const pb = map.project([b.lon, b.lat]);
  return Math.atan2(pb.x - pa.x, -(pb.y - pa.y)) * 180 / Math.PI;
}


function routeCacheVersion() { return ROUTING_VERSION; }
function routeCacheKey(leg) {
  return routeCacheKeyV6(leg, ROUTING_VERSION);
}
function legacyGeneratedRouteKey(leg) {
  const version = routingSettings?.mapbox?.cacheVersion || generatedRoutes?.version || 'v2.16';
  return `${version}:${leg.from.id}->${leg.to.id}:${leg.mode}`;
}
function playbackPlanKey(leg, geometryOverride = null) {
  const geometry = Array.isArray(geometryOverride) && geometryOverride.length > 1
    ? geometryOverride
    : Array.isArray(leg?.routeGeometry)
      ? leg.routeGeometry
      : [];
  const sampleIndexes = geometry.length > 1
    ? [...new Set([0, Math.floor((geometry.length - 1) * 0.25), Math.floor((geometry.length - 1) * 0.5), Math.floor((geometry.length - 1) * 0.75), geometry.length - 1])]
    : [];
  const geometryKey = sampleIndexes.length
    ? `${geometry.length}:${sampleIndexes.map(index => {
      const point = geometry[index] || [];
      return `${Number(point[0]).toFixed(4)},${Number(point[1]).toFixed(4)}`;
    }).join(':')}`
    : 'no-geometry';
  return `${leg?.legId || leg?.id || 'legacy'}:${leg?.from?.id || leg?.from?.lon}->${leg?.to?.id || leg?.to?.lon}:${leg?.mode || 'plane'}:${geometryKey}`;
}


function getRoutedGeometry(leg, routedGeometries = {}) {
  const manual = getManualRoute(leg);
  if (manual?.length > 1) return manual;

  // Surface routes are stored once per unordered endpoint pair. A matching
  // return leg reads the same stable geometry in reverse instead of requesting,
  // parsing, simplifying, and caching a duplicate route.
  if (isSurfaceRouteMode(leg?.mode)) {
    const canonical = routedGeometries[bidirectionalRouteKey(leg)];
    const oriented = canonical?.length > 1 ? geometryForLegDirection(leg, canonical) : null;
    if (oriented?.length > 1 && !isStraightEndpointPlaceholder(leg, oriented)) return oriented;
  }

  // v6: saved routeDetails geometry is the primary runtime source. Detailed
  // vessel routes are no longer regenerated during page startup.
  if (Array.isArray(leg?.routeGeometry) && leg.routeGeometry.length > 1 && !isStraightEndpointPlaceholder(leg, leg.routeGeometry)) return leg.routeGeometry;

  const key = leg?.routeCacheKey || routeCacheKey(leg);
  const direct = routedGeometries[key]
    || routedGeometries[routeCacheKey(leg)]
    || routedGeometries[legacyGeneratedRouteKey(leg)]
    || routingMemoryGeometry(leg);
  if (direct?.length > 1 && !isStraightEndpointPlaceholder(leg, direct)) return direct;
  return null;
}

function getVisualRoutedGeometry(leg, routedGeometries = {}) {
  if (Array.isArray(leg?.presentationGeometry) && leg.presentationGeometry.length > 1) return anchorRouteGeometryToEndpoints(leg.presentationGeometry, leg);
  const raw = getRoutedGeometry(leg, routedGeometries);
  if (!raw?.length || !isSurfaceRouteMode(leg?.mode)) return raw;
  return anchorRouteGeometryToEndpoints(buildSurfacePresentationGeometry(raw, leg.mode, { profile: 'playback' }), leg);
}

function playbackPlanPresentationGeometry(plan) {
  if (!plan?.presentation || plan.presentation.length < 4) return null;
  if (plan.__presentationGeometry) return plan.__presentationGeometry;
  const geometry = [];
  for (let index = 0; index + 1 < plan.presentation.length; index += 2) {
    geometry.push([Number(plan.presentation[index]), Number(plan.presentation[index + 1])]);
  }
  try { Object.defineProperty(plan, '__presentationGeometry', { value: geometry, configurable: true }); } catch {}
  return geometry;
}

function isNaturalEarthVesselMode(mode) {
  return mode === 'drive' || mode === 'car' || mode === 'train' || mode === 'boat';
}

function isStraightEndpointPlaceholder(leg, coords = []) {
  const mode = leg?.mode;
  if (mode === 'plane' || mode === 'move') return false;
  if (!(mode === 'drive' || mode === 'car' || mode === 'train' || mode === 'boat')) return false;
  if (!Array.isArray(coords) || coords.length !== 2) return false;
  const a = coords[0];
  const b = coords[1];
  return approxCoord(a, [leg?.from?.lon, leg?.from?.lat]) && approxCoord(b, [leg?.to?.lon, leg?.to?.lat]);
}
function approxCoord(a, b) {
  return Array.isArray(a) && Array.isArray(b) && Math.abs(Number(a[0]) - Number(b[0])) < 0.0005 && Math.abs(Number(a[1]) - Number(b[1])) < 0.0005;
}

function getManualRoute(leg) {
  const routes = routeOverrides?.routes || [];
  const direct = routes.find(r => r.mode === leg.mode && r.fromLocationId === leg.from.id && r.toLocationId === leg.to.id);
  if (direct?.coordinates?.length > 1) return direct.coordinates;
  const reverse = routes.find(r => r.mode === leg.mode && r.fromLocationId === leg.to.id && r.toLocationId === leg.from.id);
  if (reverse?.coordinates?.length > 1) return [...reverse.coordinates].reverse();
  return null;
}

function loadInitialRouteCache() {
  const generated = generatedRoutes?.routes || {};
  const detailed = routeDetailsGeometryCache(baseRouteDetails);
  // v6: startup uses only deployed geometry. Larger browser caches are restored
  // asynchronously from IndexedDB after the first render.
  return { ...generated, ...detailed };
}

function waypointPathForLeg(leg) {
  const manual = getManualRoute(leg);
  if (manual?.length > 1) return manual;
  const a = [leg.from.lon, leg.from.lat];
  const b = [leg.to.lon, leg.to.lat];
  const key = `${leg.from.id}->${leg.to.id}:${leg.mode}`;
  const reverseKey = `${leg.to.id}->${leg.from.id}:${leg.mode}`;
  const legacy = ROUTE_WAYPOINTS[key] || (ROUTE_WAYPOINTS[reverseKey] ? [...ROUTE_WAYPOINTS[reverseKey]].reverse() : null);
  if (legacy) return [a, ...legacy, b];

  // Detailed car/train/boat geometry is requested from the routing worker.
  // This lightweight fallback keeps the map usable until that asynchronous
  // result is ready, without parsing or traversing Natural Earth on the UI thread.
  return stylizedFallbackRoute(leg);
}

// v6 lightweight UI-thread fallback. Detailed routing now lives entirely in
// routingWorker.js and is cached through IndexedDB. This curve is only shown
// briefly if a worker route is not ready yet.
function stylizedFallbackRoute(leg) {
  const a = [Number(leg?.from?.lon), Number(leg?.from?.lat)];
  const b = [Number(leg?.to?.lon), Number(leg?.to?.lat)];
  if (!Number.isFinite(a[0]) || !Number.isFinite(a[1]) || !Number.isFinite(b[0]) || !Number.isFinite(b[1])) return [a, b];
  const mode = leg?.mode || 'plane';
  if (mode === 'plane' || mode === 'move') return [a, b];
  const dx = shortestLonDelta(b[0] - a[0]);
  const dy = b[1] - a[1];
  const length = Math.hypot(dx, dy) || 1;
  const perp = [-dy / length, dx / length];
  const magnitude = mode === 'boat' ? Math.min(2.2, length * 0.08) : mode === 'train' ? Math.min(0.7, length * 0.025) : Math.min(1.1, length * 0.045);
  return [
    a,
    [lerpAngle(a[0], b[0], 0.33) + perp[0] * magnitude, lerp(a[1], b[1], 0.33) + perp[1] * magnitude],
    [lerpAngle(a[0], b[0], 0.67) - perp[0] * magnitude * 0.35, lerp(a[1], b[1], 0.67) - perp[1] * magnitude * 0.35],
    b
  ];
}


const ROUTE_WAYPOINTS = {
  'melbourne-fl->key-west-fl:drive': [[-80.19, 25.76], [-81.32, 25.14]],
  'melbourne-fl->destin-fl:drive': [[-82.46, 27.95], [-84.28, 30.44]],
  'melbourne-fl->fort-lauderdale-fl:drive': [[-80.54, 27.65], [-80.23, 26.71]],
  'melbourne-fl->miami-fl:drive': [[-80.54, 27.65], [-80.23, 26.71]],
  'melbourne-fl->knoxville-tn:drive': [[-82.46, 27.95], [-84.39, 33.75], [-84.32, 35.05]],
  'melbourne-fl->jekyll-island-ga:drive': [[-81.39, 28.54], [-81.65, 30.33]],
  'melbourne-fl->augusta-ga:drive': [[-81.39, 28.54], [-81.10, 32.08]],
  'san-diego-ca->las-vegas-nv:drive': [[-116.55, 34.85], [-115.49, 35.47]],
  'san-diego-ca->palm-springs-ca:drive': [[-116.96, 33.75]],
  'san-diego-ca->mammoth-ca:drive': [[-117.16, 34.05], [-118.15, 36.60]],
  'san-diego-ca->malibu-ca:drive': [[-117.91, 33.84], [-118.24, 34.05]],
  'san-diego-ca->rosarito-mx:drive': [[-117.04, 32.52]],
  'los-angeles-ca->catalina-ca:drive': [[-118.19, 33.77], [-118.32, 33.60]],
  'san-francisco-ca->oakland-ca:drive': [[-122.34, 37.81]],
  'seattle-wa->vancouver-ca:drive': [[-122.48, 48.75]],
  'geneva-ch->interlaken-ch:drive': [[6.63, 46.52], [7.44, 46.95]],
  'interlaken-ch->evian-fr:drive': [[7.05, 46.61], [6.63, 46.52]],
  'evian-fr->geneva-ch:drive': [[6.46, 46.38]],
  'melbourne-fl->nassau-bs:boat': [[-80.6077, 28.4058], [-79.50, 27.10], [-78.35, 25.85]],
  'miami-fl->nassau-bs:boat': [[-79.50, 25.55]],
  'melbourne-fl->montego-bay-jm:boat': [[-79.20, 27.40], [-77.20, 25.35], [-75.25, 22.35], [-74.25, 20.35], [-75.95, 18.95]],
  'montego-bay-jm->george-town-ky:boat': [[-79.60, 18.85]],
  'george-town-ky->melbourne-fl:boat': [[-79.05, 19.10], [-76.15, 19.45], [-74.25, 20.35], [-75.25, 22.35], [-77.20, 25.35], [-79.20, 27.40]],
  'miami-fl->george-town-ky:boat': [[-79.90, 25.25], [-78.30, 23.15], [-76.15, 19.45], [-79.05, 19.10]],
  'george-town-ky->montego-bay-jm:boat': [[-80.20, 18.95], [-79.10, 18.82]],
  'nassau-bs->melbourne-fl:boat': [[-78.35, 25.85], [-79.50, 27.10], [-80.6077, 28.4058]]
};


function preloadTilesForLeg(leg, map, cacheSet, label = 'leg', routedGeometries = {}) {
  if (!leg || !map || !cacheSet) return;
  const routePts = [
    { lon: leg.from.lon, lat: leg.from.lat },
    pointAtRouteProgress(leg, 0.5, routedGeometries),
    { lon: leg.to.lon, lat: leg.to.lat }
  ];
  const distance = milesBetween(leg.from, leg.to);
  const zBase = Math.max(2, Math.min(7, Math.round(distance > 4000 ? 3 : distance > 1500 ? 4 : distance > 450 ? 5 : 6)));
  const zooms = [...new Set([zBase, Math.min(8, zBase + 1)])];
  for (const pt of routePts) {
    for (const z of zooms) preloadTileNeighborhood(pt.lon, pt.lat, z, cacheSet, label);
  }
  // Bound custom image-preload bookkeeping. MapLibre has its own cache; this set
  // only prevents duplicate warm requests and must not grow for an entire year.
  while (cacheSet.size > 900) cacheSet.delete(cacheSet.values().next().value);
}

function preloadTileNeighborhood(lon, lat, z, cacheSet, label = 'leg') {
  const t = lonLatToTile(lon, lat, z);
  if (!t) return;
  const radius = z <= 5 ? 0 : 1;
  const max = Math.pow(2, z);
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -radius; dy <= radius; dy++) {
      const x = ((t.x + dx) % max + max) % max;
      const y = Math.max(0, Math.min(max - 1, t.y + dy));
      const url = `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
      if (cacheSet.has(url)) continue;
      cacheSet.add(url);
      const img = new Image();
      img.decoding = 'async';
      img.referrerPolicy = 'no-referrer';
      img.src = url;
    }
  }
}

function lonLatToTile(lon, lat, z) {
  if (lon == null || lat == null) return null;
  const clampedLat = Math.max(-85.05112878, Math.min(85.05112878, lat));
  const n = Math.pow(2, z);
  const x = Math.floor((lon + 180) / 360 * n);
  const latRad = clampedLat * Math.PI / 180;
  const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n);
  return { x: Math.max(0, Math.min(n - 1, x)), y: Math.max(0, Math.min(n - 1, y)) };
}

const polylineMetricCache = new WeakMap();

function samplePolyline(coords, progress = 1, n = 64) {
  const maxT = Math.max(0, Math.min(1, progress));
  if (!Array.isArray(coords) || !coords.length) return [[0, 0], [0, 0]];
  if (maxT <= 0.001) return [coords[0], coords[0]];
  const steps = Math.max(2, Math.ceil(n * Math.max(0.05, maxT)));
  const metrics = polylineMetrics(coords);
  return Array.from({ length: steps + 1 }, (_, i) => pointOnPolylineWithMetrics(coords, (i / steps) * maxT, metrics));
}

function pointOnPolyline(coords, t) {
  if (!Array.isArray(coords) || coords.length < 2) return coords?.[0] || [0, 0];
  return pointOnPolylineWithMetrics(coords, t, polylineMetrics(coords));
}

function polylineMetrics(coords) {
  const cached = polylineMetricCache.get(coords);
  if (cached) return cached;
  const cumulative = new Float64Array(Math.max(1, coords.length));
  let total = 0;
  for (let index = 1; index < coords.length; index += 1) {
    total += Math.hypot(coords[index][0] - coords[index - 1][0], coords[index][1] - coords[index - 1][1]);
    cumulative[index] = total;
  }
  const metrics = { cumulative, total };
  polylineMetricCache.set(coords, metrics);
  return metrics;
}

function pointOnPolylineWithMetrics(coords, t, metrics) {
  if (coords.length < 2 || !metrics?.total) return coords[0] || [0, 0];
  const target = Math.max(0, Math.min(1, t)) * metrics.total;
  let low = 1;
  let high = coords.length - 1;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (metrics.cumulative[middle] < target) low = middle + 1;
    else high = middle;
  }
  const index = Math.max(1, low);
  const startDistance = metrics.cumulative[index - 1] || 0;
  const segmentDistance = Math.max(1e-12, metrics.cumulative[index] - startDistance);
  const u = Math.max(0, Math.min(1, (target - startDistance) / segmentDistance));
  return [
    lerp(coords[index - 1][0], coords[index][0], u),
    lerp(coords[index - 1][1], coords[index][1], u)
  ];
}

function interpolateGeo(a, b, t) {
  const interp = geoInterpolate([a.lon, a.lat], [b.lon, b.lat]);
  const [lon, lat] = interp(Math.max(0, Math.min(1, t)));
  return { lon, lat };
}

function routeSamples(a, b, progress = 1, n = 64) {
  const interp = geoInterpolate([a.lon, a.lat], [b.lon, b.lat]);
  const maxT = Math.max(0, Math.min(1, progress));
  if (maxT <= 0.001) return [[a.lon, a.lat], [a.lon, a.lat]];
  const steps = Math.max(2, Math.ceil(n * Math.max(0.05, maxT)));
  return unwrapAntimeridianLine(Array.from({ length: steps + 1 }, (_, i) => interp((i / steps) * maxT)));
}

function unwrapAntimeridianLine(coords) {
  if (!Array.isArray(coords) || coords.length < 2) return coords || [];
  const out = [[coords[0][0], coords[0][1]]];
  for (let i = 1; i < coords.length; i++) {
    let lon = coords[i][0];
    const lat = coords[i][1];
    const prevLon = out[out.length - 1][0];
    while (lon - prevLon > 180) lon -= 360;
    while (lon - prevLon < -180) lon += 360;
    out.push([lon, lat]);
  }
  return out;
}
function shortestLonDelta(delta) { return ((delta + 540) % 360) - 180; }
function blendGeo(a, b, amount) { return interpolateGeo(a, b, amount); }
function emptyCollection() { return { type: 'FeatureCollection', features: [] }; }
function relocationOverviewZoom(distanceMiles = 0) {
  const distance = Math.max(0, Number(distanceMiles) || 0);
  if (distance > 3200) return 2.25;
  if (distance > 1600) return 2.65;
  if (distance > 700) return 3.05;
  if (distance > 260) return 3.55;
  if (distance > 90) return 4.15;
  return 4.75;
}

function relocationTargetZoom(distanceMiles = 0, mode = 'plane', cameraMode = 'follow') {
  if (cameraMode === 'global') return 4.2;
  const distance = Math.max(0, Number(distanceMiles) || 0);
  const surfaceMode = isSurfaceRouteMode(mode);
  if (distance > 3200) return 4.35;
  if (distance > 1400) return 4.55;
  if (distance > 650) return 4.85;
  if (distance > 220) return surfaceMode ? 5.25 : 5.05;
  if (distance > 70) return surfaceMode ? 5.75 : 5.45;
  return surfaceMode ? 6.35 : 5.95;
}

function createPlaybackReturnState() {
  return {
    active: false,
    stage: 'idle',
    stageStart: 0,
    stageDuration: 0,
    from: null,
    stageFrom: null,
    target: null,
    safeZoom: INTRO_GLOBE_ZOOM,
    timer: null
  };
}

function stagedPlaybackReturnCamera(state, latestTarget, now) {
  if (!state?.active || !state.from || !latestTarget) return null;
  const elapsed = Math.max(0, Number(now) - Number(state.stageStart || now));
  const duration = Math.max(600, Number(state.stageDuration || 1500));
  const t = clamp(elapsed / duration, 0, 1);
  const orientT = smoothStep(clamp(t / 0.72, 0, 1));
  const zoomT = smoothStep(clamp((t - 0.48) / 0.52, 0, 1));
  const startCamera = state.from;
  const safeZoom = Number.isFinite(Number(state.safeZoom))
    ? Number(state.safeZoom)
    : Math.min(Number(startCamera.zoom), Number(latestTarget.zoom));

  // One owner, one continuous path: first rotate/translate at a globe-safe zoom,
  // then blend zoom only after most orientation error is gone. The live target
  // remains authoritative, so the vessel keeps moving while the camera returns.
  const orientedCamera = smoothCamera(startCamera, {
    center: [...latestTarget.center],
    zoom: safeZoom,
    pitch: Number(latestTarget.pitch),
    bearing: Number(latestTarget.bearing)
  }, orientT);
  const camera = {
    ...orientedCamera,
    center: [...orientedCamera.center],
    zoom: safeZoom + (Number(latestTarget.zoom) - safeZoom) * zoomT
  };

  state.target = { ...latestTarget, center: [...latestTarget.center] };
  state.stageFrom = camera;
  if (t >= 1) {
    const centerError = Math.hypot(
      shortestLonDelta(Number(latestTarget.center?.[0]) - Number(camera.center?.[0])),
      Number(latestTarget.center?.[1]) - Number(camera.center?.[1])
    );
    const zoomError = Math.abs(Number(latestTarget.zoom) - Number(camera.zoom));
    const bearingError = Math.abs(shortestLonDelta(Number(latestTarget.bearing || 0) - Number(camera.bearing || 0)));
    const pitchError = Math.abs(Number(latestTarget.pitch || 0) - Number(camera.pitch || 0));
    const settled = centerError < 0.12 && zoomError < 0.05 && bearingError < 1.25 && pitchError < 1.25;
    state.settledFrames = settled ? Number(state.settledFrames || 0) + 1 : 0;
    if (state.settledFrames >= 3 || elapsed >= duration + 500) state.active = false;
  }
  return camera;
}

function smoothStep(value) {
  const t = clamp(Number(value) || 0, 0, 1);
  return t * t * (3 - 2 * t);
}

function cameraChangedEnough(current, next) {
  if (!current || !next) return true;
  const centerDelta = Math.hypot(
    shortestLonDelta(Number(next.center?.[0]) - Number(current.center?.[0])),
    Number(next.center?.[1]) - Number(current.center?.[1])
  );
  return centerDelta > 0.00008
    || Math.abs(Number(next.zoom) - Number(current.zoom)) > 0.00035
    || Math.abs(Number(next.pitch) - Number(current.pitch)) > 0.015
    || Math.abs(shortestLonDelta(Number(next.bearing) - Number(current.bearing))) > 0.015;
}

function smoothCamera(prev, next, amount) {
  if (!prev) return next;
  return {
    center: [lerpAngle(prev.center[0], next.center[0], amount), lerp(prev.center[1], next.center[1], amount)],
    zoom: lerp(prev.zoom, next.zoom, amount),
    pitch: lerp(prev.pitch, next.pitch, amount),
    bearing: lerpAngle(prev.bearing, next.bearing, amount)
  };
}

function legsConnect(previousLeg, nextLeg, tolerance = 0.12) {
  if (!previousLeg?.to || !nextLeg?.from) return false;
  if (previousLeg.to.id && nextLeg.from.id && previousLeg.to.id === nextLeg.from.id) return true;
  const dx = shortestLonDelta(Number(nextLeg.from.lon) - Number(previousLeg.to.lon));
  const dy = Number(nextLeg.from.lat) - Number(previousLeg.to.lat);
  return Math.hypot(dx, dy) <= tolerance;
}

function freezeActiveEntryGeometry(entry, routedGeometries = {}, playbackPlan = null) {
  if (!entry?.leg) return entry;
  return measurePlaybackEvent('freezeActiveEntryGeometry', () => {
    // Keep the validated geometry's stable reference. v7.1.3 copied tens of
    // thousands of coordinate pairs here, invalidating WeakMap route caches and
    // forcing simplification to run again on the main thread as playback began.
    const frozenGeometry = getRoutedGeometry(entry.leg, routedGeometries);
    if (!Array.isArray(frozenGeometry) || frozenGeometry.length < 2) return entry;
    const presentationGeometry = isSurfaceRouteMode(entry.leg.mode)
      ? anchorRouteGeometryToEndpoints(buildSurfacePresentationGeometry(frozenGeometry, entry.leg.mode, { profile: 'playback' }), entry.leg)
      : null;
    return {
      ...entry,
      leg: {
        ...entry.leg,
        routeGeometry: frozenGeometry,
        ...(presentationGeometry?.length > 1 ? { presentationGeometry } : {})
      }
    };
  });
}

function adaptiveCameraSmoothing(phase, quality = 'high') {
  const qualityScale = quality === 'high' ? 1 : quality === 'medium' ? 0.86 : 0.72;
  const base = phase === 'settle' ? 0.082 : phase === 'predeparture' ? 0.012 : phase === 'arrival' ? 0.034 : phase === 'takeoff' ? 0.028 : 0.028;
  return base * qualityScale;
}

function constrainCameraToVessel(map, camera, vehicle, quality = 'high') {
  if (!map || !camera || !vehicle) return camera;
  const canvas = map.getCanvas?.();
  const width = canvas?.clientWidth || window.innerWidth;
  const height = canvas?.clientHeight || window.innerHeight;
  const point = map.project([vehicle.lon, vehicle.lat]);
  const safeLeft = width * 0.175;
  const safeRight = width * 0.825;
  const safeTop = height * 0.20;
  const safeBottom = height * 0.80;
  const overflowX = point.x < safeLeft ? (safeLeft - point.x) / Math.max(1, safeLeft) : point.x > safeRight ? (point.x - safeRight) / Math.max(1, width - safeRight) : 0;
  const overflowY = point.y < safeTop ? (safeTop - point.y) / Math.max(1, safeTop) : point.y > safeBottom ? (point.y - safeBottom) / Math.max(1, height - safeBottom) : 0;
  const overflow = Math.max(overflowX, overflowY);
  if (overflow <= 0) return camera;
  const strength = Math.min(0.82, 0.28 + overflow * (quality === 'low' ? 0.78 : 0.62));
  return {
    ...camera,
    center: [
      lerpAngle(camera.center[0], vehicle.lon, strength),
      lerp(camera.center[1], vehicle.lat, strength)
    ]
  };
}
function takeoffCruiseLandingEase(t) {
  const u = Math.max(0, Math.min(1, t));
  if (u < 0.18) return 0.5 * Math.pow(u / 0.18, 2.2) * 0.18;
  if (u > 0.82) return 1 - 0.5 * Math.pow((1 - u) / 0.18, 2.2) * 0.18;
  const mid = (u - 0.18) / 0.64;
  return 0.09 + mid * 0.82;
}
function lookAhead(distance, p, mode = 'plane') {
  const isDrive = mode === 'drive';
  const isBoat = mode === 'boat';
  const isTrain = mode === 'train';
  let base;
  // v5.0.5: long trips must keep the vessel visible. Reduce look-ahead heavily,
  // especially for boats/trains, so the camera never runs ahead of the vehicle.
  if (isDrive) base = distance > 700 ? 0.080 : distance > 250 ? 0.070 : 0.055;
  else if (isBoat || isTrain) base = distance > 1800 ? 0.040 : distance > 700 ? 0.055 : 0.065;
  else base = distance > 4500 ? 0.040 : distance > 1500 ? 0.060 : 0.080;
  const endpoint = Math.max(0, 1 - Math.min(p, 1 - p) / 0.18);
  return base * (1 - 0.55 * endpoint);
}

function surfaceTangentWindow(mode, distance, progress) {
  const normalized = String(mode || '').toLowerCase();
  if (normalized === 'drive' || normalized === 'car') {
    return distance > 700 ? 0.0045 : distance > 250 ? 0.0035 : 0.0028;
  }
  if (normalized === 'train') return distance > 1000 ? 0.007 : 0.0055;
  if (normalized === 'boat') return distance > 1200 ? 0.009 : 0.007;
  return Math.max(0.006, Math.min(0.035, lookAhead(distance, progress, normalized) * 0.52));
}

function cameraLeadBias(mode, distance, phase, p) {
  if (phase === 'predeparture') return 0.02;
  if (phase === 'settle') return 0.06;
  if (mode === 'drive') return phase === 'cruise' ? 0.34 : 0.22;
  if (mode === 'boat' || mode === 'train') return phase === 'cruise' ? (distance > 1800 ? 0.18 : 0.26) : 0.16;
  return phase === 'cruise' ? 0.30 : 0.18;
}
function cameraZoom(mode, distance, endpointBias, p, phase, settleT = 0, legMode = 'plane') {
  const isDrive = legMode === 'drive';
  const isBoat = legMode === 'boat';
  const isTrain = legMode === 'train';
  // v2.27: roughly 60% closer than v2.26. Additive zoom is the correct control
  // for map scale; +0.68 is about 1.6x closer, with drive/boat/train getting a
  // little extra to regain the localized, screensaver-style cinematic feel.
  const modeBoost = isDrive ? 0.74 : (isBoat || isTrain) ? 0.92 : 0.82;

  if (mode === 'global') return (distance > 3500 ? 1.9 : 2.75) + 0.35;
  if (mode === 'continent') return (distance > 3500 ? 2.65 : 4.0) + 0.55;
  if (mode === 'route') return (distance > 4500 ? 3.05 : distance > 1500 ? 4.0 : isDrive ? 6.2 : 5.2) + modeBoost;

  if (phase === 'predeparture') {
    if (isDrive) return (distance > 500 ? 7.25 : 7.75) + modeBoost;
    if (isBoat || isTrain) return (distance > 500 ? 5.85 : 6.55) + modeBoost;
    return (distance > 4500 ? 4.45 : distance > 1500 ? 5.25 : distance > 500 ? 6.15 : 6.85) + modeBoost;
  }

  let cruise;
  let close;
  if (isDrive) {
    // v3.17: pull back slightly for car follow mode so the vehicle stays on-screen
    // instead of the camera feeling like it is chasing from too close.
    cruise = distance > 700 ? 6.55 : distance > 250 ? 6.95 : 7.25;
    close = distance > 700 ? 7.55 : distance > 250 ? 7.88 : 8.12;
  } else if (isBoat || isTrain) {
    cruise = distance > 3500 ? 4.08 : distance > 1500 ? 4.32 : distance > 500 ? 5.22 : 6.10;
    close = distance > 3500 ? 4.58 : distance > 1500 ? 4.98 : distance > 500 ? 6.25 : 7.05;
  } else {
    cruise = distance > 4500 ? 4.03 : distance > 1500 ? 4.42 : distance > 500 ? 5.38 : 6.40;
    close = distance > 4500 ? 4.72 : distance > 1500 ? 5.42 : distance > 500 ? 6.70 : 7.50;
  }

  const takeoffPop = p < 0.14 ? smoothstep(1 - p / 0.14) * 0.06 : 0;
  const landingPop = p > 0.84 ? smoothstep((p - 0.84) / 0.16) * 0.36 : 0;
  const settleLocalPush = phase === 'settle' ? 0.34 : 0;
  const countyArrivalPush = phase === 'settle'
    ? 0.52
    : p > 0.78 ? 0.52 * smoothstep((p - 0.78) / 0.22) : 0;

  if (mode === 'follow') {
    // Follow playback owns a stable route-scale zoom. Earlier versions blended
    // from the close endpoint zoom down to cruise on every leg; that legitimate
    // formula looked like a competing controller repeatedly pulling the camera
    // out. Keep a single baseline for the leg and permit only additive arrival
    // emphasis, never a mid-leg zoom-out.
    const stableFollow = cruise + modeBoost + Math.min(0.46, Math.max(0.18, (close - cruise) * 0.34));
    return stableFollow + landingPop + settleLocalPush + countyArrivalPush;
  }
  return cruise + modeBoost + (close - cruise) * smoothstep(endpointBias) + takeoffPop + landingPop + settleLocalPush + countyArrivalPush;
}
function cameraPitch(mode, phase, distance, settleT = 0) {
  if (mode === 'global') return 0;
  if (phase === 'predeparture') return distance > 1500 ? 50 : 56;
  if (phase === 'settle') return (distance > 1500 ? 50 : 56) - 3 * smoothstep(settleT);
  if (phase === 'takeoff' || phase === 'arrival') return distance > 1500 ? 52 : 58;
  return mode === 'follow' ? 58 : 42;
}
function cameraBearing() { return 0; }
function headingToScreenRotation(heading, mapBearing) { return ((heading - mapBearing + 540) % 360) - 180; }
function vehicleScale(mode, phase, endpointBias, progress) {
  const isPlane = mode === 'plane' || mode === 'move';
  const base = isPlane ? 0.76 : 0.66;
  const cinematic = base + (phase === 'cruise' ? 0.08 : 0.16) * smoothstep(endpointBias);
  const p = clamp(Number(progress) || 0, 0, 1);
  const takeoffGrow = isPlane
    ? lerp(0.72, 1, smoothstep(clamp(p / 0.085, 0, 1)))
    : smoothstep(clamp(p / 0.11, 0, 1));
  // Aircraft remain readable through touchdown. Visibility switches off during
  // settle, so shrinking toward zero before the city only made the plane vanish.
  const landingScale = isPlane
    ? lerp(1, 0.78, smoothstep(clamp((p - 0.92) / 0.08, 0, 1)))
    : lerp(1, 0.72, smoothstep(clamp((p - 0.955) / 0.045, 0, 1)));
  return cinematic * takeoffGrow * landingScale;
}
function vehiclePitchDeg(mode, phase, progress) {
  if (!(mode === 'plane' || mode === 'move')) return 0;
  const p = clamp(Number(progress) || 0, 0, 1);
  const takeoffWindow = 1 - smoothstep(clamp(p / 0.25, 0, 1));
  const landingWindow = smoothstep(clamp((p - 0.70) / 0.30, 0, 1));
  return Math.round((landingWindow * 76 - takeoffWindow * 56) * 10) / 10;
}

function lineProgressBehindVehicle(mode, distance, routeProgress, rawP) {
  // v4.27: with cinematic route timing, only a tiny forward overlap is needed.
  // Keep the line visually tucked under the vessel without drawing noticeably
  // ahead of the nose/body.
  const isAir = mode === 'plane' || mode === 'move';
  const isSurface = mode === 'drive' || mode === 'car' || mode === 'boat' || mode === 'train';
  const overlap =
    isAir ? (distance > 3000 ? 0.0015 : distance > 900 ? 0.0025 : 0.0040) :
    isSurface ? (distance > 900 ? 0.0015 : distance > 250 ? 0.0025 : 0.0040) :
    0.002;

  const ramp = smoothstep(Math.max(0, Math.min(1, rawP / 0.055)));
  return Math.max(0, Math.min(1, routeProgress + overlap * ramp));
}
function bearingBetween(a, b) {
  const toRad = d => d * Math.PI / 180;
  const toDeg = r => r * 180 / Math.PI;
  const lat1 = toRad(a.lat), lat2 = toRad(b.lat), dLon = toRad(shortestLonDelta(b.lon - a.lon));
  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}
function dashForMode(mode) {
  if (mode === 'drive') return [1.4, 1.4];
  if (mode === 'boat') return [0.8, 2.2];
  if (mode === 'train') return [2.5, 1.2];
  return [1, 0];
}

function vehicleSvg(mode) {
  if (mode === 'drive' || mode === 'car') return '<svg viewBox="-24 -24 48 48" aria-hidden="true"><path d="M-18 3 L-14 -8 L-6 -13 L8 -13 L16 -7 L20 3 L17 10 L-17 10 Z"/><circle cx="-9" cy="10" r="4"/><circle cx="10" cy="10" r="4"/></svg>';
  if (mode === 'boat') return '<svg viewBox="-24 -24 48 48" aria-hidden="true"><path d="M-18 6 C-10 16 10 16 18 6 Z"/><path d="M-1 6 L-1 -18 L14 3 Z"/><path d="M-4 6 L-4 -14 L-15 4 Z"/></svg>';
  if (mode === 'train') return '<svg viewBox="-24 -24 48 48" aria-hidden="true"><rect x="-12" y="-18" width="24" height="34" rx="6"/><path d="M-7 -10 H7 M-7 0 H7"/><circle cx="-6" cy="18" r="3"/><circle cx="6" cy="18" r="3"/></svg>';
  return '<svg viewBox="-24 -24 48 48" aria-hidden="true"><path d="M0 -22 L6 -4 L23 3 L23 9 L5 6 L2 18 L8 22 L8 25 L0 21 L-8 25 L-8 22 L-2 18 L-5 6 L-23 9 L-23 3 L-6 -4 Z"/></svg>';
}

const US_STATE_ABBR = {
  Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA', Colorado: 'CO', Connecticut: 'CT', Delaware: 'DE', Florida: 'FL', Georgia: 'GA', Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL', Indiana: 'IN', Iowa: 'IA', Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA', Maine: 'ME', Maryland: 'MD', Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN', Mississippi: 'MS', Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH', Oklahoma: 'OK', Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC', 'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT', Virginia: 'VA', Washington: 'WA', 'Washington DC': 'DC', 'District of Columbia': 'DC', 'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY'
};
function displayNameForLocation(loc) {
  if (!loc) return '';
  const region = loc.region || '';
  if (loc.country === 'United States' && region) {
    return `${loc.name}, ${US_STATE_ABBR[region] || region}`;
  }
  return loc.name;
}

function escapeHtml(value) { return String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); }
function smoothstep(x) { const u = Math.max(0, Math.min(1, x)); return u * u * (3 - 2 * u); }
function lerp(a, b, t) { return a + (b - a) * t; }
function roundTo(value, step = 1) { return Math.round(value / step) * step; }
function lerpAngle(a, b, t) { let d = ((b - a + 540) % 360) - 180; return a + d * t; }
