# GlobeHoppers v7.1.2 QA

## Regressions addressed

1. Detailed car, train, and boat geometry could still look angular because long routed segments were rendered as hard polyline corners.
2. A disconnected trip transition advanced immediately and allowed the camera to cut to the next origin instead of treating relocation as part of playback.
3. The first Add Hop click dispatched a window event before the lazy-loaded Studio mounted its listener. A second click was required and could expose the Timeline behind the modal.

## Corrections

### Surface route smoothing

- Added a shared `routeSmoothing` utility for car, train, and boat routes.
- Geometry is sanitized, resampled at equal distance, and smoothed with mode-specific conservative displacement limits.
- Exact origin and destination coordinates remain anchored.
- Map lines, vehicle position, heading, camera lead, and worker playback plans all consume the same smoothing implementation.
- Plane and home-move geometry remain unchanged.

### Disconnected-trip relocation

- The playback engine pauses after the completed leg settles.
- The active index remains on the completed leg during relocation.
- MapLibre performs a bounded `flyTo` toward the next leg's origin.
- Playback advances and resumes only after `moveend` or a guarded timeout fallback.
- Invalid targets fail closed without leaving playback stuck.
- Opening Studio, editing, jumping, View Globe, and Restart cancel any active relocation owner.

### Add Hop first-click launch

- App now increments a durable `initialAddRequestId` instead of relying on an event listener that may not exist yet.
- Lazy-loaded AdminPanel consumes each request ID once and calls `openAdd` after mount.
- Add Hop always requests modal-only Studio state.
- The legacy window-event listener remains for backward compatibility, but is not used by the primary Add Hop path.

## Required checks

- Sharp synthetic road, rail, and water corners are rounded while endpoints remain exact.
- Smoothing remains within the configured route-relative displacement cap.
- Active surface playback and completed trails use the same smoothed route.
- Connected legs do not trigger relocation.
- Disconnected trips pause, glide, then resume exactly once.
- Relocation cancellation cannot resume stale playback.
- First Add Hop click opens the modal after lazy load.
- Add Hop does not expose the Timeline behind the modal.
- Production Vite build completes successfully.

## Updated-files deployment

When applying the updated-files-only archive over v7.1.1, remove the obsolete hashed assets listed in the release response. The complete repository archive already contains a clean `dist` directory.
