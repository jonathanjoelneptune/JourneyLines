# JourneyLines v2.25 — Aggressive Horizon Culling + Cinematic Zoom

- More aggressive globe horizon and camera-focus culling for custom city placards.
- Reduced far-zoom label counts to improve late-timeline playback performance.
- Rounded projected placard positions and removed transform transitions to reduce label wobble while the camera glides.
- Tightened far-side vehicle/air-arc culling.
- Increased follow-mode zoom, especially for car/boat/train and arrivals, so playback frames the destination/region instead of too much of the globe.
- Completed routes use lighter inactive geometry sampling while active routes stay cinematic.
- Keeps v2.24 route-cache, timeline, trips drawer, and icon behavior.
