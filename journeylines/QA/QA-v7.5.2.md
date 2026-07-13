# GlobeHoppers v7.5.2 QA Record

Release date: July 13, 2026

## Automated coverage

- Repository Hop, leg, route-detail, and Hopper-data preservation.
- Active-playback camera ownership and delayed overview-lock cancellation.
- Staged camera reorientation before final zoom-in.
- Follow-camera minimum zooms for long flights and surface routes.
- Broad marine presentation budgets, corridor limits, endpoint preservation, and one-time smoothing.
- Fixed-height timeline viewport with mutually exclusive year/month rows.
- Shared two-column destination and search result-card layout.
- Expanded marker hit target and map-shell-scoped dynamic label sizing.
- Antimeridian line splitting and wrapped decorative-air-arc suppression.
- Conservative vehicle and placard far-side culling.
- Additional Legs teal section treatment.
- Production Vite build output.

## Manual regression checklist

1. Start a Hop from View Globe and confirm the map does not perform a second abrupt zoom-out after the normal route framing is established.
2. Drag and rotate during playback, release, and confirm the camera reorients while outside the globe before zooming back to the live vessel.
3. Play consecutive long-distance Hops and confirm follow framing persists across trip boundaries.
4. Play long marine routes in open water and constrained channels. Confirm broad open-water arcs and tighter channel behavior without frame-to-frame route changes.
5. Zoom the timeline from Fit to maximum. Confirm the control bar never changes height and month labels remain in the existing label row.
6. Open destination selection and search. Confirm Hop title is left, route is upper-right, and date is lower-right.
7. Select a city using the area around its white marker and confirm the enlarged invisible target works without moving the placard.
8. Zoom from globe to regional view and confirm city names and white circles visibly increase in size.
9. Zoom and rotate during Seoul/Tokyo playback and confirm no horizontal wrapped trail appears.
10. Rotate a moving aircraft beyond the globe limb and confirm the aircraft, placards, and decorative arc are hidden conservatively.
11. Open Add/Edit Hop and confirm Additional Legs uses the same teal highlighted section language as Route and Destination.
