import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import {
  assessMultimodalRoute,
  routeReviewSignature,
  sanitizeRouteGeometry
} from '../src/utils/multimodalRouting.js';

const appRoot = path.resolve(process.argv[2] || '.');
const repoRoot = path.resolve(appRoot, '..');
let checks = 0;
const createdManagedPlaceholders = [];

function check(condition, message) {
  assert.ok(condition, message);
  checks += 1;
}

async function read(relative) {
  return fs.readFile(path.join(appRoot, relative), 'utf8');
}

async function exists(absolute) {
  try { await fs.access(absolute); return true; } catch { return false; }
}

async function ensureBuildPlaceholder(relative, content) {
  const absolute = path.join(appRoot, relative);
  if (await exists(absolute)) return;
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, content);
  createdManagedPlaceholders.push(absolute);
}

async function verifyStaticSource() {
  const pkg = JSON.parse(await read('package.json'));
  check(pkg.version === '7.0.0', 'package.json must identify v7.0.0.');
  check(pkg.scripts?.['verify:v7.0'] === 'node scripts/verify-v7.0.mjs .', 'v7 verification script is missing.');

  const admin = await read('src/components/AdminPanel.jsx');
  const client = await read('src/utils/routingClient.js');
  const worker = await read('src/workers/routingWorker.js');
  const styles = await read('src/styles.css');
  const routeDetails = await read('src/utils/routeDetails.js');
  const timing = await read('src/utils/routeTiming.js');

  check(admin.includes('Multimodal route review'), 'Route Review panel is not rendered.');
  check(admin.includes('validateRouteReviewForSave'), 'Surface-route save gate is missing.');
  check(admin.includes("status: 'stale'"), 'Route signature changes must invalidate review approval.');
  check(admin.includes('routeReviewGenerationRef'), 'Stale asynchronous route-review results are not guarded.');
  check(admin.includes("errors: [error?.message || 'The route could not be calculated.']"), 'Per-leg review errors are not contained.');
  check(admin.includes("draftSurfaceReviewLegs.length > 4"), 'Large batches should require explicit review.');
  check(admin.includes("routeReview.status === 'working'"), 'Save must be disabled while routes are calculating.');

  check(client.includes("export const ROUTING_VERSION = 'multimodal-v7.0'"), 'Routing cache version was not advanced.');
  check(client.includes('requestMapboxDrivingRoute'), 'Mapbox road routing is missing.');
  check(client.includes('mapbox-build-cache'), 'Private build-time Mapbox route reuse is missing.');
  check(client.includes('AbortController'), 'Mapbox routing does not have abort/timeout protection.');
  check(client.includes('continuing with in-memory geometry'), 'Cache write failures should be non-blocking.');
  check(client.includes('disposeWorker'), 'Worker reset/recovery logic is missing.');
  check(client.includes('workerEpoch'), 'Stale worker messages are not guarded.');

  check(worker.includes('buildSurfaceGraph'), 'Road/rail graph construction is missing.');
  check(worker.includes('astarSurfaceRoute'), 'Road/rail A* routing is missing.');
  check(worker.includes('countBoatLandCrossings'), 'Boat corridor-aware land validation is missing.');
  check(worker.includes("source: type === 'train' ? 'natural-earth-rail-graph'"), 'Rail graph source metadata is missing.');
  check(worker.includes("detail = 'direct-land-corridor'"), 'Surface fallback confidence metadata is missing.');

  check(styles.includes('.route-review-panel'), 'Route Review styles are missing.');
  check(styles.includes('.route-review-map'), 'Route geometry preview styles are missing.');
  check(routeDetails.includes("ROUTE_DETAILS_VERSION = '7.0'"), 'routeDetails metadata version was not advanced.');
  check(routeDetails.includes('routeWarnings'), 'Reviewed route diagnostics are not persisted.');
  check(timing.includes("normalizedMode === 'boat'"), 'Mode-specific playback timing is missing.');

  check(await exists(path.join(appRoot, 'QA', 'QA-v7.0.md')), 'v7 QA file must be under journeylines/QA/.');
  check(!(await exists(path.join(repoRoot, 'QA-v7.0.md'))), 'QA files must not be duplicated at repository root.');
  check(await exists(path.join(appRoot, 'MULTIMODAL-v7.md')), 'Multimodal routing documentation is missing.');
}

function verifyRouteAssessment() {
  const baseLeg = {
    legId: 'test-leg',
    mode: 'boat',
    from: { id: 'a', name: 'Port A', lon: -80, lat: 25 },
    to: { id: 'b', name: 'Port B', lon: -77, lat: 25 }
  };

  const clean = sanitizeRouteGeometry([[-80, 25], [-79, 25.2], [-77, 25]]);
  check(clean?.length === 3, 'Geometry sanitation removed valid points.');
  check(sanitizeRouteGeometry([[999, 0], [0, 999]]) === null, 'Invalid coordinates should be rejected.');

  const stationary = assessMultimodalRoute({
    leg: baseLeg,
    geometry: [[-80, 25], [-80, 25]],
    source: 'natural-earth-water-graph',
    validation: { stationaryFallback: true }
  });
  check(stationary.errors.some(message => /stationary|usable route geometry/i.test(message)), 'Stationary boat route was not rejected.');

  const landCrossing = assessMultimodalRoute({
    leg: baseLeg,
    geometry: [[-80, 25], [-78, 25], [-77, 25]],
    source: 'natural-earth-water-graph',
    validation: { landCrossings: 1 }
  });
  check(landCrossing.errors.some(message => /crosses land/i.test(message)), 'Boat land crossing was not rejected.');

  const drive = {
    ...baseLeg,
    mode: 'drive',
    from: { id: 'a', name: 'A', lon: -117, lat: 32 },
    to: { id: 'b', name: 'B', lon: -116, lat: 33 }
  };
  const offLand = assessMultimodalRoute({
    leg: drive,
    geometry: [[-117, 32], [-116.5, 32.5], [-116, 33]],
    source: 'natural-earth-road-fallback',
    validation: { surfaceWaterRatio: 0.7 }
  });
  check(offLand.errors.some(message => /off mapped land/i.test(message)), 'Severe off-land driving route was not rejected.');

  const railGap = assessMultimodalRoute({
    leg: { ...drive, mode: 'train' },
    geometry: [[-117, 32], [-116.5, 32.5], [-116, 33]],
    source: 'natural-earth-rail-fallback',
    validation: { networkStartGapMiles: 120, networkEndGapMiles: 5 }
  });
  check(railGap.warnings.some(message => /rail network begins/i.test(message)), 'Large rail-network endpoint gaps should be disclosed.');

  const signatureA = routeReviewSignature([drive]);
  const signatureB = routeReviewSignature([{ ...drive, to: { ...drive.to, lon: -115.9 } }]);
  check(signatureA !== signatureB, 'Changing an endpoint must invalidate the route signature.');
  check(signatureA === routeReviewSignature([{ ...drive }]), 'Equivalent route inputs must produce stable signatures.');
}

async function createWorkerHarness() {
  const source = await read('src/workers/routingWorker.js');
  const routingData = JSON.parse(await read('public/data/naturalEarthRouting.json'));
  const waiters = new Map();
  const statuses = [];
  const selfObject = {
    onmessage: null,
    postMessage(message) {
      if (message?.type === 'status') {
        statuses.push(message.status);
        return;
      }
      const waiter = waiters.get(message?.id);
      if (!waiter) return;
      waiters.delete(message.id);
      if (message.ok) waiter.resolve(message.result);
      else waiter.reject(new Error(message.error || 'Worker request failed.'));
    }
  };
  const context = vm.createContext({
    self: selfObject,
    console,
    fetch: async () => ({ ok: true, status: 200, json: async () => routingData }),
    Map, Set, Math, Number, String, Array, Object, Date, Infinity,
    Float32Array, Uint32Array, Uint16Array, JSON, Promise, Error
  });
  vm.runInContext(source, context, { filename: 'routingWorker.js' });
  let nextId = 1;
  async function request(type, payload = {}) {
    const id = nextId++;
    const promise = new Promise((resolve, reject) => waiters.set(id, { resolve, reject }));
    await selfObject.onmessage({ data: { id, type, payload } });
    return promise;
  }
  return { request, statuses };
}

async function verifyWorkerRoutes() {
  const { request, statuses } = await createWorkerHarness();
  const init = await request('init', { dataUrl: 'mock://natural-earth', routingVersion: 'multimodal-v7.0' });
  check(init.ready === true, 'Routing worker did not initialize.');
  check(init.roadNodeCount > 10000, 'Road graph is unexpectedly empty.');
  check(init.railNodeCount > 10000, 'Rail graph is unexpectedly empty.');
  check(init.nodeCount > 10000, 'Water graph is unexpectedly empty.');
  check(statuses.some(status => status?.state === 'ready'), 'Worker never emitted ready status.');

  const roadLeg = {
    legId: 'road-sd-la', mode: 'drive',
    from: { id: 'sd', name: 'San Diego', lon: -117.1611, lat: 32.7157 },
    to: { id: 'la', name: 'Los Angeles', lon: -118.2437, lat: 34.0522 }
  };
  const road = await request('route', { leg: roadLeg });
  check(road.geometry.length >= 40, 'Road route is too sparse for believable playback.');
  check(/^natural-earth-road-/.test(road.source), 'Road route source metadata is incorrect.');
  check(road.validation.surfaceWaterRatio < 0.2, 'San Diego–Los Angeles road route spends too much time off land.');
  check(road.validation.routeMiles >= road.validation.directMiles * 0.9, 'Road route is implausibly short.');

  const railLeg = {
    legId: 'rail-sd-la', mode: 'train',
    from: { id: 'sd-station', name: 'San Diego Santa Fe Depot', lon: -117.1696, lat: 32.7168 },
    to: { id: 'la-station', name: 'Los Angeles Union Station', lon: -118.2365, lat: 34.0562 }
  };
  const rail = await request('route', { leg: railLeg });
  check(rail.geometry.length >= 40, 'Rail route is too sparse for believable playback.');
  check(/^natural-earth-rail-/.test(rail.source), 'Rail route source metadata is incorrect.');
  check(rail.validation.surfaceWaterRatio < 0.2, 'San Diego–Los Angeles rail route spends too much time off land.');
  check(rail.validation.routeMiles < rail.validation.directMiles * 2.5 + 50, 'Rail fallback is excessively indirect.');

  const boatLeg = {
    legId: 'boat-miami-nassau', mode: 'boat',
    from: { id: 'miami-port', name: 'PortMiami', lon: -80.177, lat: 25.776 },
    to: { id: 'nassau-port', name: 'Nassau Port', lon: -77.343, lat: 25.079 }
  };
  const boat = await request('route', { leg: boatLeg });
  check(boat.geometry.length > 2, 'Boat route has no navigable-water shape.');
  check(boat.source === 'natural-earth-water-graph', 'Boat route source metadata is incorrect.');
  check(boat.validation.landCrossings === 0, 'PortMiami–Nassau route crosses mapped land.');
  check(boat.validation.stationaryFallback === false, 'PortMiami–Nassau route collapsed to a stationary fallback.');
}

async function verifyBuild() {
  await ensureBuildPlaceholder('src/data/trips.json', '[]\n');
  await ensureBuildPlaceholder('src/data/hoppers.json', '{"hoppers":[],"hopSquads":[]}\n');
  const result = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], {
    cwd: appRoot,
    encoding: 'utf8',
    env: process.env
  });
  if (result.status !== 0) {
    process.stderr.write(result.stdout || '');
    process.stderr.write(result.stderr || '');
  }
  check(result.status === 0, 'Production build failed.');
  check(await exists(path.join(appRoot, 'dist', 'index.html')), 'Production build did not produce dist/index.html.');
}

try {
  await verifyStaticSource();
  verifyRouteAssessment();
  await verifyWorkerRoutes();
  await verifyBuild();
  console.log(`GlobeHoppers v7.0 verification passed (${checks} checks).`);
} finally {
  for (const absolute of createdManagedPlaceholders) {
    try { await fs.unlink(absolute); } catch {}
  }
}
