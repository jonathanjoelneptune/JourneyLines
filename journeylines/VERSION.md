# GlobeHoppers v3.28

Placard culling and Travel Timeline scroll hardening:
- Playback placard culling is now focused on backside/rim visibility rather than local camera focus
- Removed aggressive distance/local-region suppression that hid nearby places like Oakland/San Francisco around LA
- Placards stay visible when they are in the projected view and on the front side of the globe
- Separate rim enter/exit thresholds remain to reduce edge flicker
- Travel Timeline scroll position is restored only when opening the drawer, not every playback render
- Travel Timeline wheel/pointer handling is isolated more strongly from map playback
- package intentionally omits src/data/trips.json and package-lock.json
