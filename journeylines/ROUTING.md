Base: GlobeHoppers v5.1.8
Update: v5.2 Natural Earth dense water routing graph
Changes:
- Added a dense Natural Earth-derived water routing layer to naturalEarthRouting.json.
- Generated 7,200 water detail nodes from a global ocean grid, coastline-offset water candidates, strategic waterways, and existing named corridor nodes.
- Boat routing now loads waterDetailNodes from the database and uses them in the A* graph.
- The graph now caps candidate nodes by route relevance so it can use more detail without expensive all-global routing.
- Added same-corridor ordered routing for trips that begin and end near the same named water corridor, such as U.S./Canada Pacific coast trips.
- Reduced use of broad ocean fallback; regional boat trips should prefer dense water graph/corridor routing instead of large triangle detours.
- Added stricter route relevance scoring to favor direct/coastal paths while still respecting land/island/canal rejection rules.
- Fixed edit-hop autocomplete popups: prefilled override start/destination fields no longer open suggestions until the user actively types.
