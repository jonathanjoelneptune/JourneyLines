Base: GlobeHoppers v4.30
Update: v4.31.3 safe lazy city suggestions
Changes:
- Rebuilt from stable v4.30.
- City database is stored in public/data/cities15000.json.
- Add/Edit Hop does not fetch or depend on city data during modal open.
- City database is lazy-loaded only after the user types 2+ characters in a location field.
- Saved locations remain available immediately.
- Destination, override start location, and additional leg destination support saved + city suggestions.
- Selected city suggestions are converted to locations only when the hop is saved.
