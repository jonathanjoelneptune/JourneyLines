# GlobeHoppers Routing Notes

This version does not change playback routing. It keeps the existing private build-time Mapbox driving route cache and manual boat/train route overrides.

Studio save behavior was updated so edits to `src/data/trips.json` and `src/data/locations.json` are committed together, reducing stale SHA conflicts when saving multiple edits.
