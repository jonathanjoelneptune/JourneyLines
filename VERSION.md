# JourneyLines v2.20 — Vessel Icon Color Selection

- Uses the new `journeylines/src/Icons` folder convention for vessel artwork.
- Selects airplane icon colors from the active route/traveler color.
- Both/combined cyan routes use `Airplane - Cyan.png`.
- Joey-only orange routes use `Airplane - Orange.png`.
- Bonnie-only pink routes use `Airplane - Pink.png`.
- Car, boat, and train fall back to their blue icons until matching color variants exist.
- Supports a future generic `Vessel - Blue.png` fallback if added.
- Keeps v2.19 space background, tile preload, and private Mapbox build-time route cache.
