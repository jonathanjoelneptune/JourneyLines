## v7.1.2 surface-route presentation

Validated car, train, and boat geometry remains the routing source of truth. Before drawing or sampling it for playback, GlobeHoppers creates an in-memory equal-distance presentation path with conservative mode-specific corner smoothing. Exact endpoints remain anchored, the smoothed path is not written back into routeDetails or provider caches, and map rendering and worker playback use the same implementation. This prevents the vehicle from diverging from the visible trail while reducing visually sharp long-segment corners.

Disconnected timeline entries are treated as camera relocations rather than route legs. Playback remains on the completed leg while the camera glides to the next origin, then advances and resumes only after the map reports that the movement has settled or the guarded timeout completes.

# GlobeHoppers Routing

GlobeHoppers v7.1 automatically calculates and validates surface routes without requiring user approval. Driving routes use Valhalla with OpenStreetMap data as the primary live provider. Mapbox Directions is the secondary live fallback, the existing Mapbox build cache is retained as a later fallback, and Natural Earth remains the final local road approximation. Train and boat routing continue through the local worker graphs.

## v7.1 driving route priority

1. Manual or already-saved detailed route geometry handled by the trip/routeDetails layer
2. Current v7.1 in-memory or IndexedDB route cache
3. Valhalla using OpenStreetMap data
4. Mapbox Directions when a valid runtime token is configured
5. Existing generated Mapbox build cache
6. Local Natural Earth road approximation

Route calculation is automatic. The Add/Edit Hop interface exposes optional diagnostics and recalculation controls, but no approval gate. Saving is blocked only when endpoint data is incomplete or all routing paths fail validation.

See [`VALHALLA-v7.1.md`](VALHALLA-v7.1.md) and [`MULTIMODAL-v7.md`](MULTIMODAL-v7.md) for implementation details.

## Legacy routing implementation notes

## Startup

The application starts with deployed trip, location, hopper, and routeDetails data. The detailed Natural Earth database is stored at:

`public/data/naturalEarthRouting.json`

It is not bundled into the main JavaScript file. The routing client starts the worker through `requestIdleCallback` when available, with a timeout fallback. Opening Add Hop or Edit Hop also prewarms the worker.

## Route source priority

1. Manual route override
2. Detailed geometry already saved in routeDetails.json
3. Current routing-version geometry held in memory or IndexedDB
4. Background Web Worker route calculation
5. Lightweight temporary visual fallback while a missing route is being prepared

Historical vessel routes are not recalculated during page startup.

## Routing worker

`src/workers/routingWorker.js` performs:

- Natural Earth fetch and parsing
- land spatial indexing
- dense water-node spatial indexing
- water/canal/corridor graph routing
- land-crossing validation
- road/rail guidance
- playback-plan generation
- route simplification and detail-level generation

The worker uses the Natural Earth v6 dense dataset with approximately 18,000 globally distributed water nodes.

Only explicit canal edges may bypass normal land-intersection rejection. Coastal, sea, strait, and island-passage edges must still pass land validation.

## Cache

`src/utils/routeCacheIndexedDb.js` stores completed routes using:

`natural-earth-v6.0:<from>-><to>:<mode>`

Older routing versions are pruned asynchronously. The UI does not synchronously parse a large localStorage route cache during startup.

## Repository saves

New or endpoint/mode-changed car, train, and boat routes are prepared through the worker inside the existing background repository-save workflow. The Add/Edit Hop modal still closes immediately after local validation. The finished route is included in routeDetails.json when the background commit occurs.

Existing routeDetails geometry is preserved only when its origin, destination, and mode still match the current leg.

## Playback

`src/utils/playbackEngine.js` owns the active-playback requestAnimationFrame clock. It uses `performance.now()` and reports adaptive quality based on measured frame time.

The main thread applies:

- vessel position and rotation
- camera center, zoom, bearing, and pitch
- trail reveal
- destination pulse
- active route visuals

React UI progress is throttled to approximately 10 updates per second rather than one state update per frame.

## Camera

The active camera no longer starts overlapping MapLibre ease transitions. It uses:

- one desired camera frame from the playback plan
- damped interpolation
- safe-screen vessel bounds
- immediate `jumpTo()` application from the active playback loop

A single gentle MapLibre transition remains for initial trip framing.

## Trail rendering

Completed routes remain in the static `completed-routes` source. The active trip remains in the separate `active-route` source.

The vessel and camera can update every display frame. Active GeoJSON trail updates are throttled:

- high quality: about 24 Hz
- medium quality: about 15 Hz
- low quality: about 10 Hz

The trail overlap remains tied to the same route progress as the vessel.

## Route detail levels

Completed route sampling changes with zoom:

- Overview: low point count
- Regional: medium point count
- Detail: higher point count

Changing the LOD clears the completed-route feature cache and rebuilds at the appropriate detail.

## Prefetch

The current trip and next three legs are prepared in the background:

- missing detailed route geometry
- playback positions
- headings
- camera samples
- cumulative distance
- overview and regional route geometry

## Validation checks run during development

Worker routing was exercised against:

- San Diego → Vancouver by boat
- San Diego → Athens by boat
- San Diego → Glasgow by boat
- Miami → San Juan by boat
- San Diego → Cabo by train
- San Diego → Los Angeles by car

The tested boat routes avoided Natural Earth land polygons except for deliberate Panama Canal corridor edges.

## v7.1.3 lightweight presentation geometry

Provider geometry remains the routing source of truth, but it is no longer used at full turn-by-turn density during playback. Car, train, and boat routes are converted once into a cached presentation path made from original provider coordinates. The conversion removes minor street-level or track-level changes while retaining endpoints, major bends, and high-stretch detours that usually represent coastlines, bays, islands, peninsulas, bridges, tunnels, canals, or other constrained corridors.

Normal presentation budgets are 220 points for cars, 190 for trains, and 160 for boats. Safety splits may exceed those budgets when simplifying a span would materially shortcut the original route. Rendering may downsample further for regional and globe overview views, but it may never increase presentation density during an active frame.
