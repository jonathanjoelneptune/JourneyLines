import { useEffect, useMemo, useRef, useState } from 'react';
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
  const clickRef = useRef(0);
  const tRef = useRef({ last: null, elapsed: 0 });

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
  const current = legs[Math.min(activeIndex, Math.max(0, legs.length - 1))];
  const expanded = current ? expandTrip(current.trip, locById, homeBases) : null;
  const traveler = current ? travById[getTravelerKey(current.trip)] : null;

  useEffect(() => {
    if (!isPlaying || !legs.length) return;
    let raf;
    const step = (ts) => {
      if (tRef.current.last == null) tRef.current.last = ts;
      const dt = ts - tRef.current.last;
      tRef.current.last = ts;
      const dur = legDurationMs(legs[Math.min(activeIndex, legs.length - 1)]?.leg.miles || 500, speed);
      tRef.current.elapsed += dt;
      const p = Math.min(1, tRef.current.elapsed / dur);
      setLegProgress(p);
      if (p >= 1) {
        tRef.current.elapsed = 0;
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
    if (!started || activeIndex >= legs.length - 1) { setActiveIndex(0); setLegProgress(0); setStarted(true); }
    tRef.current = { last: null, elapsed: 0 };
    setIsPlaying(true);
  }
  function pause() { setIsPlaying(false); }
  function reset() { setIsPlaying(false); setStarted(false); setActiveIndex(999999); setLegProgress(1); }
  function titleClick() {
    clickRef.current += 1;
    setTimeout(() => { clickRef.current = 0; }, 900);
    if (clickRef.current >= settings.adminClickCount) { setAdmin(a => !a); clickRef.current = 0; }
  }

  const progress = legs.length ? Math.min(1, (Math.min(activeIndex, legs.length - 1) + legProgress) / legs.length) : 1;

  return <main className={`app ${isPlaying ? 'is-playing' : ''}`}>
    <header className="topbar">
      <button className="brand" onClick={titleClick} title="JourneyLines">JourneyLines</button>
      <div className="tagline">Animated travel history across a living world atlas</div>
      <button onClick={() => document.documentElement.requestFullscreen?.()}>Fullscreen</button>
    </header>
    <TravelMap trips={filteredTrips} locations={locations} homeBases={homeBases} travelers={travelers} activeIndex={activeIndex} legProgress={legProgress} projectionName={projection} cameraMode={cameraMode} showTrails={showTrails} trailOpacity={settings.trailOpacity} trailWidth={settings.trailWidth} />
    {!started && <section className="hero glass">
      <p className="eyebrow">{filteredTrips.length} trips · lifetime travel archive</p>
      <h1>JourneyLines</h1>
      <p>A living map that replays where you have been, then settles into the web of every route.</p>
      <button className="primary big" onClick={play}>Play Travel History</button>
    </section>}
    <TripCard trip={current?.trip} expanded={expanded} traveler={traveler} />
    <PlaybackControls isPlaying={isPlaying} onPlay={play} onPause={pause} onReset={reset} progress={progress} speed={speed} setSpeed={setSpeed} filter={filter} setFilter={(v) => { setFilter(v); reset(); }} projection={projection} setProjection={setProjection} cameraMode={cameraMode} setCameraMode={setCameraMode} showTrails={showTrails} setShowTrails={setShowTrails} />
    <section className="about glass">
      <strong>About</strong> JourneyLines is an animated travel-history map that replays a lifetime of trips across a living world atlas. Five-click the title to open Admin Mode.
    </section>
    {admin && <AdminPanel trips={trips} setTrips={setTrips} locations={locations} />}
  </main>;
}
