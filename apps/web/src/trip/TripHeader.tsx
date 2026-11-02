import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatDuration, type Trip } from '@journey/shared';
import { api } from '../api/client';
import { useDeleteTrip, useRenameTrip } from '../api/hooks';
import { formatDate } from '../lib/time';

export function TripHeader({ trip, onOpenSettings }: { trip: Trip; onOpenSettings: () => void }) {
  const rename = useRenameTrip(trip.id);
  const remove = useDeleteTrip();
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(trip.name);
  const s = trip.summary;
  const last = trip.days[trip.days.length - 1];

  const saveName = () => {
    setEditing(false);
    const trimmed = name.trim();
    if (trimmed && trimmed !== trip.name) rename.mutate(trimmed);
    else setName(trip.name);
  };

  return (
    <header className="trip-header">
      <div className="trip-header__main">
        {editing ? (
          <input
            className="input input--title"
            value={name}
            autoFocus
            maxLength={120}
            onChange={(e) => setName(e.target.value)}
            onBlur={saveName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveName();
              if (e.key === 'Escape') {
                setName(trip.name);
                setEditing(false);
              }
            }}
            aria-label="Trip name"
          />
        ) : (
          <h1>
            <button type="button" className="title-button" onClick={() => setEditing(true)} title="Rename trip">
              {trip.name} <span aria-hidden>✎</span>
            </button>
          </h1>
        )}
        <p className="trip-header__route">
          {trip.request.origin.name} → {trip.request.destination.name}
        </p>
        <p className="muted">
          {formatDate(trip.request.departureDate)}
          {last && last.date !== trip.request.departureDate && ` – ${formatDate(last.date)}`}
        </p>
        <ul className="stat-pills">
          <li>
            🗓️ {s.days} day{s.days === 1 ? '' : 's'}
          </li>
          <li title={`Driving straight through would take ${formatDuration(s.directDriveSeconds)}`}>
            🚗 {formatDuration(s.totalDriveSeconds)} driving <span className="muted">({formatDuration(s.directDriveSeconds)} direct)</span>
          </li>
          <li>🎯 {s.activityCount} activities</li>
          <li>🍽️ {s.mealCount} meals</li>
          {trip.dataSource === 'demo' && <li className="pill--demo">Demo data</li>}
        </ul>
      </div>
      <div className="trip-header__actions">
        <button type="button" className="button" onClick={onOpenSettings}>
          ⚙️ Trip settings
        </button>
        <a className="button" href={api.calendarUrl(trip.id)} download>
          📅 Add to calendar
        </a>
        <button type="button" className="button button--ghost" onClick={() => window.print()}>
          🖨️ Print
        </button>
        <button
          type="button"
          className="button button--ghost button--danger"
          onClick={() => {
            if (confirm(`Delete "${trip.name}"? This can't be undone.`)) {
              remove.mutate(trip.id, { onSuccess: () => navigate('/') });
            }
          }}
        >
          Delete
        </button>
      </div>
    </header>
  );
}
