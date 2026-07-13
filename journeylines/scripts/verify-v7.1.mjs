import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  buildValhallaRoutePayload,
  decodeValhallaPolyline6,
  normalizeValhallaEndpoint,
  normalizeValhallaEndpoints,
  parseValhallaRouteResponse,
  requestValhallaDrivingRoute
} from '../src/utils/valhallaRouting.js';
import { assessMultimodalRoute, routeSourceLabel } from '../src/utils/multimodalRouting.js';

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

function encodePolyline6(points) {
  let previousLat = 0;
  let previousLon = 0;
  let encoded = '';
  for (const [lon, lat] of points) {
    const nextLat = Math.round(lat * 1e6);
    const nextLon = Math.round(lon * 1e6);
    encoded += encodeSigned(nextLat - previousLat);
    encoded += encodeSigned(nextLon - previousLon);
    previousLat = nextLat;
    previousLon = nextLon;
  }
  return encoded;
}
function encodeSigned(value) {
  let current = value < 0 ? ~(value << 1) : value << 1;
  let output = '';
  while (current >= 0x20) {
    output += String.fromCharCode((0x20 | (current & 0x1f)) + 63);
    current >>= 5;
  }
  return output + String.fromCharCode(current + 63);
}

const sampleLeg = {
  id: 'san-diego-los-angeles',
  legId: 'leg-road-test',
  mode: 'drive',
  from: { name: 'San Diego', lat: 32.7157, lon: -117.1611 },
  to: { name: 'Los Angeles', lat: 34.0522, lon: -118.2437 }
};
const sampleGeometry = [
  [-117.1611, 32.7157],
  [-117.55, 33.1],
  [-118.0, 33.72],
  [-118.2437, 34.0522]
];
const sampleShape = encodePolyline6(sampleGeometry);

// Valhalla URL and request construction.
equal(normalizeValhallaEndpoint('https://example.test/route/?x=1#hash'), 'https://example.test', 'Endpoint normalization should remove route, query, hash, and trailing slash.');
equal(normalizeValhallaEndpoint('javascript:alert(1)'), '', 'Unsafe URL protocols must be rejected.');
equal(normalizeValhallaEndpoints(['https://a.test/', 'https://a.test/route', 'https://b.test']).length, 2, 'Duplicate endpoints should be removed.');
const payload = buildValhallaRoutePayload(sampleLeg);
equal(payload.costing, 'auto', 'Driving requests must use Valhalla auto costing.');
equal(payload.locations.length, 2, 'Driving requests must contain origin and destination.');
equal(payload.locations[0].lat, sampleLeg.from.lat, 'Origin latitude order must be preserved.');
equal(payload.locations[0].lon, sampleLeg.from.lon, 'Origin longitude order must be preserved.');
equal(payload.locations[1].lat, sampleLeg.to.lat, 'Destination latitude order must be preserved.');
equal(payload.locations[1].lon, sampleLeg.to.lon, 'Destination longitude order must be preserved.');

// Precision-six decoding and response parsing.
const decoded = decodeValhallaPolyline6(sampleShape);
equal(decoded.length, sampleGeometry.length, 'Polyline decoder must preserve point count.');
for (let index = 0; index < sampleGeometry.length; index += 1) {
  check(Math.abs(decoded[index][0] - sampleGeometry[index][0]) < 1e-6, `Decoded longitude ${index} should match.`);
  check(Math.abs(decoded[index][1] - sampleGeometry[index][1]) < 1e-6, `Decoded latitude ${index} should match.`);
}
const responsePayload = {
  trip: {
    status: 0,
    status_message: 'Found route between points',
    summary: { length: 121.4, time: 7420, has_ferry: false, has_highway: true, has_toll: false },
    legs: [{ shape: sampleShape }]
  }
};
const parsed = parseValhallaRouteResponse(responsePayload, sampleLeg);
equal(parsed.geometry.length, sampleGeometry.length, 'Parsed Valhalla response must expose geometry.');
equal(parsed.distanceMiles, 121.4, 'Parsed Valhalla response must preserve distance.');
equal(parsed.durationSeconds, 7420, 'Parsed Valhalla response must preserve duration.');
check(parsed.validation.maxEndpointGapMiles < 0.1, 'Endpoint snap validation should pass exact route endpoints.');
assert.throws(() => parseValhallaRouteResponse({ trip: { status: 171, status_message: 'No suitable edges' } }, sampleLeg), /No suitable edges/, 'Unsuccessful trips must be rejected.');
checks += 1;
assert.throws(() => parseValhallaRouteResponse({ trip: { status: 0, legs: [] } }, sampleLeg), /no route legs/i, 'Empty route responses must be rejected.');
checks += 1;

// Ordered endpoint failover with a mock transport.
const calls = [];
const mockFetch = async url => {
  calls.push(String(url));
  if (calls.length === 1) {
    return { ok: false, status: 503, statusText: 'Unavailable', text: async () => 'temporary outage' };
  }
  return { ok: true, status: 200, text: async () => JSON.stringify(responsePayload) };
};
const routed = await requestValhallaDrivingRoute(sampleLeg, {
  endpoints: ['https://first.test', 'https://second.test'],
  timeoutMs: 3000,
  fetchImpl: mockFetch
});
equal(calls.length, 2, 'Valhalla must try the next configured endpoint after an HTTP failure.');
check(calls[0].startsWith('https://first.test/route?'), 'First endpoint must be attempted first.');
check(calls[1].startsWith('https://second.test/route?'), 'Second endpoint must be attempted after failure.');
equal(routed.endpoint, 'https://second.test', 'Successful fallback endpoint must be reported.');
check(calls[1].includes('json='), 'Valhalla route request must send the JSON payload.');

// Assessment uses provider duration and recognizes Valhalla as high-confidence.
const assessment = assessMultimodalRoute({
  leg: sampleLeg,
  geometry: sampleGeometry,
  source: 'valhalla-osm',
  provider: 'Valhalla / OpenStreetMap',
  validation: { valhallaDurationSeconds: 7200, maxEndpointGapMiles: 0 }
});
equal(assessment.estimatedMinutes, 120, 'Provider duration should be preferred over a generic estimate.');
equal(assessment.confidence, 'high', 'A clean Valhalla route should be high confidence.');
equal(routeSourceLabel('valhalla-osm'), 'OpenStreetMap road route', 'Valhalla source should have a user-friendly label.');

// Static integration checks.
const admin = read('src/components/AdminPanel.jsx');
const routingClient = read('src/utils/routingClient.js');
const travelMap = read('src/components/TravelMap.jsx');
const runtimeConfig = read('public/runtime-config.js');
const styles = read('src/styles.css');
const packageJson = JSON.parse(read('package.json'));
const worker = read('src/workers/routingWorker.js');
const routeDetails = read('src/utils/routeDetails.js');

check(admin.includes('Automatic route check'), 'Add/Edit Hop must expose automatic route diagnostics.');
check(admin.includes('No approval is required.'), 'The modal must state that approval is not required.');
check(!/Approve route|Approve routes|onApprove|approveDraftRoutes/.test(admin), 'No route approval control or handler may remain.');
check(admin.includes('ensureDraftRoutesForSave'), 'Save must automatically resolve surface routes.');
check(admin.includes('validateAutomaticRouteCheckForSave'), 'Save must still reject incomplete or unsafe route generation.');
check(admin.includes("status: failed.length ? 'error' : 'ready'"), 'Warnings must not convert a valid automatic route into an error.');
check(styles.includes('.route-review-details'), 'Optional route details must have responsive styling.');
check(styles.includes('.route-review-panel--warning'), 'Approximate routes must have a warning state.');

const valhallaIndex = routingClient.indexOf('requestValhallaDrivingRoute');
const mapboxIndex = routingClient.indexOf('requestMapboxDrivingRoute(leg, token)', valhallaIndex);
const buildCacheIndex = routingClient.indexOf('generatedDrivingRouteResult(leg)', mapboxIndex);
const workerIndex = routingClient.indexOf('routeLegResult(leg, { ...options, skipCache: true })', buildCacheIndex);
check(valhallaIndex >= 0 && mapboxIndex > valhallaIndex, 'Valhalla must be attempted before live Mapbox.');
check(buildCacheIndex > mapboxIndex, 'Legacy Mapbox build cache must be after live Valhalla and Mapbox fallback.');
check(workerIndex > buildCacheIndex, 'Natural Earth worker fallback must be last in the driving provider chain.');
check(routingClient.includes('VALHALLA_FAILURE_COOLDOWN_MS'), 'Valhalla failure circuit breaker must be present.');
check(routingClient.includes("ROUTING_VERSION = 'multimodal-v7.1'"), 'Browser routing cache version must be v7.1.');
check(!travelMap.includes('api.mapbox.com/directions'), 'TravelMap must not contain a parallel Mapbox-only request path.');
check(runtimeConfig.includes('...existingJourneyLinesConfig'), 'Runtime configuration must preserve deployment overrides.');
check(runtimeConfig.includes('...existingValhallaConfig'), 'Runtime Valhalla configuration must merge deployment overrides.');
check(runtimeConfig.includes('valhalla1.openstreetmap.de'), 'Default Valhalla endpoint must be configured.');
check(/^7\.(?:1\.\d+|[2-9](?:\.\d+)*)$/.test(packageJson.version), 'Package version must retain or supersede the v7.1 release line.');
check(packageJson.scripts['verify:v7.1'], 'Package must expose the v7.1 verification command.');
check(worker.includes("multimodal-v7.1"), 'Routing worker must report v7.1.');
check(routeDetails.includes("ROUTE_DETAILS_VERSION = '7.1'"), 'Route-details metadata must report v7.1.');
check(fs.existsSync(path.join(root, 'QA/QA-v7.1.md')), 'v7.1 QA record must live in journeylines/QA/.');
check(!fs.existsSync(path.resolve(root, '../QA-v7.1.md')), 'v7.1 QA record must not be duplicated at repository root.');
check(fs.existsSync(path.join(root, 'VALHALLA-v7.1.md')), 'Valhalla implementation documentation must be included.');

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

console.log(`GlobeHoppers v7.1 verification passed: ${checks} checks.`);
