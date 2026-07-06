import { useEffect, useMemo, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { geoInterpolate } from 'd3-geo';
import LegacySvgMap from './LegacySvgMap.jsx';
import { expandTrip, getTravelerKey } from '../utils/tripExpansion.js';
import { milesBetween } from '../utils/distanceUtils.js';

const MAP_STYLE = {
  version: 8,
  name: 'JourneyLines Terrain Globe',
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
  sources: {
    terrainImagery: {
      type: 'raster',
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
      ],
      tileSize: 256,
      attribution: 'Tiles &copy; Esri'
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
        'raster-brightness-max': 0.72
      }
    }
  ]
};

export default function TravelMap(props) {
  if (props.projectionName !== 'globe') return <LegacySvgMap {...props} />;
  return <MapLibreGlobe {...props} />;
}

function MapLibreGlobe({ trips, locations, homeBases, travelers, activeIndex, legProgress, cameraMode, showTrails, trailOpacity = 0.28, trailWidth = 1.55, isPlaying = false }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const vehicleRef = useRef(null);
  const originLabelRef = useRef(null);
  const destLabelRef = useRef(null);
  const overlayRef = useRef(null);
  const lastCameraRef = useRef(null);
  const arrivalTimerRef = useRef(null);
  const [mapReady, setMapReady] = useState(false);

  const locById = useMemo(() => Object.fromEntries(locations.map(l => [l.id, l])), [locations]);
  const travById = useMemo(() => Object.fromEntries(travelers.map(t => [t.id, t])), [travelers]);
  const expanded = useMemo(() => trips.map(t => expandTrip(t, locById, homeBases)), [trips, locById, homeBases]);
  const legs = useMemo(() => expanded.flatMap(t => t.legs.map((leg, legIndex) => ({ trip: t, leg, legIndex }))), [expanded]);

  const completedMode = activeIndex >= legs.length;
  const safeActiveIndex = Math.min(activeIndex, Math.max(0, legs.length - 1));
  const active = legs[safeActiveIndex];
  const scene = active && !completedMode ? getScene(active, legProgress, cameraMode) : null;
  const completedLegs = completedMode ? legs : legs.slice(0, Math.max(0, activeIndex));

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: MAP_STYLE,
      center: [-78, 31],
      zoom: 1.55,
      bearing: 0,
      pitch: 0,
      attributionControl: false,
      interactive: true,
      renderWorldCopies: false
    });

    mapRef.current = map;
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');

    map.on('load', () => {
      try { map.setProjection({ type: 'globe' }); } catch {}
      try {
        map.setFog({
          color: '#08172a',
          'horizon-blend': 0.08,
          'space-color': '#020711',
          'star-intensity': 0.24
        });
      } catch {}
      addRouteSourcesAndLayers(map);
      addPulseLayer(map);
      syncCompletedRoutes(map, completedLegs, travById, showTrails, trailOpacity, trailWidth);
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
    if (!map) return;
    const navigationMethods = [map.dragPan, map.scrollZoom, map.boxZoom, map.keyboard, map.doubleClickZoom, map.touchZoomRotate];
    for (const method of navigationMethods) {
      try { isPlaying ? method.disable() : method.enable(); } catch {}
    }
    // v2.3: keep north-up orientation. Users can pan/zoom while paused, but not rotate the globe.
    try { map.dragRotate.disable(); } catch {}
    try { map.touchZoomRotate.disableRotation(); } catch {}
    try { map.setBearing(0); } catch {}
  }, [isPlaying]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;
    syncCompletedRoutes(map, completedLegs, travById, showTrails, trailOpacity, trailWidth);
  }, [mapReady, completedLegs, travById, showTrails, trailOpacity, trailWidth]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map) return;

    if (!scene || !active) {
      syncActiveRoute(map, null);
      syncPulse(map, null, 'transparent');
      setOverlayVisibility(false);
      if (completedMode) {
        map.easeTo({ center: [-38, 23], zoom: 1.55, bearing: 0, pitch: 0, duration: 900, essential: true });
      }
      return;
    }

    const color = travById[getTravelerKey(active.trip)]?.color || '#00e5ff';
    syncActiveRoute(map, active, scene.routeProgress, color);
    syncPulse(map, active.leg.to, scene.phase === 'arrival' ? color : 'transparent');

    const camera = smoothCamera(lastCameraRef.current, scene.camera, scene.phase === 'takeoff' ? 0.42 : 0.32);
    lastCameraRef.current = camera;
    map.jumpTo({ ...camera, essential: true });

    updateOverlay(map, active, scene, color);
  }, [mapReady, scene?.frameKey, active, completedMode, travById]);

  useEffect(() => {
    const map = mapRef.current;
    if (!mapReady || !map || !active || completedMode || scene?.phase !== 'arrival') return;
    const color = travById[getTravelerKey(active.trip)]?.color || '#00e5ff';
    clearTimeout(arrivalTimerRef.current);
    syncPulse(map, active.leg.to, color);
    arrivalTimerRef.current = setTimeout(() => syncPulse(map, active.leg.to, 'transparent'), 900);
    return () => clearTimeout(arrivalTimerRef.current);
  }, [mapReady, activeIndex, scene?.phase, active, completedMode, travById]);

  function setOverlayVisibility(visible) {
    for (const ref of [vehicleRef, originLabelRef, destLabelRef]) {
      if (ref.current) ref.current.style.opacity = visible ? '1' : '0';
    }
  }

  function updateOverlay(map, activeLeg, sceneState, color) {
    if (!vehicleRef.current || !originLabelRef.current || !destLabelRef.current) return;
    const { leg } = activeLeg;
    const vehiclePt = map.project([sceneState.vehicle.lon, sceneState.vehicle.lat]);
    const originPt = map.project([leg.from.lon, leg.from.lat]);
    const destPt = map.project([leg.to.lon, leg.to.lat]);

    const mode = leg.mode;
    const rotation = mode === 'plane' ? sceneState.screenHeading : 0;
    vehicleRef.current.innerHTML = vehicleSvg(mode);
    vehicleRef.current.dataset.mode = mode;
    vehicleRef.current.style.setProperty('--vehicle-color', color);
    vehicleRef.current.style.transform = `translate3d(${vehiclePt.x}px, ${vehiclePt.y}px, 0) translate(-50%, -50%) rotate(${rotation}deg) scale(${sceneState.vehicleScale})`;
    vehicleRef.current.style.opacity = sceneState.vehicleVisible ? '1' : '0.92';

    updatePlaceLabel(originLabelRef.current, leg.from.name, originPt, color, 'origin');
    updatePlaceLabel(destLabelRef.current, leg.to.name, destPt, color, 'destination');
  }

  return <div className="maplibre-shell terrain-mode">
    <div className="maplibre-map" ref={containerRef} />
    <div className="cinema-vignette" />
    <div className="map-overlay" ref={overlayRef}>
      <div className="jl-vehicle-overlay" ref={vehicleRef} />
      <div className="jl-place-label-overlay" ref={originLabelRef} />
      <div className="jl-place-label-overlay is-destination" ref={destLabelRef} />
    </div>
  </div>;
}

function addRouteSourcesAndLayers(map) {
  if (!map.getSource('completed-routes')) {
    map.addSource('completed-routes', { type: 'geojson', data: emptyCollection() });
    map.addLayer({ id: 'completed-routes-glow', type: 'line', source: 'completed-routes', paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'glowWidth'], 'line-opacity': ['get', 'glowOpacity'], 'line-blur': 4.5 } });
    map.addLayer({ id: 'completed-routes', type: 'line', source: 'completed-routes', paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'width'], 'line-opacity': ['get', 'opacity'] } });
  }
  if (!map.getSource('active-route')) {
    map.addSource('active-route', { type: 'geojson', data: emptyCollection() });
    map.addLayer({ id: 'active-route-glow', type: 'line', source: 'active-route', paint: { 'line-color': ['get', 'color'], 'line-width': 8, 'line-opacity': 0.32, 'line-blur': 7 } });
    map.addLayer({ id: 'active-route', type: 'line', source: 'active-route', paint: { 'line-color': ['get', 'color'], 'line-width': 3.2, 'line-opacity': 0.98 } });
  }
  if (!map.getSource('visited-points')) {
    map.addSource('visited-points', { type: 'geojson', data: emptyCollection() });
    map.addLayer({ id: 'visited-points-halo', type: 'circle', source: 'visited-points', paint: { 'circle-radius': 7, 'circle-color': '#061224', 'circle-opacity': 0.84 } });
    map.addLayer({ id: 'visited-points', type: 'circle', source: 'visited-points', paint: { 'circle-radius': 3.9, 'circle-color': '#effcff', 'circle-stroke-color': '#061224', 'circle-stroke-width': 1.5, 'circle-opacity': 0.96 } });
  }
}

function addPulseLayer(map) {
  if (map.getSource('arrival-pulse')) return;
  map.addSource('arrival-pulse', { type: 'geojson', data: emptyCollection() });
  map.addLayer({ id: 'arrival-pulse', type: 'circle', source: 'arrival-pulse', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 0, 10, 6, 24], 'circle-color': ['get', 'color'], 'circle-opacity': 0.28, 'circle-blur': 0.55 } });
}

function syncCompletedRoutes(map, completedLegs, travelersById, showTrails, opacity, width) {
  const features = showTrails ? completedLegs.map((l, i) => {
    const color = travelersById[getTravelerKey(l.trip)]?.color || '#00e5ff';
    return routeFeature(l.leg, color, l.trip.id, i, opacity, width, false);
  }) : [];
  map.getSource('completed-routes')?.setData({ type: 'FeatureCollection', features });

  const pointMap = new Map();
  for (const l of completedLegs) {
    pointMap.set(l.leg.from.id, l.leg.from);
    pointMap.set(l.leg.to.id, l.leg.to);
  }
  map.getSource('visited-points')?.setData({
    type: 'FeatureCollection',
    features: [...pointMap.values()].map(loc => ({ type: 'Feature', properties: { id: loc.id, name: loc.name }, geometry: { type: 'Point', coordinates: [loc.lon, loc.lat] } }))
  });
}

function syncActiveRoute(map, active, progress = 1, color = '#00e5ff') {
  if (!active) { map.getSource('active-route')?.setData(emptyCollection()); return; }
  const feature = routeFeature(active.leg, color, active.trip.id, active.legIndex, 1, 2, true, progress);
  map.getSource('active-route')?.setData({ type: 'FeatureCollection', features: [feature] });

  const endpoints = [active.leg.from, active.leg.to].map(loc => ({ type: 'Feature', properties: { id: loc.id, name: loc.name }, geometry: { type: 'Point', coordinates: [loc.lon, loc.lat] } }));
  map.getSource('visited-points')?.setData({ type: 'FeatureCollection', features: endpoints });
}

function syncPulse(map, loc, color) {
  if (!loc || color === 'transparent') { map.getSource('arrival-pulse')?.setData(emptyCollection()); return; }
  map.getSource('arrival-pulse')?.setData({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { color }, geometry: { type: 'Point', coordinates: [loc.lon, loc.lat] } }] });
}

function routeFeature(leg, color, tripId, index, opacity, width, active = false, progress = 1) {
  return {
    type: 'Feature',
    properties: {
      tripId,
      index,
      color,
      width: active ? 3.2 : width,
      opacity: active ? 0.98 : opacity,
      glowWidth: active ? 8 : width * 3.1,
      glowOpacity: active ? 0.32 : opacity * 0.34,
      dash: dashForMode(leg.mode)
    },
    geometry: { type: 'LineString', coordinates: routeSamples(leg.from, leg.to, progress, active ? 110 : 42) }
  };
}

function getScene(active, rawProgress, cameraMode) {
  const p = Math.max(0, Math.min(1, rawProgress));
  const leg = active.leg;
  const distance = milesBetween(leg.from, leg.to);
  const routeProgress = takeoffCruiseLandingEase(p);
  const vehicle = interpolateGeo(leg.from, leg.to, routeProgress);
  const future = interpolateGeo(leg.from, leg.to, Math.min(1, routeProgress + lookAhead(distance, p)));
  const routeMid = interpolateGeo(leg.from, leg.to, 0.5);
  const phase = p < 0.16 ? 'takeoff' : p > 0.84 ? 'arrival' : 'cruise';
  const endpointBias = Math.max(0, 1 - Math.min(p, 1 - p) / 0.22);
  const cinematicFocus = blendGeo(vehicle, future, phase === 'cruise' ? 0.62 : 0.36);

  let center = cinematicFocus;
  if (cameraMode === 'global') center = blendGeo(routeMid, cinematicFocus, 0.2);
  if (cameraMode === 'route') center = blendGeo(routeMid, cinematicFocus, 0.52);
  if (cameraMode === 'continent') center = blendGeo(routeMid, cinematicFocus, 0.4);

  const heading = bearingBetween(interpolateGeo(leg.from, leg.to, Math.max(0, routeProgress - 0.01)), interpolateGeo(leg.from, leg.to, Math.min(1, routeProgress + 0.01)));
  const bearing = 0; // v2.3: north-up camera lock
  const zoom = cameraZoom(cameraMode, distance, endpointBias, p);
  const pitch = cameraPitch(cameraMode, phase, distance);

  return {
    phase,
    routeProgress,
    vehicle,
    heading,
    screenHeading: headingToScreenRotation(heading, bearing),
    vehicleScale: vehicleScale(leg.mode, phase, endpointBias),
    vehicleVisible: p > 0.01 && p < 0.995,
    camera: { center: [center.lon, center.lat], zoom, pitch, bearing },
    frameKey: `${active.trip.id}:${active.legIndex}:${Math.round(p * 1000)}:${cameraMode}`
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
  return Array.from({ length: steps + 1 }, (_, i) => interp((i / steps) * maxT));
}

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
function lookAhead(distance, p) {
  const base = distance > 4500 ? 0.055 : distance > 1500 ? 0.085 : 0.13;
  const endpoint = Math.max(0, 1 - Math.min(p, 1 - p) / 0.18);
  return base * (1 - 0.5 * endpoint);
}
function cameraZoom(mode, distance, endpointBias, p) {
  if (mode === 'global') return distance > 3500 ? 1.75 : 2.65;
  if (mode === 'continent') return distance > 3500 ? 2.65 : 4.15;
  if (mode === 'route') return distance > 4500 ? 3.0 : distance > 1500 ? 4.1 : 5.4;
  const cruise = distance > 4500 ? 3.1 : distance > 1500 ? 4.15 : distance > 500 ? 5.4 : 6.7;
  const close = distance > 4500 ? 4.7 : distance > 1500 ? 5.7 : distance > 500 ? 6.7 : 7.6;
  const takeoffPop = p < 0.14 ? smoothstep(1 - p / 0.14) * 0.34 : 0;
  const landingPop = p > 0.86 ? smoothstep((p - 0.86) / 0.14) * 0.46 : 0;
  return cruise + (close - cruise) * smoothstep(endpointBias) + takeoffPop + landingPop;
}
function cameraPitch(mode, phase, distance) {
  if (mode === 'global') return 0;
  if (phase === 'takeoff' || phase === 'arrival') return distance > 1500 ? 56 : 63;
  return mode === 'follow' ? 58 : 42;
}
function cameraBearing() { return 0; }
function headingToScreenRotation(heading, mapBearing) { return ((heading - mapBearing + 540) % 360) - 180; }
function vehicleScale(mode, phase, endpointBias) {
  const base = mode === 'plane' ? 0.72 : 0.66;
  return base + (phase === 'cruise' ? 0.10 : 0.22) * smoothstep(endpointBias);
}
function bearingBetween(a, b) {
  const toRad = d => d * Math.PI / 180;
  const toDeg = r => r * 180 / Math.PI;
  const lat1 = toRad(a.lat), lat2 = toRad(b.lat), dLon = toRad(b.lon - a.lon);
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
  if (mode === 'drive') return '<svg viewBox="-24 -24 48 48" aria-hidden="true"><path d="M-18 3 L-14 -8 L-6 -13 L8 -13 L16 -7 L20 3 L17 10 L-17 10 Z"/><circle cx="-9" cy="10" r="4"/><circle cx="10" cy="10" r="4"/></svg>';
  if (mode === 'boat') return '<svg viewBox="-24 -24 48 48" aria-hidden="true"><path d="M-18 6 C-10 16 10 16 18 6 Z"/><path d="M-1 6 L-1 -18 L14 3 Z"/><path d="M-4 6 L-4 -14 L-15 4 Z"/></svg>';
  if (mode === 'train') return '<svg viewBox="-24 -24 48 48" aria-hidden="true"><rect x="-12" y="-18" width="24" height="34" rx="6"/><path d="M-7 -10 H7 M-7 0 H7"/><circle cx="-6" cy="18" r="3"/><circle cx="6" cy="18" r="3"/></svg>';
  return '<svg viewBox="-24 -24 48 48" aria-hidden="true"><path d="M0 -22 L6 -4 L23 3 L23 9 L5 6 L2 18 L8 22 L8 25 L0 21 L-8 25 L-8 22 L-2 18 L-5 6 L-23 9 L-23 3 L-6 -4 Z"/></svg>';
}
function escapeHtml(value) { return String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])); }
function smoothstep(x) { const u = Math.max(0, Math.min(1, x)); return u * u * (3 - 2 * u); }
function lerp(a, b, t) { return a + (b - a) * t; }
function lerpAngle(a, b, t) { let d = ((b - a + 540) % 360) - 180; return a + d * t; }
