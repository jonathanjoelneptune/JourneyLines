# GlobeHoppers v3.1 — Studio Save + Sticky Modal Polish

- Added Save and commit controls to the top of the Add/Edit Trip modal.
- Made the trip title/date fields sticky so they remain visible while scrolling.
- Raised Studio/modal layering so the current trip card no longer appears above edit mode.
- Reworked GitHub saving to commit trips and locations together through an atomic Git commit, with retries for branch conflicts.
- Kept a fallback Contents API save path with retry handling.
- Improved dark dropdown/input styling for Studio controls.
