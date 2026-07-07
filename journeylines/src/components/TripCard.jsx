import { displayDate } from '../utils/dateUtils.js';
import { routeMiles } from '../utils/distanceUtils.js';

export default function TripCard({ trip, expanded, traveler, isPlaying, rows = [] }) {
  if (!trip || !expanded || !isPlaying) return null;
  const miles = Math.round(routeMiles(expanded.route));
  const mode = trip.mode === 'mixed' ? 'Mixed route' : capitalize(trip.mode || 'plane');
  const returnText = trip.roundTrip ? 'Round trip' : expanded.route.length > 2 ? 'Multi-stop' : 'One way';
  const activeRow = rows[0];
  const stack = rows.length ? rows : [{ title: trip.label, date: displayDate(trip), mode, traveler: traveler?.name || 'Travel', color: traveler?.color || '#00e5ff' }];
  return <aside className="trip-card-stack" style={{ '--accent': traveler?.color || '#00e5ff' }}>
    {stack.map((row, index) => <article key={`${row.id || row.title}-${index}`} className={`trip-card trip-card--stack-${index}`} style={{ '--accent': row.color || traveler?.color || '#00e5ff' }}>
      <div className="trip-card__eyebrow">{index === 0 ? displayDate(trip) : (String(row.year || row.date || '').match(/\d{4}/)?.[0] || row.date)}</div>
      <h2>{index === 0 ? trip.label : row.title}</h2>
      {index === 0 ? <>
        <p>{mode} · {returnText} · {miles.toLocaleString()} miles</p>
        <p className="trip-card__traveler">{traveler?.name || 'Travel'}</p>
        <p className="trip-card__stats">Trip {activeRow?.totalIndex || '—'} of {activeRow?.totalTrips || '—'} · {activeRow?.year ? `Trip ${activeRow.tripOfYear || '—'} of ${activeRow.year}` : ''}{activeRow?.visitCount ? ` · ${ordinal(activeRow.visitCount)} visit to ${activeRow.visitDestination || trip.label}` : ''}</p>
        {trip.notes && <p className="trip-card__notes">{trip.notes}</p>}
      </> : <>
        <p className="trip-card__queued-date">{String(row.year || row.date || '').match(/\d{4}/)?.[0] || row.date}</p>
      </>}
    </article>)}
  </aside>;
}
function capitalize(s) { return String(s).charAt(0).toUpperCase() + String(s).slice(1); }
function ordinal(n) { const v = Number(n) || 0; const mod100 = v % 100; if (mod100 >= 11 && mod100 <= 13) return `${v}th`; switch (v % 10) { case 1: return `${v}st`; case 2: return `${v}nd`; case 3: return `${v}rd`; default: return `${v}th`; } }
