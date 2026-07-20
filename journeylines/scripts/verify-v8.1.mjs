import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.argv[2] || '.');
const required = [
  'src/lib/supabaseClient.js',
  'src/auth/AuthProvider.jsx',
  'src/auth/useAuth.js',
  'src/components/auth/AuthModal.jsx',
  'src/components/account/AccountControl.jsx',
  'src/components/account/SecurityTestPanel.jsx',
  'src/services/accountBootstrap.js',
  'supabase/migrations/003_authentication_bootstrap.sql',
  'AUTHENTICATION-v8.1.md',
  '.env.example'
];

const missing = required.filter(file => !fs.existsSync(path.join(root, file)));
if (missing.length) {
  console.error(`Missing v8.1 files:\n${missing.join('\n')}`);
  process.exit(1);
}

const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
if (!packageJson.dependencies?.['@supabase/supabase-js']) {
  console.error('@supabase/supabase-js is not installed.');
  process.exit(1);
}

const app = fs.readFileSync(path.join(root, 'src/App.jsx'), 'utf8');
for (const marker of ['<AccountControl', '<AuthModal', '<SecurityTestPanel', 'bootstrapAccount()']) {
  if (!app.includes(marker)) {
    console.error(`App.jsx is missing ${marker}`);
    process.exit(1);
  }
}

const migration = fs.readFileSync(path.join(root, 'supabase/migrations/003_authentication_bootstrap.sql'), 'utf8');
if (!migration.includes('auth.uid()') || !migration.includes('security definer')) {
  console.error('Authentication bootstrap migration does not derive ownership securely.');
  process.exit(1);
}

console.log('GlobeHoppers v8.1 authentication verification passed.');
