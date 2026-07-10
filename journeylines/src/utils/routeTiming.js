export function legDurationMs(miles, speed = 1) {
  const s = Math.max(0.25, Number(speed) || 1);
  const d = Math.max(0, Number(miles) || 0);

  // v4.26: cinematic distance curve.
  // The old bucket model made long-haul flights only ~2x longer than short hops,
  // so routes like LA -> London visually raced across the globe. This curve keeps
  // short hops meaningful while letting international trips take their time.
  let seconds;
  if (d < 100) {
    seconds = 9.5 + d * 0.018;          // ~10-11 sec for local hops
  } else if (d < 500) {
    seconds = 11.5 + (d - 100) * 0.018; // ~12-19 sec
  } else if (d < 1500) {
    seconds = 18.5 + (d - 500) * 0.010; // ~19-29 sec
  } else if (d < 3500) {
    seconds = 28.5 + (d - 1500) * 0.0065; // ~29-42 sec
  } else if (d < 6500) {
    seconds = 41.5 + (d - 3500) * 0.0045; // ~42-55 sec
  } else {
    seconds = 55 + Math.min(18, (d - 6500) * 0.0025); // cap near 73 sec
  }

  // Surface routes benefit from a little more time because close camera views
  // make motion look faster. Flights already get more time from distance.
  if (d > 0 && d < 350 && miles != null) seconds += 1.5;

  return (Math.max(8, Math.min(74, seconds)) * 1000) / s;
}
