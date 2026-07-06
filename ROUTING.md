# JourneyLines Routing Notes

v2.29 keeps the existing routing architecture:

- Driving routes are generated privately in GitHub Actions from the Mapbox token stored as `VITE_MAPBOX_TOKEN`.
- The deployed site contains generated route geometry only, not the token.
- Boat and train routes continue to use manual route overrides.
- Caribbean cruise overrides from v2.28 remain in place.

v2.29 also adds subtle Natural Earth country and state/province boundary overlays at runtime.
