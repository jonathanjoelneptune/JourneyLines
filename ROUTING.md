# JourneyLines routing notes

v2.25 keeps the private build-time Mapbox route cache approach for driving routes. The Mapbox token stays in GitHub Actions and is not published to GitHub Pages.

This version focuses on culling and playback performance: completed routes are lighter once inactive, labels are aggressively culled when far from the camera focus/horizon, and the follow camera zooms closer for regional travel.
