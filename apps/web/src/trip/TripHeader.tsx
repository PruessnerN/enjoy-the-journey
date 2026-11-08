import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatDuration, routeLabel, type Trip } from '@journey/shared';
import { api } from '../api/client';
import { useDeleteTrip, useRenameTrip } from '../api/hooks';
import { formatDate } from '../lib/time';
import { Icon } from '../components/Icon';

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
              {trip.name} <Icon name="edit" size={18} />
            </button>
          </h1>
        )}
        <p className="trip-header__route">
          {routeLabel(trip.request, 6)}
        </p>
        <p className="muted">
          {formatDate(trip.request.departureDate)}
          {last && last.date !== trip.request.departureDate && ` – ${formatDate(last.date)}`}
        </p>
        <ul className="stat-pills">
          <li>
            <small>Days</small> {s.days}
          </li>
          <li title={`Driving straight through would take ${formatDuration(s.directDriveSeconds)}`}>
            <small>Driving</small> {formatDuration(s.totalDriveSeconds)} <span className="muted">/ {formatDuration(s.directDriveSeconds)} direct</span>
          </li>
          <li>
            <small>Activities</small> {s.activityCount}
          </li>
          <li>
            <small>Meals</small> {s.mealCount}
          </li>
          {trip.dataSource === 'demo' && <li className="pill--demo">Demo data</li>}
        </ul>
      </div>
      <div className="trip-header__actions">
        <button type="button" className="button" onClick={onOpenSettings}>
          <Icon name="settings" /> Trip settings
        </button>
        <a className="button" href={api.calendarUrl(trip.id)} download>
          <Icon name="calendar" /> Add to calendar
        </a>
        <button type="button" className="button button--ghost" onClick={() => window.print()}>
          <Icon name="print" /> Print
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
