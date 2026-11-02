import { Fragment, useState } from 'react';
import { formatDistance, formatDuration, type Stop, type StopInput, type Trip, type TripDay } from '@journey/shared';
import { useRegenerateDay, useUpdateDay } from '../api/hooks';
import { ErrorNote, IssueList, Spinner } from '../components/ui';
import { applyDayEdit, toStopInput, type DayEdit } from '../lib/dayEdits';
import { clocksDiffer, formatDate, formatTime, zoneAbbreviation } from '../lib/time';
import { AddStopModal } from './AddStopModal';
import { EditStopModal } from './EditStopModal';
import { DriveSegment, StopCard } from './StopCard';
import { STOP_ICONS, dayStartIconKind } from './stopIcons';
import { SwapStopModal } from './SwapStopModal';

type ModalState = { type: 'edit'; stop: Stop } | { type: 'swap'; stop: Stop } | { type: 'add'; index: number } | null;

interface DayTimelineProps {
  trip: Trip;
  day: TripDay;
  focusedStopId: string | null;
  onFocusStop: (id: string | null) => void;
}

export function DayTimeline({ trip, day, focusedStopId, onFocusStop }: DayTimelineProps) {
  const update = useUpdateDay(trip.id);
  const regenerate = useRegenerateDay(trip.id);
  const [modal, setModal] = useState<ModalState>(null);
  const busy = update.isPending || regenerate.isPending;
  const end = day.stops[day.stops.length - 1]!;
  const zoneNote = clocksDiffer(day.arrival, end.timeZone, day.timeZone) ? ` ${zoneAbbreviation(day.arrival, end.timeZone)}` : '';

  const commit = (stops: StopInput[], startTime?: string) => {
    // Close any dialog right away: it would otherwise cover the timeline's progress indicator
    // (dialogs render above the page). Errors show in the day header.
    setModal(null);
    update.mutate({ index: day.index, update: { stops, ...(startTime ? { startTime } : {}) } });
  };
  const edit = (e: DayEdit) => commit(applyDayEdit(day, e));

  return (
    <section className="day" aria-busy={busy}>
      <header className="day__header card">
        <div className="day__title">
          <span className="day__badge">Day {day.index + 1}</span>
          <h2>{formatDate(day.date, { weekday: 'long', month: 'long', day: 'numeric' })}</h2>
          <p>
            {day.start.name} → {end.place.name}
          </p>
        </div>
        <div className="day__stats">
          <span>🚗 {formatDuration(day.driveSeconds)}</span>
          <span>🛣️ {formatDistance(day.distanceMeters)}</span>
          <span>
            🏁 Arrive {formatTime(day.arrival, end.timeZone)}
            {zoneNote}
          </span>
          {day.sunset && (
            <span>
              🌅 Sunset {formatTime(day.sunset, end.timeZone)}
              {zoneNote}
            </span>
          )}
        </div>
        <div className="day__controls">
          <label className="inline">
            <span>Leave at</span>
            <input
              className="input input--auto"
              type="time"
              defaultValue={day.startTime}
              key={`${day.index}-${day.startTime}`}
              disabled={busy}
              onBlur={(e) => {
                if (e.target.value && e.target.value !== day.startTime) commit(day.stops.map(toStopInput), e.target.value);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              }}
            />
          </label>
          <button
            type="button"
            className="button button--small"
            disabled={busy}
            onClick={() => regenerate.mutate({ index: day.index, freshIdeas: true })}
            title="Replace unlocked stops with different ideas"
          >
            ✨ Fresh ideas
          </button>
          <button
            type="button"
            className="button button--ghost button--small"
            disabled={busy}
            onClick={() => regenerate.mutate({ index: day.index, freshIdeas: false })}
            title="Re-plan this day around your locked stops"
          >
            ↻ Re-plan day
          </button>
        </div>
        <IssueList issues={day.issues} />
        {(update.isError || regenerate.isError) && <ErrorNote error={update.error ?? regenerate.error} />}
      </header>

      <div className="timeline-wrap">
        {busy && (
          <div className="timeline-busy">
            <Spinner label={regenerate.isPending ? 'Finding new stops…' : 'Updating your timeline…'} />
          </div>
        )}
        <ol className="timeline">
          <li className="stop stop--start">
            <div className="stop__time">
              <strong>{formatTime(day.departure, day.timeZone)}</strong>
            </div>
            <div className={`stop__marker stop__marker--${dayStartIconKind(day.index)}`} aria-hidden>
              <span>{STOP_ICONS[dayStartIconKind(day.index)].emoji}</span>
            </div>
            <div className="stop__start">
              <span className="stop__eyebrow">{day.index === 0 ? 'Start your journey' : 'Good morning! Check out'}</span>
              <h3>{day.start.name}</h3>
            </div>
          </li>
          {day.stops.map((stop, i) => (
            <Fragment key={stop.id}>
              <AddStopRow disabled={busy} onClick={() => setModal({ type: 'add', index: i })} />
              <DriveSegment day={day} index={i} />
              <StopCard
                trip={trip}
                day={day}
                stop={stop}
                index={i}
                number={i + 1}
                disabled={busy}
                focused={focusedStopId === stop.id}
                onFocus={() => onFocusStop(stop.id)}
                onEdit={() => setModal({ type: 'edit', stop })}
                onSwap={() => setModal({ type: 'swap', stop })}
                onRemove={() => edit({ type: 'remove', stopId: stop.id })}
                onMove={(direction) => edit({ type: 'move', stopId: stop.id, direction })}
                onToggleLock={() => edit({ type: 'toggleLock', stopId: stop.id })}
              />
            </Fragment>
          ))}
        </ol>
      </div>

      {modal?.type === 'edit' && (
        <EditStopModal stop={modal.stop} onClose={() => setModal(null)} onSave={(stop) => edit({ type: 'replace', stopId: modal.stop.id, stop })} />
      )}
      {modal?.type === 'swap' && (
        <SwapStopModal
          trip={trip}
          day={day}
          stop={modal.stop}
          onClose={() => setModal(null)}
          onChoose={(stop) => edit({ type: 'replace', stopId: modal.stop.id, stop })}
        />
      )}
      {modal?.type === 'add' && (
        <AddStopModal
          trip={trip}
          day={day}
          index={modal.index}
          onClose={() => setModal(null)}
          onAdd={(stop) => edit({ type: 'insert', index: modal.index, stop })}
        />
      )}
    </section>
  );
}

function AddStopRow({ onClick, disabled }: { onClick: () => void; disabled: boolean }) {
  return (
    <li className="add-stop">
      <button type="button" className="add-stop__button" onClick={onClick} disabled={disabled}>
        + Add a stop here
      </button>
    </li>
  );
}
