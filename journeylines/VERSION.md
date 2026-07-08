# GlobeHoppers v3.26

Placard flicker and globe pause/resume polish:
- Globe mode freezes playback timing the same way Edit Travel Timeline does
- Play from globe mode resumes the exact current trip and mid-leg progress
- Globe transition no longer resets the route progress to zero after the zoom-in
- Placards now use visibility hysteresis near the horizon/screen edge to prevent flickering
- Rapid visible/hidden toggles are detected and temporarily locked hidden before reappearing
- package intentionally omits src/data/trips.json and package-lock.json
