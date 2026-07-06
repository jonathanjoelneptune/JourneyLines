# JourneyLines Routing Notes

v2.22 keeps the build-time Mapbox route-cache architecture. Mapbox tokens are used privately inside GitHub Actions to generate driving route geometry and are not published to GitHub Pages.

Car routes use generated Mapbox geometry when available. Boat and train routes continue to use manual route overrides until a later routing upgrade.
