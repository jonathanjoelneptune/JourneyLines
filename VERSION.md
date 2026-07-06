# JourneyLines v2.0.0 — MapLibre Cinematic Globe

Major renderer pivot from the SVG/D3 globe proof-of-concept to a MapLibre GL JS cinematic globe renderer.

## Highlights

- Adds MapLibre GL JS as the new default globe renderer.
- Keeps the D3/SVG Equal Earth and Gall-Peters renderer as fallback/alternate projections.
- Adds real raster map tiles for a more detailed terrain/map-surface feel.
- Adds cinematic camera choreography with pitch, bearing, zoom, takeoff, cruise, and arrival phases.
- Adds active route drawing with traveled-route reveal.
- Adds completed route trails with lower-opacity route web.
- Adds arrival pulse effects at the destination.
- Adds HTML/SVG vehicle markers for cleaner icons.
- Airplane rotates with direction of flight.
- Car, boat, and train remain upright.
- Keeps the working gh-pages branch deployment workflow.
- Keeps package-lock.json out of the repo so GitHub Actions installs from the public npm registry.

## Notes

This version uses public CARTO/OSM raster tiles through MapLibre. It gets much closer to the Mult.dev-style camera feel, but true premium 3D terrain or satellite flyover would require a tile/terrain provider such as MapTiler, Mapbox, or Cesium ion in a later version.
