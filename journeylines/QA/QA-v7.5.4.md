# GlobeHoppers v7.5.4 QA

## Camera
- Verify dragging, rotating, zooming, and timeline jumping during playback returns to the live route without a second continent-level zoom-out.
- Verify camera orientation completes before final route zoom.
- Verify repeated manual interactions do not require a page reload.

## Timeline
- Verify years remain visible at Fit and all zoom levels.
- Verify months appear at close timeline zoom without changing timeline height.
- Verify the active pin and location pill render above the timeline frame without clipping.

## Results
- Verify search and destination cards use the approved left identity/right route-date layout.
- Verify mobile cards remain readable and scroll correctly.

## Add Hop
- Verify Add Leg is left aligned.
- Verify an unselected month produces `Destination Year`, not `Destination Choose month Year`.

## Globe menu
- Hover Globe and verify Routes only and Locations only choices.
- Click Globe directly and verify both routes and locations are displayed.
- Verify Hero mode displays both.
- Verify Globe appears before Fullscreen.

## Build
- `npm run build` passes. Existing large-chunk advisory is non-blocking.
