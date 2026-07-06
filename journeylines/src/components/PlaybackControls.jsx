export default function PlaybackControls({ isPlaying, onPlay, onPause, onReset, progress, onSeekProgress, speed, setSpeed, filter, setFilter, projection, setProjection, cameraMode, setCameraMode, showTrails, setShowTrails, onToggleTripDrawer }) {
  const pct = Math.round(Math.max(0, Math.min(1, progress || 0)) * 1000);

  return <div className="controls glass">
    <button className="primary" onClick={isPlaying ? onPause : onPlay}>{isPlaying ? 'Pause' : 'Play Travel History'}</button>
    <button onClick={onReset}>Reset</button>
    <button onClick={onToggleTripDrawer}>Trips</button>
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
    <label className="check"><input type="checkbox" checked={showTrails} onChange={e => setShowTrails(e.target.checked)} /> Trails</label>
    <label className="timeline-scrubber" title="Scrub through the travel timeline">Timeline
      <div className="progress progress--scrubbable">
        <span style={{ width: `${Math.max(0, Math.min(1, progress || 0)) * 100}%` }} />
        <input
          aria-label="Travel timeline"
          type="range"
          min="0"
          max="1000"
          step="1"
          value={pct}
          onChange={e => onSeekProgress?.(Number(e.target.value) / 1000)}
        />
      </div>
    </label>
  </div>;
}
