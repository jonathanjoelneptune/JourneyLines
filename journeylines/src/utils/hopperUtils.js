export const DEFAULT_HOPPER_COLOR = '#00e5ff';

export function normalizeHopperData(data = {}) {
  const hoppers = Array.isArray(data.hoppers) ? data.hoppers : [];
  const hopSquads = Array.isArray(data.hopSquads) ? data.hopSquads : [];
  const palette = Array.isArray(data.palette) ? data.palette : [];
  return { hoppers, hopSquads, palette };
}

export function idsKey(ids = []) {
  return [...new Set(ids.filter(Boolean))].sort().join('|');
}

export function exactSquadForIds(ids = [], hopSquads = []) {
  const key = idsKey(ids);
  return hopSquads.find(s => idsKey(s.hopperIds || []) === key) || null;
}

export function resolveTripVisual(trip = {}, hopperData = {}) {
  const { hoppers, hopSquads } = normalizeHopperData(hopperData);
  const hById = Object.fromEntries(hoppers.map(h => [h.id, h]));
  const permanentIds = Array.isArray(trip.travelers) ? trip.travelers : [];
  const guests = Array.isArray(trip.guestHoppers) ? trip.guestHoppers : [];
  const squad = exactSquadForIds(permanentIds, hopSquads);
  if (squad && guests.length === 0) {
    return {
      id: squad.id,
      name: squad.name || permanentIds.map(id => hById[id]?.name || id).join(' + '),
      color: squad.color || DEFAULT_HOPPER_COLOR,
      colors: [squad.color || DEFAULT_HOPPER_COLOR],
      isSquad: true,
      squad
    };
  }
  const members = [
    ...permanentIds.map(id => hById[id]).filter(Boolean),
    ...guests
  ];
  const colors = members.map(m => m?.color).filter(Boolean);
  const name = members.length ? members.map(m => m.name || m.label || 'Guest').join(' + ') : 'No hoppers selected';
  return {
    id: permanentIds.length === 1 && guests.length === 0 ? permanentIds[0] : `combo-${idsKey([...permanentIds, ...guests.map(g => g.id || g.name)])}`,
    name,
    color: colors[0] || DEFAULT_HOPPER_COLOR,
    colors: colors.length ? colors : [DEFAULT_HOPPER_COLOR],
    isSquad: false,
    members
  };
}

export function travelerListForLegacy(hopperData = {}) {
  const { hoppers, hopSquads } = normalizeHopperData(hopperData);
  return [
    ...hoppers.map(h => ({ id: h.id, name: h.name, color: h.color })),
    ...hopSquads.map(s => ({ id: s.id, name: s.name, color: s.color })),
    { id: 'both', name: 'The Neptunes', color: '#00e5ff' }
  ];
}

export function colorGradient(colors = [], fallback = DEFAULT_HOPPER_COLOR) {
  const list = colors.filter(Boolean);
  if (list.length <= 1) return list[0] || fallback;
  const step = 100 / list.length;
  return `linear-gradient(90deg, ${list.map((c, i) => `${c} ${Math.round(i * step)}%, ${c} ${Math.round((i + 1) * step)}%`).join(', ')})`;
}
