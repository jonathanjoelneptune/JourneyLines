Base: GlobeHoppers v4.41.1
Update: v5.0 Natural Earth vessel routing
Changes:
- Added compact Natural Earth 10m routing guidance dataset.
- Car routes now use Natural Earth major roads/roads as broad guidance where available, then fall back to road-like generated curves.
- Train routes now use Natural Earth railroads as broad guidance where available, with tunnel/water crossing allowed by design, then fall back to smoother rail-like curves.
- Boat routes now use Natural Earth land bounding masks/coastline guidance to bend around land where possible, then fall back to water-style curves.
- Plane routes remain clean cinematic great-circle arcs.
- Existing manual route overrides and routeDetails cache still take priority over generated Natural Earth routes.
- Routing is local/instant and does not require an API key.
