Base: GlobeHoppers v5.1.3
Update: v5.1.4 systematic boat final water-side approaches
Changes:
- Added a systematic boat final-approach post-processor.
- Boat routes now build around water-side start/end approach points rather than letting the long ocean segment connect directly to a city.
- If the final connector clips land, the route inserts an additional local water-side connector chosen from nearby water candidates.
- Athens/Piraeus water-side candidates were moved farther onto the water side.
- This is intended to fix coastal destination approaches globally, not only Athens.
