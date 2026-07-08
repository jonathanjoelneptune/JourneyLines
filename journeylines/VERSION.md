# GlobeHoppers v3.35

Hopper data propagation and culling tuning:
- Add/Edit Hop now receives the live Hopper data from App state
- Configured Hoppers such as newly added people now appear as selectable in Add/Edit Hop
- Add/Edit Hop Hopper colors now reflect the colors set in Edit Hoppers
- Edit GlobeHopper Timeline row colors now use live Hopper / Hop Squad data
- Top Timeline button and drawer title use GlobeHopper Timeline casing
- Placard culling is relaxed from the v3.34 hard 48/54 degree gate to a 64/78 degree front-face buffer
- Rim/backside placards still hard-hide, but front-facing placards being flown over should remain visible
- package intentionally omits src/data/trips.json, src/data/hoppers.json, and package-lock.json
