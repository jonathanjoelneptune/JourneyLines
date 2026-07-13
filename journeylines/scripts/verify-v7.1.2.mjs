import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { smoothSurfaceRouteGeometry, surfaceRouteRenderSamples } from '../src/utils/routeSmoothing.js';

const root = path.resolve(process.argv[2] || '.');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
let checks = 0;
function check(condition, message) {
  assert.ok(condition, message);
  checks += 1;
}
function equal(actual, expected, message) {
  assert.deepEqual(actual, expected, message);
  checks += 1;
}

const app = read('src/App.jsx');
const travelMap = read('src/components/TravelMap.jsx');
const controls = read('src/components/PlaybackControls.jsx');
const admin = read('src/components/AdminPanel.jsx');
const worker = read('src/workers/routingWorker.js');
const packageJson = JSON.parse(read('package.json'));

// Surface route smoothing must preserve endpoints, densify the line, and reduce hard turns.
const sharpCorner = [[-97, 35], [-96, 35], [-96, 36]];
for (const mode of ['car', 'train', 'boat']) {
  const smoothed = smoothSurfaceRouteGeometry(sharpCorner, mode, { profile: 'playback' });
  check(smoothed.length >= 180, `${mode} routes must be densified for smooth playback.`);
  equal(smoothed[0], sharpCorner[0], `${mode} smoothing must preserve the origin exactly.`);
  equal(smoothed.at(-1), sharpCorner.at(-1), `${mode} smoothing must preserve the destination exactly.`);
  check(maxTurnDegrees(smoothed) < 55, `${mode} smoothing must reduce a 90-degree hard corner.`);
  check(surfaceRouteRenderSamples(smoothed, mode, 64, 'active') > 64, `${mode} active rendering must use increased surface-route sampling.`);
}
const plane = smoothSurfaceRouteGeometry(sharpCorner, 'plane', { profile: 'playback' });
equal(plane, sharpCorner, 'Plane geometry must not receive surface-route smoothing.');
const sanitized = smoothSurfaceRouteGeometry([[0, 0], [0, 0], ['bad', 2], [1, 1]], 'car');
equal(sanitized, [[0, 0], [1, 1]], 'Smoothing must remove invalid and duplicate coordinates safely.');

// Renderer and worker must share the smoothing implementation.
check(travelMap.includes("from '../utils/routeSmoothing.js'"), 'TravelMap must import the shared smoothing utility.');
check(travelMap.includes("smoothSurfaceRouteGeometry(raw, leg.mode, { profile: 'playback' })"), 'Rendered surface routes must use shared smoothing.');
check(travelMap.includes('surfaceRouteRenderSamples(routed, leg.mode, n, profile)'), 'Surface route drawing must increase sampling density.');
check(worker.includes("from '../utils/routeSmoothing.js'"), 'Routing worker must import shared smoothing.');
check(worker.includes("smoothSurfaceRouteGeometry(route, mode, { profile: 'playback' })"), 'Worker playback plans must use the same smoothed route as rendering.');

// Disconnected timeline entries must pause and transfer ownership to a camera relocation.
const advanceStart = app.indexOf('advancePlaybackRef.current = () => {');
const advanceEnd = app.indexOf('useEffect(() => {', advanceStart);
const advanceBlock = app.slice(advanceStart, advanceEnd);
check(advanceBlock.includes('playbackLegsConnect(currentEntry?.leg, nextEntry?.leg)'), 'Playback must classify connected and disconnected handoffs.');
check(advanceBlock.includes('playbackEngine.pause();'), 'Disconnected handoffs must pause the playback engine.');
check(advanceBlock.includes('setIsPlaying(false);'), 'Disconnected handoffs must pause the UI state.');
check(advanceBlock.includes('setRelocationTransition(transition);'), 'Disconnected handoffs must create a relocation command.');
check(!advanceBlock.includes('setActiveIndex(nextIndex);\n      return;'), 'Disconnected handoffs must not advance before the relocation completes.');

const relocationCompleteStart = app.indexOf('const completeRelocationTransition');
const relocationCompleteEnd = app.indexOf('function freezePlaybackClock', relocationCompleteStart);
const relocationCompleteBlock = app.slice(relocationCompleteStart, relocationCompleteEnd);
check(relocationCompleteBlock.includes('setActiveIndex(nextIndex);'), 'Relocation completion must advance to the next leg.');
check(relocationCompleteBlock.includes('setIsPlaying(true);'), 'Relocation completion must resume playback.');
check(relocationCompleteBlock.includes('transition.id !== requestId'), 'Stale relocation completions must be ignored.');
check(controls.includes("isRelocating ? 'Moving…'"), 'Playback control must expose the relocation state.');
check(controls.includes('disabled={isRelocating}'), 'Playback control must be disabled while relocation owns the camera.');

// Map relocation must be a bounded glide with guarded completion and cleanup.
const glideStart = travelMap.indexOf('const request = relocationTransition;');
const glideEnd = travelMap.indexOf('}, [mapReady, relocationTransition?.id', glideStart);
const glideBlock = travelMap.slice(glideStart, glideEnd);
check(glideBlock.includes('map.flyTo({'), 'Disconnected trips must glide with MapLibre flyTo.');
check(glideBlock.includes("map.once?.('moveend', handleMoveEnd)"), 'Playback must wait for the camera move to settle.');
check(glideBlock.includes("finish('timeout-fallback')"), 'Relocation must include a bounded timeout fallback.');
check(glideBlock.includes("finish('jump-fallback')"), 'Relocation must fail safely if flyTo throws.');
check(glideBlock.includes('try { map.stop(); } catch {}'), 'Relocation cleanup must stop a canceled camera animation.');
check(glideBlock.includes("status: 'invalid-target'"), 'Invalid relocation targets must be handled explicitly.');
check(travelMap.includes('if (relocationTransition?.id) {'), 'The normal scene camera must yield while relocation is active.');

// All user-owned camera/editor commands must cancel a relocation owner.
for (const functionName of ['editTravelHistory', 'editTimelineMarker', 'addTravelTimelineEntry', 'viewGlobe', 'restartJourney', 'jumpToLeg']) {
  const start = app.indexOf(`function ${functionName}`);
  check(start >= 0, `${functionName} must exist.`);
  const nextFunction = app.indexOf('\n  function ', start + 10);
  const block = app.slice(start, nextFunction > start ? nextFunction : start + 2200);
  check(block.includes('setRelocationTransition(null)'), `${functionName} must cancel an active relocation.`);
}

// First-click Add Hop must survive lazy loading and remain modal-only.
const addStart = app.indexOf('function addTravelTimelineEntry()');
const addEnd = app.indexOf('function pause()', addStart);
const addBlock = app.slice(addStart, addEnd);
check(addBlock.includes('setStudioModalOnly(true);'), 'Add Hop must always request modal-only Studio.');
check(addBlock.includes('setStudioAddRequestId(value => value + 1);'), 'Add Hop must send a durable one-shot request ID.');
check(!addBlock.includes("dispatchEvent(new CustomEvent('globehoppers-open-new-trip'"), 'Primary Add Hop must not depend on a pre-mount window event.');
check(app.includes('initialAddRequestId={studioAddRequestId}'), 'App must pass the Add Hop request into lazy AdminPanel.');
check(admin.includes('initialAddRequestId = 0'), 'AdminPanel must accept the Add Hop request ID.');
check(admin.includes('initialAddRequestRef.current === initialAddRequestId'), 'AdminPanel must consume each Add Hop request once.');
check(admin.includes('openAdd();'), 'AdminPanel must open Add Hop after consuming the request.');

// Release metadata and QA placement.
assert.equal(packageJson.version, '7.1.2'); checks += 1;
check(packageJson.scripts['verify:v7.1.2'], 'Package must expose v7.1.2 verification.');
check(fs.existsSync(path.join(root, 'QA/QA-v7.1.2.md')), 'v7.1.2 QA must live under journeylines/QA/.');
check(!fs.existsSync(path.resolve(root, '../QA-v7.1.2.md')), 'v7.1.2 QA must not be duplicated at repository root.');
check(read('VERSION.md').startsWith('GlobeHoppers v7.1.2'), 'journeylines/VERSION.md must identify v7.1.2 first.');

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

console.log(`GlobeHoppers v7.1.2 verification passed: ${checks} checks.`);

function maxTurnDegrees(points) {
  let maximum = 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = Math.atan2(points[index][1] - points[index - 1][1], points[index][0] - points[index - 1][0]);
    const next = Math.atan2(points[index + 1][1] - points[index][1], points[index + 1][0] - points[index][0]);
    let delta = Math.abs(next - previous);
    if (delta > Math.PI) delta = Math.PI * 2 - delta;
    maximum = Math.max(maximum, delta * 180 / Math.PI);
  }
  return maximum;
}
