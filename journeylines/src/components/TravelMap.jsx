import { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { geoInterpolate } from 'd3-geo';
import LegacySvgMap from './LegacySvgMap.jsx';
import { flattenLegs, getTravelerKey } from '../utils/tripExpansion.js';
import { milesBetween } from '../utils/distanceUtils.js';
import routeOverrides from '../data/routeOverrides.json';
import routingSettings from '../data/routingSettings.json';
import generatedRoutes from '../data/generatedRoutes.json';

const VESSEL_ICON_MODULES = import.meta.glob('../Icons/**/*.png', { eager: true, query: '?url', import: 'default' });
const VESSEL_ICON_INDEX = buildVesselIconIndex(VESSEL_ICON_MODULES);

const INTRO_GLOBE_CENTER = [-100, 37];
const INTRO_GLOBE_ZOOM = 2.55;

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

function MapLibreGlobe({ trips, locations, homeBases, travelers, activeIndex, legProgress, cameraMode, showTrails, trailOpacity = 0.28, trailWidth = 1.55, isPlaying = false, isStarted = false, introLaunching = false, onIntroLaunchComplete = () => {}, resetNonce = 0, onMapClick = () => {} }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const vehicleRef = useRef(null);
  const airArcRef = useRef(null);
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
  const tilePreloadRef = useRef(new Set());
  const lastActiveRouteUpdateRef = useRef(0);
  const labelRefreshThrottleRef = useRef({ t: 0, camera: null });
  const introLaunchRef = useRef({ active: false, key: null });
  const resetAnimatingRef = useRef(false);
  const [mapReady, setMapReady] = useState(false);
  const [routedGeometries, setRoutedGeometries] = useState(() => loadInitialRouteCache());

  const locById = useMemo(() => Object.fromEntries(locations.map(l => [l.id, l])), [locations]);
  const travById = useMemo(() => Object.fromEntries(travelers.map(t => [t.id, t])), [travelers]);
  const legs = useMemo(() => flattenLegs(trips, locById, homeBases), [trips, locById, homeBases]);

  const completedMode = activeIndex >= legs.length;
  const safeActiveIndex = Math.min(activeIndex, Math.max(0, legs.length - 1));
  const active = legs[safeActiveIndex];
  const nextActive = !completedMode ? legs[Math.min(activeIndex + 1, Math.max(0, legs.length - 1))] : null;
  const scene = active && !completedMode ? getScene(active, legProgress, cameraMode, nextActive, routedGeometries) : null;
  const completedLegs = useMemo(() => completedMode ? legs : legs.slice(0, Math.max(0, activeIndex)), [completedMode, legs, activeIndex]);
  const visibleLegs = useMemo(() => completedMode ? legs : legs.slice(0, Math.max(0, activeIndex + 1)), [completedMode, legs, activeIndex]);

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
      maxTileCacheSize: 3000,
      refreshExpiredTiles: false,
      prefetchZoomDelta: 5
    });

    mapRef.current = map;
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');

    map.on('load', () => {
      try { map.setProjection({ type: 'globe' }); } catch {}
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
      syncCompletedRoutes(map, completedLegs, travById, showTrails, trailOpacity, trailWidth, routedGeometries);
      const visited = buildVisitedLocations(completedLegs, active, completedMode, scene, travById, homeBases);
      syncVisitedPoints(map, visited, lastVisitedSigRef);
      updatePersistentLabels(map, visited, persistentLabelElsRef, visitedLabelsRef, colorForLeg(active, travById), null, droppedPinIdsRef);
      setMapReady(true);
    });

    return () => {
      clearTimeout(arrivalTimerRef.current);
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
      resetAnimatingRef.current = true;
      lastCameraRef.current = null;
      map.stop();
      map.easeTo({ center: INTRO_GLOBE_CENTER, zoom: INTRO_GLOBE_ZOOM, pitch: 0, bearing: 0, duration: 1850, essential: true, easing: t => 1 - Math.pow(1 - t, 3) });
      window.setTimeout(() => { resetAnimatingRef.current = false; }, 1925);
    } catch { resetAnimatingRef.current = false; }
  }, [resetNonce, mapReady]);

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
    if (isPlaying || introLaunching || isStarted) return;
    let raf;
    let last;
    const spin = (ts) => {
      if (last == null) last = ts;
      const dt = Math.min(48, ts - last);
      last = ts;
      try {
        if (!resetAnimatingRef.current) {
          const c = map.getCenter();
          map.setCenter([c.lng + dt * 0.0014, c.lat]);
        }
      } catch {}
      raf = requestAnimationFrame(spin);
    };
    raf = requestAnimationFrame(spin);
    return () => cancelAnimationFrame(raf);
  }, [mapReady, isPlaying, introLaunching, isStarted]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const refresh = () => {
      const state = currentOverlayStateRef.current;
      if (!state) return;
      updateOverlay(map, state.active, state.scene, state.color);
      updateAirArcOverlay(map, airArcRef.current, state.active, state.scene, state.color);
      const destPt = state.active?.leg?.to ? map.project([state.active.leg.to.lon, state.active.leg.to.lat]) : null;
      if (destPt) updatePulseOverlay(pulseRef.current, destPt, state.color, state.scene?.pulseActive);
      throttledRefreshPersistentPinPositions(map, persistentLabelElsRef, labelRefreshThrottleRef);
    };
    map.on('move', refresh);
    map.on('render', refresh);
    return () => {
      map.off('move', refresh);
      map.off('render', refresh);
    };
  }, [mapReady]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    // v2.13: revert drag-while-playing. During playback the cinematic camera owns the globe.
    // Manual panning/zooming is available only while paused/reset.
    const methods = [map.dragPan, map.scrollZoom, map.boxZoom, map.keyboard, map.doubleClickZoom, map.touchZoomRotate];
    for (const method of methods) {
      try { isPlaying ? method.disable() : method.enable(); } catch {}
    }
    try { map.dragRotate.disable(); } catch {}
    try { map.touchZoomRotate.disableRotation(); } catch {}
    try { map.setBearing(0); } catch {}
    if (isPlaying) userCameraOverrideRef.current = false;
  }, [isPlaying]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    // Completed route history is static map data. Only rebuild it when a leg
    // completes, route cache changes, or display settings change. Avoid doing
    // this in the per-frame playback loop.
    syncCompletedRoutes(map, completedLegs, travById, showTrails, trailOpacity, trailWidth, routedGeometries);
  }, [mapReady, completedLegs, travById, showTrails, trailOpacity, trailWidth, routedGeometries]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    // Visited points and labels change only when the timeline reaches a new
    // destination, not on every animation frame.
    const visited = buildVisitedLocations(completedLegs, active, completedMode, scene, travById, homeBases);
    syncVisitedPoints(map, visited, lastVisitedSigRef);
    updatePersistentLabels(map, visited, persistentLabelElsRef, visitedLabelsRef, colorForLeg(active, travById), scene?.newArrivalId || null, droppedPinIdsRef);
  }, [mapReady, completedLegs, activeIndex, active?.trip?.id, active?.legIndex, completedMode, scene?.newArrivalId, travById]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;

    if (!scene || !active) {
      syncActiveRoute(map, null);
      syncPulse(map, null, 'transparent');
      currentOverlayStateRef.current = null;
      setOverlayVisibility(false);
      if (completedMode) {
        map.easeTo({ center: INTRO_GLOBE_CENTER, zoom: INTRO_GLOBE_ZOOM, bearing: 0, pitch: 0, duration: 900, essential: true });
      }
      return;
    }

    const color = colorForLeg(active, travById);

    if (introLaunching) {
      const launchKey = `${active.trip.id}:${active.legIndex}`;
      if (introLaunchRef.current.key !== launchKey || !introLaunchRef.current.active) {
        introLaunchRef.current = { active: true, key: launchKey };
        syncActiveRoute(map, null);
        syncPulse(map, null, 'transparent');
        currentOverlayStateRef.current = null;
        setOverlayVisibility(false);
        lastCameraRef.current = null;
        map.stop();
        map.easeTo({ ...scene.camera, duration: 2400, essential: true, easing: t => 1 - Math.pow(1 - t, 3) });
        window.clearTimeout(introLaunchRef.current.timer);
        introLaunchRef.current.timer = window.setTimeout(() => {
          lastCameraRef.current = scene.camera;
          introLaunchRef.current.active = false;
          onIntroLaunchComplete?.();
        }, 2450);
      }
      return;
    } else if (introLaunchRef.current.active) {
      window.clearTimeout(introLaunchRef.current.timer);
      introLaunchRef.current.active = false;
    }

    const now = performance.now();
    if (now - lastActiveRouteUpdateRef.current > 45 || scene.lineProgress >= 0.995) {
      syncActiveRoute(map, active, scene.lineProgress, color, routedGeometries);
      lastActiveRouteUpdateRef.current = now;
    }
    syncPulse(map, active.leg.to, scene.pulseActive ? color : 'transparent');

    // v2.26: glide faster toward the route lead point. The old smoothing was so
    // conservative that the camera could fall behind the vessel and then catch
    // up in visible steps. These values still ease, but keep the camera ahead.
    const smoothing = scene.phase === 'settle' ? 0.018 : scene.phase === 'predeparture' ? 0.014 : scene.phase === 'takeoff' ? 0.030 : scene.phase === 'arrival' ? 0.033 : 0.028;
    const camera = smoothCamera(lastCameraRef.current, scene.camera, smoothing);
    lastCameraRef.current = camera;
    if (!userCameraOverrideRef.current) {
      map.jumpTo({ ...camera, essential: true });
    }

    currentOverlayStateRef.current = { active, scene, color };
    updateOverlay(map, active, scene, color);
    updateAirArcOverlay(map, airArcRef.current, active, scene, color);
  }, [mapReady, scene?.frameKey, active, completedMode, completedLegs, travById, routedGeometries, introLaunching, onIntroLaunchComplete]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !active || completedMode || !scene?.pulseActive) return;
    const color = colorForLeg(active, travById);
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

  useEffect(() => {
    if (!routingSettings?.mapbox?.enabled) return;
    const token = getMapboxToken();
    if (!token) { console.info('JourneyLines: browser-side Mapbox fetch disabled. Driving routes should come from generatedRoutes.json created privately during GitHub Actions. Missing routes will use manual/simple fallback geometry.'); return; }
    const candidates = legs.filter(l => l?.leg?.mode === 'drive' && !routedGeometries[routeCacheKey(l.leg)]);
    if (!candidates.length) return;
    console.info(`JourneyLines: fetching ${candidates.length} Mapbox driving route(s) with cache ${routeCacheVersion()}.`);
    let cancelled = false;
    async function fetchOne(item) {
      const key = routeCacheKey(item.leg);
      if (cancelled || routeRequestsRef.current.has(key)) return;
      routeRequestsRef.current.add(key);
      try {
        const coords = await fetchMapboxRoute(item.leg, token);
        if (!cancelled && coords?.length > 1) {
          setRoutedGeometries(prev => {
            const next = { ...prev, [key]: coords };
            persistRouteCache(next);
            return next;
          });
          console.info('JourneyLines: Mapbox route cached', key, coords.length, 'points');
        }
      } catch (err) {
        console.warn('JourneyLines Mapbox route fetch failed', key, err);
      }
    }
    async function runQueue() {
      const max = routingSettings?.mapbox?.maxRoutesPerSession || 120;
      const queue = candidates.slice(0, max);
      const concurrency = Math.max(1, Math.min(5, routingSettings?.mapbox?.concurrency || 4));
      let cursor = 0;
      await Promise.all(Array.from({ length: concurrency }, async () => {
        while (!cancelled && cursor < queue.length) {
          const item = queue[cursor++];
          await fetchOne(item);
        }
      }));
    }
    runQueue();
    return () => { cancelled = true; };
  }, [legs, routedGeometries]);

  function setOverlayVisibility(visible) {
    for (const ref of [vehicleRef, pulseRef, airArcRef]) {
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
    const rotation = projectedScreenHeading(map, leg, sceneState.routeProgress, sceneState.routedGeometries);
    const iconUrl = vesselIconUrl(iconMode, color);
    const nextMarkup = iconUrl ? `<img class="jl-vehicle-img" src="${escapeHtml(iconUrl)}" alt="" draggable="false" />` : vehicleSvg(iconMode);
    if (vehicleRef.current.__jlVehicleMarkup !== nextMarkup) {
      vehicleRef.current.innerHTML = nextMarkup;
      vehicleRef.current.__jlVehicleMarkup = nextMarkup;
    }
    vehicleRef.current.dataset.mode = iconMode;
    vehicleRef.current.dataset.iconColor = colorToIconName(color) || 'Blue';
    vehicleRef.current.style.setProperty('--vehicle-color', color);
    vehicleRef.current.style.transform = `translate3d(${vehiclePt.x}px, ${vehiclePt.y}px, 0) translate(-50%, -50%) rotate(${rotation}deg) perspective(260px) rotateX(${sceneState.vehiclePitchDeg || 0}deg) scale(${sceneState.vehicleScale})`;
    vehicleRef.current.style.opacity = sceneState.vehicleVisible && isCoordinateVisibleOnGlobe(map, sceneState.vehicle.lon, sceneState.vehicle.lat) ? '1' : '0';

    const destPt = map.project([leg.to.lon, leg.to.lat]);
    updatePulseOverlay(pulseRef.current, destPt, color, sceneState.pulseActive);
  }

  return <div className="maplibre-shell terrain-mode space-mode" onPointerDown={(e) => { if (e.target?.closest?.('.maplibre-shell')) onMapClick?.(); }}>
    <div className="jl-space-field" aria-hidden="true"><span className="star-layer star-layer-a" /><span className="star-layer star-layer-b" /><span className="star-layer star-layer-c" /></div>
    <div className="maplibre-map" ref={containerRef} />
    <div className="cinema-vignette" />
    <div className="map-overlay" ref={overlayRef}>
      <svg className="jl-air-arc-overlay" aria-hidden="true"><path ref={airArcRef} /></svg>
      <div className="jl-vehicle-overlay" ref={vehicleRef} />
      <div className="jl-visited-labels-overlay" ref={visitedLabelsRef} />
      <div className="jl-arrival-ripple" ref={pulseRef} />
    </div>
  </div>;
}

function addRouteSourcesAndLayers(map) {
  if (!map.getSource('completed-routes')) {
    map.addSource('completed-routes', { type: 'geojson', data: emptyCollection() });
    map.addLayer({ id: 'completed-routes-glow-wide', type: 'line', source: 'completed-routes', paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'outerGlowWidth'], 'line-opacity': ['get', 'outerGlowOpacity'], 'line-blur': 18 } });
    map.addLayer({ id: 'completed-routes-glow', type: 'line', source: 'completed-routes', paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'glowWidth'], 'line-opacity': ['get', 'glowOpacity'], 'line-blur': 8.5 } });
    map.addLayer({ id: 'completed-routes', type: 'line', source: 'completed-routes', paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'width'], 'line-opacity': ['get', 'opacity'] } });
  }
  if (!map.getSource('active-route')) {
    map.addSource('active-route', { type: 'geojson', data: emptyCollection() });
    map.addLayer({ id: 'active-route-glow-wide', type: 'line', source: 'active-route', paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'outerGlowWidth'], 'line-opacity': ['get', 'outerGlowOpacity'], 'line-blur': 18 } });
    map.addLayer({ id: 'active-route-glow', type: 'line', source: 'active-route', paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'glowWidth'], 'line-opacity': ['get', 'glowOpacity'], 'line-blur': 10 } });
    map.addLayer({ id: 'active-route', type: 'line', source: 'active-route', paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'width'], 'line-opacity': ['get', 'opacity'] } });
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
  map.addLayer({ id: 'arrival-pulse', type: 'circle', source: 'arrival-pulse', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 0, 10, 6, 24], 'circle-color': ['get', 'color'], 'circle-opacity': 0.28, 'circle-blur': 0.55 } });
}

function syncCompletedRoutes(map, completedLegs, travelersById, showTrails, opacity, width, routedGeometries = {}) {
  const features = showTrails ? completedLegs.map((l, i) => {
    const color = colorForLeg(l, travelersById);
    return routeFeature(l.leg, color, l.trip.id, i, Math.max(0.9, opacity), width, false, 1, routedGeometries);
  }) : [];
  map.getSource('completed-routes')?.setData({ type: 'FeatureCollection', features });

}

function syncActiveRoute(map, active, progress = 1, color = '#00e5ff', routedGeometries = {}) {
  if (!active) { map.getSource('active-route')?.setData(emptyCollection()); return; }
  const feature = routeFeature(active.leg, color, active.trip.id, active.legIndex, 1, 2, true, progress, routedGeometries);
  map.getSource('active-route')?.setData({ type: 'FeatureCollection', features: [feature] });

}

function syncPulse(map, loc, color) {
  if (!loc || color === 'transparent') { map.getSource('arrival-pulse')?.setData(emptyCollection()); return; }
  map.getSource('arrival-pulse')?.setData({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { color }, geometry: { type: 'Point', coordinates: [loc.lon, loc.lat] } }] });
}

function routeFeature(leg, color, tripId, index, opacity, width, active = false, progress = 1, routedGeometries = {}) {
  const isAir = leg.mode === 'plane' || leg.mode === 'move';
  const mainOpacity = active && isAir ? 0.52 : active ? 1 : Math.max(0.86, opacity);
  const mainWidth = active ? (isAir ? 2.6 : 4.25) : Math.max(width, 2.15);
  return {
    type: 'Feature',
    properties: {
      tripId,
      index,
      color,
      mode: leg.mode,
      width: mainWidth,
      opacity: mainOpacity,
      glowWidth: active ? (isAir ? 12.0 : 12.5) : Math.max(width * 5.2, 8.8),
      glowOpacity: active ? (isAir ? 0.56 : 0.62) : Math.min(0.62, Math.max(0.42, opacity * 0.68)),
      outerGlowWidth: active ? (isAir ? 24 : 26) : Math.max(width * 9.0, 16),
      outerGlowOpacity: active ? (isAir ? 0.20 : 0.24) : 0.14,
      dash: dashForMode(leg.mode)
    },
    geometry: { type: 'LineString', coordinates: routeCoordinates(leg, progress, active ? 96 : 22, routedGeometries) }
  };
}

function getScene(active, rawProgress, cameraMode, nextActive, routedGeometries = {}) {
  const raw = Math.max(0, rawProgress);
  const visibleP = Math.max(0, Math.min(1, raw));
  const departureWarmup = 0.085;
  const p = Math.max(0, Math.min(1, (visibleP - departureWarmup) / (1 - departureWarmup)));
  const warmupT = Math.max(0, Math.min(1, visibleP / departureWarmup));
  const settleT = Math.max(0, Math.min(1, (raw - 1) / 0.28));
  const leg = active.leg;
  const distance = milesBetween(leg.from, leg.to);
  const routeProgress = takeoffCruiseLandingEase(p);
  const lineProgress = lineProgressBehindVehicle(leg.mode, distance, routeProgress, p);
  const vehicle = pointAtRouteProgress(leg, routeProgress, routedGeometries);
  const future = pointAtRouteProgress(leg, Math.min(1, routeProgress + lookAhead(distance, p, leg.mode)), routedGeometries);
  const routeMid = pointAtRouteProgress(leg, 0.5, routedGeometries);
  const phase = raw > 1 ? 'settle' : visibleP < departureWarmup ? 'predeparture' : p < 0.18 ? 'takeoff' : p > 0.82 ? 'arrival' : 'cruise';
  const endpointBias = Math.max(0, 1 - Math.min(p, 1 - p) / 0.22);
  const leadBias = cameraLeadBias(leg.mode, distance, phase, p);
  let cinematicFocus = blendGeo(vehicle, future, leadBias);

  if (phase === 'settle') {
    const nextFrom = nextActive?.leg?.from;
    const driftRadius = distance > 1500 ? 0.55 : distance > 450 ? 0.28 : 0.12;
    const quietDrift = {
      lon: leg.to.lon + Math.sin(settleT * Math.PI * 1.15) * driftRadius,
      lat: leg.to.lat + Math.sin(settleT * Math.PI * 0.72) * driftRadius * 0.55
    };
    cinematicFocus = nextFrom && nextFrom.id !== leg.to.id
      ? blendGeo(quietDrift, nextFrom, 0.16 * smoothstep(settleT))
      : quietDrift;
  }

  if (phase === 'predeparture') {
    const smallOrbit = { lon: leg.from.lon + Math.sin(warmupT * Math.PI * 0.8) * 0.08, lat: leg.from.lat + Math.cos(warmupT * Math.PI * 0.7) * 0.045 };
    cinematicFocus = blendGeo(smallOrbit, leg.to, 0.035 * smoothstep(warmupT));
  }

  let center = cinematicFocus;
  if (cameraMode === 'global') center = blendGeo(routeMid, cinematicFocus, 0.2);
  if (cameraMode === 'route') center = blendGeo(routeMid, cinematicFocus, 0.52);
  if (cameraMode === 'continent') center = blendGeo(routeMid, cinematicFocus, 0.4);

  const heading = headingAlongRoute(leg, routeProgress, routedGeometries);
  const bearing = 0; // North-up. No route-heading camera rotation.
  const zoom = cameraZoom(cameraMode, distance, endpointBias, p, phase, settleT, leg.mode);
  const pitch = cameraPitch(cameraMode, phase, distance, settleT);
  const arrived = routeProgress >= 0.995 || phase === 'settle';

  return {
    phase,
    routeProgress,
    lineProgress,
    vehicle,
    heading,
    screenHeading: headingToScreenRotation(heading, bearing),
    vehicleScale: vehicleScale(leg.mode, phase, endpointBias, p),
    vehiclePitchDeg: vehiclePitchDeg(leg.mode, phase, p),
    vehicleVisible: raw <= 1 && phase !== 'predeparture' && p > 0.006 && p < 0.994,
    pulseActive: arrived,
    arrivalLabelVisible: arrived,
    newArrivalId: arrived ? leg.to.id : null,
    camera: { center: [center.lon, center.lat], zoom, pitch, bearing },
    routedGeometries,
    frameKey: `${active.trip.id}:${active.legIndex}:${Math.round(raw * 1000)}:${cameraMode}`
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
    pathEl.style.opacity = '0';
    pathEl.setAttribute('d', '');
    return;
  }
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
  if (dist < 8) { pathEl.style.opacity = '0'; pathEl.setAttribute('d', ''); return; }
  const lift = Math.min(560, Math.max(86, dist * 0.58));
  const cx = (fromPt.x + tail.x) / 2 - dy / dist * lift;
  const cy = (fromPt.y + tail.y) / 2 + dx / dist * lift - lift * 0.98;
  pathEl.setAttribute('d', `M ${fromPt.x.toFixed(1)} ${fromPt.y.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${tail.x.toFixed(1)} ${tail.y.toFixed(1)}`);
  pathEl.style.setProperty('--air-arc-color', color);
  pathEl.style.opacity = String(Math.min(1, 0.25 + sceneState.lineProgress * 1.1));
}

function colorForLeg(active, travelersById) {
  if (active?.trip?.isHomeMove || active?.leg?.mode === 'move') return '#050607';
  return travelersById[getTravelerKey(active.trip)]?.color || '#00e5ff';
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
    const visits = options.homeSeed ? [] : [{ color: seedColor, tripId: legWrapper?.trip?.id || 'seed', legIndex: -1, mode: legWrapper?.leg?.mode || 'seed' }];
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
    const isNew = Boolean(loc.isNew && loc.id === newArrivalId && !loc.isActiveHomeBase && !droppedIdsRef.current.has(loc.id));

    if (!el) {
      el = document.createElement('div');
      el.className = 'jl-map-pin';
      el.dataset.locationId = loc.id;
      // Use MapLibre's marker transform for the outer wrapper. This anchors the
      // placard to the globe on the same render path as the map and removes the
      // projection-vs-camera wobble caused by manually setting translate3d().
      el.__jlMarker = new maplibregl.Marker({ element: el, anchor: 'bottom', offset: [0, -18], occludedOpacity: 0 })
        .setLngLat([loc.lon, loc.lat])
        .addTo(map);
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
    // Keep home-base placards visually above nearby destination pins. This is
    // important for clustered places such as San Diego / Rosarito.
    el.style.zIndex = loc.isHomeBase ? (loc.isActiveHomeBase ? '1950' : '1900') : '1800';
    el.__jlLocation = loc;

    let inner = el.querySelector('.jl-map-pin-inner');
    const displayName = displayNameForLocation(loc);
    if (!inner) {
      el.innerHTML = `<span class="jl-map-pin-inner"><span class="jl-map-pin-dot"></span><span class="jl-map-pin-text"><span class="jl-map-pin-name"></span><span class="jl-map-pin-ticks"></span></span><span class="jl-map-pin-tail"></span></span>`;
      inner = el.querySelector('.jl-map-pin-inner');
    } else if (!el.querySelector('.jl-map-pin-ticks')) {
      // Upgrade older live DOM nodes to the v2.30 visit-tick structure without
      // recreating the outer MapLibre marker. This avoids placard wobble/reset.
      const nameText = el.querySelector('.jl-map-pin-name')?.textContent || displayName;
      inner.innerHTML = `<span class="jl-map-pin-dot"></span><span class="jl-map-pin-text"><span class="jl-map-pin-name"></span><span class="jl-map-pin-ticks"></span></span><span class="jl-map-pin-tail"></span>`;
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
  refreshPersistentPinPositions(map, labelsRef);
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

function throttledRefreshPersistentPinPositions(map, labelsRef, throttleRef) {
  const now = performance.now();
  // Marker positions are now owned by MapLibre. We only update opacity/culling,
  // so this can run at a moderate cadence without causing placard wobble.
  if (throttleRef?.current?.t && now - throttleRef.current.t < 80) return;
  if (throttleRef) throttleRef.current = { t: now, camera: null };
  refreshPersistentPinPositions(map, labelsRef);
}

function refreshPersistentPinPositions(map, labelsRef) {
  if (!map || !labelsRef?.current) return;
  const canvas = map.getCanvas();
  const w = canvas?.clientWidth || window.innerWidth;
  const h = canvas?.clientHeight || window.innerHeight;
  const zoom = map.getZoom?.() || 1.5;

  for (const el of labelsRef.current.values()) {
    const loc = el.__jlLocation;
    if (!loc) continue;
    const pt = map.project([loc.lon, loc.lat]);
    const angularDistance = angularDistanceFromMapCenter(map, loc.lon, loc.lat);
    const milesFromFocus = milesFromMapCenter(map, loc.lon, loc.lat);
    const onScreen = pt.x > -130 && pt.x < w + 130 && pt.y > -130 && pt.y < h + 130;

    // v2.35: two independent culling guards:
    // 1) hard horizon guard so placards do not dim/reappear on the back side
    //    of the globe, and
    // 2) maximum distance guard so places on the far side of the visible
    //    hemisphere, such as Tokyo/Seoul/Alaska while focused on Amsterdam, do
    //    not remain visible just because MapLibre can still project them.
    // The distance limits are intentionally relaxed enough to keep regional
    // context like Chicago/Atlanta/Kentucky visible while focused on Florida.
    const horizonCutoff = hardPlacardHorizonCutoffDeg(zoom);
    const maxMiles = maxPlacardDistanceMiles(zoom);
    const wasVisible = el.__jlVisible === true;
    const horizonHysteresis = 1.8;
    const milesHysteresis = 180;
    const frontSide = wasVisible
      ? angularDistance <= horizonCutoff + horizonHysteresis
      : angularDistance <= horizonCutoff - horizonHysteresis;
    const closeEnough = wasVisible
      ? milesFromFocus <= maxMiles + milesHysteresis
      : milesFromFocus <= maxMiles - milesHysteresis;
    const visible = Boolean(onScreen && frontSide && closeEnough);

    el.classList.toggle('is-culled', !visible);
    el.setAttribute('aria-hidden', visible ? 'false' : 'true');
    el.__jlVisible = visible;
    if (visible) {
      el.style.display = '';
      el.style.visibility = 'visible';
      el.style.opacity = '1';
    } else {
      el.style.opacity = '0';
      el.style.visibility = 'hidden';
      el.style.display = 'none';
    }
    el.style.pointerEvents = 'none';
  }
}

function isCoordinateVisibleOnGlobe(map, lon, lat, marginDeg = 74) {
  if (!map || lon == null || lat == null) return false;
  try {
    const center = map.getCenter();
    const distance = angularDistanceDeg({ lon: center.lng, lat: center.lat }, { lon, lat });
    return distance <= marginDeg;
  } catch {
    return true;
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

function angularDistanceFromMapCenter(map, lon, lat) {
  try {
    const center = map.getCenter();
    return angularDistanceDeg({ lon: center.lng, lat: center.lat }, { lon, lat });
  } catch {
    return 0;
  }
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
  if (zoom < 1.7) return 58;
  if (zoom < 2.2) return 62;
  if (zoom < 3.0) return 66;
  if (zoom < 4.2) return 70;
  if (zoom < 5.5) return 74;
  if (zoom < 7.0) return 78;
  return 80;
}

function maxPlacardDistanceMiles(zoom) {
  // Hard distance guard against far-side placards while preserving useful
  // regional context. At closer cinematic zooms, only the current broad region
  // should label; at wide views, allow more of the visible hemisphere.
  if (zoom < 1.7) return 6200;
  if (zoom < 2.2) return 5600;
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
  el.style.transform = `translate3d(${point.x}px, ${point.y}px, 0) translate(-50%, -50%)`;
  el.classList.toggle('is-active', Boolean(active));
  el.style.opacity = active ? '1' : '0';
}

function routeCoordinates(leg, progress = 1, n = 64, routedGeometries = {}) {
  if (leg.mode === 'plane' || leg.mode === 'move') return routeSamples(leg.from, leg.to, progress, Math.max(2, n));
  const routed = getRoutedGeometry(leg, routedGeometries);
  if (routed?.length > 1) return samplePolyline(routed, progress, n);
  const pts = waypointPathForLeg(leg);
  return samplePolyline(pts, progress, n);
}

function pointAtRouteProgress(leg, t, routedGeometries = {}) {
  if (leg.mode === 'plane' || leg.mode === 'move') return interpolateGeo(leg.from, leg.to, t);
  const routed = getRoutedGeometry(leg, routedGeometries);
  const coords = routed?.length > 1 ? routed : waypointPathForLeg(leg);
  const [lon, lat] = pointOnPolyline(coords, t);
  return { lon, lat };
}

function headingAlongRoute(leg, t, routedGeometries = {}) {
  const a = pointAtRouteProgress(leg, Math.max(0, t - 0.008), routedGeometries);
  const b = pointAtRouteProgress(leg, Math.min(1, t + 0.008), routedGeometries);
  return bearingBetween(a, b);
}

function projectedScreenHeading(map, leg, t, routedGeometries = {}) {
  const a = pointAtRouteProgress(leg, Math.max(0, t - 0.01), routedGeometries);
  const b = pointAtRouteProgress(leg, Math.min(1, t + 0.01), routedGeometries);
  const pa = map.project([a.lon, a.lat]);
  const pb = map.project([b.lon, b.lat]);
  return Math.atan2(pb.x - pa.x, -(pb.y - pa.y)) * 180 / Math.PI;
}


function routeCacheVersion() { return routingSettings?.mapbox?.cacheVersion || generatedRoutes?.version || 'v2.16'; }
function routeCacheKey(leg) {
  return `${routeCacheVersion()}:${leg.from.id}->${leg.to.id}:${leg.mode}`;
}

function reverseRouteCacheKey(leg) {
  return `${routeCacheVersion()}:${leg.to.id}->${leg.from.id}:${leg.mode}`;
}

function getRoutedGeometry(leg, routedGeometries = {}) {
  const key = routeCacheKey(leg);
  if (routedGeometries[key]?.length > 1) return routedGeometries[key];
  const reverse = routedGeometries[reverseRouteCacheKey(leg)];
  if (reverse?.length > 1) return [...reverse].reverse();
  const manual = getManualRoute(leg);
  return manual?.length > 1 ? manual : null;
}

function getManualRoute(leg) {
  const routes = routeOverrides?.routes || [];
  const direct = routes.find(r => r.mode === leg.mode && r.fromLocationId === leg.from.id && r.toLocationId === leg.to.id);
  if (direct?.coordinates?.length > 1) return direct.coordinates;
  const reverse = routes.find(r => r.mode === leg.mode && r.fromLocationId === leg.to.id && r.toLocationId === leg.from.id);
  if (reverse?.coordinates?.length > 1) return [...reverse.coordinates].reverse();
  return null;
}

function getMapboxToken() {
  // Published JourneyLines builds do not include the Mapbox token.
  // GitHub Actions uses the repository secret privately to generate src/data/generatedRoutes.json.
  // This browser-side fallback is only for local development or manual debugging.
  return (
    routingSettings?.mapbox?.publicToken ||
    localStorage.getItem('journeylines.mapboxToken') ||
    ''
  ).trim();
}

async function fetchMapboxRoute(leg, token) {
  const profile = routingSettings?.mapbox?.profile || 'mapbox/driving';
  const coords = `${leg.from.lon},${leg.from.lat};${leg.to.lon},${leg.to.lat}`;
  const params = new URLSearchParams({
    alternatives: 'false',
    geometries: routingSettings?.mapbox?.geometries || 'geojson',
    overview: routingSettings?.mapbox?.overview || 'full',
    steps: 'false',
    access_token: token
  });
  const url = `https://api.mapbox.com/directions/v5/${profile}/${coords}?${params.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Mapbox Directions ${res.status}`);
  const data = await res.json();
  const geometry = data?.routes?.[0]?.geometry?.coordinates;
  return Array.isArray(geometry) ? geometry : null;
}

function loadInitialRouteCache() {
  const generated = generatedRoutes?.routes || {};
  let stored = {};
  try { stored = JSON.parse(localStorage.getItem('journeylines.routeCache') || '{}') || {}; } catch {}
  // Build-time generated routes win over older browser cache entries.
  return { ...stored, ...generated };
}

function loadStoredRouteCache() {
  try { return JSON.parse(localStorage.getItem('journeylines.routeCache') || '{}') || {}; } catch { return {}; }
}

function persistRouteCache(cache) {
  if (!routingSettings?.mapbox?.cacheInLocalStorage) return;
  try { localStorage.setItem('journeylines.routeCache', JSON.stringify(cache)); } catch {}
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
  return [a, b];
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
    pointAtRouteProgress(leg, 0.25, routedGeometries),
    pointAtRouteProgress(leg, 0.5, routedGeometries),
    pointAtRouteProgress(leg, 0.75, routedGeometries),
    { lon: leg.to.lon, lat: leg.to.lat }
  ];
  const distance = milesBetween(leg.from, leg.to);
  const zBase = Math.max(2, Math.min(7, Math.round(distance > 4000 ? 3 : distance > 1500 ? 4 : distance > 450 ? 5 : 6)));
  const zooms = [zBase, Math.max(2, zBase - 1), Math.min(8, zBase + 1)];
  for (const pt of routePts) {
    for (const z of zooms) {
      preloadTileNeighborhood(pt.lon, pt.lat, z, cacheSet, label);
    }
  }
}

function preloadTileNeighborhood(lon, lat, z, cacheSet, label = 'leg') {
  const t = lonLatToTile(lon, lat, z);
  if (!t) return;
  const radius = z <= 3 ? 0 : 1;
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

function samplePolyline(coords, progress = 1, n = 64) {
  const maxT = Math.max(0, Math.min(1, progress));
  if (maxT <= 0.001) return [coords[0], coords[0]];
  const steps = Math.max(2, Math.ceil(n * Math.max(0.05, maxT)));
  return Array.from({ length: steps + 1 }, (_, i) => pointOnPolyline(coords, (i / steps) * maxT));
}

function pointOnPolyline(coords, t) {
  if (coords.length < 2) return coords[0] || [0, 0];
  const lengths = [];
  let total = 0;
  for (let i = 1; i < coords.length; i++) {
    const d = Math.hypot(coords[i][0] - coords[i-1][0], coords[i][1] - coords[i-1][1]);
    lengths.push(d);
    total += d;
  }
  if (!total) return coords[0];
  let target = Math.max(0, Math.min(1, t)) * total;
  for (let i = 1; i < coords.length; i++) {
    const seg = lengths[i-1];
    if (target <= seg || i === coords.length - 1) {
      const u = seg ? target / seg : 0;
      return [lerp(coords[i-1][0], coords[i][0], u), lerp(coords[i-1][1], coords[i][1], u)];
    }
    target -= seg;
  }
  return coords[coords.length - 1];
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
function smoothCamera(prev, next, amount) {
  if (!prev) return next;
  return {
    center: [lerpAngle(prev.center[0], next.center[0], amount), lerp(prev.center[1], next.center[1], amount)],
    zoom: lerp(prev.zoom, next.zoom, amount),
    pitch: lerp(prev.pitch, next.pitch, amount),
    bearing: lerpAngle(prev.bearing, next.bearing, amount)
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
  if (isDrive) base = distance > 700 ? 0.22 : distance > 250 ? 0.18 : 0.14;
  else if (isBoat || isTrain) base = distance > 700 ? 0.16 : 0.12;
  else base = distance > 4500 ? 0.070 : distance > 1500 ? 0.105 : 0.14;
  const endpoint = Math.max(0, 1 - Math.min(p, 1 - p) / 0.18);
  return base * (1 - 0.40 * endpoint);
}

function cameraLeadBias(mode, distance, phase, p) {
  if (phase === 'predeparture') return 0.04;
  if (phase === 'settle') return 0.12;
  if (mode === 'drive') return phase === 'cruise' ? 0.90 : 0.72;
  if (mode === 'boat' || mode === 'train') return phase === 'cruise' ? 0.84 : 0.64;
  return phase === 'cruise' ? 0.78 : 0.50;
}
function cameraZoom(mode, distance, endpointBias, p, phase, settleT = 0, legMode = 'plane') {
  const isDrive = legMode === 'drive';
  const isBoat = legMode === 'boat';
  const isTrain = legMode === 'train';
  // v2.27: roughly 60% closer than v2.26. Additive zoom is the correct control
  // for map scale; +0.68 is about 1.6x closer, with drive/boat/train getting a
  // little extra to regain the localized, screensaver-style cinematic feel.
  const modeBoost = isDrive ? 1.08 : (isBoat || isTrain) ? 0.92 : 0.82;

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
    cruise = distance > 700 ? 6.95 : distance > 250 ? 7.38 : 7.75;
    close = distance > 700 ? 8.15 : distance > 250 ? 8.58 : 8.88;
  } else if (isBoat || isTrain) {
    cruise = distance > 1500 ? 4.10 : distance > 500 ? 5.38 : 6.28;
    close = distance > 1500 ? 5.35 : distance > 500 ? 6.52 : 7.32;
  } else {
    cruise = distance > 4500 ? 3.18 : distance > 1500 ? 4.05 : distance > 500 ? 5.30 : 6.40;
    close = distance > 4500 ? 4.95 : distance > 1500 ? 5.82 : distance > 500 ? 6.70 : 7.50;
  }

  const takeoffPop = p < 0.14 ? smoothstep(1 - p / 0.14) * 0.10 : 0;
  const landingPop = p > 0.84 ? smoothstep((p - 0.84) / 0.16) * 0.48 : 0;
  const settleLocalPush = phase === 'settle' ? 0.42 * (1 - 0.35 * Math.sin(settleT * Math.PI)) : 0;
  // v2.30: arrival should feel like a local-region/county view rather than a
  // broad regional view. +0.58 zoom is roughly 50% closer; ease it in near the
  // destination and keep it during the settle drift.
  const countyArrivalPush = phase === 'settle'
    ? 0.58
    : p > 0.78 ? 0.58 * smoothstep((p - 0.78) / 0.22) : 0;
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
  const base = mode === 'plane' || mode === 'move' ? 0.72 : 0.66;
  const cinematic = base + (phase === 'cruise' ? 0.08 : 0.16) * smoothstep(endpointBias);
  const takeoffGrow = smoothstep(Math.max(0, Math.min(1, progress / 0.14)));
  const landingShrink = smoothstep(Math.max(0, Math.min(1, (1 - progress) / 0.14)));
  return cinematic * takeoffGrow * landingShrink;
}
function vehiclePitchDeg(mode, phase, progress) {
  if (!(mode === 'plane' || mode === 'move')) return 0;
  const landing = smoothstep(Math.max(0, Math.min(1, (progress - 0.82) / 0.18)));
  const takeoff = 1 - smoothstep(Math.max(0, Math.min(1, progress / 0.12)));
  return Math.round((landing * 22 - takeoff * 8) * 10) / 10;
}

function lineProgressBehindVehicle(mode, distance, routeProgress, rawP) {
  if (!(mode === 'plane' || mode === 'move')) return routeProgress;
  if (rawP > 0.965) return 1;
  const offset = distance > 3000 ? 0.006 : distance > 900 ? 0.010 : 0.018;
  return Math.max(0, Math.min(1, routeProgress - offset));
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

function buildVesselIconIndex(modules) {
  const index = new Map();
  for (const [rawPath, url] of Object.entries(modules || {})) {
    const normalized = rawPath
      .replace(/\\/g, '/')
      .replace(/^\.\.\//, '')
      .replace(/^\.\//, '')
      .toLowerCase();

    const parts = normalized.split('/').filter(Boolean);
    const file = parts.at(-1)?.replace(/\.png$/, '') || '';
    const folder = parts.at(-2) || '';
    const fullNoExt = normalized.replace(/\.png$/, '');

    // Support both likely folder layouts:
    //   src/Icons/Airplanes/Airplane - Cyan.png
    //   src/icons/airplanes/airplane - cyan.png
    // Vite import.meta.glob('../Icons/**/*.png') returns paths like:
    //   ../Icons/Airplanes/Airplane - Cyan.png
    // The lookup keys below intentionally include both the short form and
    // full normalized path forms so GitHub/browser upload casing does not matter.
    const keys = [
      `${folder}/${file}`,
      `icons/${folder}/${file}`,
      fullNoExt,
      fullNoExt.replace(/^icons\//, ''),
      fullNoExt.replace(/^src\//, ''),
      fullNoExt.replace(/^src\/icons\//, ''),
    ];

    for (const key of keys) {
      const cleanKey = key.replace(/\s+/g, ' ').trim().toLowerCase();
      if (cleanKey) index.set(cleanKey, url);
    }
  }
  return index;
}
function vesselIconUrl(mode, color) {
  const family = vesselFamilyForMode(mode);
  const preferredColor = colorToIconName(color) || 'Blue';
  const candidates = [
    vesselIconKey(family, preferredColor),
    vesselIconKey(family, 'Blue'),
    `icons/${vesselIconKey(family, preferredColor)}`,
    `icons/${vesselIconKey(family, 'Blue')}`,
    'vessel - blue',
    'vessels/vessel - blue',
    'icons/vessel - blue',
    'icons/vessels/vessel - blue'
  ];
  for (const key of candidates) {
    const found = VESSEL_ICON_INDEX.get(key.toLowerCase());
    if (found) return found;
  }
  return '';
}
function vesselFamilyForMode(mode) {
  if (mode === 'drive' || mode === 'car') return 'Car';
  if (mode === 'boat') return 'Boat';
  if (mode === 'train') return 'Train';
  return 'Airplane';
}
function vesselIconKey(family, colorName) {
  const folder = `${family}s`.toLowerCase();
  return `${folder}/${family} - ${colorName}`.toLowerCase();
}
function colorToIconName(color) {
  const value = String(color || '').trim().toLowerCase();
  const aliases = {
    '#00e5ff': 'Cyan', '#00ffff': 'Cyan', cyan: 'Cyan',
    '#ff8a00': 'Orange', '#ffa500': 'Orange', orange: 'Orange',
    '#ff4fb8': 'Pink', '#ff69b4': 'Pink', pink: 'Pink',
    '#000000': 'Black', black: 'Black',
    '#808080': 'Gray', '#888888': 'Gray', gray: 'Gray', grey: 'Gray',
    '#ffd700': 'Gold', gold: 'Gold',
    '#ffff00': 'Yellow', yellow: 'Yellow',
    '#00ff00': 'Green', green: 'Green',
    '#800080': 'Purple', '#a020f0': 'Purple', purple: 'Purple',
    '#ff0000': 'Red', red: 'Red',
    '#0000ff': 'Blue', '#007bff': 'Blue', blue: 'Blue'
  };
  return aliases[value] || null;
}

function vehicleSvg(mode) {
  if (mode === 'drive') return '<svg viewBox="-24 -24 48 48" aria-hidden="true"><path d="M-18 3 L-14 -8 L-6 -13 L8 -13 L16 -7 L20 3 L17 10 L-17 10 Z"/><circle cx="-9" cy="10" r="4"/><circle cx="10" cy="10" r="4"/></svg>';
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
