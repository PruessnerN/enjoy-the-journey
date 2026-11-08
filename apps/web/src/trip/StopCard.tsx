import { formatDistance, formatDuration, formatMinutes, type Stop, type Trip, type TripDay } from '@journey/shared';
import { STOP_ICONS, stopIconKind } from './stopIcons';
import { clocksDiffer, formatClock, formatTime, zoneAbbreviation } from '../lib/time';
import { Icon } from '../components/Icon';
import { IssueList, Rating } from '../components/ui';

export const KIND_LABEL: Record<Stop['kind'], string> = {
  activity: 'Activity',
  meal: 'Meal',
  lodging: 'Overnight',
  destination: 'Destination',
  custom: 'Your stop',
  event: 'Main event',
};

interface StopCardProps {
  trip: Trip;
  day: TripDay;
  stop: Stop;
  index: number;
  number: number;
  disabled: boolean;
  focused: boolean;
  onFocus: () => void;
  onEdit: () => void;
  onSwap: () => void;
  onRemove: () => void;
  onMove: (direction: -1 | 1) => void;
  onToggleLock: () => void;
}

export function StopCard({ trip, day, stop, index, number, disabled, focused, onFocus, onEdit, onSwap, onRemove, onMove, onToggleLock }: StopCardProps) {
  const isEnd = stop.kind === 'lodging' || stop.kind === 'destination';
  const lastMovable = day.stops.length - 2;
  const showZone = clocksDiffer(stop.arrival, stop.timeZone, day.timeZone);
  const label = stop.activityLabel ?? KIND_LABEL[stop.kind];
  const isEvent = stop.kind === 'event';
  const lodgingLabel = day.stay ? `Back at your stay · ${label}` : `Check in · ${label}`;
  const iconKind = stopIconKind(stop);

  return (
    <li id={`stop-${stop.id}`} className={`stop stop--${stop.kind}${focused ? ' is-focused' : ''}`}>
      <div className="stop__time">
        <strong>{formatTime(isEnd ? stop.arrival : stop.start, stop.timeZone)}</strong>
        {!isEnd && stop.durationMinutes > 0 && <span>until {formatTime(stop.departure, stop.timeZone)}</span>}
        {showZone && <span className="stop__zone">{zoneAbbreviation(stop.arrival, stop.timeZone)}</span>}
      </div>
      <div className={`stop__marker stop__marker--${iconKind}`} aria-hidden title={STOP_ICONS[iconKind].label}>
        <span>{STOP_ICONS[iconKind].emoji}</span>
        <small>{number}</small>
      </div>
      <article className="stop__card card" onClick={onFocus}>
        <header className="stop__head">
          <div className="stop__title">
            <span className="stop__eyebrow">
              {stop.kind === 'lodging' ? lodgingLabel : label}
              {!isEnd && !isEvent && ` · ${formatMinutes(stop.durationMinutes)}`}
              {stop.pinnedStart && ' · Fixed time'}
              {stop.arriveBy && ` · Arrive by ${formatClock(stop.arriveBy)}`}
              {stop.locked && !isEvent && (
                <span className="lock-badge" title="Locked: kept when you regenerate this day">
                  <Icon name="lock" size={12} /> Locked
                </span>
              )}
            </span>
            <h3>
              {stop.place.googleMapsUri ? (
                <a href={stop.place.googleMapsUri} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>
                  {stop.place.name}
                </a>
              ) : (
                stop.place.name
              )}
            </h3>
            <div className="stop__meta">
              <Rating place={stop.place} />
              {stop.place.primaryTypeLabel && <span>{stop.place.primaryTypeLabel}</span>}
              {stop.place.address && stop.place.address !== stop.place.name && <span className="stop__address">{stop.place.address}</span>}
            </div>
          </div>
          {isEvent && <span className="muted stop__managed">Change in Trip settings</span>}
          {stop.kind !== 'destination' && !isEvent && (
            <div className="stop__actions" onClick={(e) => e.stopPropagation()}>
              <button type="button" className="button button--small" onClick={onSwap} disabled={disabled} title="See alternatives nearby">
                <Icon name="swap" /> Swap
              </button>
              {!isEnd && (
                <>
                  <button type="button" className="icon-button" onClick={onEdit} disabled={disabled} aria-label="Edit stop" title="Edit time, duration & notes">
                    <Icon name="edit" />
                  </button>
                  <button type="button" className="icon-button" onClick={() => onMove(-1)} disabled={disabled || index === 0} aria-label="Move earlier" title="Move earlier">
                    <Icon name="up" />
                  </button>
                  <button type="button" className="icon-button" onClick={() => onMove(1)} disabled={disabled || index >= lastMovable} aria-label="Move later" title="Move later">
                    <Icon name="down" />
                  </button>
                  <button
                    type="button"
                    className={`icon-button${stop.locked ? ' is-active' : ''}`}
                    onClick={onToggleLock}
                    disabled={disabled}
                    aria-pressed={stop.locked}
                    aria-label={stop.locked ? 'Unlock stop' : 'Lock stop'}
                    title={stop.locked ? 'Unlock (may be replaced when regenerating)' : 'Lock (keep when regenerating)'}
                  >
                    <Icon name={stop.locked ? 'lock' : 'unlock'} />
                  </button>
                  <button type="button" className="icon-button icon-button--danger" onClick={onRemove} disabled={disabled} aria-label="Remove stop" title="Remove">
                    <Icon name="trash" />
                  </button>
                </>
              )}
            </div>
          )}
        </header>
        {stop.notes && <p className="stop__notes">{stop.notes}</p>}
        {(stop.links?.length || stop.place.websiteUri) && (
          <div className="stop__links" onClick={(e) => e.stopPropagation()}>
            {(stop.links ?? (stop.place.websiteUri ? [{ label: 'Website', url: stop.place.websiteUri }] : [])).map((l) => (
              <a key={l.url} href={l.url} target="_blank" rel="noreferrer" className="link-pill">
                {l.label} <Icon name="external" size={12} />
              </a>
            ))}
          </div>
        )}
        <IssueList issues={stop.issues} compact />
      </article>
    </li>
  );
}

export function DriveSegment({ day, index }: { day: TripDay; index: number }) {
  const leg = day.legs[index];
  const stop = day.stops[index];
  if (!leg || !stop) return null;
  return (
    <li className="drive" aria-label="Drive">
      <div className="drive__line" aria-hidden />
      <div className="drive__info">
        <span>
          Drive {formatDuration(leg.durationSeconds)} · {formatDistance(leg.distanceMeters)}
          {leg.breakMinutes > 0 && <span className="muted"> · includes {leg.breakMinutes} min of breaks</span>}
          {leg.estimated && <span className="muted"> · estimated</span>}
        </span>
        {stop.waitMinutes >= 10 && <span className="drive__wait">{formatMinutes(stop.waitMinutes)} of free time before the next stop</span>}
      </div>
    </li>
  );
}
