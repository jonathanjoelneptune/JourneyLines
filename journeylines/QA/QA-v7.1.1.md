# GlobeHoppers v7.1.1 QA

## Regression addressed

During a surface leg, the moving car could follow the lightweight stylized fallback while the completed trail later changed to the detailed Valhalla/OpenStreetMap route. The active playback entry was freezing `waypointPathForLeg`, which always returned the fallback when no manual legacy waypoint path existed. The detailed geometry loaded into the runtime route cache, but the frozen active entry continued to take precedence for the entire leg.

## Corrections

- `freezeActiveEntryGeometry` now freezes only geometry returned by `getRoutedGeometry`.
- No temporary stylized fallback is copied into the active leg snapshot.
- Playback plans are stored and retrieved using the same explicit geometry signature.
- Geometry signatures sample the start, quarter, midpoint, three-quarter, and end positions to avoid endpoint-only cache collisions.
- Surface-route prefetch begins at leg zero before playback starts and continues for the current plus next three legs.
- A late detailed result can take ownership of an active entry that began without frozen detailed geometry.

## Required checks

- Car playback position, active trail, heading, and camera lead all use the same detailed geometry.
- A route plan built for detailed geometry cannot be retrieved using a different fallback geometry signature.
- Manual route overrides still remain first priority.
- Saved `routeDetails` geometry still remains ahead of runtime provider results.
- Plane and home-move playback remain unchanged.
- Connected-leg camera continuity remains unchanged.
- Production Vite build completes successfully.

## Updated-files deployment

When applying the updated-files-only archive over v7.1.0, remove the obsolete hashed files listed in the release response. The complete repository archive already contains a clean `dist` directory.
