import { useEffect, useRef, useState } from 'react';

export default function PlaybackControls({ isPlaying, onPlay, onPause, onReset, onViewGlobe, progress, onSeekProgress, onMarkerJump, speed, setSpeed, filter, setFilter, projection, setProjection, cameraMode, setCameraMode, showTrails, setShowTrails, theme, setTheme, onToggleTripDrawer, tripMarkers = [], yearSegments = [] }) {
  const pct = Math.round(Math.max(0, Math.min(1, progress || 0)) * 1000);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [hoverMarker, setHoverMarker] = useState(null);
  const advancedRef = useRef(null);

  useEffect(() => {
    if (!advancedOpen) return;
    const close = (event) => {
      if (advancedRef.current && !advancedRef.current.contains(event.target)) setAdvancedOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [advancedOpen]);

  return <div className="controls glass">
    <button className="controls-play-pill" onClick={isPlaying ? onPause : onPlay}>{isPlaying ? 'Pause' : 'Play'}</button>
    <label className="timeline-scrubber">Timeline
      <div className="timeline-scrubber-stack">
        <div className="progress progress--scrubbable" onMouseMove={(e) => { if (e.target === e.currentTarget || e.target.tagName === 'INPUT' || e.target.tagName === 'SPAN') setHoverMarker(null); }} onMouseLeave={() => setHoverMarker(null)}>
          <span style={{ width: `${Math.max(0, Math.min(1, progress || 0)) * 100}%` }} />
          <div className="timeline-marker-layer" aria-hidden="true">
            {tripMarkers.map(marker => <button
              key={marker.id}
              type="button"
              className={hoverMarker?.id === marker.id ? 'timeline-marker is-active' : 'timeline-marker'}
              style={{ '--marker-left': `${marker.progress * 100}%`, '--marker-color': marker.color || '#00e5ff' }}
              aria-label={`${marker.title} · ${marker.date}`}
              onMouseEnter={() => setHoverMarker(marker)}
              onMouseLeave={() => setHoverMarker(null)}
              onFocus={() => setHoverMarker(marker)}
              onBlur={() => setHoverMarker(null)}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); onMarkerJump ? onMarkerJump(marker) : onSeekProgress?.(marker.progress); }}
            />)}
            {hoverMarker && <span className="timeline-marker__tooltip is-visible" style={{ '--marker-left': `${hoverMarker.progress * 100}%`, '--marker-color': hoverMarker.color || '#00e5ff' }}>
              <strong className="timeline-marker__tooltip-title">{hoverMarker.title}</strong><small className="timeline-marker__tooltip-date">{hoverMarker.date}</small>
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
      {advancedOpen && <div className="controls-advanced-panel glass" onClick={e => e.stopPropagation()}>
        <div className="controls-advanced-actions">
          <button onClick={onViewGlobe}>View Globe</button>
          <button onClick={onReset}>Reset</button>
          <button onClick={onToggleTripDrawer}>Trips</button>
        </div>
        <label>Speed
          <select value={speed} onChange={e => setSpeed(Number(e.target.value))}>
            {[0.5,1,1.5,2,4].map(v => <option key={v} value={v}>{v}x</option>)}
          </select>
        </label>
        <label>Traveler
          <select value={filter} onChange={e => setFilter(e.target.value)}>
            <option value="all">Show all travel</option>
            <option value="joey">Joey only</option>
            <option value="bonnie">Bonnie only</option>
            <option value="together">Trips together only</option>
          </select>
        </label>
        <label>Projection
          <select value={projection} onChange={e => setProjection(e.target.value)}>
            <option value="globe">Globe</option>
            <option value="equalEarth">Equal Earth</option>
            <option value="gallPeters">Gall-Peters</option>
          </select>
        </label>
        <label>Camera
          <select value={cameraMode} onChange={e => setCameraMode(e.target.value)}>
            <option value="global">Global view</option>
            <option value="route">Route view</option>
            <option value="follow">Follow mode</option>
            <option value="continent">Continent mode</option>
          </select>
        </label>
        <label>Theme
          <select value={theme} onChange={e => setTheme(e.target.value)}>
            <option value="bold-dark">Bold Dark Neon</option>
            <option value="bold-light">Bold Light Neon</option>
            <option value="pastel-dark">Dark Pastel</option>
            <option value="pastel-light">Light Pastel</option>
          </select>
        </label>
        <label className="check"><input type="checkbox" checked={showTrails} onChange={e => setShowTrails(e.target.checked)} /> Trails</label>
      </div>}
    </div>
  </div>;
}
