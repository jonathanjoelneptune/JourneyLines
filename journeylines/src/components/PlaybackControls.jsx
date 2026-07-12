import { useEffect, useRef, useState } from 'react';

export default function PlaybackControls({ isPlaying, hasPlaybackStarted = false, timelineComplete = false, onPlay, onPause, onReset, onViewGlobe, progress, onSeekProgress, onMarkerJump, onMarkerEdit, speed, setSpeed, filter, setFilter, projection, setProjection, cameraMode, setCameraMode, showTrails, setShowTrails, routeStackingEnabled = false, setRouteStackingEnabled = () => {}, placeBackgroundsEnabled = true, setPlaceBackgroundsEnabled = () => {}, theme, setTheme, onToggleTripDrawer, onToggleTimelineUtility, timelineTuning = {}, tripMarkers = [], activeMarkerId = null, yearSegments = [], routeDetailsStatus = null, routingStatus = null, onRetryRouting = null, tripsDataStatus = null, hopperIntegrity = null, repoSaveStatus = null, onRetryRepoSave = null, routeDetailsMessage = '', routeDetailsBusy = false, onRebuildRouteDetails = null }) {
  const pct = Math.round(Math.max(0, Math.min(1, progress || 0)) * 1000);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [hoverMarker, setHoverMarker] = useState(null);
  const [leavingMarkerId, setLeavingMarkerId] = useState(null);
  const [enteringMarkerId, setEnteringMarkerId] = useState(null);
  const advancedRef = useRef(null);
  const advancedToggleRef = useRef(null);
  const previousActiveIdRef = useRef(activeMarkerId);
  const transitionTimerRef = useRef(null);
  const playClickCountRef = useRef(0);
  const playClickTimerRef = useRef(null);

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
    if (timelineComplete) return;
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
  const playbackActionLabel = timelineComplete ? 'Complete' : (isPlaying ? 'Pause' : (hasPlaybackStarted ? 'Resume' : 'Play'));
  const playbackActionAriaLabel = timelineComplete
    ? 'Timeline complete. Use Restart Journey to begin again.'
    : (isPlaying ? 'Pause travel timeline' : (hasPlaybackStarted ? 'Resume travel timeline' : 'Play travel timeline'));

  return <div className="controls glass" style={timelineStyle}>
    <button type="button" className="controls-play-pill" onClick={handlePlayPauseClick} aria-pressed={isPlaying} aria-disabled={timelineComplete} aria-label={playbackActionAriaLabel} title={timelineComplete ? 'Timeline complete — use Restart Journey' : undefined}>{playbackActionLabel}</button>
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
                onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onMarkerEdit?.(marker); }}
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
      <button ref={advancedToggleRef} type="button" className="controls-advanced-toggle" aria-label="Advanced controls" aria-expanded={advancedOpen} aria-haspopup="dialog" aria-controls="globehoppers-advanced-controls" onClick={() => setAdvancedOpen(v => !v)}>⋯</button>
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
