# GlobeHoppers v7.1.4 QA Record

## Scope

Surface Playback Performance Recovery and canonical bidirectional route reuse.

## Required behavior

- Car, train, and boat return legs with reversed endpoints and matching waypoints reuse the outbound canonical route.
- Manual routes remain higher priority than canonical automatic routes.
- Active-leg setup retains stable raw geometry references and does not deep-copy provider coordinates.
- Worker playback-plan input uses a transferable typed-array buffer.
- The playback engine performs one overlay update per playback frame.
- Map move/render events do not duplicate active playback overlay updates.
- Active route GeoJSON updates are capped near 12/10/8 FPS by quality level.
- Camera updates are capped near 60/40/30 FPS by quality level.
- Completed-route fades and trip-profile transitions do not rebuild full history in requestAnimationFrame loops.
- Passive route glow and full-frame effects are reduced only while playback is active.
- Existing connected-leg continuity, disconnected-trip relocation glide, Add Hop first-click behavior, and detailed surface-route playback remain intact.

## Automated verification

- Canonical forward/reverse route keys and stable reverse geometry
- Transferable route packing and worker unpacking
- Reverse playback-plan positions, headings, cumulative distance, camera lead, and presentation path
- Deep-copy regression guard
- Overlay ownership and duplicate-listener guard
- Active-trail and camera render-budget guards
- Completed-history paint-transition guard
- Playback CSS compositing guard
- Tile-cache and prefetch limits
- Performance diagnostics availability and disabled-path caching
- v7.1 through v7.1.4 regression suites
- Vite production build

## Managed release exclusions

The release archives omit:

- `package-lock.json`
- `journeylines/src/data/trips.json`
- `journeylines/src/data/hoppers.json`
