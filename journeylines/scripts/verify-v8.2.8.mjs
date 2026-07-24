import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] || '.');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const expect = (condition, message) => { if (!condition) throw new Error(message); };

const repo = read('src/repositories/SupabaseTravelRepository.js');
const adapter = read('src/adapters/supabaseToTravelMap.js');
const factory = read('src/repositories/createTravelRepository.js');
const app = read('src/App.jsx');
const admin = read('src/components/AdminPanel.jsx');
const migration = read('supabase/migrations/013_remove_timeline_revision_compatibility.sql');

expect(repo.includes(".order('start_date'"), 'Cloud trips must order by start_date.');
expect(repo.includes(".order('end_date'"), 'Cloud trips must use end_date as a tie-breaker.');
expect(repo.includes(".order('created_at'"), 'Cloud trips must use created_at as a stable tie-breaker.');
expect(!/order\('start_date'[\s\S]{0,300}order\('sort_order'/.test(repo), 'Trip loading must not use sort_order as timeline authority.');
expect(adapter.includes('function sortableDate'), 'Adapter must build a date-driven sort key.');
expect(!adapter.includes('trip?.sort_order != null'), 'Adapter must ignore manual trip sort_order.');
expect(factory.includes("if (cloudEnabled)"), 'Factory must explicitly handle cloud mode.');
expect(factory.includes('no travel map was selected'), 'Cloud mode without a map must fail rather than use JSON.');
expect(app.includes('retryPrivateGlobeLoad'), 'Private cloud load errors must be retryable.');
expect(app.includes('Unable to load your Globe'), 'Private cloud failure UI is required.');
expect(!app.includes('Reorder Timeline'), 'Manual reorder controls must not appear in App.');
expect(!admin.includes('Save Timeline Order'), 'Manual reorder save controls must not appear in AdminPanel.');
expect(!admin.includes('reorder_private_trips'), 'AdminPanel must not call manual reorder RPC.');
expect(migration.includes('drop column if exists timeline_order_revision'), 'Cleanup migration must remove the compatibility column.');

console.log('GlobeHoppers v8.2.8 chronological timeline verification passed.');
