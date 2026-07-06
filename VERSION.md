# JourneyLines v2.13 — Playback Camera Revert + Runtime Token Hardening

## Date
2026-07-06

## Changes
- Reverted the v2.11/v2.12 drag-while-playing behavior.
- During playback, JourneyLines owns the cinematic camera again and manual drag/zoom is disabled.
- Manual drag/zoom remains available while paused/reset.
- Updated Mapbox token handling so the GitHub Actions workflow writes `runtime-config.js` both before the Vite build and directly into `dist/` before publishing to `gh-pages`.
- Updated `index.html` to load `./runtime-config.js` with a stable relative path.
- Reworded the Mapbox diagnostic warning so it checks all token sources, not only `VITE_MAPBOX_TOKEN`.
- Bumped Mapbox driving route cache version to `v2.13`.
- Keeps persistent stylized pins, globe culling, airplane air-arc, and the working `gh-pages` publish workflow.

## Important upload note
This version includes an updated hidden workflow file:

`.github/workflows/deploy.yml`

If you upload only the `journeylines/` folder, the Mapbox runtime token fix will not deploy. Make sure the root-level `.github` folder is updated too.
