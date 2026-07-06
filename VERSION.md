# JourneyLines v2.18 — Space Globe + Tile Preload Polish

## Summary
This version makes the MapLibre globe feel like it is floating in space and adds tile-loading polish to reduce visible terrain popping during cinematic playback.

## Highlights
- Adds black space background with layered star field and subtle nebula haze.
- Adds a soft atmospheric/rim glow around the globe.
- Keeps the globe surface visible without a heavy vignette.
- Adds browser tile preloading for the active and next route using origin, mid-route, and destination sample points.
- Adds MapLibre tile fade/cache options to reduce hard raster tile changes.
- Adds a short pre-departure visual warmup phase before the vehicle appears.
- Lowers cruise zoom levels so terrain tiles do not have to resolve as aggressively while the camera is moving.
- Slows camera smoothing for a lighter, airier glide.
- Keeps the private build-time Mapbox route cache architecture from v2.17.
- No Mapbox token is published to GitHub Pages.

## Upload note
Upload the entire extracted repo contents, including `.github/workflows/deploy.yml`. Do not upload `package-lock.json`.
