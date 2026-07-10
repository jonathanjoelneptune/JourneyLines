export function displayDate(trip) {
  if (trip.displayDate) return trip.displayDate;
  if (trip.month && trip.day) return new Date(trip.year, trip.month - 1, trip.day).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
  if (trip.month) return new Date(trip.year, trip.month - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  return String(trip.year);
}

export function tripChronologyKey(trip = {}) {
  const year = padNumber(trip.year || 9999, 4);
  const month = padNumber(trip.month || 13, 2);
  const day = padNumber(trip.day || 99, 2);
  const endYear = padNumber(trip.endYear || trip.year || 9999, 4);
  const endMonth = padNumber(trip.endMonth || trip.month || 13, 2);
  const endDay = padNumber(trip.endDay || trip.day || 99, 2);
  const label = String(trip.label || trip.toLocationName || trip.toLocationId || '');
  const id = String(trip.id || '');
  return `${year}-${month}-${day}-${endYear}-${endMonth}-${endDay}-${label}-${id}`;
}

export function sortTrips(trips) {
  return [...(trips || [])].sort((a, b) => tripChronologyKey(a).localeCompare(tripChronologyKey(b)));
}

function padNumber(value, width) {
  const n = Number(value);
  const safe = Number.isFinite(n) ? n : Number(String(value).replace(/\D/g, '')) || 0;
  return String(safe).padStart(width, '0');
}
