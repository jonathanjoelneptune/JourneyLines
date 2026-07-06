# JourneyLines Routing Notes — v2.13

## Mapbox token source
JourneyLines uses a Mapbox public token for driving route geometry. In v2.13 the GitHub Actions workflow writes the token into:

`dist/runtime-config.js`

The app reads tokens in this order:

1. `window.JOURNEYLINES_CONFIG.mapboxToken` from `runtime-config.js`
2. `import.meta.env.VITE_MAPBOX_TOKEN`
3. `src/data/routingSettings.json` public token field, intentionally blank by default
4. `localStorage.getItem('journeylines.mapboxToken')` fallback

## Required GitHub Secret
Repo → Settings → Secrets and variables → Actions → Repository secrets:

`VITE_MAPBOX_TOKEN`

## How to confirm after deploy
Open:

`https://jonathanjoelneptune.github.io/JourneyLines/runtime-config.js`

It should contain:

`window.JOURNEYLINES_CONFIG = {"mapboxToken":"pk...."};`

If it is blank, the updated `.github/workflows/deploy.yml` did not deploy or the secret is not available to the workflow.

## Driving route behavior
Driving routes use Mapbox Directions with profile `mapbox/driving` when a token is available. If the token is missing, JourneyLines falls back to manual/generic geometry and logs a console warning.
