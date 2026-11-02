import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { PlaceCandidate, Stop, StopInput, Trip, TripDay } from '@journey/shared';
import { api } from '../api/client';
import { Modal } from '../components/Modal';
import { ErrorNote, Spinner } from '../components/ui';
import { toStopInput } from '../lib/dayEdits';
import { CandidateList } from './CandidateList';

interface SwapStopModalProps {
  trip: Trip;
  day: TripDay;
  stop: Stop;
  onChoose: (stop: StopInput) => void;
  onClose: () => void;
}

/** Shows ranked alternatives for a stop, plus a free-text search near it. */
export function SwapStopModal({ trip, day, stop, onChoose, onClose }: SwapStopModalProps) {
  const [query, setQuery] = useState('');
  const [submitted, setSubmitted] = useState('');
  const alternatives = useQuery({
    queryKey: ['alternatives', trip.id, day.index, stop.id, trip.updatedAt],
    queryFn: () => api.alternatives(trip.id, day.index, stop.id),
  });
  const search = useQuery({
    queryKey: ['day-search', trip.id, day.index, submitted, stop.place.location],
    queryFn: () => api.searchDay(trip.id, day.index, submitted, stop.place.location),
    enabled: submitted.length >= 2,
  });

  const choose = (candidate: PlaceCandidate) => {
    const base = toStopInput(stop);
    const next: StopInput = { ...base, place: candidate.place, locked: true };
    delete next.links;
    onChoose(next);
  };

  const what = stop.kind === 'lodging' ? 'places to stay' : stop.kind === 'meal' ? 'places to eat' : `${stop.activityLabel ?? 'places'}`;

  return (
    <Modal title={`Swap ${stop.place.name}`} onClose={onClose} wide>
      <form
        className="search-row"
        onSubmit={(e) => {
          e.preventDefault();
          setSubmitted(query.trim());
        }}
      >
        <input
          className="input"
          placeholder="Search for something else near here (e.g. a place you found online)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search near this stop"
        />
        <button type="submit" className="button" disabled={query.trim().length < 2}>
          Search
        </button>
      </form>

      {submitted && (
        <section>
          <h3>Results for “{submitted}”</h3>
          {search.isLoading && <Spinner label="Searching…" />}
          {search.isError && <ErrorNote error={search.error} />}
          {search.data && <CandidateList candidates={search.data} actionLabel="Use this" onChoose={choose} />}
        </section>
      )}

      <section>
        <h3>Top-rated {what} nearby</h3>
        {alternatives.isLoading && <Spinner label="Finding alternatives…" />}
        {alternatives.isError && <ErrorNote error={alternatives.error} onRetry={() => void alternatives.refetch()} />}
        {alternatives.data && (
          <CandidateList candidates={alternatives.data} minRating={trip.request.preferences.minRating} actionLabel="Swap in" onChoose={choose} />
        )}
      </section>
    </Modal>
  );
}
