# JourneyLines routing plan

JourneyLines v2.6 adds the first routing layer beyond straight-line travel.

## Driving: Mapbox Directions

Driving routes can be fetched from Mapbox Directions when a public token is available.

Add your public token in either place:

1. Edit `journeylines/src/data/routingSettings.json`:

```json
{
  "mapbox": {
    "publicToken": "pk.your_public_token_here"
  }
}
```

2. Or store it in the browser console once:

```js
localStorage.setItem('journeylines.mapboxToken', 'pk.your_public_token_here')
```

The app uses:

- profile: `mapbox/driving`
- geometry: `geojson`
- overview: `full`
- local cache key: `journeylines.routeCache`

If no token is present, drive routes fall back to manual waypoint overrides or simple point-to-point paths.

## Boat routing

v2.6 uses manual boat route overrides in `journeylines/src/data/routeOverrides.json`.

Included manual cruise-style paths:

- Melbourne / Port Canaveral area to Nassau
- Nassau back to Melbourne / Port Canaveral area
- Melbourne / Port Canaveral area to Jamaica
- Jamaica to Grand Cayman
- Grand Cayman back to Melbourne / Port Canaveral area
- Long Beach / Catalina routing through the Long Beach port waypoint

This is intentionally manual for now because there is not a simple universal browser-only equivalent of Mapbox Directions for cruise ships. A future cruise routing database could be added as a curated JSON dataset with named ports, cruise legs, and typical sea-lane waypoints.

## Train routing

v2.6 uses manual train waypoints for known train legs. A future true train-routing implementation would likely need a server-side transit engine such as OpenTripPlanner plus GTFS data, which is outside the scope of a purely static GitHub Pages app.

## Future route database idea

A good future structure would be:

```json
{
  "ports": [],
  "cruiseLines": [],
  "itineraries": [],
  "seaLanes": [],
  "railCorridors": []
}
```

This would let JourneyLines route cruises and trains from curated real-world corridors without requiring a live paid service for every playback.
