# JourneyLines v2.7 — GitHub Secret Mapbox Token

## Summary
This update wires the Mapbox public token through the GitHub Actions repository secret `VITE_MAPBOX_TOKEN`.

## Key changes
- Build workflow injects `VITE_MAPBOX_TOKEN` during `npm run build`.
- App reads Mapbox token from `import.meta.env.VITE_MAPBOX_TOKEN` first.
- `routingSettings.json` stays token-free for repo safety.
- Browser `localStorage` token remains as a fallback for local testing only.
- Keeps v2.6 Mapbox driving routing, manual boat/train overrides, cinematic glide updates, persistent labels, and the working `gh-pages` deployment workflow.

## GitHub setup
Repo secret name must be exactly:

```text
VITE_MAPBOX_TOKEN
```

The value should be your Mapbox public token beginning with `pk.`.

## Expected repo shape

```text
.github/workflows/deploy.yml
.gitignore
VERSION.md
ROUTING.md
journeylines/
```
