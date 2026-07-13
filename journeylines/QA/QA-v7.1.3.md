# GlobeHoppers v7.1.3 QA

## Regression addressed

v7.1.2 made surface routes visually smoother by resampling detailed provider geometry to as many as 1,400 presentation points. The active trail then sampled that dense route repeatedly while the vehicle and camera animated. Long repository routes contain thousands to tens of thousands of original coordinates, so the new density and repeated polyline scans could reduce frame rate and make car playback visibly stutter.

## Correction: lightweight surface presentation paths

- Valhalla, saved road, rail, and navigable-water geometry remains the route source of truth.
- Playback and trail rendering now select a bounded set of original provider points instead of generating dense equal-distance geometry.
- Car routes target no more than 220 presentation anchors under normal conditions; train routes target 190 and boat routes target 160.
- Corridor protection may retain additional points when needed to preserve a major provider detour.
- Exact start and destination coordinates remain anchored.
- Presentation points are selected from the original route, so the visual path does not drift away from the known route corridor.
- Large shortcuts are rejected when the original path-to-chord ratio indicates a meaningful detour around water, land, islands, peninsulas, or disconnected terrain.
- Nearly straight road, rail, bridge, tunnel, canal, and open-water corridors simplify aggressively.
- The same presentation utility is used by MapLibre rendering and worker-generated playback plans.

## Runtime performance protections

- Presentation geometry is cached by source-array identity before sanitation or simplification work is repeated.
- Surface drawing is prohibited from re-densifying the lightweight geometry during a frame.
- Worker playback plans are capped at 320 interpolated samples instead of 900.
- Polyline cumulative metrics are cached in a `WeakMap`.
- Vehicle and trail point lookup uses binary search rather than recalculating and linearly scanning every route segment for every sample.
- The vehicle and camera continue updating at display refresh rate, while active-trail reconstruction is throttled to 20 fps on the high-quality path and lower rates under reduced quality.
- Provider route geometry and the v7.1 browser route cache are retained. This release changes presentation only and does not force users to regenerate valid Valhalla routes.

## Required checks

- A 12,000-point synthetic road is reduced by at least 95 percent.
- The largest repository route is reduced to a bounded presentation path.
- Repeated presentation requests return the same cached array through an O(1) lookup.
- Surface rendering never creates more samples than the presentation route contains.
- Car and train test routes retain a route around a synthetic bay rather than cutting across it.
- Boat test routes retain a navigable detour around a synthetic island rather than crossing land.
- Straight provider corridors simplify aggressively.
- Worker and renderer use the same presentation implementation.
- Existing v7.1.2 relocation-glide and first-click Add Hop behavior remains intact.
- Production Vite build completes successfully.

## Updated-files deployment

When applying the updated-files-only archive over v7.1.2, remove the obsolete hashed assets listed in the release response. The complete repository archive already contains a clean `dist` directory.
