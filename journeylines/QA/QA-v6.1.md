# GlobeHoppers v6.1 Verification Report

## Automated checks completed

- `npm run build`: PASS
- Vite production transform: 292 modules
- Trip normalization and stable-ID determinism: PASS
- Multi-leg expansion and leg-ID preservation: PASS
- Leap-year and invalid-date validation: PASS
- Unresolved 0,0 location rejection: PASS
- routeDetails stable keys: PASS
- Stale routeDetails destination rejection: PASS
- Stale routeDetails coordinate rejection: PASS
- Playback generation increment and stable leg metadata: PASS
- City search worker queries for San Diego, Rome, and Milan prefixes: PASS
- Routing worker initialization: PASS
- San Diego → Vancouver by boat: PASS
- San Diego → Athens by boat: PASS
- Miami → San Juan by boat: PASS
- San Diego → Cabo by train: PASS
- San Diego → Los Angeles by car: PASS
- Playback-plan typed arrays and sample count: PASS
- Unauthorized Natural Earth boat/land intersections: 0 in tested routes
- Production preview root: HTTP 200
- Natural Earth routing data: HTTP 200
- Cities database: HTTP 200
- Production asset requests: PASS

## Static source checks completed

- Camera handoff does not clear the previous camera.
- Frames validate trip, leg, and playback generation.
- Stable IDs are used for route and UI identity.
- Reverse-route symmetry is not assumed.
- Placeholder 0,0 location creation is absent.
- Save/Delete double-submit guards are active.
- Dirty-state close confirmation is present.
- Autocomplete keyboard/ARIA behavior is present.
- Repository retry is connected.
- Detailed vessel geometry is prepared before auto-play.
- Duplicate worker route jobs are coalesced.
- Studio loading feedback and short-screen scrolling are present.

## Boundaries of this verification

The container cannot perform an authenticated commit to your live GitHub repository or reproduce every GPU/browser/device combination. No failures were found in the production build or targeted regression suites, but a deployment smoke test should still cover:

- one outbound/return flight
- one multi-leg trip
- one add/edit/delete batch
- one repository retry using a deliberately interrupted connection
- desktop and mobile-sized browser windows
