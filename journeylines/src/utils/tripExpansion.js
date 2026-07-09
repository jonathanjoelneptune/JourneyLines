import { milesBetween } from './distanceUtils.js';

export function activeHomeBase(homeBases, trip) {
  const key = `${trip.year}-${String(trip.month || 1).padStart(2, '0')}`;
  return homeBases.find(h => h.start <= key && (!h.end || h.end >= key)) || homeBases[0];
}

export function getTravelerKey(trip, hopSquads = []) {
  const ids = [...new Set(trip.travelers || [])].filter(Boolean);
  const key = ids.slice().sort().join('|');
  const squad = hopSquads.find(s => [...new Set(s.hopperIds || [])].filter(Boolean).sort().join('|') === key);
  if (squad) return squad.id;
  if (ids.includes('joey') && ids.includes('bonnie')) return 'both';
  if (ids.length === 1) return ids[0];
  if (ids.includes('bonnie')) return 'bonnie';
  if (ids.includes('joey')) return 'joey';
  return ids[0] || 'joey';
}

export function expandTrip(trip, locationsById, homeBases) {
  let route = [];
  if (trip.route?.length) {
    route = trip.route.map((r, idx) => ({ ...locationsById[r.locationId], modeFromPrevious: idx === 0 ? null : r.modeFromPrevious || trip.mode }));
  } else {
    const home = locationsById[trip.fromLocationId || activeHomeBase(homeBases, trip)?.locationId];
    const to = locationsById[trip.toLocationId];
    route = [home, { ...to, modeFromPrevious: trip.mode }];
    if (trip.roundTrip) route.push({ ...home, modeFromPrevious: trip.returnMode || trip.mode });
  }
  const legs = route.slice(1).map((to, idx) => {
    const from = route[idx];
    return { from, to, mode: to.modeFromPrevious || trip.mode || 'plane', miles: milesBetween(from, to) };
  });
  return { ...trip, route, legs };
}


export function buildHomeMoveTrips(homeBases, locationsById) {
  return [...homeBases]
    .sort((a, b) => String(a.start).localeCompare(String(b.start)))
    .slice(1)
    .map((home, index, arr) => {
      const sorted = [...homeBases].sort((a, b) => String(a.start).localeCompare(String(b.start)));
      const prev = sorted[index];
      const from = locationsById[prev.locationId];
      const to = locationsById[home.locationId];
      const [year, month] = String(home.start || '').split('-').map(Number);
      return {
        id: `home-move-${home.locationId}-${home.start}`,
        year: year || 2000,
        month: month || null,
        day: null,
        displayDate: formatHomeMoveDate(home.start),
        sortKey: `${home.start || year}-000-home-move`,
        label: `Moved to ${to?.name || home.name}`,
        travelers: ['joey', 'bonnie'],
        mode: 'move',
        roundTrip: false,
        isHomeMove: true,
        route: [
          { locationId: from?.id || prev.locationId, modeFromPrevious: null },
          { locationId: to?.id || home.locationId, modeFromPrevious: 'move' }
        ],
        notes: 'New home base',
        occasion: ''
      };
    });
}

function formatHomeMoveDate(value) {
  const [year, month] = String(value || '').split('-').map(Number);
  if (!year) return 'Move';
  if (!month) return String(year);
  return new Date(year, month - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

export function flattenLegs(trips, locationsById, homeBases) {
  // Home bases are context only. They define the auto-derived start/return
  // location for Hops, but they should not create playable timeline cards or
  // playback entries.
  const entries = (trips || []).flatMap(trip =>
    expandTrip(trip, locationsById, homeBases).legs.map((leg, legIndex) => ({ trip, leg, legIndex }))
  );
  return applyRouteStackOffsets(entries);
}

function applyRouteStackOffsets(entries = []) {
  const groups = new Map();
  for (const entry of entries) {
    const key = routeStackKey(entry?.leg);
    if (!key) continue;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  for (const rows of groups.values()) {
    if (rows.length <= 1) continue;
    const spacing = 3.1;
    rows.forEach((entry, index) => {
      const offset = (index - (rows.length - 1) / 2) * spacing;
      entry.leg = { ...entry.leg, routeStackOffset: offset, routeStackCount: rows.length, routeStackIndex: index };
    });
  }
  return entries;
}

function routeStackKey(leg) {
  const from = leg?.from?.id || leg?.from?.name;
  const to = leg?.to?.id || leg?.to?.name;
  return from && to ? `${from}→${to}` : '';
}

function timelineDateValue(item, isHomeMove = false) {
  const year = Number(item?.year) || 9999;
  const month = Number(item?.month) || (isHomeMove ? 1 : 13);
  const day = Number(item?.day) || (isHomeMove ? 0 : 99);
  return year * 10000 + month * 100 + day;
}
