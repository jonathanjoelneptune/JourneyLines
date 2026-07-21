import fs from 'node:fs';
import path from 'node:path';

const root = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const admin = read('src/components/AdminPanel.jsx');
const pkg = JSON.parse(read('package.json'));
const required = [
  'TRIP_CONFLICT_MESSAGE',
  'withCloudSaveTimeout',
  "err?.code === 'TRIP_CONFLICT'",
  "err?.code === '40001'",
  'setBusy(false);',
  'window.alert(message)'
];
for (const token of required) {
  if (!admin.includes(token)) throw new Error(`Missing Work Package 4 concurrency hotfix token: ${token}`);
}
if (pkg.version !== '8.2.5') throw new Error(`Expected package version 8.2.5, found ${pkg.version}`);
console.log('GlobeHoppers v8.2.5 concurrency feedback verification passed.');
