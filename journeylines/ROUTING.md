# GlobeHoppers Routing

GlobeHoppers v7 uses the multimodal routing pipeline described in [`MULTIMODAL-v7.md`](MULTIMODAL-v7.md). Cars prefer Mapbox Directions when configured, trains use a local Natural Earth rail graph, and boats use the navigable-water graph. Every surface route must pass Route Review and be approved before its Hop can be saved.

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
