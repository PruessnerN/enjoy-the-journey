import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  MEALS,
  MEAL_ORDER,
  formatMinutes,
  type LatLng,
  type MealType,
  type PlaceCandidate,
  type PlaceInfo,
  type StopInput,
  type Trip,
  type TripDay,
} from '@journey/shared';
import { api } from '../api/client';
import { Modal } from '../components/Modal';
import { PlaceAutocomplete } from '../components/PlaceAutocomplete';
import { ErrorNote, Rating, Spinner } from '../components/ui';
import { CandidateList } from './CandidateList';

interface AddStopModalProps {
  trip: Trip;
  day: TripDay;
  /** Insert position in the day's stop list. */
  index: number;
  onAdd: (stop: StopInput) => void;
  onClose: () => void;
}

type Purpose =
  | { type: 'activity'; id: string; label: string; emoji?: string; outdoor: boolean; query: string; duration: number }
  | { type: 'meal'; meal: MealType }
  | { type: 'custom' };

/** Add a stop: search near this point in the day, or look up a specific place by name/address. */
export function AddStopModal({ trip, day, index, onAdd, onClose }: AddStopModalProps) {
  const near: LatLng = index === 0 ? day.start.location : day.stops[index - 1]!.place.location;
  const [tab, setTab] = useState<'search' | 'specific'>('search');
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const [purpose, setPurpose] = useState<Purpose>({ type: 'custom' });
  const [duration, setDuration] = useState(60);
  const [specific, setSpecific] = useState<PlaceInfo | null>(null);

  const results = useQuery({
    queryKey: ['day-search', trip.id, day.index, submitted, near],
    queryFn: () => api.searchDay(trip.id, day.index, submitted, near),
    enabled: submitted.length >= 2,
  });

  const pickActivity = (id: string) => {
    const activity = trip.request.activities.find((a) => a.id === id);
    if (!activity) return;
    const p: Purpose = {
      type: 'activity',
      id: activity.id,
      label: activity.label,
      ...(activity.emoji ? { emoji: activity.emoji } : {}),
      outdoor: activity.outdoor,
      query: activity.query,
      duration: activity.durationMinutes,
    };
    setPurpose(p);
    setDuration(activity.durationMinutes);
    setQuery(activity.query);
    setSubmitted(activity.query);
  };

  const pickMeal = (meal: MealType) => {
    setPurpose({ type: 'meal', meal });
    setDuration(MEALS[meal].durationMinutes);
    setQuery(MEALS[meal].query);
    setSubmitted(MEALS[meal].query);
  };

  const build = (place: PlaceInfo): StopInput => {
    if (purpose.type === 'meal') {
      const meal = MEALS[purpose.meal];
      return { kind: 'meal', mealType: purpose.meal, place, durationMinutes: duration, activityLabel: meal.label, emoji: meal.emoji };
    }
    if (purpose.type === 'activity') {
      return {
        kind: 'activity',
        activityId: purpose.id,
        activityLabel: purpose.label,
        ...(purpose.emoji ? { emoji: purpose.emoji } : {}),
        outdoor: purpose.outdoor,
        place,
        durationMinutes: duration,
      };
    }
    return {
      kind: 'custom',
      place,
      durationMinutes: duration,
      activityLabel: place.primaryTypeLabel ?? 'Your stop',
      emoji: '📍',
    };
  };

  const choose = (candidate: PlaceCandidate) => onAdd(build(candidate.place));
  const previous = index === 0 ? day.start.name : day.stops[index - 1]!.place.name;

  return (
    <Modal title="Add a stop" onClose={onClose} wide>
      <p className="muted">
        Searching near <strong>{previous}</strong>. The timeline updates automatically once you add it.
      </p>
      <div className="tabs" role="tablist">
        <button type="button" role="tab" aria-selected={tab === 'search'} className={`tab${tab === 'search' ? ' is-active' : ''}`} onClick={() => setTab('search')}>
          Find ideas nearby
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={tab === 'specific'}
          className={`tab${tab === 'specific' ? ' is-active' : ''}`}
          onClick={() => setTab('specific')}
        >
          I know where I want to go
        </button>
      </div>

      <div className="field">
        <span className="field__label">Time there: {formatMinutes(duration)}</span>
        <input className="range" type="range" min={10} max={360} step={5} value={duration} onChange={(e) => setDuration(Number(e.target.value))} aria-label="Duration in minutes" />
      </div>

      {tab === 'search' && (
        <>
          <div className="chips">
            {trip.request.activities.map((a) => (
              <button
                key={a.id}
                type="button"
                className={`chip chip--small${purpose.type === 'activity' && purpose.id === a.id ? ' is-selected' : ''}`}
                onClick={() => pickActivity(a.id)}
              >
                {a.emoji ?? '📍'} {a.label}
              </button>
            ))}
            {MEAL_ORDER.map((m) => (
              <button
                key={m}
                type="button"
                className={`chip chip--small${purpose.type === 'meal' && purpose.meal === m ? ' is-selected' : ''}`}
                onClick={() => pickMeal(m)}
              >
                {MEALS[m].emoji} {MEALS[m].label}
              </button>
            ))}
          </div>
          <form
            className="search-row"
            onSubmit={(e) => {
              e.preventDefault();
              if (purpose.type !== 'custom' && query.trim() !== submitted) setPurpose({ type: 'custom' });
              setSubmitted(query.trim());
            }}
          >
            <input
              className="input"
              placeholder="What are you in the mood for? (e.g. pie, hot springs, bookstore)"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              aria-label="Search"
              autoFocus
            />
            <button type="submit" className="button" disabled={query.trim().length < 2}>
              Search
            </button>
          </form>
          {results.isLoading && <Spinner label="Searching…" />}
          {results.isError && <ErrorNote error={results.error} />}
          {results.data && <CandidateList candidates={results.data} minRating={trip.request.preferences.minRating} actionLabel="Add" onChoose={choose} />}
        </>
      )}

      {tab === 'specific' && (
        <div className="specific">
          <PlaceAutocomplete label="Place name or address" placeholder="e.g. Shoshone Falls" value={specific} onChange={setSpecific} bias={near} autoFocus />
          {specific && (
            <div className="specific__confirm">
              <Rating place={specific} />
              <button type="button" className="button button--primary" onClick={() => onAdd(build(specific))}>
                Add to day {day.index + 1}
              </button>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
