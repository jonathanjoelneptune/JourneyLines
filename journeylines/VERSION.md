# GlobeHoppers v3.40

Mixed-color UI, validation popup, and Edit Hoppers drawer:
- Mixed non-squad groups keep the first selected Hopper as the route/vessel primary color
- Mixed groups now show secondary Hopper/Guest colors as accents in Add/Edit Hop UI and Hop Preview
- Hop Preview rows/cards now expose mixed-color gradient/accent variables
- Guest Hopper color picker is repositioned and given a higher z-index to avoid clipping
- Add/Edit Hop required-field errors now render in the GlobeHoppers themed popup
- Edit Hoppers now slides in from the right side of the screen with drawer-style animation
- Edit Hoppers still keeps compact one-line rows, color-circle pickers, and delete buttons
- Long date cells continue to support wrapping
- package intentionally omits src/data/trips.json, src/data/hoppers.json, and package-lock.json


## v3.40 — Stable Glass + Active Edit Timeline Fix
- Rebuilt from the working v3.38 base to avoid the v3.39 black-screen regression.
- Reapplied glass menus, active edit timeline tracking, active-card mixed-name coloring, mixed corner accents, looser date wrapping, and modal-only playback pause behavior.
