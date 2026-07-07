import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import TravelMap from './components/TravelMap.jsx';
import PlaybackControls from './components/PlaybackControls.jsx';
import TripCard from './components/TripCard.jsx';
import AdminPanel from './components/AdminPanel.jsx';
import { sortTrips } from './utils/dateUtils.js';
import { expandTrip, flattenLegs, getTravelerKey } from './utils/tripExpansion.js';
import { legDurationMs } from './utils/routeTiming.js';
import baseTrips from './data/trips.json';
import locations from './data/locations.json';
import homeBases from './data/homeBases.json';
import travelers from './data/travelers.json';
import settings from './data/settings.json';

export default function App() {
  const [trips, setTrips] = useState(() => JSON.parse(localStorage.getItem('journeylines.trips') || 'null') || baseTrips);
  const [isPlaying, setIsPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [activeIndex, setActiveIndex] = useState(999999);
  const [legProgress, setLegProgress] = useState(1);
  const [projection, setProjection] = useState(settings.defaultProjection);
  const [cameraMode, setCameraMode] = useState(settings.defaultCameraMode);
  const [showTrails, setShowTrails] = useState(settings.showTrails);
  const [speed, setSpeed] = useState(settings.playbackSpeed);
  const [filter, setFilter] = useState('all');
  const [admin, setAdmin] = useState(false);
  const [tripDrawerOpen, setTripDrawerOpen] = useState(false);
  const [introLaunching, setIntroLaunching] = useState(false);
  const clickRef = useRef(0);
  const tRef = useRef({ last: null, elapsed: 0 });
  const SETTLE_MS = settings.arrivalSettleMs || 4000;
  const FRAME_MS = 33.333; // cap playback state updates around 30fps for smoother wall-display playback

  useEffect(() => localStorage.setItem('journeylines.trips', JSON.stringify(trips)), [trips]);

  const sortedTrips = useMemo(() => sortTrips(trips), [trips]);
  const filteredTrips = useMemo(() => sortedTrips.filter(t => {
    const hasJ = t.travelers?.includes('joey'), hasB = t.travelers?.includes('bonnie');
    if (filter === 'joey') return hasJ;
    if (filter === 'bonnie') return hasB;
    if (filter === 'together') return hasJ && hasB;
    return true;
  }), [sortedTrips, filter]);
  const locById = useMemo(() => Object.fromEntries(locations.map(l => [l.id, l])), []);
  const travById = useMemo(() => Object.fromEntries(travelers.map(t => [t.id, t])), []);
  const legs = useMemo(() => flattenLegs(filteredTrips, locById, homeBases), [filteredTrips, locById]);
  const tripTimeline = useMemo(() => buildTripTimeline(filteredTrips, legs, locById, travById), [filteredTrips, legs, locById, travById]);
  const current = legs[Math.min(activeIndex, Math.max(0, legs.length - 1))];
  const expanded = current ? expandTrip(current.trip, locById, homeBases) : null;
  const traveler = current ? travById[getTravelerKey(current.trip)] : null;

  useEffect(() => {
    if (!isPlaying || !legs.length) return;
    let raf;
    const step = (ts) => {
      if (tRef.current.last == null) tRef.current.last = ts;
      const dt = ts - tRef.current.last;
      if (dt < FRAME_MS) {
        raf = requestAnimationFrame(step);
        return;
      }
      tRef.current.last = ts;
      const dur = legDurationMs(legs[Math.min(activeIndex, legs.length - 1)]?.leg.miles || 500, speed);
      const settle = SETTLE_MS / Math.max(0.25, Number(speed) || 1);
      tRef.current.elapsed += dt;
      const p = tRef.current.elapsed / dur;
      setLegProgress(p);
      if (tRef.current.elapsed >= dur + settle) {
        tRef.current.elapsed = 0;
        tRef.current.last = null;
        setLegProgress(0);
        setActiveIndex(i => {
          if (i + 1 >= legs.length) { setIsPlaying(false); return i; }
          return i + 1;
        });
      }
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, activeIndex, legs, speed]);

  function play() {
    if (!started || activeIndex >= legs.length - 1) {
      setActiveIndex(0);
      setLegProgress(0);
      tRef.current = { last: null, elapsed: 0 };
      setStarted(true);
      setIsPlaying(false);
      setIntroLaunching(true);
    } else {
      const currentLeg = legs[Math.min(activeIndex, legs.length - 1)]?.leg;
      const dur = legDurationMs(currentLeg?.miles || 500, speed);
      tRef.current = { last: null, elapsed: Math.max(0, Math.min(1, legProgress)) * dur };
      setIsPlaying(true);
    }
  }
  const completeIntroLaunch = useCallback(() => {
    setIntroLaunching(false);
    tRef.current = { last: null, elapsed: 0 };
    setLegProgress(0);
    setIsPlaying(true);
  }, []);
  function editTravelHistory() {
    setAdmin(true);
    setStarted(true);
    setIntroLaunching(false);
    setIsPlaying(false);
  }
  function pause() { setIsPlaying(false); }
  function reset() { setIsPlaying(false); setIntroLaunching(false); setStarted(false); setActiveIndex(999999); setLegProgress(1); }
  function jumpToLeg(index, progressWithinLeg = 0, autoPlay = false) {
    if (!legs.length) return;
    const safeIndex = Math.max(0, Math.min(legs.length - 1, Math.floor(index)));
    const safeProgress = Math.max(0, Math.min(1, progressWithinLeg));
    const dur = legDurationMs(legs[safeIndex]?.leg?.miles || 500, speed);
    setStarted(true);
    setIsPlaying(Boolean(autoPlay));
    setActiveIndex(safeIndex);
    setLegProgress(safeProgress);
    tRef.current = { last: null, elapsed: safeProgress * dur };
  }
  function seekTimeline(fraction) {
    if (!legs.length) return;
    const p = Math.max(0, Math.min(0.999999, Number(fraction) || 0));
    const raw = p * legs.length;
    const index = Math.max(0, Math.min(legs.length - 1, Math.floor(raw)));
    const withinLeg = raw - index;
    jumpToLeg(index, withinLeg, true);
  }
  function titleClick() {
    clickRef.current += 1;
    setTimeout(() => { clickRef.current = 0; }, 900);
    if (clickRef.current >= settings.adminClickCount) { setAdmin(a => !a); clickRef.current = 0; }
  }

  const progress = legs.length ? Math.min(1, (Math.min(activeIndex, legs.length - 1) + Math.min(1, legProgress)) / legs.length) : 1;

  return <main className={`app ${isPlaying ? 'is-playing' : ''}`}>
    <header className="topbar">
      <button className="brand" onClick={titleClick} title="GlobeHoppers">GlobeHoppers</button>
      <div className="tagline">All your hops, skips & jumps.</div>
      <button onClick={() => setTripDrawerOpen(v => !v)}>Trips</button>
      <button onClick={() => document.documentElement.requestFullscreen?.()}>Fullscreen</button>
    </header>
    <TravelMap trips={filteredTrips} locations={locations} homeBases={homeBases} travelers={travelers} activeIndex={activeIndex} legProgress={legProgress} projectionName={projection} cameraMode={cameraMode} showTrails={showTrails} trailOpacity={settings.trailOpacity} trailWidth={settings.trailWidth} isPlaying={isPlaying} introLaunching={introLaunching} onIntroLaunchComplete={completeIntroLaunch} />
    {!started && <section className="hero glass">
      <p className="eyebrow">{filteredTrips.length} trips · lifetime travel archive</p>
      <h1>GlobeHoppers</h1>
      <p>All your hops, skips & jumps, replayed across a living globe.</p>
      <div className="hero-actions">
        <button className="primary big" onClick={play}>Play Travel History</button>
        <button className="secondary big" onClick={editTravelHistory}>Edit Travel History</button>
      </div>
    </section>}
    <TripCard trip={current?.trip} expanded={expanded} traveler={traveler} />
    <PlaybackControls isPlaying={isPlaying} onPlay={play} onPause={pause} onReset={reset} progress={progress} onSeekProgress={seekTimeline} speed={speed} setSpeed={setSpeed} filter={filter} setFilter={(v) => { setFilter(v); reset(); }} projection={projection} setProjection={setProjection} cameraMode={cameraMode} setCameraMode={setCameraMode} showTrails={showTrails} setShowTrails={setShowTrails} onToggleTripDrawer={() => setTripDrawerOpen(v => !v)} />
    <TripTimelineDrawer open={tripDrawerOpen} rows={tripTimeline} activeIndex={activeIndex} onClose={() => setTripDrawerOpen(false)} onJump={(index) => jumpToLeg(index, 0, true)} />
    <section className="about glass">
      <strong>About</strong> GlobeHoppers is an animated travel-history map for all your hops, skips & jumps. Five-click the title to open Admin Mode.
    </section>
    {admin && <AdminPanel trips={trips} setTrips={setTrips} locations={locations} />}
  </main>;
}


function buildTripTimeline(trips, legs, locById, travById) {
  const firstLegByTrip = new Map();
  for (let i = 0; i < legs.length; i++) {
    const id = legs[i]?.trip?.id;
    if (id && !firstLegByTrip.has(id)) firstLegByTrip.set(id, i);
  }
  return trips.map(trip => {
    const firstIndex = firstLegByTrip.get(trip.id) ?? 0;
    const tripLegs = legs.filter(l => l.trip.id === trip.id);
    const from = tripLegs[0]?.leg?.from;
    const to = tripLegs[0]?.leg?.to || locById[trip.toLocationId];
    const traveler = travById[getTravelerKey(trip)];
    return {
      id: trip.id,
      firstIndex,
      title: trip.label || to?.name || 'Trip',
      date: trip.displayDate || String(trip.year || ''),
      mode: trip.mode || tripLegs[0]?.leg?.mode || 'plane',
      traveler: traveler?.name || 'Travel',
      color: traveler?.color || '#00e5ff',
      route: from && to ? `${formatLocation(from)} → ${formatLocation(to)}` : formatLocation(to),
      legCount: tripLegs.length
    };
  });
}

function TripTimelineDrawer({ open, rows, activeIndex, onClose, onJump }) {
  return <aside className={`trip-drawer glass ${open ? 'is-open' : ''}`} aria-hidden={!open}>
    <div className="trip-drawer__header">
      <div>
        <p className="eyebrow">Timeline</p>
        <h2>Trips</h2>
      </div>
      <button onClick={onClose}>Close</button>
    </div>
    <div className="trip-drawer__list">
      {rows.map(row => {
        const active = activeIndex >= row.firstIndex && activeIndex < row.firstIndex + Math.max(1, row.legCount || 1);
        return <button
          key={row.id}
          className={`trip-drawer__row ${active ? 'is-active' : ''}`}
          style={{ '--accent': row.color }}
          onClick={() => onJump(row.firstIndex)}
        >
          <span className="trip-drawer__date">{row.date}</span>
          <span className="trip-drawer__main">
            <strong>{row.title}</strong>
            <small>{row.route}</small>
          </span>
          <span className="trip-drawer__meta">{row.mode}{row.legCount > 1 ? ` · ${row.legCount} legs` : ''}<br />{row.traveler}</span>
        </button>;
      })}
    </div>
  </aside>;
}

function formatLocation(loc) {
  if (!loc) return '';
  const abbr = {
    Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA', Colorado: 'CO', Connecticut: 'CT', Delaware: 'DE', Florida: 'FL', Georgia: 'GA', Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL', Indiana: 'IN', Iowa: 'IA', Kansas: 'KS', Kentucky: 'KY', Louisiana: 'LA', Maine: 'ME', Maryland: 'MD', Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN', Mississippi: 'MS', Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV', 'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND', Ohio: 'OH', Oklahoma: 'OK', Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC', 'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT', Virginia: 'VA', Washington: 'WA', 'Washington DC': 'DC', 'District of Columbia': 'DC', 'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY'
  };
  if (loc.country === 'United States' && loc.region) return `${loc.name}, ${abbr[loc.region] || loc.region}`;
  return loc.name || '';
}
