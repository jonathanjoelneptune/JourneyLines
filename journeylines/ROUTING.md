Base: GlobeHoppers v5.0
Update: v5.0.1 unique trip IDs and Natural Earth cache bypass
Changes:
- New trips now receive unique 6-character random alphanumeric IDs.
- Existing trip IDs are preserved when editing.
- New trip ID generation checks the current trip list to avoid collisions.
- Car/train/boat routes now ignore two-point straight-line routeDetails placeholders.
- This allows Natural Earth-guided generated routing to run for car/train/boat when the cache only has a simple straight line.
- Plane routes and detailed/manual route geometries continue to work as before.
