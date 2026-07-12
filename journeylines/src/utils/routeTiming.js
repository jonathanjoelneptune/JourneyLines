export function legDurationMs(miles, speed = 1, mode = 'plane') {
  const s = Math.max(0.25, Number(speed) || 1);
  const d = Math.max(0, Number(miles) || 0);

  // Cinematic distance curve. Long routes receive meaningful time without
  // making short local trips feel instantaneous.
  let seconds;
  if (d < 100) {
    seconds = 9.5 + d * 0.018;
  } else if (d < 500) {
    seconds = 11.5 + (d - 100) * 0.018;
  } else if (d < 1500) {
    seconds = 18.5 + (d - 500) * 0.010;
  } else if (d < 3500) {
    seconds = 28.5 + (d - 1500) * 0.0065;
  } else if (d < 6500) {
    seconds = 41.5 + (d - 3500) * 0.0045;
  } else {
    seconds = 55 + Math.min(18, (d - 6500) * 0.0025);
  }

  const normalizedMode = mode === 'car' ? 'drive' : String(mode || 'plane');
  if (normalizedMode === 'drive') {
    seconds = seconds * (d < 800 ? 1.18 : 1.08) + 1.2;
  } else if (normalizedMode === 'train') {
    seconds = seconds * (d < 1400 ? 1.13 : 1.07) + 1.6;
  } else if (normalizedMode === 'boat') {
    seconds = seconds * (d < 1800 ? 1.24 : 1.13) + 2.2;
  } else if (d > 0 && d < 350) {
    seconds += 1.5;
  }

  return (Math.max(8, Math.min(82, seconds)) * 1000) / s;
}
