Base: GlobeHoppers v4.39
Update: v4.40 inactive hero state and dense card override fix
Changes:
- Pre-start/hero state now has no active trip.
- Pre-start/hero state no longer treats the final trip as completed/active.
- This removes the cyan pulse around the last destination on page load.
- Pre-start/hero map now hard-resets to the 4.20 overview zoom instead of easing from the previous active trip.
- Completed/visible legs are empty before playback starts, so the map cannot zoom toward the last trip.
- Strengthened dense Card mode CSS specificity so card size/padding updates override older card rules.
