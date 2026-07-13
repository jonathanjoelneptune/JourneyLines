const reversedPlanCache = new WeakMap();

/** Pack nested [lon, lat] route geometry into a transferable typed-array. */
export function packGeometryForWorker(geometry) {
  if (!Array.isArray(geometry) || geometry.length < 2) return null;
  const packed = new Float64Array(geometry.length * 2);
  let offset = 0;
  for (const point of geometry) {
    packed[offset++] = Number(point?.[0]);
    packed[offset++] = Number(point?.[1]);
  }
  return packed;
}

/** Reverse a prepared playback plan once and cache the paired view. */
export function reversePlaybackPlan(plan, mode = 'drive') {
  if (!plan || typeof plan !== 'object') return plan;
  const cached = reversedPlanCache.get(plan);
  if (cached) return cached;
  const sampleCount = Math.max(0, Number(plan.sampleCount) || Math.floor((plan.positions?.length || 0) / 2));
  const positions = reversePairArray(plan.positions);
  const headings = reverseHeadingArray(plan.headings);
  const cumulative = reverseCumulativeArray(plan.cumulative, Number(plan.totalMiles || 0));
  const camera = buildCameraLeadArray(positions, sampleCount, mode);
  const reversed = {
    ...plan,
    positions,
    headings,
    camera,
    cumulative,
    overview: reversePairArray(plan.overview),
    regional: reversePairArray(plan.regional),
    presentation: reversePairArray(plan.presentation),
    reversedFromCanonical: !plan.reversedFromCanonical
  };
  reversedPlanCache.set(plan, reversed);
  reversedPlanCache.set(reversed, plan);
  return reversed;
}

function reversePairArray(value) {
  if (!value || typeof value.length !== 'number') return value;
  const Type = value.constructor === Array ? Array : value.constructor;
  const output = Type === Array ? new Array(value.length) : new Type(value.length);
  const count = Math.floor(value.length / 2);
  for (let index = 0; index < count; index += 1) {
    const source = (count - 1 - index) * 2;
    output[index * 2] = value[source];
    output[index * 2 + 1] = value[source + 1];
  }
  return output;
}

function reverseHeadingArray(value) {
  if (!value || typeof value.length !== 'number') return value;
  const Type = value.constructor === Array ? Array : value.constructor;
  const output = Type === Array ? new Array(value.length) : new Type(value.length);
  for (let index = 0; index < value.length; index += 1) {
    output[index] = (Number(value[value.length - 1 - index]) + 180) % 360;
  }
  return output;
}

function reverseCumulativeArray(value, totalMiles = 0) {
  if (!value || typeof value.length !== 'number') return value;
  const Type = value.constructor === Array ? Array : value.constructor;
  const output = Type === Array ? new Array(value.length) : new Type(value.length);
  const total = Number(totalMiles || value[value.length - 1] || 0);
  for (let index = 0; index < value.length; index += 1) {
    output[index] = Math.max(0, total - Number(value[value.length - 1 - index] || 0));
  }
  return output;
}

function buildCameraLeadArray(positions, sampleCount, mode) {
  const camera = new Float32Array(Math.max(0, sampleCount) * 2);
  if (!positions?.length || sampleCount < 1) return camera;
  const canonicalMode = String(mode || '').toLowerCase() === 'car' ? 'drive' : String(mode || '').toLowerCase();
  const leadSamples = canonicalMode === 'boat' || canonicalMode === 'train'
    ? Math.max(1, Math.round(sampleCount * 0.015))
    : Math.max(1, Math.round(sampleCount * 0.025));
  const bias = canonicalMode === 'boat' || canonicalMode === 'train' ? 0.18 : canonicalMode === 'drive' ? 0.25 : 0.28;
  for (let index = 0; index < sampleCount; index += 1) {
    const leadIndex = Math.min(sampleCount - 1, index + leadSamples);
    const lon = Number(positions[index * 2]);
    const lat = Number(positions[index * 2 + 1]);
    const leadLon = Number(positions[leadIndex * 2]);
    const leadLat = Number(positions[leadIndex * 2 + 1]);
    camera[index * 2] = interpolateLongitude(lon, leadLon, bias);
    camera[index * 2 + 1] = lat + (leadLat - lat) * bias;
  }
  return camera;
}

function interpolateLongitude(a, b, t) {
  const delta = ((Number(b) - Number(a) + 540) % 360) - 180;
  let value = Number(a) + delta * t;
  while (value > 180) value -= 360;
  while (value < -180) value += 360;
  return value;
}
