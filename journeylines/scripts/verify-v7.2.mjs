import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(process.argv[2] || '.');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const admin = read('src/components/AdminPanel.jsx');
const map = read('src/components/TravelMap.jsx');
const css = read('src/styles.css');
const packageJson = JSON.parse(read('package.json'));
let passed = 0;
function check(condition, message) {
  if (!condition) throw new Error(`FAIL: ${message}`);
  passed += 1;
}

check(packageJson.version === '7.2.0', 'package version is 7.2.0');
check(admin.includes("setModal('batch')"), 'Batch Add opens a dedicated modal mode');
check(admin.includes('Batch Add Hops'), 'Batch Add entry action exists');
check(admin.includes('Done with Hop'), 'Done with Hop action exists');
check(admin.includes('Update Staged Hop'), 'staged Hop update action exists');
check(admin.includes('Save Batch'), 'Save Batch action exists');
check(admin.includes('Add Another Hop'), 'Add Another Hop action exists');
check(admin.includes('function BatchHopTable'), 'staged table component exists');
check(admin.includes('sortBatchRows'), 'batch rows use chronological sorting');
check(admin.includes('compareDateParts'), 'chronology uses normalized date comparison');
check(admin.includes('entryOrder'), 'equal-date rows preserve entry order');
check(admin.includes('batch-route-cell'), 'legs and vessels share one multiline table cell');
check(admin.includes('onEdit(row.stageId)'), 'row editing requires explicit Edit control');
check(admin.includes('onDelete(row.stageId)'), 'row deletion is explicit');
check(admin.includes('stageCurrentBatchHop'), 'staging function exists');
check(admin.includes('ensureDraftRoutesForSave()'), 'routes validate during staging');
check(admin.includes('prepareTripRoutesForPlayback(normalizedTrip, nextLocations)'), 'surface geometry prepares while staging');
check(admin.includes('batchLocationsExcluding'), 'staged locations are isolated by row');
check(admin.includes('mergeLocationsById(currentLocations'), 'final locations merge occurs at batch save');
check(admin.includes('setTrips(nextTrips)'), 'batch save updates trips state');
check(admin.includes('setLocations(nextLocations)'), 'batch save updates locations state');
check(admin.includes("saveDataInBackground(nextTrips, nextLocations, `Batch Add Hops"), 'batch uses one repository queue call');
check(admin.includes("action: 'batch-add'"), 'batch completion is identified without auto-play');
check(admin.includes('shouldAutoPlay: false'), 'batch save does not unexpectedly start playback');
check(admin.includes('activeHomeBaseId(homeBases, draft)'), 'default start remains date-derived home base');
check(admin.includes('studio-modal-layout--batch'), 'batch mode has a dedicated streamlined layout');
check(admin.includes("{!batchMode && <div className=\"studio-modal-sidecol\">"), 'Hop Preview side column is omitted in batch mode');
check(admin.includes('requestBatchEdit'), 'switching staged rows is guarded');
check(admin.includes('requestNewBatchDraft'), 'Add Another is guarded');
check(admin.includes('requestSaveBatch'), 'Save Batch protects unstaged editor changes');
check(admin.includes("title: 'Leave Batch Add?'"), 'closing Batch Add protects the batch');
check(admin.includes('discardLabel'), 'three-way Save/Discard/Cancel confirmation is supported');
check(css.includes('.batch-hop-table'), 'batch table styles exist');
check(css.includes('min-width: 1380px'), 'wide spreadsheet row preserves readable columns');
check(css.includes('overflow: auto'), 'batch table can scroll without clipping');
check(css.includes('.studio-modal--batch'), 'batch modal has a wider desktop presentation');

check(map.includes('relocationOverviewZoom'), 'disconnected transitions calculate overview zoom');
check(map.includes('zoomOutDuration'), 'disconnected transition has zoom-out stage');
check(map.includes('map.jumpTo({ center: [lon, lat], zoom: overviewZoom'), 'reposition occurs only at overview zoom');
check(map.includes('zoomInAtDestination'), 'disconnected transition has zoom-in stage');
check(map.includes("finish('complete')"), 'playback ownership completes after final stage');
check(!map.includes('map.flyTo({\n        center: [lon, lat],\n        zoom: targetZoom'), 'old long-distance flyTo relocation is removed');
check(map.includes("iconMode === 'plane' ? 0.026 : 0.012"), 'aircraft uses a longer projected tangent window');
check(map.includes("iconMode === 'plane'\n      ? projectedRotation"), 'aircraft uses projected screen-space rotation');
check(map.includes('lerpAngle(previousRotation, rawRotation'), 'vehicle rotation uses shortest-angle smoothing');
check(map.includes('__jlVehicleRotation'), 'aircraft rotation state persists between frames');

check(fs.existsSync(path.join(root, 'BATCH-ADD-v7.2.md')), 'batch workflow documentation exists');
check(fs.existsSync(path.join(root, 'QA/QA-v7.2.md')), 'QA record is under journeylines/QA');
check(!fs.existsSync(path.join(root, '..', 'QA-v7.2.md')), 'QA record is not duplicated at repository root');

const build = spawnSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build'], {
  cwd: root,
  encoding: 'utf8',
  stdio: 'pipe'
});
if (build.status !== 0) {
  process.stderr.write(build.stdout || '');
  process.stderr.write(build.stderr || '');
  throw new Error('FAIL: production build');
}
check(fs.existsSync(path.join(root, 'dist/index.html')), 'production build output exists');

console.log(`GlobeHoppers v7.2 verification passed: ${passed} checks.`);
