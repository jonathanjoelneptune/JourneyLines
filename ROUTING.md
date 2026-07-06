# JourneyLines Routing

## Mapbox driving routes

JourneyLines uses `VITE_MAPBOX_TOKEN` at build time. The token must be saved as a GitHub repository secret named exactly:

```text
VITE_MAPBOX_TOKEN
```

The deploy workflow now checks whether the secret is available before building. If it is missing, the Action will fail with a clear message instead of silently deploying a build with generic driving routes.

The app reads the token in this order:

1. `import.meta.env.VITE_MAPBOX_TOKEN` from GitHub Actions / Vite build
2. `routingSettings.json` publicToken, blank by default
3. browser localStorage fallback for local testing

Driving routes are cached in localStorage by cache version.

## Boat and train routing

Boat and train routes currently use manual waypoint overrides in `src/data/routeOverrides.json`. Cruise routing is represented by curated port/ocean waypoints for now. A future cruise-route database can be added as more exact itinerary port calls are known.


## v2.12 Mapbox token runtime config

GitHub Actions writes `journeylines/public/runtime-config.js` during deployment using the repository secret `VITE_MAPBOX_TOKEN`. The app checks `window.JOURNEYLINES_CONFIG.mapboxToken` first, then `import.meta.env.VITE_MAPBOX_TOKEN`, then `routingSettings.json`, then localStorage. This makes the deployed gh-pages site use the token without committing it to source.
