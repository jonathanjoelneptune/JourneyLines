# GlobeHoppers v7.2.0 QA

## Camera and vehicle alignment

- Disconnected entries pause timeline playback before camera movement.
- Stage 1 zooms out around the completed destination without cross-map center interpolation.
- The center is repositioned only at overview zoom.
- Stage 3 zooms into the next origin and playback resumes only after completion or bounded fallback.
- Cancellation and stale transition ownership remain protected.
- Plane rotation is derived from a projected route tangent with a wider air look-ahead and shortest-angle smoothing.

## Batch Add Hops

- Batch Add is reachable from Add Hop.
- Hop Preview is absent in batch mode.
- Surface routes calculate when Done with Hop/Update Staged Hop is selected.
- Staged rows are chronological with entry-order tie breaking.
- Start locations derive from the active home base for each Hop date.
- All legs and vessels appear in one multiline route cell.
- Rows are editable only through Edit and removable through Delete.
- Add Another Hop resets the upper editor.
- Unsaved changes are protected when switching rows, adding another Hop, saving, and closing.
- Save Batch updates React trip/location state once and queues one repository batch containing all staged Hops.
- Managed trips.json and hoppers.json are excluded from release ZIPs.

## Build gate

- Vite production build succeeds.
- The v7.2 static verifier confirms workflow ownership and required source patterns.
