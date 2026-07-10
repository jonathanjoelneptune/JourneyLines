Base: GlobeHoppers v4.36.2
Update: v4.36.3 save status groups and conflict fallback
Changes:
- Repository save status now separates Pending, Saving now, and Complete sections.
- Completed saves no longer show stale pending wording.
- Pending/complete lists show add/edit/delete action, trip label, and trip ID.
- Atomic Git save remains the primary save path.
- If atomic Git save repeatedly fails with a non-fast-forward/reference conflict, the app falls back to the GitHub Contents API sequential save.
- Fallback save writes locations.json first, trips.json second, and routeDetails.json last to reduce the chance of missing location references.
