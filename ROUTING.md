# JourneyLines Routing Notes

## Driving

Driving routes are fetched from Mapbox Directions using the public token injected by GitHub Actions as `VITE_MAPBOX_TOKEN`.

The token priority order is:

1. `import.meta.env.VITE_MAPBOX_TOKEN`, injected from the GitHub repository secret at build time.
2. `src/data/routingSettings.json` `publicToken`, intentionally blank by default.
3. Browser `localStorage` key `journeylines.mapboxToken`, retained only for local testing.

v2.8 bumps the route cache key to `v2.8:*` so old generic fallback routes will not hide newly fetched Mapbox Directions results.

Driving routes use:

- profile: `mapbox/driving`
- geometry: `geojson`
- overview: `full`

If the token is missing or rejected by Mapbox, JourneyLines logs a warning in the browser console and falls back to manual/simple route geometry.

## Boats

Boat routes are manual overrides in `src/data/routeOverrides.json` for now. Carnival/cruise-style routes should be stored as waypoint paths from the likely departure port to each port of call.

Known intent:

- Bahamas/Jamaica/Cayman cruise routes use Port Canaveral/Miami-style waypoints depending on the trip context.
- Catalina uses Long Beach/San Pedro-style ferry routing to Catalina Island.

A future cruise routing database could be built as a curated JSON library of cruise ports and common port-to-port legs.

## Trains

Train routes are also manual overrides for now. A future true train routing option would require a transit routing provider or an OpenTripPlanner server with GTFS data, which is outside the static GitHub Pages-only model.
