# JourneyLines v2.17 — Private Mapbox Cache, No Runtime Token

- Removes runtime-config.js from the published site entirely.
- Uses the GitHub Actions secret only as MAPBOX_TOKEN during the route-generation step.
- Does not expose VITE_MAPBOX_TOKEN to the Vite build, preventing token embedding in the JS bundle.
- Verifies the dist output does not contain the Mapbox token before publishing.
- Keeps generated Mapbox driving route geometry bundled as data only.
