# GlobeHoppers v6.2 Verification Report

## v6.2 verification additions

Static and behavioral checks cover:
- v6.1.1 connected camera handoff and final globe-level completion behavior remain present.
- View Globe no longer increments the restart/reset nonce.
- Restart Journey is the only command that returns to the intro/home state.
- Play preserves a completed timeline rather than implicitly restarting.
- Routing worker requests have init/job timeouts and clear their timers on completion.
- Worker crashes, message deserialization failures, request timeouts, and postMessage failures dispose the poisoned worker and reject queued jobs.
- Manual routing retry creates a fresh worker.
- Advanced controls close on Escape and restore focus.
- Play/completion and advanced-popover controls expose ARIA state.
- Hopper/Hop Squad audit surfaces duplicate IDs, missing fields, invalid references, and unknown trip travelers without rewriting user data.
- Short-screen/mobile overflow and reduced-motion rules are present.
- package-lock.json, trips.json, and website-owned hoppers.json are not included or modified by this patch.

Run `cd journeylines && node scripts/verify-v6.2.mjs .` after the managed data files are present in the checkout.
