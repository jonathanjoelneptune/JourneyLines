import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import TravelMap from './components/TravelMap.jsx';
import PlaybackControls from './components/PlaybackControls.jsx';
import TripCard from './components/TripCard.jsx';
import AdminPanel from './components/AdminPanel.jsx';
import { sortTrips } from './utils/dateUtils.js';
import { expandTrip, flattenLegs, getTravelerKey } from './utils/tripExpansion.js';
import { legDurationMs } from './utils/routeTiming.js';
import { normalizeHopperData, resolveTripVisual, travelerListForLegacy, multiMemberCircleBackground, segmentedBorderGradient } from './utils/hopperUtils.js';
import baseTrips from './data/trips.json';
import baseLocations from './data/locations.json';
import homeBases from './data/homeBases.json';
import baseHoppers from './data/hoppers.json';
import settings from './data/settings.json';
import parameters from './data/parameters.json';

const DEFAULT_TRAIL_TUNING = {
  solidThickness: 2.4,
  solidGlow: 0.5,
  borderThickness: 1.35,
  borderZoomFade: 1.0,
  stripeThickness: 2.5,
  stripeSegmentMiles: 80,
  stripeSeparator: 0.45,
  stripeGlow: 0.75,
  stripeBevel: 0.45,
  stripeLaneEffect: 0.4,
  ribbonThickness: 5.0,
  ribbonGap: 0.75,
  ribbonSpread: 2.5,
  ribbonGlow: 0.0,
  spiralThickness: 1.55,
  spiralSegmentMiles: 50,
  spiralAmplitude: 0.3,
  spiralGlow: 1.2,
  spiralAnimate: false
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

export default function App() {
  const [trips, setTrips] = useState(() => JSON.parse(localStorage.getItem('journeylines.trips') || 'null') || baseTrips);
  const [locations, setLocations] = useState(() => JSON.parse(localStorage.getItem('journeylines.locations') || 'null') || baseLocations);
  const [hopperData, setHopperData] = useState(() => JSON.parse(localStorage.getItem('globehoppers.hoppers') || 'null') || baseHoppers);
  const [isPlaying, setIsPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [activeIndex, setActiveIndex] = useState(999999);
  const [legProgress, setLegProgress] = useState(1);
  const [projection, setProjection] = useState(settings.defaultProjection);
  const [cameraMode, setCameraMode] = useState('follow');
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
  const [jumpFade, setJumpFade] = useState(false);
  const addTripNoun = 'Hop';
  const [hopperEditorOpen, setHopperEditorOpen] = useState(false);
  const [resetNonce, setResetNonce] = useState(0);
  const [trailTuningOpen, setTrailTuningOpen] = useState(false);
  const [timelineTuningOpen, setTimelineTuningOpen] = useState(false);
  const [trailTuning, setTrailTuning] = useState(() => {
    try { return { ...DEFAULT_TRAIL_TUNING, ...(parameters?.trailTuning || {}), ...(JSON.parse(localStorage.getItem('globehoppers.trailTuning') || 'null') || {}) }; }
    catch { return { ...DEFAULT_TRAIL_TUNING, ...(parameters?.trailTuning || {}) }; }
  });
  const [timelineTuning, setTimelineTuning] = useState(() => {
    try { return { ...DEFAULT_TIMELINE_TUNING, ...(parameters?.timelineTuning || {}), ...(JSON.parse(localStorage.getItem('globehoppers.timelineTuning') || 'null') || {}) }; }
    catch { return { ...DEFAULT_TIMELINE_TUNING, ...(parameters?.timelineTuning || {}) }; }
  });
  const [routeStackingEnabled, setRouteStackingEnabled] = useState(() => {
    try {
      const saved = localStorage.getItem('globehoppers.routeStackingEnabled');
      return saved == null ? Boolean(parameters?.routeStackingEnabled) : saved === 'true';
    } catch { return Boolean(parameters?.routeStackingEnabled); }
  });
  const clickRef = useRef(0);
  const tRef = useRef({ last: null, elapsed: 0 });
  const resumeAfterStudioRef = useRef(false);
  const resumeAfterTabHiddenRef = useRef(false);
  const SETTLE_MS = settings.arrivalSettleMs || 4000;
  const FRAME_MS = 33.333; // cap playback state updates around 30fps for smoother wall-display playback

  useEffect(() => localStorage.setItem('journeylines.trips', JSON.stringify(trips)), [trips]);
  useEffect(() => localStorage.setItem('journeylines.locations', JSON.stringify(locations)), [locations]);
  useEffect(() => localStorage.setItem('globehoppers.hoppers', JSON.stringify(hopperData)), [hopperData]);
  useEffect(() => localStorage.setItem('globehoppers.theme', theme), [theme]);
  useEffect(() => localStorage.setItem('globehoppers.trailTuning', JSON.stringify(trailTuning)), [trailTuning]);
  useEffect(() => localStorage.setItem('globehoppers.timelineTuning', JSON.stringify(timelineTuning)), [timelineTuning]);
  useEffect(() => localStorage.setItem('globehoppers.routeStackingEnabled', String(routeStackingEnabled)), [routeStackingEnabled]);
  useEffect(() => localStorage.setItem('globehoppers.timelineView', timelineView), [timelineView]);
  useEffect(() => {
    const closeStudio = () => {
      setAdmin(false);
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
  const travelers = useMemo(() => travelerListForLegacy(normalizedHoppers), [normalizedHoppers]);
  const travById = useMemo(() => Object.fromEntries(travelers.map(t => [t.id, t])), [travelers]);
  const legs = useMemo(() => flattenLegs(filteredTrips, locById, homeBases), [filteredTrips, locById]);
  const tripTimeline = useMemo(() => buildTripTimeline(filteredTrips, legs, locById, normalizedHoppers), [filteredTrips, legs, locById, normalizedHoppers]);
  const timelineMarkers = useMemo(() => buildTimelineMarkers(tripTimeline, legs.length), [tripTimeline, legs.length]);
  const timelineYearSegments = useMemo(() => buildTimelineYearSegments(tripTimeline, legs.length), [tripTimeline, legs.length]);
  const tripCardRows = useMemo(() => buildTripCardRows(tripTimeline, activeIndex), [tripTimeline, activeIndex]);
  const current = legs[Math.min(activeIndex, Math.max(0, legs.length - 1))];
  const expanded = current ? expandTrip(current.trip, locById, homeBases) : null;
  const traveler = current ? resolveTripVisual(current.trip, normalizedHoppers) : null;

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
    return () => { cancelAnimationFrame(raf); tRef.current.last = null; };
  }, [isPlaying, activeIndex, legs, speed]);

  function freezePlaybackClock() {
    const currentLeg = legs[Math.min(activeIndex, Math.max(0, legs.length - 1))]?.leg;
    const dur = legDurationMs(currentLeg?.miles || 500, speed);
    tRef.current = { last: null, elapsed: Math.max(0, Math.min(1, legProgress)) * dur };
  }

  function play() {
    const wasGlobeOverview = globeOverview;
    setGlobeOverview(false);
    setCameraMode(prev => prev === 'global' ? 'follow' : (prev || 'follow'));
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
    const currentLeg = legs[Math.min(activeIndex, Math.max(0, legs.length - 1))]?.leg;
    const dur = legDurationMs(currentLeg?.miles || 500, speed);
    const currentProgress = Math.max(0, Math.min(1, legProgress));
    tRef.current = { last: null, elapsed: currentProgress * dur };
    setLegProgress(currentProgress);
    setIsPlaying(true);
  }, [activeIndex, legProgress, legs, speed]);
  function editTravelHistory() {
    setGlobeOverview(false);
    setShowHero(false);
    setTripDrawerOpen(false);
    setStudioEditTripId(null);
    setAdmin(true);
    setStarted(true);
    setIntroLaunching(false);
  }
  function addTravelTimelineEntry() {
    resumeAfterStudioRef.current = isPlaying;
    freezePlaybackClock();
    setGlobeOverview(false);
    setShowHero(false);
    setTripDrawerOpen(false);
    setStudioEditTripId(null);
    setAdmin(true);
    setStarted(true);
    setIntroLaunching(false);
    tRef.current.last = null;
    setIsPlaying(false);
    window.setTimeout(() => window.dispatchEvent(new CustomEvent('globehoppers-open-new-trip')), 80);
  }
  function pause() { resumeAfterTabHiddenRef.current = false; freezePlaybackClock(); setIsPlaying(false); }
  function viewGlobe() {
    resumeAfterStudioRef.current = isPlaying;
    freezePlaybackClock();
    setAdmin(false);
    setTripDrawerOpen(false);
    setProjection('globe');
    setCameraMode('global');
    setGlobeOverview(true);
    setIsPlaying(false);
    setIntroLaunching(false);
    setShowHero(false);
    window.dispatchEvent(new CustomEvent('globehoppers-force-globe-overview'));
    window.setTimeout(() => window.dispatchEvent(new CustomEvent('globehoppers-force-globe-overview')), 12);
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

    const applyJump = () => {
      setGlobeOverview(false);
      setCameraMode(prev => prev === 'global' ? 'follow' : (prev || 'follow'));
      setStarted(true);
      setActiveIndex(safeIndex);
      setLegProgress(safeProgress);
      tRef.current = { last: null, elapsed: safeProgress * dur };
      setIsPlaying(Boolean(autoPlay));

      window.setTimeout(() => {
        if (selectedLeg?.from) {
          window.dispatchEvent(new CustomEvent('globehoppers-jump-to-leg-start', {
            detail: { lon: selectedLeg.from.lon, lat: selectedLeg.from.lat, mode: selectedLeg.mode, forceScene: true }
          }));
        }
      }, 0);
    };

    setJumpFade(true);
    window.setTimeout(applyJump, 115);
    window.setTimeout(() => setJumpFade(false), 360);
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

  function playTripFromStudio(tripId) {
    const index = legs.findIndex(item => item?.trip?.id === tripId);
    if (index < 0) return;
    jumpToLeg(index, 0, true);
  }

  async function saveParametersToRepo() {
    const repo = localStorage.getItem('journeylines.githubRepo') || localStorage.getItem('journeylines.repo') || 'jonathanjoelneptune/JourneyLines';
    const token = localStorage.getItem('journeylines.githubToken') || '';
    const payload = { trailTuning, timelineTuning, routeStackingEnabled };
    localStorage.setItem('globehoppers.trailTuning', JSON.stringify(trailTuning));
    localStorage.setItem('globehoppers.timelineTuning', JSON.stringify(timelineTuning));
    localStorage.setItem('globehoppers.routeStackingEnabled', String(routeStackingEnabled));
    if (!token) return false;
    await commitSingleJsonFile(repo, token, 'journeylines/src/data/parameters.json', payload, 'Update GlobeHoppers parameters');
    return true;
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

  return <main className={`app ${isPlaying ? 'is-playing' : ''}`} data-theme={theme}>
    <header className="topbar">
      <button className="brand" onClick={titleClick} title="GlobeHoppers">GlobeHoppers</button>
      <div className="tagline">All your hops, skips & jumps.</div>
      <button className="topbar-pill topbar-add" onClick={addTravelTimelineEntry}>Add Hop</button>
      <button className="topbar-pill topbar-old-timeline" aria-hidden="true" tabIndex={-1} onClick={() => { setAdmin(false); setTripDrawerOpen(v => !v); }}>Old Timeline</button>
      <button className="topbar-pill" onClick={editTravelHistory}>GlobeHopper Timeline</button>
      <button className="topbar-pill topbar-hoppers" onClick={() => { setHopperEditorOpen(true); setAdmin(false); setTripDrawerOpen(false); }}><span className="topbar-hoppers-icon" aria-hidden="true">👤</span><span>Hoppers</span></button>
      <button className="topbar-pill topbar-icon-pill topbar-fullscreen" title={document.fullscreenElement ? 'Exit fullscreen' : 'Fullscreen'} onClick={() => document.fullscreenElement ? document.exitFullscreen?.() : document.documentElement.requestFullscreen?.()}><span className="fullscreen-corners" aria-hidden="true"><i></i><i></i><i></i><i></i></span></button>
      <button className="topbar-pill topbar-icon-pill" title="View Globe" onClick={viewGlobe}>🌐</button>
      <button className="topbar-pill topbar-icon-pill" title={isPlaying ? 'Pause' : 'Play Travel History'} onClick={isPlaying ? pause : play}>{isPlaying ? '⏸' : '▶'}</button>
    </header>
    <div className={`timeline-jump-fade ${jumpFade ? 'is-active' : ''}`} />
    <TravelMap trips={filteredTrips} locations={locations} homeBases={homeBases} travelers={travelers} activeIndex={activeIndex} legProgress={legProgress} projectionName={projection} hopperData={normalizedHoppers} cameraMode={cameraMode} showTrails={showTrails} trailOpacity={settings.trailOpacity} trailWidth={settings.trailWidth} trailTuningOpen={trailTuningOpen} trailTuning={{ ...trailTuning, routeStackingEnabled }} isPlaying={isPlaying} isStarted={started} introLaunching={introLaunching} onIntroLaunchComplete={completeIntroLaunch} resetNonce={resetNonce} globeOverview={globeOverview} onMapClick={() => { if (admin) window.dispatchEvent(new CustomEvent('globehoppers-request-close-studio')); if (tripDrawerOpen) setTripDrawerOpen(false); }} />
    {!started && showHero && <section className="hero glass">
      <button type="button" className="hero-close" aria-label="Close welcome popup" title="Close" onClick={() => setShowHero(false)}>×</button>
      <p className="eyebrow">{filteredTrips.length} trips · lifetime travel archive</p>
      <h1>GlobeHoppers</h1>
      <p>All your hops, skips & jumps, replayed across a living globe.</p>
      <div className="hero-actions">
        <button className="primary big" onClick={play}>Start the Journey</button>
        <button className="primary big hero-add-hop" onClick={addTravelTimelineEntry}>Add Hop</button>
        <button className="secondary big" onClick={viewGlobe}>Explore the Globe</button>
      </div>
    </section>}
    <TripCard trip={current?.trip} expanded={expanded} traveler={traveler} isPlaying={isPlaying} rows={tripCardRows} onJumpToTrip={(index) => jumpToLeg(index, 0, true)} onOpenTrips={() => { setAdmin(false); setTripDrawerOpen(true); }} />
    <PlaybackControls isPlaying={isPlaying} onPlay={play} onPause={pause} onReset={reset} onViewGlobe={viewGlobe} progress={progress} onSeekProgress={seekTimeline} onMarkerJump={(marker) => jumpToLeg(marker.firstIndex || 0, 0, true)} speed={speed} setSpeed={setSpeed} filter={filter} setFilter={(v) => { setFilter(v); reset(); }} projection={projection} setProjection={setProjection} cameraMode={cameraMode} setCameraMode={setCameraMode} showTrails={showTrails} setShowTrails={setShowTrails} routeStackingEnabled={routeStackingEnabled} setRouteStackingEnabled={setRouteStackingEnabled} theme={theme} setTheme={setTheme} onToggleTripDrawer={() => { setAdmin(false); setTripDrawerOpen(v => !v); }} onToggleTimelineUtility={() => { setTimelineTuningOpen(v => !v); setTrailTuningOpen(false); }} timelineTuning={timelineTuning} tripMarkers={timelineMarkers} activeMarkerId={current?.trip?.id || null} yearSegments={timelineYearSegments} />
    {trailTuningOpen && <TrailTuningUtility values={trailTuning} onChange={setTrailTuning} onClose={() => setTrailTuningOpen(false)} onReset={() => setTrailTuning(DEFAULT_TRAIL_TUNING)} onSave={saveParametersToRepo} />}
    {timelineTuningOpen && <TimelineTuningUtility values={timelineTuning} onChange={setTimelineTuning} onClose={() => setTimelineTuningOpen(false)} onReset={() => setTimelineTuning(DEFAULT_TIMELINE_TUNING)} onSave={saveParametersToRepo} />}
    <TripTimelineDrawer open={tripDrawerOpen} rows={tripTimeline} activeIndex={activeIndex} initialScroll={studioDrawerScrollRef.current || tripDrawerScrollRef.current} onScrollStore={(y) => { tripDrawerScrollRef.current = y; }} onClose={() => setTripDrawerOpen(false)} onJump={(index) => jumpToLeg(index, 0, true)} onEditTrip={openStudioForTrip} viewType={timelineView} onViewTypeChange={setTimelineView} />
    <section className="about glass">
      <strong>About</strong> GlobeHoppers is an animated travel-history map for all your hops, skips & jumps. Five-click the title to open GlobeHoppers Studio.
    </section>
    {hopperEditorOpen && <HopperEditorPanel hopperData={hopperData} setHopperData={setHopperData} onClose={() => setHopperEditorOpen(false)} repo={""} />}
    {admin && <AdminPanel trips={trips} setTrips={setTrips} locations={locations} setLocations={setLocations} homeBases={homeBases} initialEditTripId={studioEditTripId} initialScroll={tripDrawerScrollRef.current || studioDrawerScrollRef.current} onScrollStore={(y) => { studioDrawerScrollRef.current = y; }} onConsumedInitialEdit={() => setStudioEditTripId(null)} viewType={timelineView} onViewTypeChange={setTimelineView} addTripNoun={addTripNoun} hopperData={hopperData} setHopperData={setHopperData} activeTripId={current?.trip?.id} onPlayTrip={playTripFromStudio} />}
  </main>;
}




function TrailTuningUtility({ values, onChange, onClose, onReset, onSave }) {
  const update = (key, value) => onChange(v => ({ ...v, [key]: value }));
  const row = (key, label, min, max, step = 0.05, suffix = 'x') => (
    <label className="trail-tuning-row">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={values[key]} onChange={e => update(key, Number(e.target.value))} />
      <b>{Number(values[key]).toFixed(step >= 1 ? 0 : 2)}{suffix}</b>
    </label>
  );
  return <aside className="trail-tuning glass">
    <div className="trail-tuning__head">
      <div><p className="eyebrow">Trail Utility</p><h3>Trail tuning</h3></div>
      <button type="button" onClick={onClose} aria-label="Close trail tuning">×</button>
    </div>
    <p className="trail-tuning__note">Demo mode hides the real trip trails and shows Solid, Stripe, Ribbon, and Spiral coast-to-coast for live tuning.</p>
    <section>
      <h4>Solid</h4>
      {row('solidThickness', 'Thickness', 0.6, 5.0, 0.05, 'x')}
      {row('solidGlow', 'Glow', 0, 2, 0.05, 'x')}
    </section>
    <section>
      <h4>All trails</h4>
      {row('borderThickness', 'Black border', 0, 3, 0.05, 'px')}
      {row('borderZoomFade', 'Border zoom fade', 0, 1, 0.05, 'x')}
    </section>
    <section>
      <h4>Stripe</h4>
      {row('stripeThickness', 'Thickness', 0.8, 5.0, 0.05, 'x')}
      {row('stripeSegmentMiles', 'Segment length', 5, 650, 5, ' mi')}
      {row('stripeSeparator', 'Dark transition', 0, 2.4, 0.05, 'x')}
      {row('stripeGlow', 'Glow', 0, 2, 0.05, 'x')}
      {row('stripeBevel', 'Bevel/highlight', 0, 1.5, 0.05, 'x')}
      {row('stripeLaneEffect', 'Lane contrast', 0, 2, 0.05, 'x')}
    </section>
    <section>
      <h4>Ribbon</h4>
      {row('ribbonThickness', 'Thickness', 0.9, 5.0, 0.05, 'x')}
      {row('ribbonSpread', 'Spread', 0, 3.0, 0.05, 'x')}
      {row('ribbonGap', 'Dark separation', 0, 1.4, 0.05, 'x')}
      {row('ribbonGlow', 'Glow', 0, 2, 0.05, 'x')}
    </section>
    <section>
      <h4>Spiral</h4>
      {row('spiralThickness', 'Thickness', 0.9, 3.2, 0.05, 'x')}
      {row('spiralSegmentMiles', 'Twist length', 50, 360, 10, ' mi')}
      {row('spiralAmplitude', 'Twist depth', 0.3, 2.4, 0.05, 'x')}
      {row('spiralGlow', 'Glow', 0, 2, 0.05, 'x')}
      <label className="trail-tuning-check"><input type="checkbox" checked={!!values.spiralAnimate} onChange={e => update('spiralAnimate', e.target.checked)} /> Animate spiral</label>
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
      year: trip.year || String(trip.date || '').slice(0, 4) || '',
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
