# JourneyLines v2.12 — Functionality Reapply + Globe Culling Fix

This release reapplies and hardens the v2.11 functionality that did not show up correctly after deployment.

## Highlights
- Pin/nameplate drop animation now animates the inner pin so inline globe-positioning does not cancel the CSS animation.
- Persistent stylized pins stay anchored to the globe and hide when their location is on the backside of the globe.
- Vehicle overlay also hides when the vessel is on the backside of the globe.
- Airplane air-arc overlay is hidden when the start or vehicle is on the hidden hemisphere.
- Drag/zoom while playing pauses playback immediately and stops JourneyLines from fighting the user's camera movement.
- Mapbox route cache version bumped to v2.12.
- Keeps the gh-pages deployment workflow and runtime Mapbox token injection.

## Upload note
Upload the extracted contents to the existing repository root. Do not upload package-lock.json.
