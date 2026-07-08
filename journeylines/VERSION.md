# GlobeHoppers v3.32

Hopper bug fixes and color consistency:
- Fixed black-screen risk when opening Add Hop / Edit Hop by adding safe Hopper data fallbacks
- Hopper commits now use GitHub Contents API with SHA refetch/retry to avoid 422 stale-ref failures on back-to-back saves
- Active in-flight route and vessel color now resolve from current Hop Squad / Hopper data
- Updated vessel icon color matching for the Hopper palette
- Hero Add Hop button keeps the green style
- Add/Edit Hop labels remain in Hop language
- Placard culling tightened further for rim/backside items while preserving local/front-facing placards
- package intentionally omits src/data/trips.json, src/data/hoppers.json, and package-lock.json
