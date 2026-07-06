import { useEffect, useMemo, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { geoInterpolate } from 'd3-geo';
import LegacySvgMap from './LegacySvgMap.jsx';
import { expandTrip, getTravelerKey } from '../utils/tripExpansion.js';
import { milesBetween } from '../utils/distanceUtils.js';

const MAP_STYLE = {
  version: 8,
  name: 'JourneyLines Cinematic Dark Globe',
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
  sources: {
    cartoDark: {
      type: 'raster',
      tiles: [
        'https://a.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png',
        'https://b.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png',
        'https://c.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png',
        'https://d.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}{r}.png'
      ],
      tileSize: 256,
      attribution: '&copy; OpenStreetMap contributors &copy; CARTO'
    }
  },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#07101f' } },
    { id: 'carto-dark', type: 'raster', source: 'cartoDark', minzoom: 0, maxzoom: 19, paint: { 'raster-opacity': 0.86, 'raster-saturation': -0.18, 'raster-contrast': -0.08, 'raster-brightness-min': 0.12, 'raster-brightness-max': 0.96 } }
  ]
};

export default function TravelMap(props) {
  if (props.projectionName !== 'globe') return <LegacySvgMap {...props} />;
  return <MapLibreGlobe {...props} />;
}

function MapLibreGlobe({ trips, locations, homeBases, travelers, activeIndex, legProgress, cameraMode, showTrails, trailOpacity = 0.28, trailWidth = 1.55, isPlaying = false }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const endpointMarkerRefs = useRef([]);
  const endpointKeyRef = useRef('');
  const lastCameraRef = useRef(null);
  const arrivalRef = useRef(null);

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
      center: [-38, 26],
      zoom: 1.35,
      bearing: 0,
      pitch: 0,
      attributionControl: false,
      dragRotate: true,
      interactive: true
    });
    mapRef.current = map;
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');

    map.on('load', () => {
      try { map.setProjection({ type: 'globe' }); } catch {}
      try { map.setFog({ color: '#07101f', 'horizon-blend': 0.08, 'space-color': '#020711', 'star-intensity': 0.14 }); } catch {}
      addRouteSourcesAndLayers(map);
      addPulseLayer(map);
      syncCompletedRoutes(map, completedLegs, travById, showTrails, trailOpacity, trailWidth);
    });

    return () => { markerRef.current?.remove(); endpointMarkerRefs.current.forEach(m => m.remove()); map.remove(); mapRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const methods = [map.dragPan, map.scrollZoom, map.boxZoom, map.dragRotate, map.keyboard, map.doubleClickZoom, map.touchZoomRotate];
    for (const method of methods) {
      try { isPlaying ? method.disable() : method.enable(); } catch {}
    }
  }, [isPlaying]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.isStyleLoaded()) return;
    syncCompletedRoutes(map, completedLegs, travById, showTrails, trailOpacity, trailWidth);
  }, [completedLegs, travById, showTrails, trailOpacity, trailWidth]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.isStyleLoaded()) return;
    if (!scene || !active) {
      syncActiveRoute(map, null);
      updateVehicle(null);
      updateEndpointMarkers(null);
      if (completedMode) {
        map.easeTo({ center: [-38, 23], zoom: 1.35, bearing: 0, pitch: 0, duration: 900, essential: true });
      }
      return;
    }

    const color = travById[getTravelerKey(active.trip)]?.color || '#00e5ff';
    syncActiveRoute(map, active, scene.routeProgress, color);
    syncPulse(map, active.leg.to, scene.phase === 'arrival' ? color : 'transparent');
    updateVehicle({ point: scene.vehicle, mode: active.leg.mode, color, heading: scene.heading, scale: scene.vehicleScale });
    updateEndpointMarkers(active, color);

    const camera = smoothCamera(lastCameraRef.current, scene.camera, 0.26);
    lastCameraRef.current = camera;
    map.jumpTo({ ...camera, essential: true });
  }, [scene?.frameKey, active, completedMode, travById]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map?.isStyleLoaded()) return;
    if (!active || completedMode || scene?.phase !== 'arrival') return;
    const color = travById[getTravelerKey(active.trip)]?.color || '#00e5ff';
    clearTimeout(arrivalRef.current);
    syncPulse(map, active.leg.to, color);
    arrivalRef.current = setTimeout(() => syncPulse(map, active.leg.to, 'transparent'), 900);
    return () => clearTimeout(arrivalRef.current);
  }, [activeIndex, scene?.phase, active, completedMode, travById]);

  function updateVehicle(state) {
    if (!mapRef.current) return;
    if (!state) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }
    if (!markerRef.current) {
      markerRef.current = new maplibregl.Marker({ element: makeVehicleElement(), anchor: 'center', pitchAlignment: 'viewport', rotationAlignment: 'viewport' })
        .setLngLat([state.point.lon, state.point.lat])
        .addTo(mapRef.current);
    }
    const el = markerRef.current.getElement();
    const glyph = el.querySelector('.jl-vehicle-glyph');
    glyph.innerHTML = vehicleSvg(state.mode);
    glyph.style.color = state.color;
    glyph.style.setProperty('--vehicle-color', state.color);
    glyph.style.transform = `rotate(${state.mode === 'plane' ? state.heading : 0}deg) scale(${state.scale})`;
    el.dataset.mode = state.mode;
    markerRef.current.setLngLat([state.point.lon, state.point.lat]);
  }

  function updateEndpointMarkers(activeLeg, color) {
    if (!mapRef.current || !activeLeg) {
      endpointMarkerRefs.current.forEach(m => m.remove());
      endpointMarkerRefs.current = [];
      endpointKeyRef.current = '';
      return;
    }
    const key = `${activeLeg.leg.from.id}:${activeLeg.leg.to.id}:${color}`;
    if (endpointKeyRef.current === key) return;
    endpointKeyRef.current = key;
    endpointMarkerRefs.current.forEach(m => m.remove());
    endpointMarkerRefs.current = [];
    const endpoints = [
      { loc: activeLeg.leg.from, kind: 'Depart' },
      { loc: activeLeg.leg.to, kind: 'Arrive' }
    ];
    endpointMarkerRefs.current = endpoints.map(({ loc, kind }) => {
      const el = document.createElement('div');
      el.className = 'jl-place-label';
      el.style.setProperty('--place-color', color);
      el.innerHTML = `<span class="jl-place-dot"></span><span class="jl-place-name">${escapeHtml(loc.name)}</span>`;
      el.title = `${kind}: ${loc.name}`;
      return new maplibregl.Marker({ element: el, anchor: 'bottom', pitchAlignment: 'viewport', rotationAlignment: 'viewport' })
        .setLngLat([loc.lon, loc.lat])
        .addTo(mapRef.current);
    });
  }

  return <div className="maplibre-shell">
    <div className="cinema-vignette" />
    <div className="maplibre-map" ref={containerRef} />
  </div>;
}

function addRouteSourcesAndLayers(map) {
  if (!map.getSource('completed-routes')) {
    map.addSource('completed-routes', { type: 'geojson', data: emptyCollection() });
    map.addLayer({ id: 'completed-routes-glow', type: 'line', source: 'completed-routes', paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'glowWidth'], 'line-opacity': ['get', 'glowOpacity'], 'line-blur': 5 } });
    map.addLayer({ id: 'completed-routes', type: 'line', source: 'completed-routes', paint: { 'line-color': ['get', 'color'], 'line-width': ['get', 'width'], 'line-opacity': ['get', 'opacity'] } });
  }
  if (!map.getSource('active-route')) {
    map.addSource('active-route', { type: 'geojson', data: emptyCollection() });
    map.addLayer({ id: 'active-route-glow', type: 'line', source: 'active-route', paint: { 'line-color': ['get', 'color'], 'line-width': 9, 'line-opacity': 0.34, 'line-blur': 7 } });
    map.addLayer({ id: 'active-route', type: 'line', source: 'active-route', paint: { 'line-color': ['get', 'color'], 'line-width': 3.4, 'line-opacity': 0.96 } });
  }
  if (!map.getSource('visited-points')) {
    map.addSource('visited-points', { type: 'geojson', data: emptyCollection() });
    map.addLayer({ id: 'visited-points-halo', type: 'circle', source: 'visited-points', paint: { 'circle-radius': 7, 'circle-color': '#061224', 'circle-opacity': 0.8 } });
    map.addLayer({ id: 'visited-points', type: 'circle', source: 'visited-points', paint: { 'circle-radius': 3.8, 'circle-color': '#e7f7ff', 'circle-stroke-color': '#061224', 'circle-stroke-width': 1.4, 'circle-opacity': 0.95 } });
    map.addLayer({ id: 'active-labels', type: 'symbol', source: 'visited-points', layout: { 'text-field': ['case', ['get', 'active'], ['get', 'name'], ''], 'text-font': ['Open Sans Regular'], 'text-size': 12, 'text-offset': [0, -1.45], 'text-anchor': 'bottom', 'text-allow-overlap': false }, paint: { 'text-color': '#ecfbff', 'text-halo-color': '#07101f', 'text-halo-width': 2 } });
  }
}

function addPulseLayer(map) {
  if (map.getSource('arrival-pulse')) return;
  map.addSource('arrival-pulse', { type: 'geojson', data: emptyCollection() });
  map.addLayer({ id: 'arrival-pulse', type: 'circle', source: 'arrival-pulse', paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 0, 9, 6, 18], 'circle-color': ['get', 'color'], 'circle-opacity': 0.28, 'circle-blur': 0.55 } });
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
    features: [...pointMap.values()].map(loc => ({ type: 'Feature', properties: { id: loc.id, name: loc.name, active: false }, geometry: { type: 'Point', coordinates: [loc.lon, loc.lat] } }))
  });
}

function syncActiveRoute(map, active, progress = 1, color = '#00e5ff') {
  if (!active) { map.getSource('active-route')?.setData(emptyCollection()); return; }
  const feature = routeFeature(active.leg, color, active.trip.id, active.legIndex, 1, 2, true, progress);
  map.getSource('active-route')?.setData({ type: 'FeatureCollection', features: [feature] });

  const endpoints = [active.leg.from, active.leg.to].map(loc => ({ type: 'Feature', properties: { id: loc.id, name: loc.name, active: true }, geometry: { type: 'Point', coordinates: [loc.lon, loc.lat] } }));
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
      width: active ? 3.4 : width,
      opacity: active ? 0.96 : opacity,
      glowWidth: active ? 9 : width * 3.2,
      glowOpacity: active ? 0.34 : opacity * 0.42,
      dash: dashForMode(leg.mode)
    },
    geometry: { type: 'LineString', coordinates: routeSamples(leg.from, leg.to, progress, active ? 90 : 40) }
  };
}

function getScene(active, rawProgress, cameraMode) {
  const p = Math.max(0, Math.min(1, rawProgress));
  const e = takeoffCruiseLandingEase(p);
  const leg = active.leg;
  const distance = milesBetween(leg.from, leg.to);
  const vehicle = interpolateGeo(leg.from, leg.to, e);
  const lead = interpolateGeo(leg.from, leg.to, Math.min(1, e + lookAhead(distance, p)));
  const focus = blendGeo(vehicle, lead, p < 0.15 ? 0.34 : p > 0.83 ? 0.52 : 0.62);
  const routeMid = interpolateGeo(leg.from, leg.to, 0.5);
  const endpointBias = Math.max(0, 1 - Math.min(p, 1 - p) / 0.24);
  const phase = p < 0.13 ? 'takeoff' : p > 0.88 ? 'arrival' : 'cruise';
  const routeProgress = e;
  const heading = bearingBetween(interpolateGeo(leg.from, leg.to, Math.max(0, e - 0.012)), interpolateGeo(leg.from, leg.to, Math.min(1, e + 0.012)));

  let center = focus;
  if (cameraMode === 'global') center = routeMid;
  if (cameraMode === 'route' || cameraMode === 'continent') center = blendGeo(routeMid, focus, 0.28);

  const zoom = cameraZoom(cameraMode, distance, endpointBias, p);
  const pitch = cameraPitch(cameraMode, phase, distance);
  const bearing = cameraBearing(cameraMode, heading, phase);

  return {
    phase,
    routeProgress,
    vehicle,
    heading,
    vehicleScale: vehicleScale(leg.mode, phase, endpointBias),
    camera: { center: [center.lon, center.lat], zoom, pitch, bearing },
    frameKey: `${active.trip.id}:${active.legIndex}:${Math.round(p * 1000)}:${cameraMode}`
  };
}

function interpolateGeo(a, b, t) {
  const interp = geoInterpolate([a.lon, a.lat], [b.lon, b.lat]);
  const [lon, lat] = interp(Math.max(0, Math.min(1, t)));
  return { lon, lat };
}

function routeSamples(a, b, progress = 1, n = 64) {
  const interp = geoInterpolate([a.lon, a.lat], [b.lon, b.lat]);
  const maxT = Math.max(0, Math.min(1, progress));
  const steps = Math.max(2, Math.ceil(n * Math.max(0.06, maxT)));
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
  return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
}
function lookAhead(distance, p) {
  const base = distance > 4500 ? 0.05 : distance > 1500 ? 0.075 : 0.11;
  const endpoints = Math.max(0, 1 - Math.min(p, 1 - p) / 0.18);
  return base * (1 - 0.45 * endpoints);
}
function cameraZoom(mode, distance, endpointBias, p) {
  if (mode === 'global') return distance > 3500 ? 1.45 : 2.25;
  if (mode === 'continent') return distance > 3500 ? 2.15 : 3.35;
  if (mode === 'route') return distance > 4500 ? 2.75 : distance > 1500 ? 3.55 : 4.65;
  const cruise = distance > 4500 ? 2.65 : distance > 1500 ? 3.55 : distance > 500 ? 4.85 : 6.15;
  const close = distance > 4500 ? 4.05 : distance > 1500 ? 4.95 : distance > 500 ? 5.95 : 6.85;
  const takeoffPop = p < 0.12 ? smoothstep(1 - p / 0.12) * 0.45 : 0;
  const landingPop = p > 0.88 ? smoothstep((p - 0.88) / 0.12) * 0.55 : 0;
  return cruise + (close - cruise) * smoothstep(endpointBias) + takeoffPop + landingPop;
}
function cameraPitch(mode, phase, distance) {
  if (mode === 'global') return 8;
  if (phase === 'takeoff' || phase === 'arrival') return distance > 1500 ? 54 : 62;
  return mode === 'follow' ? 52 : 38;
}
function cameraBearing(mode, heading, phase) {
  if (mode === 'global') return 0;
  if (mode === 'route') return heading * 0.35;
  return phase === 'cruise' ? heading * 0.75 : heading * 0.9;
}
function vehicleScale(mode, phase, endpointBias) {
  const base = mode === 'plane' ? 0.9 : 0.74;
  return base + (phase === 'cruise' ? 0.12 : 0.26) * smoothstep(endpointBias);
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
function makeVehicleElement() {
  const el = document.createElement('div');
  el.className = 'jl-vehicle';
  const glyph = document.createElement('div');
  glyph.className = 'jl-vehicle-glyph';
  el.appendChild(glyph);
  return el;
}
function vehicleSvg(mode) {
  if (mode === 'drive') return '<svg viewBox="-24 -24 48 48" aria-hidden="true"><path d="M-18 3 L-14 -8 L-6 -13 L8 -13 L16 -7 L20 3 L17 10 L-17 10 Z"/><circle cx="-9" cy="10" r="4"/><circle cx="10" cy="10" r="4"/></svg>';
  if (mode === 'boat') return '<svg viewBox="-24 -24 48 48" aria-hidden="true"><path d="M-18 6 C-10 16 10 16 18 6 Z"/><path d="M-1 6 L-1 -18 L14 3 Z"/><path d="M-4 6 L-4 -14 L-15 4 Z"/></svg>';
  if (mode === 'train') return '<svg viewBox="-24 -24 48 48" aria-hidden="true"><rect x="-12" y="-18" width="24" height="34" rx="6"/><path d="M-7 -10 H7 M-7 0 H7"/><circle cx="-6" cy="18" r="3"/><circle cx="6" cy="18" r="3"/></svg>';
  return '<svg viewBox="-24 -24 48 48" aria-hidden="true"><path d="M0 -22 L6 -4 L23 3 L23 9 L5 6 L2 18 L8 22 L8 25 L0 21 L-8 25 L-8 22 L-2 18 L-5 6 L-23 9 L-23 3 L-6 -4 Z"/></svg>';
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
}
function smoothstep(x) { const u = Math.max(0, Math.min(1, x)); return u * u * (3 - 2 * u); }
function lerp(a, b, t) { return a + (b - a) * t; }
function lerpAngle(a, b, t) { let d = ((b - a + 540) % 360) - 180; return a + d * t; }
