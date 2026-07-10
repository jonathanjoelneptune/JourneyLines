Base: GlobeHoppers v4.31
Update: v4.31.1 city suggestions runtime fix
Changes:
- Moved cities15000.json out of the JS bundle and into public/data for lazy fetch.
- Add/Edit Hop no longer imports the full city database synchronously.
- Suggestions fall back to saved locations until the city database finishes loading.
- Keeps Destination, Override Start, and Additional Leg city suggestions.
