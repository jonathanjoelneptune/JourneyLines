# GlobeHoppers v7.1.4 Performance Architecture

## Playback ownership

During active playback, the singleton playback engine is the only owner of vehicle, active-route, and cinematic-camera updates. MapLibre `move` callbacks remain available for placard maintenance but do not repeat vehicle projection work.

## Surface geometry lifecycle

1. Provider geometry remains the immutable routing source of truth.
2. A bounded presentation path is calculated once and cached by stable array identity.
3. Playback-plan input is packed into a transferable `Float64Array` before it is sent to the worker.
4. The worker returns typed positions, headings, camera lead, cumulative distance, and presentation geometry.
5. A matching reverse trip uses the same canonical geometry and a reversed playback plan.

No raw provider route is copied or simplified inside the playback frame loop.

## Render budgets

| Work | High | Medium | Low |
|---|---:|---:|---:|
| Vehicle overlay | Display rate | Display rate | Display rate |
| Camera target | ~60 FPS | ~40 FPS | ~30 FPS |
| Active trail source | ~12 FPS | ~10 FPS | ~8 FPS |
| Passive placard refresh | ~2 FPS | ~2 FPS | ~2 FPS |

Completed-route fades and trip-profile transitions use MapLibre paint transitions and at most a small number of source updates, never a full-history source rebuild on every animation frame.

## Playback visual reductions

While playing, GlobeHoppers disables the wide passive route glow, reduces passive glow blur, removes the full-canvas color filter, pauses star animation, and simplifies vehicle shadow compositing. These effects return automatically when playback pauses or enters View Globe.

## Diagnostics

Diagnostics are off by default and add only a cached boolean check in production. Enable them in the browser console:

```js
window.__GLOBEHOPPERS_PERFORMANCE__?.enable()
```

After playback begins, retrieve a snapshot with:

```js
window.__GLOBEHOPPERS_PERFORMANCE__?.snapshot()
```

The snapshot includes average and p95 frame time, estimated FPS, long tasks, worker round-trip durations, route-source updates, overlay updates, and camera-update counts. Disable and reset with `disable()` and `reset()`.
