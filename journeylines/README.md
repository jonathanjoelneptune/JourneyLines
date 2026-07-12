# GlobeHoppers

**All your hops, skips & jumps.**

GlobeHoppers is a living travel-history map that replays trips across a cinematic globe, with alternate flat projections, traveler-specific colors, custom vehicle icons, route trails, and editable trip data stored in the repository.

## v7.0: Multimodal Journeys

Road, rail, and water Hops now use an explicit Route Review step before saving. GlobeHoppers calculates each surface leg in a worker, presents the route geometry, source, distance, estimated duration, confidence, and validation messages, and requires the user to approve the current route signature.

- Cars reuse the private Mapbox build cache when available, can use Mapbox Directions when a public runtime token is configured, and otherwise fall back to the local Natural Earth road network.
- Trains use Natural Earth rail-network routing and clearly labeled fallback corridors when network coverage is incomplete.
- Boats use the navigable-water graph and are blocked when validation detects a land crossing or stationary fallback.
- Additional legs act as route-shaping stops for complex journeys.
- Saved station, depot, port, marina, and terminal locations provide more precise endpoints than city centers.

The v7.0 rail data is geographic routing data, not a live timetable or ticketing service. Route Review surfaces low-confidence cases so they can be corrected with better endpoints or intermediate legs before saving.

## Quality assurance

Release QA records are stored under `journeylines/QA/` rather than at the repository root.
