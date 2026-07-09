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

function uniqueColors(colors = []) {
  return [...new Set((colors || []).filter(Boolean))];
}

function squadMemberColors(squad, hById) {
  return uniqueColors((squad?.hopperIds || []).map(id => hById[id]?.color).filter(Boolean));
}

export function segmentedCircleBackground(colors = [], fallback = '#5d7288', glossy = false) {
  const list = uniqueColors(colors);
  const base = list[0] || fallback;
  const fill = list.length <= 1
    ? base
    : `conic-gradient(from -90deg, ${list.map((color, index) => {
        const start = (index / list.length) * 360;
        const end = ((index + 1) / list.length) * 360;
        return `${color} ${start}deg ${end}deg`;
      }).join(', ')})`;
  if (!glossy) return fill;
  return [
    'radial-gradient(circle at 34% 26%, rgba(255,255,255,.62), rgba(255,255,255,.26) 17%, transparent 40%)',
    'linear-gradient(180deg, rgba(255,255,255,.22), rgba(255,255,255,0) 44%, rgba(0,0,0,.1) 100%)',
    fill
  ].join(', ');
}

export function multiMemberCircleBackground(colors = [], fallback = '#5d7288') {
  return segmentedCircleBackground(colors, fallback, false);
}

export function resolveTripVisual(trip = {}, hopperData = {}) {
  const { hoppers, hopSquads } = normalizeHopperData(hopperData);
  const hById = Object.fromEntries(hoppers.map(h => [h.id, h]));
  const permanentIds = Array.isArray(trip.travelers) ? trip.travelers : [];
  const guests = Array.isArray(trip.guestHoppers) ? trip.guestHoppers : [];
  const squad = exactSquadForIds(permanentIds, hopSquads);

  const memberHoppers = permanentIds.map(id => hById[id]).filter(Boolean);
  const guestMembers = guests.map(g => ({ ...g, isGuest: true }));
  const members = [...memberHoppers, ...guestMembers];
  const memberColors = uniqueColors(members.map(m => m?.color).filter(Boolean));
  const squadColors = squadMemberColors(squad, hById);
  const circleColors = squad && guests.length === 0 ? (squadColors.length ? squadColors : memberColors) : memberColors;

  if (squad && guests.length === 0) {
    const c = squad.color || DEFAULT_HOPPER_COLOR;
    return {
      id: squad.id,
      name: squad.name || permanentIds.map(id => hById[id]?.name || id).join(' + '),
      color: c,
      primaryColor: c,
      colors: [c],
      memberColors,
      circleColors: circleColors.length ? circleColors : [c],
      accentColors: [],
      isSquad: true,
      isEmpty: false,
      squad,
      members
    };
  }

  const colors = memberColors;
  const name = members.length ? members.map(m => m.name || m.label || 'Guest').join(' + ') : 'No hoppers selected';
  const primary = memberHoppers[0]?.color || colors[0] || EMPTY_HOPPER_COLOR;
  return {
    id: permanentIds.length === 1 && guests.length === 0 ? permanentIds[0] : `combo-${idsKey([...permanentIds, ...guests.map(g => g.id || g.name)])}`,
    name,
    color: primary,
    primaryColor: primary,
    colors,
    memberColors: colors,
    circleColors: colors,
    accentColors: colors.slice(1),
    isSquad: false,
    isEmpty: members.length === 0,
    members,
    guests: guestMembers,
    squad: null
  };
}

export function resolveTrailVisual(trip = {}, hopperData = {}) {
  const visual = resolveTripVisual(trip, hopperData);
  const memberColors = uniqueColors(visual.circleColors || visual.memberColors || visual.colors || [visual.color]);
  const hasMultiplePeople = memberColors.length > 1;
  const requestedMode = trip?.trailColorMode || (visual.isSquad && hasMultiplePeople ? 'squad' : 'members');
  let style = (trip?.trailStyle || 'solid').toLowerCase();
  let colorMode = requestedMode;

  if (!hasMultiplePeople) {
    style = 'solid';
    colorMode = 'members';
  }

  if (colorMode === 'squad') {
    style = 'solid';
    return {
      style,
      colorMode,
      colors: [visual.color || DEFAULT_HOPPER_COLOR],
      baseColor: visual.color || DEFAULT_HOPPER_COLOR,
      circleColors: memberColors.length ? memberColors : [visual.color || DEFAULT_HOPPER_COLOR],
      visual
    };
  }

  const trailColors = memberColors.length ? memberColors : [visual.color || DEFAULT_HOPPER_COLOR];
  if (!['solid', 'stripe', 'ribbon'].includes(style)) style = 'solid';
  return {
    style,
    colorMode,
    colors: style === 'solid' ? [trailColors[0]] : trailColors,
    baseColor: trailColors[0] || visual.color || DEFAULT_HOPPER_COLOR,
    circleColors: trailColors,
    visual
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
