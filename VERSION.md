# JourneyLines v2.3.0 — North-Up Globe + Label Cleanup

## Summary
This update keeps the MapLibre cinematic globe renderer but locks the camera bearing to north-up during playback so the globe pans, zooms, and glides without rotating/spinning the map orientation. It also removes faint base-map city labels from the raster overlay so only active JourneyLines trip endpoint labels are shown.

## Changes
- Camera bearing locked to 0 degrees for north-up playback.
- Globe can still pan, zoom, pitch, and glide cinematically.
- Disabled globe rotation/drag-rotate while paused; panning/zooming remain available while paused.
- Removed faint CARTO label raster layer from the MapLibre style.
- Active origin/destination labels remain app-rendered HTML overlays.
- Increased active place label contrast and readability.
- Kept terrain/satellite imagery globe surface.
- Kept v2.x MapLibre renderer and gh-pages workflow.
- `package-lock.json` intentionally remains excluded.

## Upload structure
Upload the extracted contents to the root of the existing GitHub repo:

```text
.github/workflows/deploy.yml
.gitignore
VERSION.md
journeylines/
```
