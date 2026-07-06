# JourneyLines Routing

## v2.17 routing architecture

Mapbox is used only during GitHub Actions.

1. The repository secret `VITE_MAPBOX_TOKEN` is read by the workflow.
2. The workflow passes it to the route-generation script as `MAPBOX_TOKEN`.
3. `scripts/generate-mapbox-routes.mjs` calls Mapbox Directions and writes `src/data/generatedRoutes.json`.
4. The Vite build publishes only route geometry, never the token.
5. No `runtime-config.js` is published.

The public site should not need a Mapbox token in the browser for archived driving routes.
