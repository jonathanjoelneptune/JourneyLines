import { useEffect, useRef, useState } from 'react';

export default function PlaybackControls({ isPlaying, onPlay, onPause, onReset, onViewGlobe, progress, onSeekProgress, onMarkerJump, speed, setSpeed, filter, setFilter, projection, setProjection, cameraMode, setCameraMode, showTrails, setShowTrails, routeStackingEnabled = false, setRouteStackingEnabled = () => {}, placeBackgroundsEnabled = true, setPlaceBackgroundsEnabled = () => {}, theme, setTheme, onToggleTripDrawer, onToggleTimelineUtility, timelineTuning = {}, tripMarkers = [], activeMarkerId = null, yearSegments = [], routeDetailsStatus = null, routeDetailsMessage = '', routeDetailsBusy = false, onRebuildRouteDetails = null }) {
  const pct = Math.round(Math.max(0, Math.min(1, progress || 0)) * 1000);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [hoverMarker, setHoverMarker] = useState(null);
  const [leavingMarkerId, setLeavingMarkerId] = useState(null);
  const [enteringMarkerId, setEnteringMarkerId] = useState(null);
  const advancedRef = useRef(null);
  const previousActiveIdRef = useRef(activeMarkerId);
  const transitionTimerRef = useRef(null);
  const playClickCountRef = useRef(0);
  const playClickTimerRef = useRef(null);

  useEffect(() => {
    if (!advancedOpen) return;
    const close = (event) => {
      if (advancedRef.current && !advancedRef.current.contains(event.target)) setAdvancedOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
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
    (isPlaying ? onPause : onPlay)?.();
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

  const activeMarker = tripMarkers.find(marker => marker.id === activeMarkerId) || null;
  const tooltipMarker = hoverMarker || activeMarker;

  return <div className="controls glass" style={timelineStyle}>
    <button className="controls-play-pill" onClick={handlePlayPauseClick}>{isPlaying ? 'Pause' : 'Play'}</button>
    <label className="timeline-scrubber">Timeline
      <div className="timeline-scrubber-stack">
        <div className="progress progress--scrubbable" onMouseMove={(e) => { if (e.target === e.currentTarget || e.target.tagName === 'INPUT' || e.target.tagName === 'SPAN') setHoverMarker(null); }} onMouseLeave={() => setHoverMarker(null)}>
          <span style={{ width: `${Math.max(0, Math.min(1, progress || 0)) * 100}%` }} />
          <div className="timeline-marker-layer" aria-hidden="true">
            {tripMarkers.map(marker => {
              const isCurrent = activeMarkerId === marker.id;
              const isEntering = enteringMarkerId === marker.id;
              const isLeaving = leavingMarkerId === marker.id;
              const isHovered = hoverMarker?.id === marker.id;
              return <button
                key={marker.id}
                type="button"
                className={[
                  'timeline-marker',
                  isHovered || isCurrent ? 'is-active' : '',
                  isCurrent ? 'is-current' : '',
                  isEntering ? 'is-entering' : '',
                  isLeaving ? 'is-leaving' : ''
                ].filter(Boolean).join(' ')}
                style={{ '--marker-left': `${marker.progress * 100}%`, '--marker-color': marker.color || '#00e5ff', '--marker-background': marker.markerBackground || marker.color || '#00e5ff' }}
                aria-label={`${marker.title} · ${marker.date}`}
                aria-current={isCurrent ? 'true' : undefined}
                onMouseEnter={() => setHoverMarker(marker)}
                onMouseLeave={() => setHoverMarker(null)}
                onFocus={() => setHoverMarker(marker)}
                onBlur={() => setHoverMarker(null)}
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); onMarkerJump ? onMarkerJump(marker) : onSeekProgress?.(marker.progress); }}
              />;
            })}
            {tooltipMarker && <span className={`timeline-marker__tooltip is-visible ${hoverMarker ? 'is-hovered' : 'is-current'} ${tooltipMarker.id === activeMarkerId ? 'is-current' : ''}`} style={{ '--marker-left': `${tooltipMarker.progress * 100}%`, '--marker-color': tooltipMarker.color || '#00e5ff', '--marker-background': tooltipMarker.markerBackground || tooltipMarker.color || '#00e5ff' }}>
              <strong className="timeline-marker__tooltip-title">{tooltipMarker.title}</strong><small className="timeline-marker__tooltip-date">{tooltipMarker.date}</small>
            </span>}
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
      </div>
    </label>
    <div className="controls-advanced-wrap" ref={advancedRef}>
      <button className="controls-advanced-toggle" aria-label="Advanced controls" onClick={() => setAdvancedOpen(v => !v)}>⋯</button>
      {advancedOpen && <div className="controls-advanced glass">
        <button onClick={onReset}>Reset</button>
        <button onClick={onViewGlobe}>View Globe</button>
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
