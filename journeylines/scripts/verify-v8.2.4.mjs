import fs from 'node:fs';

const app = fs.readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const admin = fs.readFileSync(new URL('../src/components/AdminPanel.jsx', import.meta.url), 'utf8');
const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const checks = [
  [/^8\.2\.(?:[4-9]|\d{2,})$/.test(pkg.version), 'package version is v8.2.4 or newer'],
  [app.includes('function requireCloudTimelineAccess()'), 'private timeline access gate exists'],
  [app.includes('if (!requireCloudTimelineAccess()) return;'), 'timeline menu uses the private timeline gate'],
  [!app.includes("requireCloudWriteAccess('GlobeHopper Timeline editing')"), 'obsolete blanket timeline block removed'],
  [admin.includes('onDelete={cloudMode ? null : del}'), 'cloud timeline rows hide Delete'],
  [admin.includes("onDelete={modal === 'edit' && (!cloudMode || cloudTripDeleteEnabled) ? deleteTripFromModal : null}"), 'cloud Edit Hop modal gates Delete behind the delete feature flag'],
  [admin.includes('onOpenBatch={cloudMode ? null : openBatchAdd}'), 'cloud Edit Hop modal blocks Batch Add'],
  [admin.includes('{!cloudMode && <details className="repo-settings"'), 'legacy repository controls hidden in cloud mode'],
];

const failed = checks.filter(([ok]) => !ok);
for (const [ok, label] of checks) console.log(`${ok ? 'PASS' : 'FAIL'}: ${label}`);
if (failed.length) process.exit(1);
console.log('GlobeHoppers v8.2.4 timeline access hotfix verification passed.');
