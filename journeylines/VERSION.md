# GlobeHoppers v3.34

Stable Add/Edit Hop recovery and hard rim culling:
- Rebased Add/Edit Hop modal behavior on the known-working v3.30 implementation
- Keeps dynamic configured Hoppers selectable in Add/Edit Hop
- Keeps Guest Hoppers supported using the stable inline v3.30 path
- Preserves active in-flight route and vessel color matching from current Hopper / Hop Squad data
- Keeps GitHub Hopper saves on the SHA refetch/retry path for back-to-back commits
- Replaces the rim flashing fix with a hard safe-front-face gate during playback
- Rim/backside placards are immediately hidden and locked hidden for 2 seconds before reappearing
- package intentionally omits src/data/trips.json, src/data/hoppers.json, and package-lock.json
