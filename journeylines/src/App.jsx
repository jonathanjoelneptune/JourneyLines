import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import TravelMap from './components/TravelMap.jsx';
import PlaybackControls from './components/PlaybackControls.jsx';
import TripCard from './components/TripCard.jsx';
import AdminPanel from './components/AdminPanel.jsx';
import { sortTrips } from './utils/dateUtils.js';
import { expandTrip, flattenLegs, getTravelerKey } from './utils/tripExpansion.js';
import { legDurationMs } from './utils/routeTiming.js';
import baseTrips from './data/trips.json';
import baseLocations from './data/locations.json';
import homeBases from './data/homeBases.json';
import travelers from './data/travelers.json';
import settings from './data/settings.json';

export default function App() {
  const [trips, setTrips] = useState(() => JSON.parse(localStorage.getItem('journeylines.trips') || 'null') || baseTrips);
  const [locations, setLocations] = useState(() => JSON.parse(localStorage.getItem('journeylines.locations') || 'null') || baseLocations);
  const [isPlaying, setIsPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [activeIndex, setActiveIndex] = useState(999999);
  const [legProgress, setLegProgress] = useState(1);
  const [projection, setProjection] = useState(settings.defaultProjection);
  const [cameraMode, setCameraMode] = useState('route');
  const [showTrails, setShowTrails] = useState(settings.showTrails);
  const [speed, setSpeed] = useState(settings.playbackSpeed);
  const [filter, setFilter] = useState('all');
  const [admin, setAdmin] = useState(false);
  const [tripDrawerOpen, setTripDrawerOpen] = useState(false);
  const [studioEditTripId, setStudioEditTripId] = useState(null);
  const tripDrawerScrollRef = useRef(0);
  const studioDrawerScrollRef = useRef(0);
  const [introLaunching, setIntroLaunching] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem('globehoppers.theme') || 'bold-dark');
  const [timelineView, setTimelineView] = useState(() => localStorage.getItem('globehoppers.timelineView') || 'expanded');
  const [showHero, setShowHero] = useState(true);
  const [globeOverview, setGlobeOverview] = useState(false);
  const [addTripNoun] = useState(() => ['Hop', 'Skip', 'Jump'][Math.floor(Math.random() * 3)]);
  const [resetNonce, setResetNonce] = useState(0);
  const clickRef = useRef(0);
  const tRef = useRef({ last: null, elapsed: 0 });
  const resumeAfterStudioRef = useRef(false);
  const SETTLE_MS = settings.arrivalSettleMs || 4000;
  const FRAME_MS = 33.333; // cap playback state updates around 30fps for smoother wall-display playback

  useEffect(() => localStorage.setItem('journeylines.trips', JSON.stringify(trips)), [trips]);
  useEffect(() => localStorage.setItem('journeylines.locations', JSON.stringify(locations)), [locations]);
  useEffect(() => localStorage.setItem('globehoppers.theme', theme), [theme]);
  useEffect(() => localStorage.setItem('globehoppers.timelineView', timelineView), [timelineView]);
  useEffect(() => {
    const closeStudio = () => {
      setAdmin(false);
      if (resumeAfterStudioRef.current) {
        resumeAfterStudioRef.current = false;
        setIsPlaying(true);
      }
    };
    window.addEventListener('globehoppers-close-studio', closeStudio);
    return () => window.removeEventListener('globehoppers-close-studio', closeStudio);
  }, []);

  const sortedTrips = useMemo(() => sortTrips(trips), [trips]);
  const filteredTrips = useMemo(() => sortedTrips.filter(t => {
    const hasJ = t.travelers?.includes('joey'), hasB = t.travelers?.includes('bonnie');
    if (filter === 'joey') return hasJ;
    if (filter === 'bonnie') return hasB;
    if (filter === 'together') return hasJ && hasB;
    return true;
  }), [sortedTrips, filter]);
  const locById = useMemo(() => Object.fromEntries(locations.map(l => [l.id, l])), [locations]);
  const travById = useMemo(() => Object.fromEntries(travelers.map(t => [t.id, t])), []);
  const legs = useMemo(() => flattenLegs(filteredTrips, locById, homeBases), [filteredTrips, locById]);
  const tripTimeline = useMemo(() => buildTripTimeline(filteredTrips, legs, locById, travById), [filteredTrips, legs, locById, travById]);
  const tripCardRows = useMemo(() => buildTripCardRows(tripTimeline, activeIndex), [tripTimeline, activeIndex]);
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
    const wasGlobeOverview = globeOverview;
    setGlobeOverview(false);
    setCameraMode(prev => prev === 'global' ? 'route' : (prev || 'route'));
    setShowHero(false);
    setAdmin(false);
    setTripDrawerOpen(false);
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
      if (wasGlobeOverview) {
        setIsPlaying(false);
        setIntroLaunching(true);
      } else {
        setIsPlaying(true);
      }
    }
  }
  const completeIntroLaunch = useCallback(() => {
    setIntroLaunching(false);
    tRef.current = { last: null, elapsed: 0 };
    setLegProgress(0);
    setIsPlaying(true);
  }, []);
  function editTravelHistory() {
    resumeAfterStudioRef.current = isPlaying;
    setGlobeOverview(false);
    setShowHero(false);
    setTripDrawerOpen(false);
    setStudioEditTripId(null);
    setAdmin(true);
    setStarted(true);
    setIntroLaunching(false);
    setIsPlaying(false);
  }
  function addTravelTimelineEntry() {
    resumeAfterStudioRef.current = isPlaying;
    setGlobeOverview(false);
    setShowHero(false);
    setTripDrawerOpen(false);
    setStudioEditTripId(null);
    setAdmin(true);
    setStarted(true);
    setIntroLaunching(false);
    setIsPlaying(false);
    window.setTimeout(() => window.dispatchEvent(new CustomEvent('globehoppers-open-new-trip')), 80);
  }
  function pause() { setIsPlaying(false); }
  function viewGlobe() {
    setAdmin(false);
    setTripDrawerOpen(false);
    setProjection('globe');
    setCameraMode('global');
    setGlobeOverview(true);
    setIsPlaying(false);
    setIntroLaunching(false);
    setShowHero(false);
    setResetNonce(n => n + 1);
  }
  function reset() {
    setIsPlaying(false);
    setIntroLaunching(false);
    setStarted(false);
    setShowHero(false);
    setGlobeOverview(true);
    setActiveIndex(999999);
    setLegProgress(1);
    setCameraMode('global');
    setResetNonce(n => n + 1);
  }
  function jumpToLeg(index, progressWithinLeg = 0, autoPlay = false) {
    if (!legs.length) return;
    const safeIndex = Math.max(0, Math.min(legs.length - 1, Math.floor(index)));
    const safeProgress = Math.max(0, Math.min(1, progressWithinLeg));
    const selectedLeg = legs[safeIndex]?.leg;
    const dur = legDurationMs(selectedLeg?.miles || 500, speed);
    if (selectedLeg?.from) {
      window.dispatchEvent(new CustomEvent('globehoppers-jump-to-leg-start', {
        detail: { lon: selectedLeg.from.lon, lat: selectedLeg.from.lat, mode: selectedLeg.mode }
      }));
    }
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
  function openStudioForTrip(tripId) {
    setTripDrawerOpen(false);
    setStudioEditTripId(tripId);
    setAdmin(true);
    setStarted(true);
    setIntroLaunching(false);
    setIsPlaying(false);
  }

  function titleClick() {
    clickRef.current += 1;
    setTimeout(() => { clickRef.current = 0; }, 900);
    if (clickRef.current >= settings.adminClickCount) { setAdmin(a => !a); clickRef.current = 0; }
  }

  const progress = legs.length ? Math.min(1, (Math.min(activeIndex, legs.length - 1) + Math.min(1, legProgress)) / legs.length) : 1;

  return <main className={`app ${isPlaying ? 'is-playing' : ''}`} data-theme={theme}>
    <header className="topbar">
      <button className="brand" onClick={titleClick} title="GlobeHoppers">GlobeHoppers</button>
      <div className="tagline">All your hops, skips & jumps.</div>
      <button className="topbar-pill topbar-add" onClick={addTravelTimelineEntry}>Add {addTripNoun}</button>
      <button className="topbar-pill topbar-edit" onClick={editTravelHistory}>Edit Travel Timeline</button>
      <button className="topbar-pill" onClick={() => { setAdmin(false); setTripDrawerOpen(v => !v); }}>Travel Timeline</button>
      <button className="topbar-pill topbar-icon-pill topbar-fullscreen" title={document.fullscreenElement ? 'Exit fullscreen' : 'Fullscreen'} onClick={() => document.fullscreenElement ? document.exitFullscreen?.() : document.documentElement.requestFullscreen?.()}><span className="fullscreen-corners" aria-hidden="true"><i></i><i></i><i></i><i></i></span></button>
      <button className="topbar-pill topbar-icon-pill" title="View Globe" onClick={viewGlobe}>🌐</button>
      <button className="topbar-pill topbar-icon-pill" title={isPlaying ? 'Pause' : 'Play Travel History'} onClick={isPlaying ? pause : play}>{isPlaying ? '⏸' : '▶'}</button>
    </header>
    <TravelMap trips={filteredTrips} locations={locations} homeBases={homeBases} travelers={travelers} activeIndex={activeIndex} legProgress={legProgress} projectionName={projection} cameraMode={cameraMode} showTrails={showTrails} trailOpacity={settings.trailOpacity} trailWidth={settings.trailWidth} isPlaying={isPlaying} isStarted={started} introLaunching={introLaunching} onIntroLaunchComplete={completeIntroLaunch} resetNonce={resetNonce} globeOverview={globeOverview} onMapClick={() => { if (admin) window.dispatchEvent(new CustomEvent('globehoppers-request-close-studio')); if (tripDrawerOpen) setTripDrawerOpen(false); }} />
    {!started && showHero && <section className="hero glass">
      <p className="eyebrow">{filteredTrips.length} trips · lifetime travel archive</p>
      <h1>GlobeHoppers</h1>
      <p>All your hops, skips & jumps, replayed across a living globe.</p>
      <div className="hero-actions">
        <button className="primary big" onClick={play}>Play Travel History</button>
        <button className="secondary big" onClick={editTravelHistory}>Edit Travel History</button>
        <button className="secondary big" onClick={viewGlobe}>View Globe</button>
      </div>
    </section>}
    <TripCard trip={current?.trip} expanded={expanded} traveler={traveler} isPlaying={isPlaying} rows={tripCardRows} onJumpToTrip={(index) => jumpToLeg(index, 0, true)} onOpenTrips={() => { setAdmin(false); setTripDrawerOpen(true); }} />
    <PlaybackControls isPlaying={isPlaying} onPlay={play} onPause={pause} onReset={reset} onViewGlobe={viewGlobe} progress={progress} onSeekProgress={seekTimeline} speed={speed} setSpeed={setSpeed} filter={filter} setFilter={(v) => { setFilter(v); reset(); }} projection={projection} setProjection={setProjection} cameraMode={cameraMode} setCameraMode={setCameraMode} showTrails={showTrails} setShowTrails={setShowTrails} theme={theme} setTheme={setTheme} onToggleTripDrawer={() => { setAdmin(false); setTripDrawerOpen(v => !v); }} />
    <TripTimelineDrawer open={tripDrawerOpen} rows={tripTimeline} activeIndex={activeIndex} initialScroll={studioDrawerScrollRef.current || tripDrawerScrollRef.current} onScrollStore={(y) => { tripDrawerScrollRef.current = y; }} onClose={() => setTripDrawerOpen(false)} onJump={(index) => jumpToLeg(index, 0, true)} onEditTrip={openStudioForTrip} viewType={timelineView} onViewTypeChange={setTimelineView} addTripNoun={addTripNoun} />
    <section className="about glass">
      <strong>About</strong> GlobeHoppers is an animated travel-history map for all your hops, skips & jumps. Five-click the title to open GlobeHoppers Studio.
    </section>
    {admin && <AdminPanel trips={trips} setTrips={setTrips} locations={locations} setLocations={setLocations} homeBases={homeBases} initialEditTripId={studioEditTripId} initialScroll={tripDrawerScrollRef.current || studioDrawerScrollRef.current} onScrollStore={(y) => { studioDrawerScrollRef.current = y; }} onConsumedInitialEdit={() => setStudioEditTripId(null)} viewType={timelineView} onViewTypeChange={setTimelineView} addTripNoun={addTripNoun} />}
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
      legCount: tripLegs.length,
      year: trip.year || String(trip.date || '').slice(0, 4) || '',
      toLocationId: trip.toLocationId,
      notes: trip.notes || trip.occasion || '',
      trip
    };
  });
}

function TripTimelineDrawer({ open, rows, activeIndex, initialScroll, onScrollStore, onClose, onJump, onEditTrip, viewType = 'expanded', onViewTypeChange }) {
  const [menu, setMenu] = useState(null);
  const listRef = useRef(null);
  useEffect(() => {
    if (!open || !listRef.current) return;
    requestAnimationFrame(() => { if (listRef.current) listRef.current.scrollTop = initialScroll || 0; });
  }, [open, initialScroll]);
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
        <h2>Travel Timeline</h2>
      </div>
      <div ref={listRef} className={`trip-drawer__list trip-drawer__list--${viewType}`} onWheel={(e) => e.stopPropagation()} onScroll={(e) => onScrollStore?.(e.currentTarget.scrollTop)}>
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
    className={`trip-drawer__row ${active ? 'is-active' : ''} trip-row-view--${viewType}`}
    style={{ '--accent': row.color }}
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
