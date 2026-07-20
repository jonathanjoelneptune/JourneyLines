import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] || '.');
const required = [
  'src/App.jsx',
  'src/components/AdminPanel.jsx',
  'src/repositories/SupabaseTravelRepository.js',
  'supabase/migrations/006_create_private_trip.sql'
];
for (const file of required) {
  if (!fs.existsSync(path.join(root, file))) throw new Error(`Missing ${file}`);
}
const app = fs.readFileSync(path.join(root, 'src/App.jsx'), 'utf8');
const admin = fs.readFileSync(path.join(root, 'src/components/AdminPanel.jsx'), 'utf8');
const repo = fs.readFileSync(path.join(root, 'src/repositories/SupabaseTravelRepository.js'), 'utf8');
const sql = fs.readFileSync(path.join(root, 'supabase/migrations/006_create_private_trip.sql'), 'utf8');
const checks = [
  [app.includes('requireCloudTripCreateAccess'), 'App create-only write gate missing'],
  [app.includes('onCloudCreateTrip'), 'App cloud create callback missing'],
  [admin.includes('cloudTripCreateEnabled'), 'AdminPanel cloud create flag missing'],
  [admin.includes('Editing existing cloud trips is not enabled in Work Package 3'), 'Edit-trip guard missing'],
  [repo.includes("rpc('create_private_trip'"), 'Supabase repository RPC call missing'],
  [sql.includes('security definer'), 'RPC must be security definer'],
  [sql.includes('private.can_edit_map'), 'RPC map permission check missing'],
  [sql.includes('Every selected Hopper must belong'), 'Cross-map Hopper validation missing'],
  [sql.includes('insert into public.trip_legs'), 'Trip leg transaction missing'],
  [sql.includes('insert into public.trip_hoppers'), 'Trip Hopper transaction missing']
];
for (const [ok, message] of checks) if (!ok) throw new Error(message);
console.log('GlobeHoppers v8.2 Work Package 3 verification passed.');
