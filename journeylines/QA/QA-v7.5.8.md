# GlobeHoppers v7.5.8 QA

## Scope
- Reimplemented playback camera reacquisition as one continuous live-target controller.
- Corrected first-pin callout clamping.
- Reduced timeline rail thickness and removed year/pin clipping masks.
- Narrowed search and destination-result panels.
- Made automatic Hop-title spacing explicit.

## Verification
- Clean `npm ci --ignore-scripts --no-audit --no-fund` completed.
- Production Vite build completed using temporary empty validation data for the intentionally excluded mutable `trips.json` and `hoppers.json` files.
- Confirmed camera reacquisition has no discrete orient/zoom handoff stages.
- Confirmed title generation emits explicit spaces between destination, month, and year.
- Confirmed result-panel maximum widths are 340 px and 360 px.
- Confirmed timeline tooltip horizontal clamp accounts for pill width.
