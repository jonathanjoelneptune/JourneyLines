# GlobeHoppers Routing Notes

This build keeps the private build-time Mapbox route-cache architecture for driving routes. The Mapbox token remains in GitHub Actions and is not published to GitHub Pages.

v3.8 increases MapLibre's in-session tile cache settings so recently displayed terrain is more likely to remain available when returning to an area during the same browser session. A deeper persistent/offline tile cache would require a service worker and tile-source/CORS validation, so that is reserved for a future performance pass.
