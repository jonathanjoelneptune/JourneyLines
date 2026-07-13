import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { spawnSync } from 'node:child_process';
import {
  buildSurfacePresentationGeometry,
  isSurfaceRouteMode,
  presentationPointBudget,
  surfaceRouteRenderSamples
} from '../src/utils/routePresentation.js';

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

const travelMap = read('src/components/TravelMap.jsx');
const worker = read('src/workers/routingWorker.js');
const routingClient = read('src/utils/routingClient.js');
const packageJson = JSON.parse(read('package.json'));
const routeDetails = JSON.parse(read('src/data/routeDetails.json'));

check(isSurfaceRouteMode('car') && isSurfaceRouteMode('drive') && isSurfaceRouteMode('train') && isSurfaceRouteMode('boat'), 'All surface modes must use presentation routing.');
check(!isSurfaceRouteMode('plane') && !isSurfaceRouteMode('move'), 'Plane and home-move routes must not use surface presentation routing.');

const detailed = makeNoisyRoad(12000);
const start = performance.now();
const simplified = buildSurfacePresentationGeometry(detailed, 'car', { profile: 'playback' });
const firstDuration = performance.now() - start;
const cachedStart = performance.now();
const cached = buildSurfacePresentationGeometry(detailed, 'car', { profile: 'playback' });
const cachedDuration = performance.now() - cachedStart;

check(simplified.length < detailed.length / 20, 'A dense road route must be reduced by at least 95 percent.');
check(simplified.length <= presentationPointBudget(polylineMiles(detailed), 'car') + 40, 'Normal road routes must remain near the lightweight point budget.');
equal(simplified[0], detailed[0], 'Presentation geometry must preserve the exact route origin.');
equal(simplified.at(-1), detailed.at(-1), 'Presentation geometry must preserve the exact route destination.');
const detailedPointSet = new Set(detailed.map(point => `${point[0].toFixed(12)},${point[1].toFixed(12)}`));
check(simplified.every(point => detailedPointSet.has(`${point[0].toFixed(12)},${point[1].toFixed(12)}`)), 'Presentation geometry must select provider route points rather than inventing off-route coordinates.');
check(cached === simplified, 'Repeated presentation requests must return the cached geometry object.');
check(cachedDuration < Math.max(2, firstDuration * 0.1), 'Repeated presentation requests must use the O(1) cache path.');
check(surfaceRouteRenderSamples(simplified, 'car', 420, 'active') <= simplified.length - 1, 'Active rendering must never re-densify a lightweight surface route.');
check(surfaceRouteRenderSamples(simplified, 'car', 72, 'overview') <= 72, 'Overview rendering must be allowed to downsample further.');

const bayRoute = makeBayDetour();
for (const mode of ['car', 'train']) {
  const result = buildSurfacePresentationGeometry(bayRoute, mode, { profile: 'playback' });
  check(!segmentsCrossRectangle(result, [-0.19, 0.19, 0.01, 0.49]), `${mode} simplification must retain the provider detour around a water obstacle.`);
  check(result.some(point => point[1] >= 0.49), `${mode} simplification must preserve the major detour apex.`);
}

const islandRoute = makeIslandDetour();
const boatResult = buildSurfacePresentationGeometry(islandRoute, 'boat', { profile: 'playback' });
check(!segmentsCrossRectangle(boatResult, [-0.18, 0.18, -0.35, 0.35]), 'Boat simplification must retain the provider detour around an island.');
check(boatResult.some(point => point[1] >= 0.49), 'Boat simplification must preserve the navigable-water waypoint around the island.');

const straightBridge = Array.from({ length: 1000 }, (_, index) => [-1 + index / 500, 0]);
const bridgeResult = buildSurfacePresentationGeometry(straightBridge, 'car');
check(bridgeResult.length < 12, 'A nearly straight provider route, including a valid bridge corridor, should simplify aggressively.');

const largest = Object.values(routeDetails.routes || {})
  .filter(entry => Array.isArray(entry?.geometry) && entry.geometry.length > 1)
  .sort((a, b) => b.geometry.length - a.geometry.length)[0];
check(Boolean(largest), 'The routeDetails fixture must include at least one detailed route.');
const largestStart = performance.now();
const largestPresentation = buildSurfacePresentationGeometry(largest.geometry, largest.mode || 'car');
const largestDuration = performance.now() - largestStart;
check(largestPresentation.length <= 360, 'The largest repository surface route must be reduced to a bounded presentation path.');
check(largestDuration < 1500, 'The largest repository route must simplify in bounded time.');

check(travelMap.includes("from '../utils/routePresentation.js'"), 'TravelMap must use the lightweight route-presentation utility.');
check(travelMap.includes('buildSurfacePresentationGeometry(raw, leg.mode'), 'Rendered surface routes must use lightweight presentation geometry.');
check(travelMap.includes('const polylineMetricCache = new WeakMap();'), 'TravelMap must cache polyline metrics.');
check(travelMap.includes('pointOnPolylineWithMetrics'), 'Vehicle/trail sampling must share precomputed polyline metrics.');
check(travelMap.includes('while (low < high)'), 'Polyline lookup must use bounded binary search rather than a full linear scan for every sample.');
check(/const trailInterval = quality === 'high' \? (?:50|84)/.test(travelMap), 'Active trail reconstruction must be throttled independently from vehicle animation.');
check(!travelMap.includes('smoothSurfaceRouteGeometry(raw, leg.mode'), 'TravelMap must not invoke the old dense smoothing path.');

check(worker.includes("from '../utils/routePresentation.js'"), 'Routing worker must use the same route-presentation utility as rendering.');
check(worker.includes('buildSurfacePresentationGeometry(route, mode'), 'Playback plans must use the exact lightweight presentation route.');
check(worker.includes('Math.min(320'), 'Worker playback plans must have a hard sample-count ceiling.');
check(worker.includes('Math.max(72'), 'Worker playback plans must retain enough samples for smooth interpolation.');
check(routingClient.includes("export const ROUTING_VERSION = 'multimodal-v7.1';"), 'Provider route caches must remain reusable because v7.1.3 changes presentation, not routing source data.');

check(/^7\.1\.(?:3|[4-9]|[1-9]\d+)$/.test(packageJson.version), 'Package version must retain or supersede v7.1.3.');
check(packageJson.scripts['verify:v7.1.3'], 'Package must expose v7.1.3 verification.');
check(fs.existsSync(path.join(root, 'QA/QA-v7.1.3.md')), 'v7.1.3 QA must live under journeylines/QA/.');
check(!fs.existsSync(path.resolve(root, '../QA-v7.1.3.md')), 'v7.1.3 QA must not be duplicated at repository root.');
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

console.log(`GlobeHoppers v7.1.3 verification passed: ${checks} checks.`);

function makeNoisyRoad(count) {
  return Array.from({ length: count }, (_, index) => {
    const t = index / Math.max(1, count - 1);
    return [-117 + t * 7.5, 32 + t * 4.2 + Math.sin(t * 170) * 0.007 + Math.sin(t * 31) * 0.025];
  });
}

function makeBayDetour() {
  return joinLines([
    [[-1, 0], [-0.2, 0], 300],
    [[-0.2, 0], [-0.2, 0.5], 220],
    [[-0.2, 0.5], [0.2, 0.5], 220],
    [[0.2, 0.5], [0.2, 0], 220],
    [[0.2, 0], [1, 0], 300]
  ]);
}

function makeIslandDetour() {
  return joinLines([
    [[-1, 0], [-0.25, 0], 240],
    [[-0.25, 0], [-0.25, 0.5], 180],
    [[-0.25, 0.5], [0.25, 0.5], 180],
    [[0.25, 0.5], [0.25, 0], 180],
    [[0.25, 0], [1, 0], 240]
  ]);
}

function joinLines(definitions) {
  const output = [];
  for (const [start, end, count] of definitions) {
    const line = Array.from({ length: count }, (_, index) => {
      const t = index / Math.max(1, count - 1);
      return [start[0] + (end[0] - start[0]) * t, start[1] + (end[1] - start[1]) * t];
    });
    output.push(...(output.length ? line.slice(1) : line));
  }
  return output;
}

function segmentsCrossRectangle(points, [minX, maxX, minY, maxY]) {
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    for (let sample = 0; sample <= 80; sample += 1) {
      const t = sample / 80;
      const x = a[0] + (b[0] - a[0]) * t;
      const y = a[1] + (b[1] - a[1]) * t;
      if (x > minX && x < maxX && y > minY && y < maxY) return true;
    }
  }
  return false;
}

function polylineMiles(points) {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];
    const latScale = Math.cos(((a[1] + b[1]) / 2) * Math.PI / 180);
    total += Math.hypot((b[0] - a[0]) * 69.172 * latScale, (b[1] - a[1]) * 69.0);
  }
  return total;
}
