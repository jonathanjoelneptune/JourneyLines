# JourneyLines Routing Notes

v2.36 keeps the private build-time Mapbox route cache architecture from prior versions. The Mapbox token remains in GitHub Actions and is not published to GitHub Pages.

This update is focused on visual parity for non-globe projections:
- Equal Earth
- Gall-Peters

Those projections still use the lightweight D3/SVG renderer, but now match the darker terrain/space style more closely and use the same vessel icon assets when present in `src/Icons`.
