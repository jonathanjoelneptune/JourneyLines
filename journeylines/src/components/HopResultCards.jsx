import React from 'react';

export default function HopResultCards({ rows = [], onSelect = () => {}, className = '', emptyMessage = 'No matching Hops.' }) {
  if (!rows.length) return <div className="hop-result-cards__empty">{emptyMessage}</div>;
  return <div className={`hop-result-cards ${className}`.trim()}>
    {rows.map((row, index) => <button
      key={row.id || `${row.title || 'hop'}-${index}`}
      type="button"
      className="destination-trip-queue__card hop-result-card"
      style={{
        '--queue-color': row.color || '#00e5ff',
        '--queue-border': row.borderGradient || row.color || '#00e5ff',
        '--queue-marker': row.markerBackground || row.color || '#00e5ff',
        '--queue-index': index
      }}
      onClick={() => onSelect(row)}
    >
      <span className="destination-trip-queue__ball" aria-hidden="true"></span>
      <span className="destination-trip-queue__content">
        <span className="hop-result-card__identity">
          <strong>{row.title || 'Hop'}</strong>
          {row.traveler && <em>{row.traveler}</em>}
        </span>
        <span className="hop-result-card__details">
          <span className="destination-trip-queue__route">{row.route || ''}</span>
          <span className="destination-trip-queue__date">{row.date || row.year || ''}</span>
        </span>
      </span>
    </button>)}
  </div>;
}
