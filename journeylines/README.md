# JourneyLines

JourneyLines is a public-facing animated travel-history site. It replays a lifetime of trips across a cinematic globe, then settles into a completed route web.

## v2.0 Renderer

v2.0 pivots the default globe view to MapLibre GL JS for a more Mult.dev-like experience:

- cinematic globe camera
- route-following pan, zoom, pitch, and bearing
- takeoff, cruise, and arrival phases
- detailed raster basemap
- route reveal and destination pulse
- clean SVG vehicle markers

Equal Earth and Gall-Peters are still available as alternate SVG atlas projections.

## Local development

```bash
cd journeylines
npm install --no-audit --no-fund --registry=https://registry.npmjs.org/
npm run dev
```

## GitHub Pages deployment

This repo uses a GitHub Actions workflow that builds the Vite app from `main` and publishes the built `dist` folder to the `gh-pages` branch.

GitHub Pages should be configured as:

- Source: Deploy from a branch
- Branch: `gh-pages`
- Folder: `/ root`

## Repo structure

```text
.github/workflows/deploy.yml
VERSION.md
journeylines/
  index.html
  package.json
  vite.config.js
  src/
```

Do not commit `package-lock.json` for this version. The workflow intentionally uses `npm install` against the public npm registry.


## v2.4
Glide-focused playback polish: persistent visited dots, softer camera movement, arrival settle, landing ripple, vehicle grow/shrink, red home-base move routes, and first-pass waypoint routing for drive/boat/train modes.


## Mapbox token

For Mapbox Directions driving routes, create a GitHub repository secret named `VITE_MAPBOX_TOKEN` with your Mapbox public token. The GitHub Actions workflow injects it during `npm run build`. Do not commit a token into `routingSettings.json` unless you intentionally want it in the public repo.
