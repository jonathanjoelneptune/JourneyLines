# GlobeHoppers v3.27

Playback placard stability:
- Persistent placards now use a separate playback visibility model from globe overview
- Playback mode uses a smaller safe zone so placards hide before reaching the unstable rim
- Persistent placards use separate show/hide thresholds instead of a single toggle threshold
- Non-current placards update visibility more slowly during playback
- Rapid edge toggles are temporarily locked hidden before reappearing
- Current route origin/destination placards remain responsive
- package intentionally omits src/data/trips.json and package-lock.json
