# GlobeHoppers v8.1 Authentication and RLS Test

This update adds Supabase email/password authentication without replacing the existing JSON travel timeline.

## Included

- Email/password sign-up and sign-in
- Email confirmation support
- Persistent sessions and automatic token refresh
- Sign-out
- Forgot-password and password-update flows
- Top-right account control
- Secure `ensure_default_travel_map()` database function
- Account bootstrap for profile and default map
- Optional development-only Row Level Security test panel
- Environment-variable validation and setup documentation

## Required migration

Run migrations in order in the Supabase Development project:

1. `supabase/migrations/001_initial_globehoppers_schema`
2. `supabase/migrations/002_initial_rls`
3. `supabase/migrations/003_authentication_bootstrap.sql`

If 001 and 002 are already installed, run only 003.

## Local environment

Copy `.env.example` to `.env.local` and fill in Development values:

```env
VITE_SUPABASE_URL=https://YOUR-DEVELOPMENT-PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR_DEVELOPMENT-PUBLISHABLE-KEY
VITE_ENABLE_RLS_TEST_PANEL=true
```

Never use the Supabase secret or service-role key in a `VITE_` variable.

## Supabase dashboard settings

In **Authentication → URL Configuration**:

- Site URL: `http://localhost:5173`
- Redirect URL: `http://localhost:5173/**`
- Add the exact Vercel Preview URL with `/**`

In **Authentication → Providers → Email**:

- Enable Email
- Enable password sign-in
- Decide whether Confirm Email is required for Development

## Vercel variables

Add the same three variable names under **Project → Settings → Environment Variables**.

- Preview must use Supabase Development values.
- Production must use Supabase Production values.
- Set `VITE_ENABLE_RLS_TEST_PANEL=false` in Production.

Redeploy after changing variables.

## Two-account test

1. Sign in as User A.
2. Open **Account → Security Test**.
3. Create a test Hopper and copy its UUID.
4. Sign out and sign in as User B.
5. Confirm User A's test Hopper is not listed.
6. Paste User A's UUID and run **Attempt Direct Read**.
7. Expected: no row returned.
8. Run **Attempt Direct Update**.
9. Expected: zero rows updated.
10. Repeat in the opposite direction.

The Supabase dashboard can display both users' rows because it uses administrative access. The browser test uses the publishable key and authenticated session, which is the correct RLS test.
