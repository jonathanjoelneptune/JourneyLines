Base: GlobeHoppers v4.36.3
Update: v4.37 chronological timeline only
Changes:
- Removed manual Reorder controls from GlobeHopper Timeline.
- Menu, timeline, and playback ordering now use chronological trip date sorting only.
- Existing manual sortKey values are ignored for display/playback sorting.
- Add/edit/delete saves normalize the stored trips array back into chronological order.
- Editing a trip date moves it to its correct chronological position, and play-saved-hop resolves it by trip ID after the rebuilt timeline.
- New saved sortKey values are date-derived instead of manual-order derived.
