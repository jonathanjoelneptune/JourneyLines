# JourneyLines v2.6.0 — Mapbox Routing + Glide/Label Fix

This version reinforces the v2.5 animation and label behavior and adds the first Mapbox Directions integration path for driving routes.

## Highlights

- Adds optional Mapbox Directions routing for `drive` legs.
- Adds route geometry caching through localStorage.
- Adds manual route overrides for boat, train, and fallback drive paths.
- Adds Carnival-style cruise waypoints for Bahamas/Jamaica/Cayman routes and Long Beach/Catalina routing.
- Keeps visited dots and nameplates persistent after arrival.
- Destination nameplates animate in only on arrival.
- Keeps completed route legs visible instead of dimming them away.
- Slows camera motion and adds a drifting settle/hold period after arrival.
- Improves plane icon rotation by using projected screen-space route direction.
- Keeps north-up camera orientation.
- Keeps gh-pages branch deployment workflow.

## Mapbox token

Mapbox routing is optional. Add your public Mapbox token in `journeylines/src/data/routingSettings.json`, or set it in browser localStorage as `journeylines.mapboxToken`.

No `package-lock.json` is included.
