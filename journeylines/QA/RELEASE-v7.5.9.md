# GlobeHoppers v7.5.9

Rebased on v7.5.7 and reimplemented the camera reacquisition and timeline overlay architecture.

## Changes
- Preserved the v7.5.7 vessel rendering and normal playback-follow loop.
- Replaced discrete camera return stages with one continuous orientation-first camera path.
- Kept zoom at a safe outside-globe level until most orientation error is removed.
- Anchored active timeline callouts to the control bar coordinate system.
- Added a dedicated non-clipping active marker overlay.
- Simplified timeline sizing and removed visible scrollbars and label masks.
- Restored unclipped year and month labels within a compact rail.
- Shifted the route/date card column slightly left.
- Made automatic trip-title spacing explicit.
