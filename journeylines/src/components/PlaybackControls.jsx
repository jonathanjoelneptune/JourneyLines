import { useEffect, useMemo, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import HopResultCards from './HopResultCards.jsx';

export default function PlaybackControls({ isPlaying, hasPlaybackStarted = false, timelineComplete = false, isRelocating = false, onPlay, onPause, onReset, onViewGlobe, globeControlsVisible = false, globeSpinSpeed = 0.55, onGlobeSpinSpeedChange = () => {}, globeSpinPaused = false, onToggleGlobeSpin = () => {}, onGlobeZoom = () => {}, progress, onSeekProgress, onMarkerJump, onMarkerEdit, destinationMatchIds = [], speed, setSpeed, filter, setFilter, projection, setProjection, cameraMode, setCameraMode, showTrails, setShowTrails, routeStackingEnabled = false, setRouteStackingEnabled = () => {}, placeBackgroundsEnabled = true, setPlaceBackgroundsEnabled = () => {}, theme, setTheme, onToggleTripDrawer, onToggleTimelineUtility, timelineTuning = {}, tripMarkers = [], activeMarkerId = null, yearSegments = [], monthTicks = [], timelineYearSpan = 1, searchRows = [], routeDetailsStatus = null, routingStatus = null, onRetryRouting = null, tripsDataStatus = null, hopperIntegrity = null, repoSaveStatus = null, onRetryRepoSave = null, routeDetailsMessage = '', routeDetailsBusy = false, onRebuildRouteDetails = null }) {
  const pct = Math.round(Math.max(0, Math.min(1, progress || 0)) * 1000);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [debouncedSearchText, setDebouncedSearchText] = useState('');
  const [hoverMarker, setHoverMarker] = useState(null);
  const [leavingMarkerId, setLeavingMarkerId] = useState(null);
  const [enteringMarkerId, setEnteringMarkerId] = useState(null);
  const advancedRef = useRef(null);
  const searchRef = useRef(null);
  const searchInputRef = useRef(null);
  const advancedToggleRef = useRef(null);
  const previousActiveIdRef = useRef(activeMarkerId);
  const transitionTimerRef = useRef(null);
  const playClickCountRef = useRef(0);
  const playClickTimerRef = useRef(null);
  const [timelineZoom, setTimelineZoom] = useState(1);
  const [timelineAnimating, setTimelineAnimating] = useState(false);
  const timelineAnimationTimerRef = useRef(null);
  const timelineViewportRef = useRef(null);
  const timelineDragRef = useRef(null);
  const [floatingTooltipPosition, setFloatingTooltipPosition] = useState(null);
  const destinationMatchSet = useMemo(() => new Set(destinationMatchIds || []), [destinationMatchIds]);
  const displayMarkers = useMemo(() => clusterTimelineMarkers(tripMarkers, timelineZoom, destinationMatchSet), [tripMarkers, timelineZoom, destinationMatchSet]);
  const activeMarker = tripMarkers.find(marker => marker.id === activeMarkerId) || null;
  const visibleTimelineYears = Math.max(1 / 12, Number(timelineYearSpan) || 1) / Math.max(1, timelineZoom);
  const visibleMonthTicks = useMemo(() => {
    if (visibleTimelineYears > 3.25) return [];
    // A month label is meaningful only when a Hop exists in that month. Keeping
    // labels attached to actual pins avoids an artificial calendar grid and
    // makes the rail read like a travel timeline.
    const seen = new Set();
    return (monthTicks || []).filter(tick => {
      const key = `${tick.year}-${tick.month}`;
      if (!tick.hasPin || seen.has(key)) return false;
      seen.add(key);
      return true;
    }).map(tick => ({ ...tick, displayLabel: tick.label }));
  }, [monthTicks, visibleTimelineYears]);
  const searchResults = useMemo(() => {
    const query = normalizeSearchText(debouncedSearchText);
    if (query.length < 2) return [];
    const terms = query.split(/\s+/).filter(Boolean);
    return (searchRows || []).filter(row => {
      const haystack = normalizeSearchText([
        row.title, row.date, row.year, row.route, row.traveler, row.mode, row.notes,
        row.trip?.occasion, row.trip?.label, row.trip?.displayDate
      ].filter(Boolean).join(' '));
      return terms.every(term => haystack.includes(term));
    }).slice(0, 80);
  }, [debouncedSearchText, searchRows]);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearchText(searchText), 120);
    return () => window.clearTimeout(timer);
  }, [searchText]);

  useEffect(() => {
    if (!searchOpen) return;
    setAdvancedOpen(false);
    window.requestAnimationFrame(() => searchInputRef.current?.focus());
    const closeOutside = event => {
      if (searchRef.current && !searchRef.current.contains(event.target)) setSearchOpen(false);
    };
    const closeOnEscape = event => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setSearchOpen(false);
    };
    window.addEventListener('pointerdown', closeOutside);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('pointerdown', closeOutside);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [searchOpen]);

  useEffect(() => {
    const closeSearch = () => { setSearchOpen(false); setSearchText(''); };
    window.addEventListener('globehoppers-close-search', closeSearch);
    return () => window.removeEventListener('globehoppers-close-search', closeSearch);
  }, []);

  useEffect(() => {
    const handleSpacebar = (event) => {
      if (event.code !== 'Space' || event.repeat) return;
      const target = event.target;
      if (target?.closest?.('input, textarea, select, button, [contenteditable="true"]')) return;
      event.preventDefault();
      if (timelineComplete || isRelocating) return;
      (isPlaying ? onPause : onPlay)?.();
    };
    window.addEventListener('keydown', handleSpacebar);
    return () => window.removeEventListener('keydown', handleSpacebar);
  }, [isPlaying, timelineComplete, isRelocating, onPause, onPlay]);

  useEffect(() => {
    if (!advancedOpen) return;
    const closeOutside = (event) => {
      if (advancedRef.current && !advancedRef.current.contains(event.target)) setAdvancedOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setAdvancedOpen(false);
      window.requestAnimationFrame(() => advancedToggleRef.current?.focus());
    };
    window.addEventListener('pointerdown', closeOutside);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      window.removeEventListener('pointerdown', closeOutside);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [advancedOpen]);

  useEffect(() => {
    const previous = previousActiveIdRef.current;
    if (previous === activeMarkerId) return;
    window.clearTimeout(transitionTimerRef.current);
    setLeavingMarkerId(previous || null);
    setEnteringMarkerId(activeMarkerId || null);
    previousActiveIdRef.current = activeMarkerId;
    transitionTimerRef.current = window.setTimeout(() => {
      setLeavingMarkerId(null);
      setEnteringMarkerId(null);
    }, 420);
    return () => window.clearTimeout(transitionTimerRef.current);
  }, [activeMarkerId]);


  const handlePlayPauseClick = () => {
    window.clearTimeout(playClickTimerRef.current);
    playClickCountRef.current += 1;
    playClickTimerRef.current = window.setTimeout(() => { playClickCountRef.current = 0; }, 900);
    if (playClickCountRef.current >= 5) {
      playClickCountRef.current = 0;
      onToggleTimelineUtility?.();
      return;
    }
    if (timelineComplete || isRelocating) return;
    (isPlaying ? onPause : onPlay)?.();
  };


  const changeTimelineZoom = (nextZoom, focusProgress = activeMarker?.progress ?? progress ?? 0) => {
    const viewport = timelineViewportRef.current;
    const previousZoom = timelineZoom;
    const clamped = Math.max(1, Math.min(16, Number(nextZoom) || 1));
    if (Math.abs(clamped - previousZoom) < 0.001) return;
    const viewportWidth = viewport?.clientWidth || 1;
    const focus = Math.max(0, Math.min(1, Number(focusProgress) || 0));
    const focusX = focus * viewportWidth * previousZoom - (viewport?.scrollLeft || 0);
    clearTimeout(timelineAnimationTimerRef.current);
    setTimelineAnimating(true);
    setTimelineZoom(clamped);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!viewport) return;
      const targetLeft = clamped <= 1.001 ? 0 : Math.max(0, focus * viewportWidth * clamped - focusX);
      if (clamped <= 1.001) {
        viewport.scrollLeft = 0;
        viewport.scrollTo({ left: 0, behavior: 'auto' });
      } else {
        viewport.scrollTo({ left: targetLeft, behavior: 'smooth' });
      }
      timelineAnimationTimerRef.current = window.setTimeout(() => setTimelineAnimating(false), 620);
    }));
  };

  const recenterTimeline = () => {
    const viewport = timelineViewportRef.current;
    if (!viewport) return;
    const target = activeMarker?.progress ?? progress ?? 0;
    const contentWidth = viewport.clientWidth * timelineZoom;
    viewport.scrollTo({ left: Math.max(0, target * contentWidth - viewport.clientWidth / 2), behavior: 'smooth' });
  };

  useEffect(() => {
    if (!isPlaying || timelineZoom <= 1) return;
    recenterTimeline();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeMarkerId]);

  const beginTimelinePan = event => {
    if (timelineZoom <= 1 || event.target?.closest?.('button, input')) return;
    const viewport = timelineViewportRef.current;
    if (!viewport) return;
    timelineDragRef.current = { pointerId: event.pointerId, x: event.clientX, scrollLeft: viewport.scrollLeft };
    viewport.setPointerCapture?.(event.pointerId);
  };
  const moveTimelinePan = event => {
    const drag = timelineDragRef.current;
    const viewport = timelineViewportRef.current;
    if (!drag || !viewport || drag.pointerId !== event.pointerId) return;
    viewport.scrollLeft = drag.scrollLeft - (event.clientX - drag.x);
  };
  const endTimelinePan = event => {
    if (timelineDragRef.current?.pointerId === event.pointerId) timelineDragRef.current = null;
  };

  const timelineStyle = {
    '--tl-inactive-head': `${Number(timelineTuning.inactiveHeadSize ?? 14)}px`,
    '--tl-inactive-stem': `${Number(timelineTuning.inactiveStemLength ?? 8)}px`,
    '--tl-active-head': `${Number(timelineTuning.activeHeadSize ?? 14)}px`,
    '--tl-active-stem': `${Number(timelineTuning.activeStemLength ?? 42)}px`,
    '--tl-active-lift': `${Number(timelineTuning.activeLift ?? 34)}px`,
    '--tl-pin-base-y': `${Number(timelineTuning.pinBaseY ?? 1)}px`,
    '--tl-bar-height': `${Number(timelineTuning.playbackBarHeight ?? 4)}px`,
    '--tl-year-offset': `${Number(timelineTuning.yearOffsetY ?? 5)}px`,
    '--tl-tooltip-offset': `${Number(timelineTuning.tooltipOffsetY ?? 68)}px`,
    '--tl-animation-ms': `${Number(timelineTuning.animationMs ?? 360)}ms`,
    '--tl-overshoot': `${Number(timelineTuning.animationOvershoot ?? 1.12)}`
  };

  const tooltipMarker = hoverMarker || activeMarker;

  useEffect(() => {
    const viewport = timelineViewportRef.current;
    if (!viewport || !tooltipMarker) {
      setFloatingTooltipPosition(null);
      return;
    }
    const update = () => {
      const rect = viewport.getBoundingClientRect();
      const contentWidth = Math.max(rect.width, viewport.scrollWidth || rect.width);
      const x = rect.left + Number(tooltipMarker.progress || 0) * contentWidth - viewport.scrollLeft;
      setFloatingTooltipPosition({
        left: Math.max(rect.left + 44, Math.min(rect.right - 44, x)),
        bottom: Math.max(12, window.innerHeight - rect.top + 8)
      });
    };
    update();
    viewport.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    return () => {
      viewport.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, [tooltipMarker, timelineZoom]);
  const playbackActionLabel = isRelocating ? 'Moving…' : timelineComplete ? 'Complete' : (isPlaying ? 'Pause' : (hasPlaybackStarted ? 'Resume' : 'Play'));
  const playbackActionAriaLabel = isRelocating
    ? 'Moving the camera to the next Hop. Playback will resume automatically.'
    : timelineComplete
      ? 'Timeline complete. Use Restart Journey to begin again.'
      : (isPlaying ? 'Pause travel timeline' : (hasPlaybackStarted ? 'Resume travel timeline' : 'Play travel timeline'));

  return <div className="controls glass" style={timelineStyle}>
    <button type="button" className="controls-play-pill" disabled={isRelocating} onClick={handlePlayPauseClick} aria-pressed={isPlaying} aria-disabled={timelineComplete || isRelocating} aria-label={playbackActionAriaLabel} title={isRelocating ? 'Moving to the next Hop' : timelineComplete ? 'Timeline complete — use Restart Journey' : undefined}>{playbackActionLabel}</button>
    <div className="timeline-scrubber">
      <div className="timeline-scrubber__header timeline-scrubber__header--controls-only">
        <div className="timeline-zoom-controls" aria-label="Timeline zoom controls">
          <button type="button" onClick={() => changeTimelineZoom(timelineZoom / 1.5)} disabled={timelineZoom <= 1.001} aria-label="Zoom timeline out">−</button>
          <button type="button" onClick={() => changeTimelineZoom(1, 0.5)} disabled={timelineZoom <= 1.001}>Fit</button>
          <button type="button" onClick={() => changeTimelineZoom(timelineZoom * 1.5)} disabled={timelineZoom >= 15.999} aria-label="Zoom timeline in">+</button>
          <button type="button" onClick={recenterTimeline} disabled={timelineZoom <= 1.001}>Recenter</button>
        </div>
      </div>
      <div
        ref={timelineViewportRef}
        className={`timeline-scroll-viewport ${timelineZoom > 1 ? 'is-zoomed' : ''} ${visibleMonthTicks.length ? 'has-months' : ''} ${timelineAnimating ? 'is-animating' : ''}`}
        onPointerDown={beginTimelinePan}
        onPointerMove={moveTimelinePan}
        onPointerUp={endTimelinePan}
        onPointerCancel={endTimelinePan}
        onWheel={(event) => {
          if (event.ctrlKey || event.metaKey) {
            event.preventDefault();
            changeTimelineZoom(timelineZoom * (event.deltaY < 0 ? 1.18 : 0.85));
          } else if (timelineZoom > 1 && Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
            event.preventDefault();
            timelineViewportRef.current.scrollLeft += event.deltaY;
          }
        }}
      >
        <div className="timeline-scroll-content" style={{ width: `${timelineZoom * 100}%` }}>
          <div className="timeline-scrubber-stack">
            <div className="progress progress--scrubbable" onMouseMove={(e) => { if (e.target === e.currentTarget || e.target.tagName === 'INPUT' || e.target.tagName === 'SPAN') setHoverMarker(null); }} onMouseLeave={() => setHoverMarker(null)}>
              <span style={{ width: `${Math.max(0, Math.min(1, progress || 0)) * 100}%` }} />
              <div className="timeline-marker-layer">
                {displayMarkers.map(item => {
                  if (item.type === 'cluster') return <button
                    key={item.id}
                    type="button"
                    className="timeline-marker timeline-marker--cluster"
                    style={{ '--marker-left': `${item.progress * 100}%`, '--marker-color': item.color || '#00e5ff', '--marker-background': item.color || '#00e5ff' }}
                    aria-label={`${item.count} Hops in this period. Zoom in to choose one.`}
                    onClick={(event) => { event.preventDefault(); event.stopPropagation(); changeTimelineZoom(Math.max(2.5, timelineZoom * 2.2), item.progress); }}
                  ><span>{item.count}</span></button>;
                  const marker = item.marker;
                  const isCurrent = activeMarkerId === marker.id;
                  const isEntering = enteringMarkerId === marker.id;
                  const isLeaving = leavingMarkerId === marker.id;
                  const isHovered = hoverMarker?.id === marker.id;
                  const isDestinationMatch = destinationMatchSet.has(marker.id);
                  return <button
                    key={marker.id}
                    type="button"
                    className={[
                      'timeline-marker',
                      isHovered || isCurrent ? 'is-active' : '',
                      isCurrent ? 'is-current' : '',
                      isEntering ? 'is-entering' : '',
                      isLeaving ? 'is-leaving' : '',
                      isDestinationMatch ? 'is-destination-match' : ''
                    ].filter(Boolean).join(' ')}
                    style={{ '--marker-left': `${marker.progress * 100}%`, '--marker-color': marker.color || '#00e5ff', '--marker-background': marker.markerBackground || marker.color || '#00e5ff' }}
                    aria-label={`${marker.title} · ${marker.date}`}
                    aria-current={isCurrent ? 'true' : undefined}
                    onMouseEnter={() => setHoverMarker(marker)}
                    onMouseLeave={() => setHoverMarker(null)}
                    onFocus={() => setHoverMarker(marker)}
                    onBlur={() => setHoverMarker(null)}
                    onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onMarkerEdit?.(marker); }}
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); onMarkerJump ? onMarkerJump(marker) : onSeekProgress?.(marker.progress); }}
                  ></button>;
                })}
              </div>
              <input
                aria-label="Travel timeline"
                type="range"
                min="0"
                max="1000"
                step="1"
                value={pct}
                onMouseEnter={() => setHoverMarker(null)}
                onMouseMove={() => setHoverMarker(null)}
                onChange={e => onSeekProgress?.(Number(e.target.value) / 1000)}
              />
            </div>
            <div className="timeline-year-scale" aria-hidden="true">
              {yearSegments.map(segment => <span key={segment.year} className="timeline-year-scale__segment" style={{ left: `${segment.start * 100}%`, width: `${Math.max(0, segment.end - segment.start) * 100}%` }}>
                <b>{segment.year}</b>
              </span>)}
            </div>
            {visibleMonthTicks.length > 0 && <div className="timeline-month-scale" aria-hidden="true">
              {visibleMonthTicks.map(tick => <span key={tick.id} className="timeline-month-scale__tick" style={{ left: `${tick.progress * 100}%` }}>
                <i></i><b>{tick.displayLabel || tick.label}</b>
              </span>)}
            </div>}
          </div>
        </div>
      </div>
    </div>
    {tooltipMarker && floatingTooltipPosition && <span
      className={`timeline-marker__tooltip timeline-marker__tooltip--floating is-visible ${hoverMarker ? 'is-hovered' : 'is-current'} ${tooltipMarker.id === activeMarkerId ? 'is-current' : ''}`}
      style={{ left: `${floatingTooltipPosition.left}px`, bottom: `${floatingTooltipPosition.bottom}px`, '--marker-color': tooltipMarker.color || '#00e5ff', '--marker-background': tooltipMarker.markerBackground || tooltipMarker.color || '#00e5ff' }}
    >
      <strong className="timeline-marker__tooltip-title">{tooltipMarker.title}</strong><small className="timeline-marker__tooltip-date">{tooltipMarker.date}</small>
    </span>}
    {globeControlsVisible && <div className="globe-playback-controls" aria-label="Globe controls">
      <button type="button" onClick={() => onGlobeZoom(-0.5)} aria-label="Zoom globe out">−</button>
      <button type="button" onClick={() => onGlobeZoom(0.5)} aria-label="Zoom globe in">+</button>
      <button type="button" onClick={() => onGlobeSpinSpeedChange(globeSpinSpeed - 0.15)} aria-label="Slow globe spin">Spin −</button>
      <span>{Number(globeSpinSpeed).toFixed(2)}°/s</span>
      <button type="button" onClick={() => onGlobeSpinSpeedChange(globeSpinSpeed + 0.15)} aria-label="Speed up globe spin">Spin +</button>
      <button type="button" onClick={onToggleGlobeSpin}>{globeSpinPaused ? 'Resume Spin' : 'Pause Spin'}</button>
    </div>}
    <div className="controls-search-wrap" ref={searchRef}>
      <button type="button" className="controls-search-toggle" aria-label="Search Hops" aria-expanded={searchOpen} onClick={() => setSearchOpen(value => { const next = !value; if (next) window.dispatchEvent(new CustomEvent('globehoppers-search-opened')); return next; })}><Search size={17} strokeWidth={2.2} /></button>
      {searchOpen && <div className="timeline-search-panel glass" role="dialog" aria-label="Search Hops">
        <div className="timeline-search-panel__head">
          <Search size={16} aria-hidden="true" />
          <input ref={searchInputRef} value={searchText} onChange={event => setSearchText(event.target.value)} placeholder="Search Hops…" aria-label="Search Hops" autoComplete="off" />
          {searchText && <button type="button" aria-label="Clear search" onClick={() => setSearchText('')}>×</button>}
        </div>
        <div className="timeline-search-panel__body">
          {searchText.trim().length < 2
            ? <div className="timeline-search-message">Type at least 2 characters.</div>
            : <HopResultCards rows={searchResults} emptyMessage="No matching Hops." onSelect={row => { setSearchOpen(false); setSearchText(''); onMarkerJump?.(row); }} />}
        </div>
      </div>}
    </div>
    <div className="controls-advanced-wrap" ref={advancedRef}>
      <button ref={advancedToggleRef} type="button" className="controls-advanced-toggle" aria-label="Advanced controls" aria-expanded={advancedOpen} aria-haspopup="dialog" aria-controls="globehoppers-advanced-controls" onClick={() => { setSearchOpen(false); setAdvancedOpen(v => !v); }}>⋯</button>
      {advancedOpen && <div id="globehoppers-advanced-controls" className="controls-advanced glass" role="dialog" aria-label="Advanced playback controls">
        <button type="button" onClick={() => { setAdvancedOpen(false); onReset?.(); }}>Restart Journey</button>
  <button type="button" onClick={() => { setAdvancedOpen(false); onViewGlobe?.(); }}>View Globe</button>
        <button onClick={onToggleTripDrawer}>GlobeHopper Timeline</button>
        <label>Speed<select value={speed} onChange={e => setSpeed(Number(e.target.value))}><option value={0.25}>0.25x</option><option value={0.5}>0.5x</option><option value={1}>1x</option><option value={2}>2x</option><option value={4}>4x</option></select></label>
        <label>Projection<select value={projection} onChange={e => setProjection(e.target.value)}><option value="orthographic">Globe</option><option value="naturalEarth1">Natural Earth</option><option value="equalEarth">Equal Earth</option><option value="geoMercator">Mercator</option></select></label>
        <label>Camera<select value={cameraMode} onChange={e => setCameraMode(e.target.value)}><option value="follow">Follow</option><option value="route">Route</option><option value="continent">Continent</option><option value="global">Global</option></select></label>
        <label>Filter<select value={filter} onChange={e => setFilter(e.target.value)}><option value="all">All</option><option value="joey">Joey only</option><option value="bonnie">Bonnie only</option><option value="together">Together</option></select></label>
        <label>Theme<select value={theme} onChange={e => setTheme(e.target.value)}><option value="bold-dark">Bold Dark</option><option value="minimal-light">Minimal Light</option></select></label>
        <label className="check"><input type="checkbox" checked={showTrails} onChange={e => setShowTrails(e.target.checked)} /> Trails</label>
        <label className="check"><input type="checkbox" checked={routeStackingEnabled} onChange={e => setRouteStackingEnabled(e.target.checked)} /> Route stacking</label>
        <label className="check"><input type="checkbox" checked={placeBackgroundsEnabled} onChange={e => setPlaceBackgroundsEnabled(e.target.checked)} /> Place backgrounds</label>
        <div className="timeline-advanced-section">
          <div className="timeline-advanced-title">Trips data</div>
          <div className="timeline-route-status">Source: {tripsDataStatus?.source || 'repo JSON'}</div>
          <div className="timeline-route-detail">{tripsDataStatus?.trips || 0} trips · {tripsDataStatus?.legs || 0} legs · signature {tripsDataStatus?.signatureMatches ? 'matches' : 'changed'}</div>
          {tripsDataStatus?.firstTimeline && <div className="timeline-route-detail">First timeline: {tripsDataStatus.firstTimeline}</div>}
          {tripsDataStatus?.firstRepo && <div className="timeline-route-detail">First repo item: {tripsDataStatus.firstRepo}</div>}
        </div>
        <div className="timeline-advanced-section">
  <div className="timeline-advanced-title">Hopper integrity</div>
  <div className={`timeline-route-status timeline-hopper-status--${hopperIntegrity?.state || 'ok'}`} aria-live="polite">{hopperIntegrity?.label || 'Hopper data healthy'}</div>
  {hopperIntegrity?.detail && <div className="timeline-route-detail">{hopperIntegrity.detail}</div>}
  {hopperIntegrity?.errors?.slice(0, 4).map((message, index) => <div key={`hopper-error-${index}`} className="timeline-route-message timeline-route-message--error">{message}</div>)}
  {hopperIntegrity?.warnings?.slice(0, 4).map((message, index) => <div key={`hopper-warning-${index}`} className="timeline-route-message">{message}</div>)}
  {(hopperIntegrity?.errors?.length || 0) + (hopperIntegrity?.warnings?.length || 0) > 8 && <div className="timeline-route-detail">Additional integrity findings are available in the returned audit object.</div>}
  </div>
  <div className="timeline-advanced-section">
          <div className="timeline-advanced-title">Repository save</div>
          <div className={`timeline-route-status timeline-save-status timeline-save-status--${repoSaveStatus?.state || 'idle'}`}>{repoSaveStatus?.label || 'No recent repository save'}</div>
          {repoSaveStatus?.detail && <div className="timeline-route-detail">{repoSaveStatus.detail}</div>}
          {Array.isArray(repoSaveStatus?.pendingItems) && repoSaveStatus.pendingItems.length > 0 && <RepoSaveGroup title="Pending" items={repoSaveStatus.pendingItems} />}
          {Array.isArray(repoSaveStatus?.currentItems) && repoSaveStatus.currentItems.length > 0 && repoSaveStatus.state === 'saving' && <RepoSaveGroup title="Saving now" items={repoSaveStatus.currentItems} />}
          {Array.isArray(repoSaveStatus?.completedItems) && repoSaveStatus.completedItems.length > 0 && <RepoSaveGroup title={`Complete${repoSaveStatus?.completedAt ? ` (${formatRelativeSaveTime(repoSaveStatus.completedAt)})` : ''}`} items={repoSaveStatus.completedItems} />}
          {!repoSaveStatus?.pendingItems?.length && !repoSaveStatus?.currentItems?.length && !repoSaveStatus?.completedItems?.length && Array.isArray(repoSaveStatus?.items) && repoSaveStatus.items.length > 0 && <RepoSaveGroup title={repoSaveStatus.state === 'saved' ? 'Complete' : 'Pending'} items={repoSaveStatus.items} />}
          {repoSaveStatus?.completedAt && (!repoSaveStatus?.completedItems || repoSaveStatus.completedItems.length === 0) && <div className="timeline-route-detail">{repoSaveStatus.state === 'error' ? 'Failed' : 'Completed'} {formatRelativeSaveTime(repoSaveStatus.completedAt)}</div>}
          {repoSaveStatus?.startedAt && repoSaveStatus?.state === 'saving' && <div className="timeline-route-detail">Started {formatRelativeSaveTime(repoSaveStatus.startedAt)}</div>}
          {repoSaveStatus?.error && <div className="timeline-route-message timeline-route-message--error">{repoSaveStatus.error}</div>}
          {repoSaveStatus?.canRetry && <button
            type="button"
            className="timeline-route-rebuild"
            onClick={(event) => { event.preventDefault(); event.stopPropagation(); onRetryRepoSave?.(); }}
          >Retry repository save</button>}
        </div>
        <div className="timeline-advanced-section">
          <div className="timeline-advanced-title">Routing engine</div>
          <div className={`timeline-route-status timeline-routing-status--${routingStatus?.state || 'idle'}`}>{routingStatus?.label || 'Routing engine idle'}</div>
          {routingStatus?.detail && <div className="timeline-route-detail">{routingStatus.detail}</div>}
          <div className="timeline-route-detail">
            Worker {routingStatus?.ready ? 'ready' : 'not ready'} · queued {routingStatus?.queued || 0} · completed {routingStatus?.completed || 0}
          </div>
          {routingStatus?.routingVersion && <div className="timeline-route-detail">Version {routingStatus.routingVersion}{routingStatus?.dataVersion ? ` · data ${routingStatus.dataVersion}` : ''}</div>}
          {routingStatus?.activeJob && <div className="timeline-route-message">Active job: {routingStatus.activeJob}</div>}
  {routingStatus?.error && <div className="timeline-route-message timeline-route-message--error" role="alert">{routingStatus.error}</div>}
  {routingStatus?.state === 'error' && <button type="button" className="timeline-route-rebuild" disabled={!onRetryRouting} onClick={(event) => { event.preventDefault(); event.stopPropagation(); onRetryRouting?.(); }}>Retry Routing Engine</button>}
        </div>
        <div className="timeline-advanced-section">
          <div className="timeline-advanced-title">Route details</div>
          <div className="timeline-route-status">{routeDetailsStatus?.label || 'Not loaded'}</div>
          {routeDetailsStatus?.detailLabel && <div className="timeline-route-detail">{routeDetailsStatus.detailLabel}</div>}
          {routeDetailsStatus && <div className="timeline-route-detail">generated {routeDetailsStatus.generated || 0} · browser {routeDetailsStatus.browser || 0} · existing {routeDetailsStatus.existing || 0} · reversed {routeDetailsStatus.reverse || 0}</div>}
          {routeDetailsMessage && <div className="timeline-route-message">{routeDetailsMessage}</div>}
          <button
            type="button"
            className="timeline-route-rebuild"
            disabled={routeDetailsBusy || !onRebuildRouteDetails}
            onClick={(event) => { event.preventDefault(); event.stopPropagation(); onRebuildRouteDetails?.(); }}
          >
            {routeDetailsBusy ? 'Rebuilding…' : 'Rebuild Route Details'}
          </button>
        </div>
      </div>}
    </div>
  </div>;
}



function normalizeSearchText(value = '') {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function clusterTimelineMarkers(markers = [], zoom = 1, destinationMatchSet = new Set()) {
  if (zoom > 1.12 || markers.length < 220 || destinationMatchSet.size) return markers.map(marker => ({ type: 'marker', marker }));
  const threshold = 0.012;
  const groups = [];
  let current = [];
  for (const marker of markers) {
    if (!current.length || marker.progress - current[current.length - 1].progress <= threshold) current.push(marker);
    else { groups.push(current); current = [marker]; }
  }
  if (current.length) groups.push(current);
  return groups.flatMap((group, index) => {
    if (group.length < 3) return group.map(marker => ({ type: 'marker', marker }));
    return [{
      type: 'cluster',
      id: `cluster-${index}-${group[0].id}`,
      count: group.length,
      progress: group.reduce((sum, marker) => sum + marker.progress, 0) / group.length,
      color: group[Math.floor(group.length / 2)]?.color || '#00e5ff',
      markers: group
    }];
  });
}

function RepoSaveGroup({ title, items = [] }) {
  if (!Array.isArray(items) || !items.length) return null;
  return <div className="timeline-save-group">
    <div className="timeline-save-group-title">{title}</div>
    <div className="timeline-save-batch-list">
      {items.slice(0, 8).map((item, index) => <div className="timeline-save-batch-item" key={`${item.tripId || item.label || 'item'}-${index}`}>
        <span>{formatRepoSaveAction(item)}</span>
        <strong>{item.label || 'Hop'}</strong>
        {item.tripId && <code>{item.tripId}</code>}
      </div>)}
      {items.length > 8 && <div className="timeline-route-detail">+ {items.length - 8} more changes</div>}
    </div>
  </div>;
}

function formatRelativeSaveTime(timestamp) {
  const value = Number(timestamp) || 0;
  if (!value) return '';
  const seconds = Math.max(0, Math.round((Date.now() - value) / 1000));
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  return `${hours}h ago`;
}

function formatRepoSaveAction(item = {}) {
  if (item.action === 'delete') return 'Delete';
  if (item.action === 'edit') return 'Edit';
  if (item.action === 'add') return 'Add';
  return 'Update';
}
