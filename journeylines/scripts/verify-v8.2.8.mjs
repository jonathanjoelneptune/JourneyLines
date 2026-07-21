import fs from 'node:fs';
import path from 'node:path';
const root = path.resolve(process.argv[2] || '.');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const required = [
  'supabase/migrations/010_reorder_private_trips.sql',
  'src/repositories/SupabaseTravelRepository.js',
  'src/components/AdminPanel.jsx',
  'src/adapters/supabaseToTravelMap.js',
  'src/services/accountBootstrap.js'
];
for (const file of required) if (!fs.existsSync(path.join(root, file))) throw new Error(`Missing ${file}`);
const migration = read(required[0]);
for (const token of ['reorder_private_trips', 'timeline_order_revision', 'private.can_edit_map', 'p_expected_revision']) {
  if (!migration.includes(token)) throw new Error(`Migration missing ${token}`);
}
const repo = read(required[1]);
if (!repo.includes('async reorderTrips')) throw new Error('Repository reorderTrips method missing.');
const panel = read(required[2]);
for (const token of ['Reorder Timeline', 'Save Timeline Order', 'TIMELINE_CONFLICT']) {
  if (!panel.includes(token)) throw new Error(`Timeline UI missing ${token}`);
}
console.log('GlobeHoppers v8.2.8 Work Package 6 verification passed.');
