# JourneyLines v2.10 — Persistent Stylized Pins + Air Arc + Token Check

- Replaces MapLibre text labels with globe-anchored HTML stylized pins.
- Prevents repeated drop animations for the same arrival.
- Keeps each visited place pin visible after arrival.
- Removes MapLibre glyph/text layer usage to avoid demotiles font 404 spam.
- Adds a higher, more glowing active airplane arc overlay.
- Adds a GitHub Actions check that verifies `VITE_MAPBOX_TOKEN` is available before building.
- Keeps gh-pages branch deployment and no package-lock.json.
