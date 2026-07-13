GlobeHoppers v7.2.0 — Batch Add Hops and Camera Transition Polish

- Added Batch Add Hops from the normal Add Hop dialog, using the streamlined Hop editor without Hop Preview.
- Each completed Hop is routed and validated when staged, then displayed as one chronological table row with dates, Hoppers, home-base-derived start, all legs/vessels, trail type, Edit, and Delete.
- Editing a different staged Hop, starting another Hop, saving the batch, or closing Batch Add protects unsaved editor changes with Save, Discard, and Cancel choices.
- Batch Save applies all staged Hops to in-memory data once and queues one atomic repository update for trips.json, locations.json, and routeDetails.json.
- New staged Hops derive their start location independently from the active home base for their date rather than chaining from another staged Hop.
- Disconnected trips now pause playback and use zoom out, low-zoom reposition, then zoom in instead of a long cross-map center glide.
- Plane icons now use the projected screen-space route tangent with shortest-angle smoothing so the nose stays aligned to the visible flight path.
- Added v7.2 batch workflow, atomic-save, chronological-order, relocation-stage, plane-alignment, regression, and production-build verification.

---

GlobeHoppers v7.1.4 — Surface Playback Performance Recovery

- Replaced active-leg raw geometry copying with stable references and a single prepared presentation path, preventing cache invalidation and main-thread route re-simplification at leg start.
- Packed playback-plan input into transferable Float64Array buffers so large provider routes are moved to the routing worker without structured-cloning nested coordinate arrays.
- Added canonical bidirectional surface-route caching. Matching car, train, and boat return legs reuse the outbound route and playback plan in reverse instead of requesting and preparing duplicate geometry.
- Made the playback engine the sole owner of vehicle overlays while playing; MapLibre move/render callbacks no longer duplicate overlay projection work.
- Reduced active-trail GeoJSON updates to approximately 12, 10, or 8 updates per second by quality level and reused the already-built feature list for transition fades.
- Replaced per-frame completed-history fade and profile-morph GeoJSON rebuilding with one-time source updates and MapLibre paint transitions.
- Adaptive quality now throttles camera updates to approximately 60, 40, or 30 FPS while preserving display-rate vehicle motion.
- Disabled the wide historical-route glow and reduced passive blur during playback, while keeping the active route fully styled.
- Suspended full-screen map filters and decorative star animation during playback to reduce compositing overhead.
- Reduced MapLibre tile cache/prefetch settings and bounded the custom tile-warmup set.
- Added opt-in development instrumentation for frame time, long tasks, overlay/camera/trail updates, worker round trips, and GeoJSON setData calls.
- Added v7.1.4 bidirectional-route, transferable-buffer, performance-ownership, render-budget, regression, and production-build verification.

---

GlobeHoppers v7.1.3 — Lightweight Surface Playback

- Replaced dense equal-distance surface-route smoothing with bounded corridor-preserving presentation geometry.
- Car, train, and boat playback now follows a lightweight selection of original provider route points instead of turn-by-turn-density geometry.
- Exact endpoints and major route detours remain preserved; route spans that would create large shortcuts are split back onto the original corridor.
- Normal point budgets are capped at 220 for cars, 190 for trains, and 160 for boats, with additional safety anchors retained only when needed.
- Surface drawing no longer re-densifies routes during animation.
- Worker playback plans are capped at 320 samples.
- Added cached cumulative polyline metrics and binary-search point lookup to remove repeated per-frame route scans.
- Active trail reconstruction now runs independently at a lower visual frequency while vehicle and camera animation remain display-rate.
- Retained the v7.1 provider cache version because valid Valhalla/OpenStreetMap geometry remains unchanged.
- Added route-budget, cache, repository stress, synthetic water/land-detour, worker parity, and production-build verification.

---

GlobeHoppers v7.1.2 — Surface Route Smoothing, Relocation Glide, and Add Hop Launch Reliability

- Added conservative equal-distance smoothing for car, train, and boat geometry so active vehicles and completed trails follow the same detailed route with fewer visually sharp corners.
- Surface smoothing preserves exact route endpoints, limits lateral displacement by mode and route length, and is applied consistently in both map rendering and worker-generated playback plans.
- Disconnected timeline entries now pause at the completed destination, glide the camera to the next trip's starting location, and resume playback only after the relocation animation settles.
- Connected legs and connected trips retain the existing continuous-handoff behavior without an unnecessary relocation glide.
- The relocation transition has single-owner cancellation, timeout fallback, invalid-target handling, and cleanup when the user opens Studio, jumps, views the globe, or restarts.
- Fixed the first-click Add Hop failure caused by dispatching the open command before the lazy-loaded Studio listener mounted.
- Add Hop now passes a durable one-shot request into Studio, opens directly in modal-only mode on the first click, and no longer opens the GlobeHopper Timeline behind it.
- Added v7.1.2 route-smoothing, relocation-state, lazy-launch, cancellation, and production-build regression checks.

---

GlobeHoppers v7.1.1 — Detailed Surface Route Playback

- Fixed a playback-only geometry mismatch where the completed car/train/boat trail used the detailed routed geometry but the moving vehicle remained locked to a temporary stylized fallback.
- Active surface legs now freeze only validated manual, saved, or routed geometry; temporary fallback curves are never frozen into the playback snapshot.
- Playback-plan cache keys now include sampled points from the actual rendered geometry, preventing a plan for one route shape from being reused for another.
- The first four routes begin prefetching while the globe is idle, reducing the chance that playback starts before detailed surface geometry is ready.
- If a detailed route finishes after a leg has started, the live geometry remains eligible to take ownership instead of being blocked by the initial fallback snapshot.
- Added v7.1.1 regression checks for routed-geometry ownership, prefetch timing, playback-plan key symmetry, and production build output.

---

GlobeHoppers v7.1 — Automatic Surface Routing with Valhalla and OpenStreetMap

- Removed the required route-approval step for car, train, and boat Hops.
- Surface routes are calculated and validated automatically; saving is blocked only when endpoints are incomplete or no safe geometry can be generated.
- Valhalla with OpenStreetMap data is now the primary live driving-route provider.
- Mapbox Directions is a secondary fallback, followed by the existing stored Mapbox build cache and the local Natural Earth approximation.
- Current v7.1 browser-cached routes are reused, while older v7.0 routing caches are invalidated by the routing-version change.
- Added sequential Valhalla endpoint failover, bounded request timeouts, response validation, endpoint-snap checks, stale-request protection, and a temporary provider circuit breaker after failures.
- Successful routes remain cached for playback and repository persistence. Manual and already-saved detailed geometry continue to take precedence outside the automatic generation pipeline.
- Route diagnostics remain available in a compact, optional details panel. Approximate routes display warnings without requiring user approval.
- Provider travel duration is used when available, with mode-based estimates retained as the fallback.
- Added v7.1 unit, provider-fallback, source-order, UI-integrity, and production-build verification.

---

GlobeHoppers v7.0 — Multimodal Journeys and Route Review

- Added a required Route Review workflow for road, rail, and water legs before a Hop can be saved.
- Car routing now reuses private build-time Mapbox geometry when available, can use Mapbox Directions with a configured public runtime token, and then falls back to the local Natural Earth road network.
- Train routing now uses a worker-built Natural Earth rail graph with explicit lower-confidence corridor fallbacks when the source network is incomplete.
- Boat routing continues to use navigable-water graph routing with denser land-intersection validation and explicit canal-edge permissions.
- Added route source, distance, estimated duration, confidence, warnings, errors, and a compact geometry preview for every reviewed surface leg.
- Route edits invalidate prior approval. Surface routes must be recalculated and approved again before saving.
- Reviewed geometry and diagnostics are retained in memory, IndexedDB, and routeDetails metadata for playback and repository persistence.
- Added bounded worker and Mapbox request timeouts, stale-worker protection, crash recovery, non-blocking cache-write failures, and per-leg review error containment.
- Added mode-specific cinematic playback timing for car, train, and boat travel.
- Added v7.0 worker, route-assessment, source-integrity, and production-build verification.

---

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
