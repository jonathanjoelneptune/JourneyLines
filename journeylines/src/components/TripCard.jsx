import { displayDate } from '../utils/dateUtils.js';
import { routeMiles } from '../utils/distanceUtils.js';
import { segmentedBorderGradient } from '../utils/hopperUtils.js';

export default function TripCard({ trip, expanded, traveler, isPlaying, rows = [], onJumpToTrip, onOpenTrips }) {
  if (!trip || !expanded || !isPlaying) return null;
  const miles = Math.round(routeMiles(expanded.route));
  const mode = trip.mode === 'mixed' ? 'Mixed route' : capitalize(trip.mode || 'plane');
  const returnText = trip.roundTrip ? 'Round trip' : expanded.route.length > 2 ? 'Multi-stop' : 'One way';
  const activeRow = rows[0];
  const stack = rows.length ? rows : [{ title: trip.label, date: displayDate(trip), mode, traveler: traveler?.name || 'Travel', color: traveler?.color || '#00e5ff' }];
  const accentColor = traveler?.color || '#00e5ff';
  const borderColors = (traveler?.squadMemberColors || traveler?.circleColors || traveler?.memberColors || traveler?.colors || [accentColor]).filter(Boolean);
  const accent2 = borderColors.length > 1 ? borderColors[1] : accentColor;
  const isMixedTraveler = borderColors.length > 1;
  return <aside className={`trip-card-stack ${isMixedTraveler ? 'is-mixed' : ''}`} style={{ '--accent': accentColor, '--accent-2': accent2, '--trip-border': segmentedBorderGradient(borderColors, accentColor) }}>
    {stack.map((row, index) => {
      const queued = index > 0;
      const CardTag = queued ? 'button' : 'article';
      return <CardTag
        key={`${row.id || row.title}-${index}`}
        type={queued ? 'button' : undefined}
        className={`trip-card trip-card--stack-${index} ${queued ? 'trip-card--queued-clickable' : ''}`}
        style={{
          '--accent': row.color || traveler?.color || '#00e5ff',
          '--accent-2': (row.borderColors?.[1] || row.color || traveler?.color || '#00e5ff'),
          '--trip-border': row.borderGradient || segmentedBorderGradient((row.borderColors || [row.color || traveler?.color || '#00e5ff']).filter(Boolean), row.color || traveler?.color || '#00e5ff')
        }}
        onClick={queued ? () => onJumpToTrip?.(row.firstIndex) : undefined}
        title={queued ? `Jump to ${row.title}` : undefined}
      >
        <div className="trip-card__eyebrow">{index === 0 ? displayDate(trip) : (String(row.year || row.date || '').match(/\d{4}/)?.[0] || row.date)}</div>
        <h2>{index === 0 ? trip.label : row.title}</h2>
        {index === 0 ? <>
          <p>{mode} · {returnText} · {miles.toLocaleString()} miles</p>
          <p className="trip-card__traveler"><TravelerName traveler={traveler} /></p>
          <p className="trip-card__stats">Trip {activeRow?.totalIndex || '—'} of {activeRow?.totalTrips || '—'} · {activeRow?.year ? `Trip ${activeRow.tripOfYear || '—'} of ${activeRow.year}` : ''}{activeRow?.visitCount ? ` · ${ordinal(activeRow.visitCount)} visit to ${activeRow.visitDestination || trip.label}` : ''}</p>
          {trip.notes && <p className="trip-card__notes">{trip.notes}</p>}
        </> : <>
          <p className="trip-card__queued-date">{String(row.year || row.date || '').match(/\d{4}/)?.[0] || row.date}</p>
        </>}
      </CardTag>;
    })}
    <button type="button" className="trip-card-stack__timeline-link" onClick={onOpenTrips} title="Open Travel Timeline">←</button>
  </aside>;
}
function capitalize(s) { return String(s).charAt(0).toUpperCase() + String(s).slice(1); }
function ordinal(n) { const v = Number(n) || 0; const mod100 = v % 100; if (mod100 >= 11 && mod100 <= 13) return `${v}th`; switch (v % 10) { case 1: return `${v}st`; case 2: return `${v}nd`; case 3: return `${v}rd`; default: return `${v}th`; } }


function TravelerName({ traveler }) {
  if (!traveler) return <>Travel</>;
  const members = Array.isArray(traveler.members) ? traveler.members.filter(Boolean) : [];
  if (!traveler.isSquad && members.length > 1) {
    return <>{members.map((m, index) => <span key={`${m.id || m.name || index}`} className="trip-card__traveler-name" style={{ color: m.color || traveler.color }}>
      {index > 0 ? ' + ' : ''}{m.name || m.label || 'Guest'}
    </span>)}</>;
  }
  return <span style={{ color: traveler.color }}>{traveler.name || 'Travel'}</span>;
}
