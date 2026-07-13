# GlobeHoppers

**All your hops, skips & jumps.**

GlobeHoppers is a living travel-history map that replays trips across a cinematic globe, with alternate flat projections, traveler-specific colors, custom vehicle icons, route trails, and editable trip data stored in the repository.

## v7.1.4: Surface Playback Performance Recovery

Surface travel now prepares one lightweight route and reuses it throughout playback. Large provider routes are transferred to the routing worker as typed arrays, matching return legs reuse the outbound route in reverse, and active playback no longer deep-copies or re-simplifies raw geometry as a leg begins.

Map and overlay work is also budgeted independently: the vehicle remains display-rate, camera updates scale from approximately 60 to 30 FPS with measured performance, and the growing route line updates at 8–12 FPS. Historical-route fades use paint transitions rather than rebuilding the entire timeline every frame. Passive glow, map filters, star animation, tile prefetch, and diagnostics have all been tuned to preserve playback smoothness.

## v7.1.3: Lightweight Surface Playback

Detailed road, rail, and water geometry now acts as a route corridor rather than turn-by-turn animation geometry. GlobeHoppers selects a bounded set of original provider points for vehicle movement and trail drawing, preserving major bends and detours without carrying thousands of coordinates through every active-frame update.

The lightweight route is cached, cannot be re-densified by the renderer, and uses cached cumulative distances with binary-search sampling. Cars, trains, and boats therefore retain believable provider-shaped paths while the vehicle and camera remain smooth on long trips.

## v7.1.2: Smoother Surface Travel and Reliable Transitions

Car, train, and boat routes now receive conservative visual smoothing before they are rendered or sampled for playback. The detailed routed path remains the source of truth, exact endpoints are preserved, and the vehicle, camera lead, active line, and completed trail all use the same smoothed geometry.

When the next trip begins somewhere other than the previous trip's destination, playback now pauses while the camera glides to the new origin and resumes only after arrival. Add Hop also opens on the first click in modal-only mode instead of requiring a second click or opening the Timeline behind it.

## v7.1.1: Detailed Route Playback

Surface vehicles now travel along the same validated route geometry that is displayed after the leg completes. The active playback snapshot no longer locks in the temporary stylized fallback, and playback plans are keyed to the exact route geometry they animate. The first routes also prefetch while the globe is idle so detailed car, train, and boat paths are usually ready before Play is selected.

## v7.1: Automatic Surface Routing

Car, train, and boat Hops are now checked automatically. Users no longer need to approve a generated route before saving.

- Driving routes use Valhalla with OpenStreetMap data first.
- Mapbox Directions is a secondary fallback when a valid public token is configured.
- Stored Mapbox build geometry and the local Natural Earth road graph are later fallbacks.
- Train routes continue to use the local Natural Earth rail graph.
- Boat routes continue to use navigable-water routing with land-crossing validation.
- Route warnings and geometry remain available under an optional details disclosure.
- Saving is interrupted only when a surface route cannot be generated safely or its endpoints are incomplete.

Runtime provider settings live in `public/runtime-config.js`; the same defaults are documented in `src/data/routingSettings.json`.

## Quality assurance

Release QA records are stored under `journeylines/QA/` rather than at the repository root.
