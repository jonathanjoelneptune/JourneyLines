const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
];

const MODE_TO_APP = {
  flight: 'plane',
  drive: 'car',
  train: 'train',
  boat: 'boat',
  walk: 'walk',
  other: 'other'
};

function parseDate(value) {
  if (!value) return { year: null, month: null, day: null };
  const [year, month, day] = String(value).split('-').map(Number);
  return {
    year: Number.isFinite(year) ? year : null,
    month: Number.isFinite(month) ? month : null,
    day: Number.isFinite(day) ? day : null
  };
}

function displayDate(parts) {
  if (!parts?.year) return '';
  if (!parts?.month) return String(parts.year);
  const month = MONTH_NAMES[parts.month - 1] || '';
  return parts.day ? `${month} ${parts.day}, ${parts.year}` : `${month} ${parts.year}`;
}

function sortKeyFor(trip) {
  if (trip?.sort_order != null) return `${String(Number(trip.sort_order) || 0).padStart(8, '0')}-${trip.id}`;
  return `99999999-${trip.id}`;
}

function normalizeLocation(row) {
  return {
    id: row.id,
    name: row.name,
    region: row.region || '',
    country: row.country || '',
    continent: row.continent || '',
    lat: Number(row.latitude),
    lon: Number(row.longitude)
  };
}

function normalizeHopper(row) {
  return {
    id: row.id,
    name: row.name,
    colorName: 'custom',
    color: row.color || '#2f80ff',
    avatarUrl: row.avatar_url || null,
    sortOrder: Number(row.sort_order) || 0,
    isActive: row.is_active !== false
  };
}

function normalizeTrip(trip, legs, hopperIds) {
  const start = parseDate(trip.start_date);
  const end = parseDate(trip.end_date);
  const orderedLegs = [...legs].sort((a, b) => Number(a.leg_order) - Number(b.leg_order));
  const route = [];

  orderedLegs.forEach((leg, index) => {
    if (index === 0 && leg.from_location_id) {
      route.push({
        pointId: `point-${trip.id}-0`,
        locationId: leg.from_location_id,
        modeFromPrevious: null
      });
    }
    route.push({
      pointId: `point-${leg.id}`,
      legId: leg.id,
      locationId: leg.to_location_id,
      modeFromPrevious: MODE_TO_APP[leg.transport_mode] || leg.transport_mode || 'plane',
      routeGeometry: leg.route_geometry || null,
      routeProvider: leg.route_provider || null,
      routeVersion: leg.route_version || null
    });
  });

  const fallbackTitle = orderedLegs.length
    ? `Trip to ${orderedLegs[orderedLegs.length - 1].to_location_id}`
    : 'Untitled Hop';

  return {
    id: trip.id,
    routeModelVersion: 2,
    year: start.year,
    month: start.month,
    day: start.day,
    endYear: end.year,
    endMonth: end.month,
    endDay: end.day,
    displayDate: displayDate(start),
    displayEndDate: displayDate(end),
    sortOrder: Number(trip.sort_order) || 0,
    sortKey: sortKeyFor(trip),
    label: trip.title || fallbackTitle,
    title: trip.title || fallbackTitle,
    travelers: hopperIds,
    guestHoppers: [],
    mode: route[1]?.modeFromPrevious || 'plane',
    roundTrip: false,
    returnMode: null,
    fromLocationId: route[0]?.locationId || null,
    toLocationId: route[route.length - 1]?.locationId || null,
    route,
    notes: trip.notes || '',
    occasion: trip.occasion || '',
    trailStyle: trip.trail_style || 'solid',
    trailColorMode: trip.trail_color_mode || 'members',
    routeReview: null,
    databaseUpdatedAt: trip.updated_at || null
  };
}

export function supabaseRowsToTravelMap({ map, hoppers = [], locations = [], trips = [], legs = [], tripHoppers = [] }) {
  const legsByTrip = new Map();
  for (const leg of legs) {
    if (!legsByTrip.has(leg.trip_id)) legsByTrip.set(leg.trip_id, []);
    legsByTrip.get(leg.trip_id).push(leg);
  }

  const hopperIdsByTrip = new Map();
  for (const link of tripHoppers) {
    if (!hopperIdsByTrip.has(link.trip_id)) hopperIdsByTrip.set(link.trip_id, []);
    hopperIdsByTrip.get(link.trip_id).push(link.hopper_id);
  }

  const normalizedHoppers = hoppers
    .map(normalizeHopper)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));

  return {
    map: { ...map, timelineOrderRevision: Number(map?.timeline_order_revision) || 0 },
    trips: trips
      .map(trip => normalizeTrip(trip, legsByTrip.get(trip.id) || [], hopperIdsByTrip.get(trip.id) || []))
      .sort((a, b) => String(a.sortKey).localeCompare(String(b.sortKey))),
    locations: locations.map(normalizeLocation),
    hopperData: {
      hoppers: normalizedHoppers,
      hopSquads: [],
      palette: []
    }
  };
}
