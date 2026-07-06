import { useMemo } from 'react';
import { geoPath, geoEqualEarth, geoOrthographic, geoInterpolate } from 'd3-geo';
import { geoCylindricalEqualArea } from 'd3-geo-projection';
import { feature } from 'topojson-client';
import world from 'world-atlas/countries-110m.json';
import { expandTrip, getTravelerKey } from '../utils/tripExpansion.js';

const W = 1400, H = 760;

export default function TravelMap({ trips, locations, homeBases, travelers, activeIndex, legProgress, projectionName, cameraMode, showTrails, trailOpacity, trailWidth }) {
  const locById = useMemo(() => Object.fromEntries(locations.map(l => [l.id, l])), [locations]);
  const travById = useMemo(() => Object.fromEntries(travelers.map(t => [t.id, t])), [travelers]);
  const expanded = useMemo(() => trips.map(t => expandTrip(t, locById, homeBases)), [trips, locById, homeBases]);
  const legs = useMemo(() => expanded.flatMap(t => t.legs.map((leg, legIndex) => ({ trip: t, leg, legIndex }))), [expanded]);
  const countries = useMemo(() => feature(world, world.objects.countries), []);

  const safeActiveIndex = Math.min(activeIndex, Math.max(0, legs.length - 1));
  const active = legs[safeActiveIndex];
  const completedMode = activeIndex >= legs.length;
  const drawnLegs = legs.slice(0, Math.min(activeIndex, legs.length));
  const currentPoint = active ? interpolateGeo(active.leg.from, active.leg.to, completedMode ? 1 : legProgress) : null;

  const projection = useMemo(() => {
    if (projectionName === 'globe') {
      const target = globeTarget(cameraMode, active, currentPoint);
      const scale = globeScale(cameraMode, completedMode);
      return geoOrthographic()
        .translate([W / 2, H / 2])
        .scale(scale)
        .rotate([-target.lon, -target.lat, 0])
        .clipAngle(90)
        .precision(0.35);
    }
    const p = projectionName === 'gallPeters' ? geoCylindricalEqualArea().parallel(45) : geoEqualEarth();
    return p.fitSize([W, H], { type: 'Sphere' });
  }, [projectionName, cameraMode, active, currentPoint, completedMode]);

  const path = useMemo(() => geoPath(projection), [projection]);
  const currentXY = currentPoint ? projection([currentPoint.lon, currentPoint.lat]) : null;
  const viewTransform = projectionName === 'globe' ? '' : cameraTransform(cameraMode, active, currentXY, projection);
  const visited = visitedLocations(expanded, activeIndex);
  const activeIds = new Set(active ? [active.leg.from.id, active.leg.to.id] : []);

  return <svg className={`map map--${projectionName}`} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="JourneyLines travel map">
    <defs>
      <filter id="glow"><feGaussianBlur stdDeviation="3" result="coloredBlur"/><feMerge><feMergeNode in="coloredBlur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      <filter id="terrainGlow"><feGaussianBlur stdDeviation="7" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
      <radialGradient id="globeOcean" cx="42%" cy="28%" r="76%">
        <stop offset="0" stopColor="#214a72"/>
        <stop offset="0.45" stopColor="#102944"/>
        <stop offset="1" stopColor="#050b17"/>
      </radialGradient>
      <linearGradient id="ocean" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#09111f"/><stop offset="1" stopColor="#101b31"/></linearGradient>
      <radialGradient id="atmosphere" cx="50%" cy="50%" r="50%"><stop offset="68%" stopColor="rgba(24,226,255,0)"/><stop offset="96%" stopColor="rgba(24,226,255,.12)"/><stop offset="100%" stopColor="rgba(24,226,255,.28)"/></radialGradient>
    </defs>
    <rect width={W} height={H} fill="url(#ocean)" />
    {projectionName === 'globe' && <circle cx={W/2} cy={H/2} r={projection.scale()} fill="url(#globeOcean)" className="globe-disc" />}
    <g transform={viewTransform} className="camera-layer">
      <path d={path({ type: 'Sphere' })} className="sphere" />
      <g className="countries terrain">{countries.features.map((c, i) => <path key={i} d={path(c)} />)}</g>
      {projectionName === 'globe' && <g className="terrain-shade">{countries.features.map((c, i) => <path key={`s-${i}`} d={path(c)} />)}</g>}
      {showTrails && <g className="trails" opacity={trailOpacity} strokeWidth={trailWidth}>
        {drawnLegs.map((l, i) => <Route key={`${l.trip.id}-${l.legIndex}-${i}`} leg={l.leg} projection={projection} color={travById[getTravelerKey(l.trip)]?.color} mode={l.leg.mode} globe={projectionName === 'globe'} />)}
        {active && !completedMode && <Route leg={{...active.leg, to: currentPoint}} projection={projection} color={travById[getTravelerKey(active.trip)]?.color} mode={active.leg.mode} active globe={projectionName === 'globe'} progress={legProgress} />}
      </g>}
      <g className="dots">
        {[...visited].map(id => {
          const l = locById[id];
          if (!l) return null;
          const xy = projection([l.lon, l.lat]);
          if (!xy) return null;
          const showLabel = !completedMode && activeIds.has(id);
          return <g key={id} transform={`translate(${xy[0]},${xy[1]})`} className={showLabel ? 'dot dot--active' : 'dot'}><circle r={showLabel ? 5.8 : 3.6}/>{showLabel && <text y="-11">{l.name}</text>}</g>;
        })}
      </g>
      {currentXY && active && !completedMode && <Vehicle xy={currentXY} mode={active.leg.mode} color={travById[getTravelerKey(active.trip)]?.color} projectionName={projectionName} />}
    </g>
    {projectionName === 'globe' && <circle cx={W/2} cy={H/2} r={projection.scale()} fill="url(#atmosphere)" className="atmosphere" />}
  </svg>;
}

function Route({ leg, projection, color = '#00e5ff', mode = 'plane', active, globe, progress = 1 }) {
  const dash = mode === 'drive' ? '6 7' : mode === 'boat' ? '2 10' : mode === 'train' ? '10 5' : '';
  if (globe || mode === 'plane') {
    const coords = routeSamples(leg.from, leg.to, active ? progress : 1, globe ? 42 : 26);
    const d = geoPath(projection)({ type: 'LineString', coordinates: coords });
    if (!d) return null;
    return <path d={d} fill="none" stroke={color} strokeLinecap="round" strokeDasharray={dash} className={active ? 'route active' : 'route'} />;
  }
  const a = projection([leg.from.lon, leg.from.lat]);
  const b = projection([leg.to.lon, leg.to.lat]);
  if (!a || !b) return null;
  const dx = b[0]-a[0], dy = b[1]-a[1];
  const curve = mode === 'boat' ? 25 : 8;
  const mx = (a[0]+b[0])/2, my = (a[1]+b[1])/2 - curve;
  return <path d={`M${a[0]},${a[1]} Q${mx},${my} ${b[0]},${b[1]}`} fill="none" stroke={color} strokeLinecap="round" strokeDasharray={dash} className={active ? 'route active' : 'route'} />;
}

function Vehicle({ xy, mode, color, projectionName }) {
  const icon = mode === 'drive' ? '🚗' : mode === 'boat' ? '⛵' : mode === 'train' ? '🚆' : '✈';
  const r = projectionName === 'globe' ? 13 : 15;
  const fontSize = projectionName === 'globe' ? 17 : 19;
  return <g className="vehicle" transform={`translate(${xy[0]},${xy[1]})`} filter="url(#glow)">
    <circle r={r} fill="rgba(5,12,25,.74)" stroke={color} strokeWidth="2" />
    <text textAnchor="middle" dominantBaseline="central" fontSize={fontSize}>{icon}</text>
  </g>;
}

function interpolateGeo(a, b, t) {
  const interp = geoInterpolate([a.lon, a.lat], [b.lon, b.lat]);
  const [lon, lat] = interp(Math.max(0, Math.min(1, t)));
  return { lon, lat };
}

function routeSamples(a, b, progress = 1, n = 32) {
  const interp = geoInterpolate([a.lon, a.lat], [b.lon, b.lat]);
  const steps = Math.max(2, Math.ceil(n * Math.max(0.05, progress)));
  return Array.from({ length: steps + 1 }, (_, i) => interp((i / steps) * Math.max(0, Math.min(1, progress))));
}

function visitedLocations(expanded, activeIndex) {
  const out = new Set(); let count = 0;
  for (const trip of expanded) {
    for (const leg of trip.legs) {
      if (count <= activeIndex) { out.add(leg.from.id); out.add(leg.to.id); }
      count++;
    }
  }
  return out;
}

function globeTarget(mode, active, currentPoint) {
  if (!active || !currentPoint) return { lon: -35, lat: 25 };
  if (mode === 'route' || mode === 'continent') {
    const mid = interpolateGeo(active.leg.from, active.leg.to, 0.5);
    return mid;
  }
  return currentPoint;
}

function globeScale(mode, completedMode) {
  if (completedMode) return 360;
  if (mode === 'follow') return 620;
  if (mode === 'route') return 520;
  if (mode === 'continent') return 460;
  return 430;
}

function cameraTransform(mode, active, currentXY, projection) {
  if (!active || !currentXY || mode === 'global') return '';
  let scale = mode === 'follow' ? 2.4 : mode === 'route' ? 1.75 : 1.35;
  let cx = currentXY[0], cy = currentXY[1];
  if (mode === 'route' || mode === 'continent') {
    const a = projection([active.leg.from.lon, active.leg.from.lat]);
    const b = projection([active.leg.to.lon, active.leg.to.lat]);
    cx = (a[0]+b[0])/2; cy = (a[1]+b[1])/2;
  }
  return `translate(${W/2},${H/2}) scale(${scale}) translate(${-cx},${-cy})`;
}
