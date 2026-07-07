# GlobeHoppers Routing Notes

Current routing approach:

- Plane routes use cinematic great-circle/air-arc animation.
- Driving routes are generated privately during GitHub Actions using Mapbox Directions and stored as route geometry.
- Boat and train routes use curated/manual route overrides for now.
- Mapbox tokens are not published to GitHub Pages.

v3.11 focused on Studio layout polish, theme options, reset camera behavior, and placard visibility polish.
