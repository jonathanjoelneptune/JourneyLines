const SAMPLE_LIMIT = 180;
const counters = new Map();
const durations = new Map();
const frames = [];
const longTasks = [];
let lastFrameAt = 0;
let observerStarted = false;
let lastConsoleReport = 0;
let diagnosticsEnabledCache;

function runtimeConfig() {
  if (typeof window === 'undefined') return {};
  return window.JOURNEYLINES_CONFIG || {};
}

export function playbackDiagnosticsEnabled() {
  if (diagnosticsEnabledCache != null) return diagnosticsEnabledCache;
  if (typeof window === 'undefined') return false;
  try {
    diagnosticsEnabledCache = Boolean(import.meta.env.DEV
      || runtimeConfig().performanceDiagnostics
      || window.localStorage?.getItem('globehoppers.performanceDiagnostics') === 'true');
  } catch {
    diagnosticsEnabledCache = Boolean(import.meta.env.DEV || runtimeConfig().performanceDiagnostics);
  }
  return diagnosticsEnabledCache;
}

export function setPlaybackDiagnosticsEnabled(enabled) {
  diagnosticsEnabledCache = Boolean(enabled);
  if (typeof window !== 'undefined') {
    try { window.localStorage?.setItem('globehoppers.performanceDiagnostics', String(Boolean(enabled))); } catch {}
  }
  publish();
}

function ensureObserver() {
  if (observerStarted || !playbackDiagnosticsEnabled() || typeof PerformanceObserver === 'undefined') return;
  observerStarted = true;
  try {
    const observer = new PerformanceObserver(list => {
      for (const entry of list.getEntries()) {
        longTasks.push({ start: entry.startTime, duration: entry.duration, name: entry.name || 'longtask' });
        while (longTasks.length > 40) longTasks.shift();
      }
      publish();
    });
    observer.observe({ type: 'longtask', buffered: true });
  } catch {}
}

export function recordPlaybackFrame(timestamp = performance.now(), quality = 'high') {
  if (!playbackDiagnosticsEnabled()) return;
  ensureObserver();
  const now = Number(timestamp) || performance.now();
  if (lastFrameAt) {
    frames.push({ ms: Math.max(0, now - lastFrameAt), quality });
    while (frames.length > SAMPLE_LIMIT) frames.shift();
  }
  lastFrameAt = now;
  increment('frames');
  publishMaybe(now);
}

export function recordPlaybackEvent(name, durationMs = 0, detail = null) {
  if (!playbackDiagnosticsEnabled()) return;
  ensureObserver();
  increment(name);
  if (Number.isFinite(Number(durationMs)) && Number(durationMs) > 0) {
    const list = durations.get(name) || [];
    list.push(Number(durationMs));
    while (list.length > 60) list.shift();
    durations.set(name, list);
  }
  if (detail != null) counters.set(`${name}:lastDetail`, detail);
  publishMaybe(performance.now());
}

export function measurePlaybackEvent(name, callback) {
  if (!playbackDiagnosticsEnabled()) return callback();
  const started = performance.now();
  try {
    return callback();
  } finally {
    recordPlaybackEvent(name, performance.now() - started);
  }
}

export function playbackPerformanceSnapshot() {
  const frameValues = frames.map(entry => entry.ms).filter(Number.isFinite);
  const sortedFrames = [...frameValues].sort((a, b) => a - b);
  const durationSummary = {};
  for (const [name, values] of durations) {
    const sorted = [...values].sort((a, b) => a - b);
    durationSummary[name] = {
      count: values.length,
      averageMs: average(values),
      p95Ms: percentile(sorted, 0.95),
      maxMs: sorted.at(-1) || 0
    };
  }
  return {
    generatedAt: new Date().toISOString(),
    frameCount: frameValues.length,
    averageFrameMs: average(frameValues),
    p95FrameMs: percentile(sortedFrames, 0.95),
    estimatedFps: frameValues.length ? 1000 / Math.max(1, average(frameValues)) : 0,
    counters: Object.fromEntries(counters),
    durations: durationSummary,
    longTasks: [...longTasks]
  };
}

function increment(name) {
  counters.set(name, Number(counters.get(name) || 0) + 1);
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function percentile(sorted, ratio) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))];
}

function publishMaybe(now) {
  if (now - lastConsoleReport < 1000) return;
  lastConsoleReport = now;
  publish();
  if (runtimeConfig().performanceDiagnosticsLog) {
    try { console.debug('[GlobeHoppers performance]', playbackPerformanceSnapshot()); } catch {}
  }
}

function publish() {
  if (typeof window === 'undefined') return;
  try {
    window.__GLOBEHOPPERS_PERFORMANCE__ = {
      snapshot: playbackPerformanceSnapshot,
      reset: resetPlaybackPerformanceDiagnostics,
      enable: () => setPlaybackDiagnosticsEnabled(true),
      disable: () => setPlaybackDiagnosticsEnabled(false)
    };
  } catch {}
}

export function resetPlaybackPerformanceDiagnostics() {
  counters.clear();
  durations.clear();
  frames.length = 0;
  longTasks.length = 0;
  lastFrameAt = 0;
  publish();
}
