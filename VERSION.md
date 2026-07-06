# JourneyLines v2.1.0 — MapLibre Animation Recovery + Visibility Fix

## Purpose
This update fixes the first MapLibre v2.0 regression pass where the map became too dark, the vehicle marker disappeared, the camera appeared static, route segments appeared instead of drawing, and city names were not visible on the globe.

## Changes
- Keeps MapLibre GL JS as the default renderer.
- Keeps the working `gh-pages` branch deployment workflow.
- Brightens the MapLibre globe/map surface.
- Switches the default MapLibre raster source from very dark tiles to a brighter CARTO Voyager no-label basemap.
- Reduces the heavy vignette/dark overlay.
- Restores visible vehicle markers.
- Prevents MapLibre marker classes from being overwritten.
- Plane rotates to follow the heading of flight.
- Car, boat, and train stay upright.
- Uses per-frame `jumpTo` with camera smoothing instead of queued `easeTo` calls, which should restore dynamic camera motion.
- Disables manual mouse interactions while playback is running so the animation owns the camera.
- Adds visible origin/destination HTML labels during active playback.
- Fixes the one-frame leg transition issue by resetting leg progress when moving to the next leg.
- Keeps `package-lock.json` out of the repo.

## Notes
This is still a MapLibre approximation of the Mult.dev cinematic feel. It should now animate visibly again and be much brighter, but full terrain/satellite flyover quality will require a better tile provider or a terrain-enabled style later.
