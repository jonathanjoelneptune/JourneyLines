# GlobeHoppers v7.0 QA Record

## Scope

GlobeHoppers v7.0 introduces multimodal Route Review for car, train, and boat legs, a worker-built road/rail graph, Mapbox-first road routing when configured, stronger navigable-water validation, persistence of reviewed route diagnostics, and mode-specific playback timing.

## Automated verification

The `scripts/verify-v7.0.mjs` gate verifies:

- v7 version and package metadata
- Route Review approval and stale-signature save gates
- per-leg route-review error containment
- Mapbox timeout/fallback and non-blocking cache failure handling
- worker initialization and road/rail/water graph counts
- representative San Diego–Los Angeles road and rail routes
- representative PortMiami–Nassau navigable-water route with zero unauthorized land crossings
- assessment rejection of stationary boat routes, mapped land crossings, and severe off-land surface routes
- route signature stability and invalidation behavior
- QA document placement under `journeylines/QA/`
- production Vite build

## Manual regression checklist

1. Add a one-way car Hop and verify Route Review calculates automatically, shows a geometry preview, and requires approval before Save.
2. Change its destination after approval and verify the approval becomes stale and Save is blocked.
3. Add a train Hop using station-named saved locations and confirm the endpoint guidance warning is absent.
4. Add a train Hop using city centers and confirm the station precision warning appears.
5. Add a boat Hop using ports and confirm no land-crossing error is present before approval.
6. Add a mixed multi-leg Hop containing car, train, plane, and boat legs. Confirm only surface legs appear in Route Review and all surface legs must be approved.
7. Add more than four surface legs and confirm routing waits for the explicit Review Routes command rather than starting a large automatic batch.
8. Force the routing worker offline/crashed, confirm errors are contained per leg, and use Retry Routing Engine.
9. Pause and resume playback and confirm mode-specific route playback remains continuous.
10. Verify repository save writes routeDetails metadata without rewriting managed `trips.json` or `hoppers.json` in release packages.

## Data-quality notes

Natural Earth road and rail data is geographic visualization data, not street-level navigation or live rail service/timetable data. Low-confidence results are labeled as fallbacks and include endpoint/network warnings. Users can improve difficult routes by selecting precise station/port locations or adding intermediate legs.

## Updated-files overlay cleanup

When applying the updated-files-only ZIP over v6.3.0, delete these obsolete hashed build artifacts before committing:

- `journeylines/dist/assets/AdminPanel-Ck8_xNhG.js`
- `journeylines/dist/assets/index-9Pb-uv0Z.js`
- `journeylines/dist/assets/index-B2tIqc0f.css`
- `journeylines/dist/assets/routingWorker-BSbjWl4T.js`

GitHub Actions rebuilds `dist`, but removing the obsolete hashes keeps the source repository clean.
