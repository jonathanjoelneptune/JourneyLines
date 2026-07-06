# JourneyLines v2.8 — Anchored Labels + Mapbox Driving Polish

This release focuses on the deployed issues from v2.7:

- Visited labels are now MapLibre symbol labels anchored to globe coordinates instead of static HTML overlays.
- Labels and route content move correctly when the globe is panned/zoomed while paused.
- Locations behind the globe horizon are handled by MapLibre instead of staying visible as fixed screen overlays.
- Destination label animation is simplified to a pin-drop from above instead of the previous two-phase/checkmark-like animation.
- Arrival ripple/pulse is gated to actual arrival/settle, not early approach.
- US locations display with state abbreviations where available, e.g. New York, NY; Chicago, IL; Atlanta, GA.
- Route glow was strengthened for both active and completed routes.
- Mapbox driving route cache keys were bumped to v2.8 so older generic/fallback routes do not mask newly fetched Mapbox routes.
- Driving route fetch now attempts all drive routes in the trip archive when a Mapbox token is available, instead of only routes already reached in playback.
- Plane/trail alignment was adjusted so the active tail stops farther behind the aircraft.

Deployment model remains the working `gh-pages` branch workflow. `package-lock.json` remains excluded.
