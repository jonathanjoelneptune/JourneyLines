import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { spawnSync } from 'node:child_process';
import {
  bidirectionalRouteKey,
  canonicalGeometryForLeg,
  endpointsMatchInReverse,
  geometryForLegDirection,
  reverseGeometryStable
} from '../src/utils/routeReuse.js';
import { packGeometryForWorker, reversePlaybackPlan } from '../src/utils/playbackPlanTransfer.js';

const root = path.resolve(process.argv[2] || '.');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
let checks = 0;
function check(condition, message) { assert.ok(condition, message); checks += 1; }
function equal(actual, expected, message) { assert.deepEqual(actual, expected, message); checks += 1; }

const packageJson = JSON.parse(read('package.json'));
const travelMap = read('src/components/TravelMap.jsx');
const routingClient = read('src/utils/routingClient.js');
const routingWorker = read('src/workers/routingWorker.js');
const routeCache = read('src/utils/routeCacheIndexedDb.js');
const routeDetails = read('src/utils/routeDetails.js');
const performanceModule = read('src/utils/playbackPerformance.js');
const styles = read('src/styles.css');

const a = { id: 'alpha', name: 'Alpha', lon: -117.1, lat: 32.7 };
const b = { id: 'bravo', name: 'Bravo', lon: -115.1, lat: 34.2 };
const c = { id: 'charlie', name: 'Charlie', lon: -116.7, lat: 33.1 };
const d = { id: 'delta', name: 'Delta', lon: -115.8, lat: 33.8 };
const forward = { mode: 'car', from: a, to: b, waypoints: [c, d] };
const reverse = { mode: 'drive', from: b, to: a, waypoints: [d, c] };
check(bidirectionalRouteKey(forward) === bidirectionalRouteKey(reverse), 'Reversed surface legs with reversed waypoints must share one canonical cache key.');
check(endpointsMatchInReverse(forward, reverse), 'Matching return legs must be recognized within endpoint tolerance.');
check(bidirectionalRouteKey({ ...forward, mode: 'train' }) !== bidirectionalRouteKey(forward), 'Different surface modes must not share route geometry.');

const geometry = [[-117.1, 32.7], [-116.5, 33.2], [-115.1, 34.2]];
const reversed = reverseGeometryStable(geometry);
equal(reversed, [...geometry].reverse(), 'Stable reverse geometry must preserve all points in reverse order.');
check(reverseGeometryStable(geometry) === reversed, 'Repeated reverse geometry lookup must reuse the same array object.');
check(reverseGeometryStable(reversed) === geometry, 'Reversing the reverse view must return the original stable geometry.');
const canonical = canonicalGeometryForLeg(forward, geometry);
check(geometryForLegDirection(reverse, canonical) === reversed, 'Return legs must read canonical geometry in reverse without a deep copy.');

const dense = Array.from({ length: 50000 }, (_, index) => [-120 + index / 10000, 30 + Math.sin(index / 200) * 0.1]);
const packStart = performance.now();
const packed = packGeometryForWorker(dense);
const packDuration = performance.now() - packStart;
check(packed instanceof Float64Array, 'Playback-plan input must be packed into Float64Array.');
check(packed.length === dense.length * 2, 'Packed route buffer must contain exactly two numbers per point.');
equal(Array.from(packed.slice(0, 4)), [...dense[0], ...dense[1]], 'Packed route order must preserve longitude and latitude.');
check(packDuration < 250, 'Packing a 50,000-point route must complete in bounded time.');

const plan = {
  sampleCount: 3,
  totalMiles: 30,
  positions: new Float32Array([0, 0, 1, 1, 2, 2]),
  headings: new Float32Array([10, 20, 30]),
  camera: new Float32Array([0, 0, 1, 1, 2, 2]),
  cumulative: new Float32Array([0, 10, 30]),
  overview: new Float32Array([0, 0, 2, 2]),
  regional: new Float32Array([0, 0, 1, 1, 2, 2]),
  presentation: new Float32Array([0, 0, 0.5, 0.5, 2, 2])
};
const reversePlan = reversePlaybackPlan(plan, 'drive');
equal(Array.from(reversePlan.positions), [2, 2, 1, 1, 0, 0], 'Reverse plan positions must traverse the canonical path backward.');
equal(Array.from(reversePlan.headings), [210, 200, 190], 'Reverse plan headings must reverse and rotate 180 degrees.');
equal(Array.from(reversePlan.cumulative), [0, 20, 30], 'Reverse cumulative distance must remain increasing from zero.');
equal(Array.from(reversePlan.presentation), [2, 2, 0.5, 0.5, 0, 0], 'Reverse presentation geometry must match the return direction.');
check(reversePlaybackPlan(plan, 'drive') === reversePlan, 'Reverse playback plans must be cached.');
check(reversePlaybackPlan(reversePlan, 'drive') === plan, 'Reversing a reverse playback plan must recover the original plan object.');
check(reversePlan.camera.length === plan.camera.length, 'Reverse plan must rebuild a complete directional camera-lead array.');

check(routeCache.includes('bidirectionalRouteCacheKey'), 'IndexedDB cache must expose canonical bidirectional route keys.');
check(routeDetails.includes('bidirectionalRouteKey(pairLeg)'), 'Deployed route details must seed canonical bidirectional geometry aliases.');
check(routingClient.includes('memoryBidirectionalRoutes'), 'Routing client must retain one canonical in-memory surface route per endpoint pair.');
check(routingClient.includes('memoryBidirectionalPlans'), 'Routing client must reuse prepared playback plans for return legs.');
check(routingClient.includes("request('playbackPlan'"), 'Routing client must still prepare playback plans in the worker.');
check(routingClient.includes('geometryPacked: packed'), 'Worker messages must carry packed geometry rather than nested coordinate arrays.');
check(routingClient.includes("packed ? [packed.buffer] : []"), 'Packed geometry buffer must be transferred, not structured-cloned.');
check(routingWorker.includes('unpackCoordinateBuffer(payload.geometryPacked'), 'Routing worker must unpack transferred route geometry.');
check(routingWorker.includes('presentation = new Float32Array'), 'Routing worker must return the bounded presentation route as typed geometry.');

const freezeStart = travelMap.indexOf('function freezeActiveEntryGeometry');
const freezeEnd = travelMap.indexOf('function adaptiveCameraSmoothing', freezeStart);
const freezeBody = travelMap.slice(freezeStart, freezeEnd);
check(freezeBody.includes('routeGeometry: frozenGeometry'), 'Active route freeze must retain the stable raw geometry reference.');
check(!freezeBody.includes('.map(point =>'), 'Active route freeze must not deep-copy raw route coordinates.');
check(freezeBody.includes('playbackPlanPresentationGeometry'), 'Active route freeze must reuse the worker-prepared presentation geometry.');
check(travelMap.includes('routedGeometries[bidirectionalRouteKey(leg)]'), 'TravelMap must look up canonical bidirectional routes before directional duplicates.');

check(travelMap.includes('if (playbackOwnsOverlayRef.current) return;'), 'Map movement callbacks must not duplicate vehicle overlay work during playback.');
check(!travelMap.includes("map.on('render', refresh)"), 'A render listener must not perform a second active overlay update each frame.');
check(travelMap.includes("recordPlaybackEvent('overlayUpdates')"), 'Playback overlay ownership must be instrumented.');
check(travelMap.includes("const trailInterval = quality === 'high' ? 84 : quality === 'medium' ? 100 : 125"), 'Active trail updates must be budgeted near 12/10/8 FPS.');
check(travelMap.includes("const cameraInterval = quality === 'high' ? 16 : quality === 'medium' ? 25 : 34"), 'Adaptive quality must throttle camera work near 60/40/30 FPS.');
check(travelMap.includes('activeRouteFeaturesForFadeFromFeatures(activeFeatures)'), 'Transition snapshots must reuse the active feature list already built for setData.');
check(travelMap.includes('lastTrailProgress'), 'Trail updates must be skipped when visual route progress has not moved enough.');
check(travelMap.includes("recordPlaybackEvent('activeTrailUpdates')"), 'Active-trail source updates must be instrumented.');
check(travelMap.includes("recordPlaybackEvent('cameraUpdates')"), 'Camera updates must be instrumented.');
check(travelMap.includes("measurePlaybackEvent('activeRouteSetData'"), 'Active GeoJSON setData duration must be instrumented.');
check(travelMap.includes("measurePlaybackEvent('completedRouteSetData'"), 'Completed GeoJSON setData duration must be instrumented.');
check(travelMap.includes('if (playbackOwnsOverlayRef.current) return;\n        const now = performance.now();'), 'Zoom readout must avoid React state updates while playback owns the camera.');

const fadeStart = travelMap.indexOf('function startCompletedRouteFade');
const fadeEnd = travelMap.indexOf('function startTrailProfileMorph', fadeStart);
const fadeBody = travelMap.slice(fadeStart, fadeEnd);
check(!fadeBody.includes('const step ='), 'Completed-route fading must not rebuild the route source in a requestAnimationFrame loop.');
check(!fadeBody.includes('syncCompletedRoutes('), 'Completed-route fading must not rebuild the full historical route collection.');
check(fadeBody.includes('setCompletedRoutePaintState'), 'Completed-route fading must use MapLibre paint transitions.');
const morphStart = fadeEnd;
const morphEnd = travelMap.indexOf('function syncPulse', morphStart);
const morphBody = travelMap.slice(morphStart, morphEnd);
check(!morphBody.includes('const step ='), 'Trip profile morphing must not run a full-history RAF rebuild loop.');
check((morphBody.match(/syncCompletedRoutes\(/g) || []).length <= 2, 'Trip profile morphing must use at most bounded source updates.');

check(travelMap.includes('maxTileCacheSize: 1200'), 'MapLibre tile cache must be reduced from the previous 3,000-tile setting.');
check(travelMap.includes('prefetchZoomDelta: 2'), 'MapLibre prefetch zoom delta must be reduced conservatively.');
check(travelMap.includes('while (cacheSet.size > 900)'), 'Custom tile warmup bookkeeping must be bounded.');
check(travelMap.includes('const radius = z <= 5 ? 0 : 1'), 'Low-zoom tile prefetch must not request full neighborhoods.');

check(styles.includes('.maplibre-shell.playback-active .maplibre-map'), 'Playback CSS must remove the full-canvas map filter.');
check(styles.includes('animation-play-state: paused !important'), 'Decorative star animation must pause during playback.');
check(styles.includes('.maplibre-shell.playback-active .jl-vehicle-overlay'), 'Playback CSS must simplify vehicle shadow compositing.');
check(travelMap.includes("['completed-routes-glow-wide', 'outerGlowOpacity', playback ? 0"), 'Wide passive route glow must be disabled during playback.');
check(travelMap.includes("playback ? 4.5 : 8.5"), 'Passive route blur must be reduced during playback.');

check(performanceModule.includes('let diagnosticsEnabledCache;'), 'Diagnostics enabled state must be cached so disabled instrumentation is inexpensive.');
check(performanceModule.includes("window.__GLOBEHOPPERS_PERFORMANCE__"), 'Development performance snapshots must be exposed for browser inspection.');
check(performanceModule.includes("observer.observe({ type: 'longtask'"), 'Long tasks must be captured when diagnostics are enabled.');
check(fs.existsSync(path.join(root, 'PERFORMANCE-v7.1.4.md')), 'Performance architecture documentation must be included.');

check(packageJson.version === '7.1.4', 'Package version must be 7.1.4.');
check(Boolean(packageJson.scripts['verify:v7.1.4']), 'Package must expose v7.1.4 verification.');
check(read('VERSION.md').startsWith('GlobeHoppers v7.1.4'), 'journeylines/VERSION.md must identify v7.1.4 first.');
check(fs.existsSync(path.join(root, 'QA/QA-v7.1.4.md')), 'v7.1.4 QA must live under journeylines/QA/.');
check(!fs.existsSync(path.resolve(root, '../QA-v7.1.4.md')), 'v7.1.4 QA must not be duplicated at repository root.');

if (process.env.SKIP_BUILD !== '1') {
  const build = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], {
    cwd: root,
    encoding: 'utf8',
    stdio: 'pipe'
  });
  if (build.status !== 0) {
    process.stderr.write(build.stdout || '');
    process.stderr.write(build.stderr || '');
    throw new Error(`Production build failed with exit code ${build.status}.`);
  }
  check(fs.existsSync(path.join(root, 'dist/index.html')), 'Production build must create dist/index.html.');
}

console.log(`GlobeHoppers v7.1.4 verification passed: ${checks} checks.`);
