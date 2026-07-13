import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(process.argv[2] || '.');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
let checks = 0;
function check(condition, message) {
  assert.ok(condition, message);
  checks += 1;
}
function equal(actual, expected, message) {
  assert.equal(actual, expected, message);
  checks += 1;
}

const travelMap = read('src/components/TravelMap.jsx');
const routingClient = read('src/utils/routingClient.js');
const packageJson = JSON.parse(read('package.json'));

// The active entry must never freeze the temporary stylized fallback.
const freezeStart = travelMap.indexOf('function freezeActiveEntryGeometry');
const freezeEnd = travelMap.indexOf('function adaptiveCameraSmoothing', freezeStart);
const freezeBlock = travelMap.slice(freezeStart, freezeEnd);
check(freezeStart >= 0 && freezeEnd > freezeStart, 'freezeActiveEntryGeometry must be present.');
check(freezeBlock.includes('getRoutedGeometry(entry.leg, routedGeometries)'), 'Active playback must freeze detailed routed geometry.');
check(!freezeBlock.includes('waypointPathForLeg('), 'Active playback must not freeze the stylized fallback path.');
check(freezeBlock.includes('return entry;'), 'An entry without detailed geometry must remain live for late promotion.');

// Prefetch must begin before playback instead of requiring an active index.
check(travelMap.includes('const routePrefetchIndex = safeActiveIndex >= 0 ? safeActiveIndex : 0;'), 'Route prefetch must start from leg zero while idle.');
check(travelMap.includes('const queue = legs.slice(routePrefetchIndex, routePrefetchIndex + 4);'), 'Current and next three legs must be prefetched.');
check(!travelMap.includes('if (safeActiveIndex < 0 || !legs.length) return;'), 'Idle prefetch must not be blocked by the inactive playback index.');

// Stored and retrieved playback plans must use the same explicit geometry.
check(travelMap.includes('playbackPlansRef.current.set(playbackPlanKey(leg, geometry), plan)'), 'Playback plans must be stored using the routed geometry signature.');
check(
  travelMap.includes('const liveGeometry = getRoutedGeometry(activeEntry.leg, routedGeometriesRef.current);') ||
    travelMap.includes('const renderGeometry = getRoutedGeometry(renderEntry.leg, routedGeometriesRef.current);'),
  'Playback must resolve the geometry it is actually rendering.'
);
check(
  travelMap.includes('playbackPlansRef.current.get(playbackPlanKey(activeEntry.leg, liveGeometry))') ||
    travelMap.includes('playbackPlansRef.current.get(playbackPlanKey(renderEntry.leg, renderGeometry))'),
  'Playback plans must be retrieved using the rendered geometry signature.'
);
check(travelMap.includes('function playbackPlanKey(leg, geometryOverride = null)'), 'Playback plan keys must accept an explicit geometry override.');
check(travelMap.includes('Math.floor((geometry.length - 1) * 0.5)'), 'Playback plan keys must sample the route midpoint.');
check(travelMap.includes('Math.floor((geometry.length - 1) * 0.75)'), 'Playback plan keys must sample the three-quarter route point.');

// Worker-side plan deduplication must also distinguish route shapes.
check(routingClient.includes('function playbackGeometrySignature(geometry)'), 'Routing client must define a detailed playback geometry signature.');
check(routingClient.includes('const geometrySignature = playbackGeometrySignature(geometry);'), 'Worker plan cache must use the detailed geometry signature.');
check(routingClient.includes('Math.floor((geometry.length - 1) * 0.25)'), 'Worker plan signature must sample the quarter route point.');
check(routingClient.includes('Math.floor((geometry.length - 1) * 0.5)'), 'Worker plan signature must sample the midpoint.');

// Regression guard: the temporary route remains available only as a visual fallback.
const waypointStart = travelMap.indexOf('function waypointPathForLeg');
const waypointEnd = travelMap.indexOf('const ROUTE_WAYPOINTS', waypointStart);
const waypointBlock = travelMap.slice(waypointStart, waypointEnd);
check(waypointBlock.includes('return stylizedFallbackRoute(leg);'), 'The lightweight fallback must remain available when no route is ready.');
check(travelMap.includes('const routed = getVisualRoutedGeometry(leg, routedGeometries);') || travelMap.includes('const routed = getRoutedGeometry(leg, routedGeometries);'), 'Vehicle position must prefer routed geometry.');

// Release metadata and QA placement.
check(/^7\.1\.(?:1|[2-9]|\d{2,})$/.test(packageJson.version), 'Package version must be v7.1.1 or a later v7.1 patch.');
check(packageJson.scripts['verify:v7.1.1'], 'Package must expose the v7.1.1 verification command.');
check(fs.existsSync(path.join(root, 'QA/QA-v7.1.1.md')), 'v7.1.1 QA record must live under journeylines/QA/.');
check(!fs.existsSync(path.resolve(root, '../QA-v7.1.1.md')), 'v7.1.1 QA record must not be duplicated at repository root.');
check(read('VERSION.md').startsWith(`GlobeHoppers v${packageJson.version}`), 'journeylines/VERSION.md must identify the current package version first.');

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

console.log(`GlobeHoppers v7.1.1 verification passed: ${checks} checks.`);
