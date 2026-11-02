import { formatDistance, type PlaceCandidate } from '@journey/shared';
import { Rating } from '../components/ui';

interface CandidateListProps {
  candidates: PlaceCandidate[];
  minRating?: number;
  actionLabel: string;
  onChoose: (candidate: PlaceCandidate) => void;
}

export function CandidateList({ candidates, minRating, actionLabel, onChoose }: CandidateListProps) {
  if (candidates.length === 0) return <p className="muted">No places found. Try a different search.</p>;
  return (
    <ul className="candidates">
      {candidates.map((c) => {
        const belowBar = minRating !== undefined && c.place.rating !== undefined && c.place.rating < minRating;
        return (
          <li key={c.place.placeId ?? `${c.place.name}-${c.place.location.lat}`} className={`candidate${belowBar ? ' is-below' : ''}`}>
            <div className="candidate__info">
              <strong>{c.place.name}</strong>
              <div className="stop__meta">
                <Rating place={c.place} />
                {c.place.primaryTypeLabel && <span>{c.place.primaryTypeLabel}</span>}
                {c.detourMinutes !== undefined && (
                  <span title="Estimated extra driving to get there and back to your route">
                    {c.detourMinutes <= 5 ? 'right on the way' : `+${c.detourMinutes} min detour`}
                  </span>
                )}
                {c.distanceFromRouteMeters !== undefined && c.distanceFromRouteMeters > 500 && (
                  <span>{formatDistance(c.distanceFromRouteMeters)} off route</span>
                )}
              </div>
              {c.place.address && <small className="muted">{c.place.address}</small>}
              {belowBar && <small className="field__error">Below your {minRating}★ minimum</small>}
            </div>
            <div className="candidate__actions">
              {c.place.googleMapsUri && (
                <a href={c.place.googleMapsUri} target="_blank" rel="noreferrer" className="button button--ghost button--small">
                  Map ↗
                </a>
              )}
              <button type="button" className="button button--primary button--small" onClick={() => onChoose(c)}>
                {actionLabel}
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
