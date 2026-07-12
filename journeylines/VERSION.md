GlobeHoppers v6.3 — Resume State and Add/Edit Hop Preview Layout

- The primary playback control now displays Play before the journey begins, Pause during playback, Resume after playback has been paused, and Complete after the final leg.
- The top-bar playback control uses matching Play, Pause, Resume, and completed-state accessible labels.
- Widened the desktop Add/Edit Hop modal and rebalanced the editor/preview columns so the Hop Preview retains a protected minimum width.
- Reserved additional space between Hop Preview content and its independent scrollbar, preventing title circles, route markers, and traveler status text from being clipped.
- Added responsive preview-row wrapping and minimum-width protections for high-leg-count Hops.
- Preserved the stacked narrow-screen layout below 980 px.
- Moved QA release records into `journeylines/QA/` and removed QA documents from the repository root.
- Added v6.3 static verification, responsive layout checks, and a production build gate.

---

GlobeHoppers v6.2 — Playback Command Ownership, Worker Recovery, Accessibility, and Integrity Diagnostics

- Added an explicit Restart Journey command. Restart is now the only command that returns to the home/intro state.
- Play no longer implicitly restarts a completed timeline; the completed state remains stable until Restart Journey is selected.
- View Globe no longer also fires the reset nonce, removing overlapping camera owners and duplicate camera motion.
- Preserved the v6.1.1 connected-handoff zoom hold/release and final globe-level completion glide.
- Routing worker requests now have bounded timeouts, crash/message-error recovery, stale-worker protection, and a visible Retry Routing Engine action.
- Advanced controls now support Escape dismissal, focus restoration, ARIA-expanded/dialog semantics, and clearer playback-complete labeling.
- Added non-destructive Hopper/Hop Squad integrity auditing for duplicate IDs, missing fields, broken squad references, and trips that reference unknown permanent Hoppers.
- Added short-screen/mobile containment and reduced-motion safeguards for playback controls.
- Added v6.2 static verification and production-build checks.

---

GlobeHoppers v6.1 — Stable Leg IDs, Route Integrity, and Editor Hardening

Base: v6.0.1

Playback and identity:
- Added permanent leg IDs and point IDs.
- Legacy trips are normalized deterministically at runtime.
- The first repository trip save writes the normalized explicit-route model.
- Playback identity, routeDetails keys, worker jobs, cache keys, and map route keys use stable leg IDs.
- Legacy positional routeDetails keys remain readable during migration.
- Playback frame validation uses trip ID, leg ID, leg index, and generation.

Route integrity:
- Saved geometry is accepted only when trip, leg, origin, destination, mode, coordinates, and routing version match.
- Coordinate changes invalidate cached geometry.
- Reverse routes are no longer assumed to be symmetric.
- Route cache keys include stable leg ID and endpoint coordinates.
- IndexedDB route cache is capped at 500 entries.
- Playback-plan cache is capped and keyed by route geometry.
- Duplicate route and playback-plan requests are coalesced.
- Active vessel trips wait for detailed geometry before auto-play.
- Route-generation failure is surfaced in the ... menu rather than silently playing an invalid fallback.
- RouteDetails state updates live during the session.

Editor and data integrity:
- All saved trips use one explicit ordered route model.
- Additional-leg rows use stable React keys.
- Adding/removing middle legs preserves identities of unchanged legs.
- Save and Delete are protected against double submission.
- Metadata-only edits do not interrupt playback; new trips and route/date edits auto-play.
- Prefilled autocomplete fields stay closed until the user types.
- Autocomplete supports outside-click dismissal, Escape, arrow keys, Enter, and ARIA combobox semantics.
- City search runs in a Web Worker instead of scanning 23,000 cities during React render.
- Exact GeoNames identity is preferred for same-named cities.
- Unresolved text is blocked; GlobeHoppers never creates a location at 0,0.
- Custom destinations can be saved using validated exact coordinates.
- Date validation rejects impossible dates and end dates before start dates.
- Future trips are supported through five years beyond the current year.
- Month changes clamp invalid day values.
- Start override is no longer enabled merely because a trip uses an explicit route.

Modal and GUI:
- Unsaved edits require confirmation before close.
- Delayed close timers are cancelled when a modal reopens.
- Focus is trapped inside the dialog and restored to the opening control.
- Escape closes the active dialog.
- Long titles are truncated without moving actions.
- The form and preview remain usable on short screens.
- The route-preview column scrolls independently.
- Added Apply Mode to All Legs.
- Added a high-leg-count performance warning.
- Added visible loading feedback while Studio lazy-loads.
- Removed the disabled photo-upload placeholder.
- Clarified Guest Hopper actions.

Repository save safety:
- Repository failures are non-blocking and remain visible in the ... menu.
- Failed batches have an integrated Retry action.
- Retry works whether Studio is already open or still loading.
- Subsequent saves use current in-session routeDetails rather than the originally deployed snapshot.

Natural Earth:
- Rebuilt the Panama corridor with water-only Pacific/Caribbean approaches.
- Only explicit canal-center edges may cross Natural Earth land polygons.
- The same edge-specific permission model is available for other known canals.

Verification:
- Production build passed.
- Stable trip/leg migration tests passed.
- Date and unresolved-location validation tests passed.
- RouteDetails stale endpoint and stale coordinate rejection tests passed.
- Playback generation tests passed.
- City-search worker tests passed.
- Routing worker tests passed for boat, train, and car scenarios.
- San Diego→Vancouver, San Diego→Athens, and Miami→San Juan boat routes had zero unauthorized Natural Earth land intersections.
- Production preview and static data requests returned HTTP 200.
