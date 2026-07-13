import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const root = path.resolve(process.argv[2] || '.');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const json = relative => JSON.parse(read(relative));
const checks = [];
function check(condition, label) {
  if (!condition) throw new Error(`FAIL: ${label}`);
  checks.push(label);
}
function contains(relative, text, label = `${relative} contains ${text}`) {
  check(read(relative).includes(text), label);
}
function excludes(relative, text, label = `${relative} excludes ${text}`) {
  check(!read(relative).includes(text), label);
}

const pkg = json('package.json');
check(pkg.version === '7.5.2', 'package version is 7.5.2');
check(pkg.scripts?.['verify:v7.5.2'] === 'node scripts/verify-v7.5.2.mjs .', 'v7.5.2 verifier is registered');

const trips = json('src/data/trips.json');
const hoppers = json('src/data/hoppers.json');
const routeDetails = json('src/data/routeDetails.json');
check(trips.length === 149, 'all 149 repository Hops are preserved');
check(trips.reduce((sum, trip) => sum + Math.max(0, trip.route.length - 1), 0) === 316, 'all 316 trip legs are preserved');
check(Object.keys(routeDetails.routes || {}).length === 316, 'all 316 saved route geometries are preserved');
check((hoppers.hoppers || []).length >= 3, 'Hopper data remains present');

// Camera ownership and return sequencing.
contains('src/components/TravelMap.jsx', 'overviewLockTimersRef = useRef(new Set())', 'delayed overview locks are tracked');
contains('src/components/TravelMap.jsx', 'const playbackHasCameraPriority = () => Boolean(', 'camera callbacks consult live playback priority');
contains('src/components/TravelMap.jsx', 'latestFrameContextRef.current?.isPlaying', 'camera priority is available before React effects run');
contains('src/components/TravelMap.jsx', 'clearOverviewLockTimers();', 'playback can cancel all delayed overview locks');
contains('src/components/TravelMap.jsx', 'Playback is the sole camera owner once a Hop begins', 'exclusive playback camera ownership is documented');
contains('src/components/TravelMap.jsx', 'idleCameraRef.current = null;', 'playback discards stale idle camera restoration');
contains('src/components/TravelMap.jsx', 'try { map.stop(); } catch {}', 'playback stops residual MapLibre easing');
contains('src/components/TravelMap.jsx', "stage: needsZoomOut ? 'zoom-out' : 'orient'", 'manual return begins with safe zoom-out only when needed');
contains('src/components/TravelMap.jsx', "state.stage = 'orient'", 'manual return has a reorientation stage');
contains('src/components/TravelMap.jsx', "state.stage = 'zoom-in'", 'manual return zooms in only after orientation');
contains('src/components/TravelMap.jsx', 'The final phase changes only zoom', 'outside-globe return invariant remains documented');
contains('src/components/TravelMap.jsx', "const cameraInterval = quality === 'high' ? 28", 'camera updates remain throttled independently of vehicle motion');
contains('src/components/TravelMap.jsx', 'if (isPlaying) return;', 'legacy React rendering does not compete with the playback frame engine');
contains('src/components/TravelMap.jsx', 'distance > 4500 ? 4.03', 'long-flight follow zoom has a close minimum');
contains('src/components/TravelMap.jsx', 'distance > 3500 ? 4.08', 'long boat/train follow zoom has a close minimum');

// Marine presentation and route stability.
contains('src/components/TravelMap.jsx', 'buildSurfacePresentationGeometry(frozenGeometry', 'surface presentation geometry is frozen once per active leg');
contains('src/utils/routePresentation.js', "const base = normalizedMode === 'boat' ? 6", 'boat presentation uses a low open-water anchor base');
contains('src/utils/routePresentation.js', "const distanceFactor = normalizedMode === 'boat' ? 0.78", 'boat anchor count grows slowly with distance');
contains('src/utils/routePresentation.js', "const minimum = normalizedMode === 'boat' ? 18", 'boat routes may simplify below the road/rail minimum');
contains('src/utils/routePresentation.js', "const maximum = normalizedMode === 'boat' ? 34", 'boat routes retain a bounded broad-route maximum');
contains('src/utils/routePresentation.js', "mode === 'boat' ? 3.50", 'marine corridor allows broad source-native chords');
contains('src/utils/routePresentation.js', 'routeScale * 18.5', 'open-water presentation spans longer safe segments');
contains('src/utils/routePresentation.js', "const turnThreshold = mode === 'boat' ? 62", 'major marine turns remain available for channels');
contains('src/utils/routePresentation.js', "const iterations = mode === 'boat' ? 3", 'boat corners receive one-time smoothing');

// Timeline and result-card layout.
contains('src/components/PlaybackControls.jsx', "displayLabel: Number(tick.month) === 1 ? `Jan ${tick.year}`", 'January month labels retain year context');
contains('src/components/PlaybackControls.jsx', 'visibleMonthTicks.length === 0 && <div className="timeline-year-scale"', 'year and month scales are mutually exclusive');
contains('src/components/PlaybackControls.jsx', 'visibleMonthTicks.length > 0 && <div className="timeline-month-scale"', 'month labels use the existing label row');
contains('src/styles.css', 'height: 54px !important;', 'timeline viewport has a fixed height');
contains('src/styles.css', 'max-height: 54px !important;', 'timeline cannot grow vertically at close zoom');
contains('src/styles.css', 'overflow-y: hidden !important;', 'month labels cannot expand the timeline rail');
contains('src/components/HopResultCards.jsx', 'hop-result-card__identity', 'shared cards provide a left trip-identity column');
contains('src/components/HopResultCards.jsx', 'hop-result-card__details', 'shared cards provide a right route/date column');
contains('src/components/HopResultCards.jsx', 'row.title || \'Hop\'', 'trip name is rendered in the left column');
contains('src/components/HopResultCards.jsx', 'row.route || \'\'', 'destination route is rendered in the right column');
contains('src/components/HopResultCards.jsx', 'row.date || row.year || \'\'', 'date is rendered below the route');
contains('src/styles.css', 'grid-template-columns: minmax(0, .46fr) minmax(0, .54fr)', 'result cards reserve distinct left/right columns');
contains('src/components/PlaybackControls.jsx', '<HopResultCards rows={searchResults}', 'Timeline search shares the destination result component');
excludes('src/components/HopResultCards.jsx', 'gh-timeline-trip-row', 'shared result cards do not recreate the nested inner pill');

// Hit targets and dynamic label sizing.
contains('src/styles.css', 'inset: -24px !important;', 'city-marker invisible hit target is substantially enlarged');
contains('src/styles.css', 'pointer-events: auto !important;', 'marker hit target accepts pointer input');
contains('src/components/TravelMap.jsx', "el.addEventListener('pointerup'", 'complete placard selection handles pointer release');
contains('src/components/TravelMap.jsx', "setAttribute('role', 'button')", 'map placards remain keyboard-accessible');
contains('src/components/TravelMap.jsx', "closest?.('.maplibre-shell')?.style", 'live map shell receives the zoom scale variable');
contains('src/components/TravelMap.jsx', 'zoomBoost = clamp((zoom - 3.65) * 0.22', 'city labels grow materially at regional zoom');
contains('src/components/TravelMap.jsx', "shellStyle?.setProperty('--gh-map-label-scale'", 'label scaling bypasses competing root-only rules');
contains('src/styles.css', '.maplibre-shell.playback-active .maplibregl-marker.jl-map-pin .jl-map-pin-name', 'playback label scale has sufficient CSS specificity');

// Dateline safety and conservative globe culling.
contains('src/components/TravelMap.jsx', 'function mapLineGeometry(coords = [])', 'map route geometry passes through a dateline-safe builder');
contains('src/components/TravelMap.jsx', "return { type: 'MultiLineString', coordinates: segments }", 'antimeridian crossings render as separate line segments');
contains('src/components/TravelMap.jsx', 'function splitLineAtAntimeridian(coords = [])', 'antimeridian route splitting is implemented');
contains('src/components/TravelMap.jsx', 'dateLineRoute || dist < 8', 'wrapped decorative air arcs are suppressed');
contains('src/components/TravelMap.jsx', 'const visualDistance = angularDistanceDeg(visualCenter, coordinate)', 'vehicle culling checks the visual globe center');
contains('src/components/TravelMap.jsx', 'const targetDistance = angularDistanceDeg(mapCenter, coordinate)', 'vehicle culling also checks the map target hemisphere');
contains('src/components/TravelMap.jsx', 'Math.max(visualDistance, targetDistance) > conservativeCutoff', 'either far-side estimate can hide the vehicle');
contains('src/components/TravelMap.jsx', 'pitch > 45 ? 50 : pitch > 24 ? 53 : 57', 'pitched views use an especially conservative horizon cutoff');
contains('src/components/TravelMap.jsx', 'isVisibleOnGlobe(map, point, 0.955)', 'vehicle must remain inside the visible globe disk');
contains('src/components/TravelMap.jsx', 'const angularDistance = Math.max(visualDistance, targetDistance);', 'placards use conservative dual-center hemisphere ownership');

// Editor styling.
contains('src/components/AdminPanel.jsx', 'additional-legs-section compact-section route-section', 'Additional Legs receives route-section semantics');
contains('src/styles.css', '.studio-modal-maincol .additional-legs-section.route-section', 'Additional Legs has dedicated teal section styling');
contains('src/styles.css', 'rgba(0,229,255,.26)', 'Additional Legs uses the teal route border');
contains('src/styles.css', '.studio-modal-maincol .additional-legs-section .legs-block', 'Additional Legs inner fields receive matching treatment');

const routeModule = await import(pathToFileURL(path.join(root, 'src/utils/routePresentation.js')));
const detailed = Array.from({ length: 720 }, (_, index) => {
  const t = index / 719;
  return [-124 + t * 15, 32 + t * 11 + Math.sin(t * Math.PI * 38) * 0.075];
});
const car = routeModule.buildSurfacePresentationGeometry(detailed, 'drive');
const train = routeModule.buildSurfacePresentationGeometry(detailed, 'train');
const boat = routeModule.buildSurfacePresentationGeometry(detailed, 'boat');
for (const [mode, geometry] of [['car', car], ['train', train], ['boat', boat]]) {
  check(geometry.length >= 2, `${mode} presentation geometry remains usable`);
  check(geometry[0][0] === detailed[0][0] && geometry[0][1] === detailed[0][1], `${mode} preserves the exact origin`);
  check(geometry.at(-1)[0] === detailed.at(-1)[0] && geometry.at(-1)[1] === detailed.at(-1)[1], `${mode} preserves the exact destination`);
}
check(boat.length < car.length && boat.length < train.length, 'boat playback is materially broader than road and rail presentation');
check(routeModule.presentationPointBudget(2500, 'boat') < routeModule.presentationPointBudget(2500, 'drive'), 'boat point budget is lower than car point budget');
check(routeModule.presentationPointBudget(6000, 'boat') <= 34, 'very long boat routes remain within the broad-route cap');

check(fs.existsSync(path.join(root, 'QA/QA-v7.5.2.md')), 'v7.5.2 QA documentation is under journeylines/QA');
check(fs.existsSync(path.join(root, 'INTERACTION-v7.5.2.md')), 'v7.5.2 interaction notes are documented');
check(!fs.existsSync(path.join(root, '..', 'QA-v7.5.2.md')), 'QA documentation is not duplicated at repository root');

const build = spawnSync(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), 'build'], {
  cwd: root,
  encoding: 'utf8',
  env: { ...process.env, NODE_ENV: 'production' }
});
if (build.status !== 0) {
  process.stderr.write(build.stdout || '');
  process.stderr.write(build.stderr || '');
}
check(build.status === 0, 'production Vite build succeeds');
check(fs.existsSync(path.join(root, 'dist/index.html')), 'production build output exists');

console.log(`GlobeHoppers v7.5.2 verification passed: ${checks.length} checks.`);
