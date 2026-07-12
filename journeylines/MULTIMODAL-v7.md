# GlobeHoppers v7.0 Multimodal Routing

## Purpose

v7.0 makes car, train, and boat travel first-class routing modes. A surface Hop cannot be saved until its current road, rail, and water legs have been calculated, reviewed, and approved.

## Route selection hierarchy

### Car

1. A previously generated private Mapbox build cache route when one exists for the endpoint pair.
2. Mapbox Directions when `window.JOURNEYLINES_CONFIG.mapboxToken` or `VITE_MAPBOX_TOKEN` contains a public `pk.` token.
3. Natural Earth road graph in the routing worker.
4. A clearly labeled local/direct land-corridor fallback when the detailed network is incomplete.

### Train

1. Natural Earth rail graph in the routing worker.
2. A clearly labeled rail-corridor fallback when the source network does not connect sufficiently near the endpoints.

Use saved station or depot locations for the best station-to-station result. This is geographic route visualization, not timetable or service-availability data.

### Boat

1. Explicit known water corridors.
2. A* routing through the dense water graph.
3. Water-grid repair/fallback routing.

A boat route is rejected when it crosses mapped land or collapses to a stationary path. Only explicitly permitted canal-center edges may cross simplified Natural Earth land polygons.

## Route Review

The Add/Edit Hop dialog shows a Route Review panel for every surface leg. Each result includes:

- route source and provider
- route and direct distance
- estimated duration
- confidence
- geometry preview
- endpoint/network attachment warnings
- land/water and plausibility errors

Changing a reviewed mode, origin, destination, or intermediate stop changes the route signature and invalidates approval. Recalculate and approve the updated result before saving.

## Persistence and recovery

Reviewed routes are retained in the in-memory route store and IndexedDB cache. On repository save, the current geometry and diagnostic metadata are written into `routeDetails.json`. Cache failures are non-blocking; the current reviewed geometry remains available in memory.

The worker has initialization/request timeouts, generation-based stale-worker protection, crash/message-error recovery, and a manual retry action in Advanced Controls.

## Known data limitations

Natural Earth provides broad geographic roads and railways rather than street-level or timetable-level detail. Fallback routes are always labeled and produce warnings when endpoint attachment, route stretch, or land/water checks indicate lower confidence. Add intermediate legs or use more precise station/port locations to shape difficult routes.
