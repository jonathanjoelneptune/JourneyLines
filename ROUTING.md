# JourneyLines Routing Notes

## Current routing architecture
- Driving routes are generated privately during GitHub Actions using the `VITE_MAPBOX_TOKEN` repository secret.
- The deployed site does not include the Mapbox token.
- Generated route geometry is stored in `journeylines/src/data/generatedRoutes.json` during the workflow.
- Boat and train routes use manual overrides in `journeylines/src/data/routeOverrides.json`.

## v2.18 tile preload behavior
The globe now preloads ArcGIS terrain imagery tiles for the current route and the next route at representative points along the route. This is intended to reduce visible terrain/imagery popping during playback without trying to load the entire Earth at high resolution.

## Future improvements
- Curated cruise database for Carnival-style loops.
- KML/GeoJSON import for train and boat routes.
- Optional premium tile provider if terrain popping remains too visible on a wall display.
