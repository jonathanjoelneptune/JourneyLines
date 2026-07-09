export const DEFAULT_HOPPER_COLOR = '#00e5ff';
export const EMPTY_HOPPER_COLOR = 'transparent';

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
    const c = squad.color || DEFAULT_HOPPER_COLOR;
    return {
      id: squad.id,
      name: squad.name || permanentIds.map(id => hById[id]?.name || id).join(' + '),
      color: c,
      primaryColor: c,
      colors: [c],
      accentColors: [],
      isSquad: true,
      isEmpty: false,
      squad
    };
  }
  const memberHoppers = permanentIds.map(id => hById[id]).filter(Boolean);
  const guestMembers = guests.map(g => ({ ...g, isGuest: true }));
  const members = [...memberHoppers, ...guestMembers];
  const colors = members.map(m => m?.color).filter(Boolean);
  const name = members.length ? members.map(m => m.name || m.label || 'Guest').join(' + ') : 'No hoppers selected';
  const primary = memberHoppers[0]?.color || colors[0] || EMPTY_HOPPER_COLOR;
  return {
    id: permanentIds.length === 1 && guests.length === 0 ? permanentIds[0] : `combo-${idsKey([...permanentIds, ...guests.map(g => g.id || g.name)])}`,
    name,
    color: primary,
    primaryColor: primary,
    colors,
    accentColors: colors.slice(1),
    isSquad: false,
    isEmpty: members.length === 0,
    members,
    guests: guestMembers
  };
}

export function multiMemberCircleBackground(colors = [], fallback = '#5d7288') {
  const list = (colors || []).filter(Boolean);
  const base = list[0] || fallback;
  if (list.length <= 1) return base;

  const layers = [];
  // Match Hop Preview logic:
  // primary/base owns the left side; additional members are placed clockwise:
  // guest/member 1 top-right, guest/member 2 bottom-right, guest/member 3 bottom-left.
  if (list[1]) layers.push(`linear-gradient(${list[1]}, ${list[1]}) top right / 50% 50% no-repeat`);
  if (list[2]) layers.push(`linear-gradient(${list[2]}, ${list[2]}) bottom right / 50% 50% no-repeat`);
  if (list[3]) layers.push(`linear-gradient(${list[3]}, ${list[3]}) bottom left / 50% 50% no-repeat`);
  layers.push(base);
  return layers.join(', ');
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
