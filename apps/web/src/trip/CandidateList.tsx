import { formatDistance, type PlaceCandidate } from '@journey/shared';
import { Icon } from '../components/Icon';
import { Rating } from '../components/ui';

export function candidateKey(c: PlaceCandidate): string {
  return c.place.placeId ?? `${c.place.name}@${c.place.location.lat.toFixed(5)},${c.place.location.lng.toFixed(5)}`;
}

interface CandidateListProps {
  candidates: PlaceCandidate[];
  minRating?: number;
  actionLabel: string;
  onChoose: (candidate: PlaceCandidate) => void;
  /** Show numbers that match the map's pins. */
  numbered?: boolean;
  activeKey?: string | null;
  /** Hovering highlights a place; clicking also asks the map to bring it into view. */
  onActivate?: (key: string, how: 'hover' | 'click') => void;
  /** Prefix for element ids so a map pin can scroll its row into view. */
  idPrefix?: string;
}

export function CandidateList({ candidates, minRating, actionLabel, onChoose, numbered, activeKey, onActivate, idPrefix }: CandidateListProps) {
  if (candidates.length === 0) return <p className="muted">No places found. Try a different search.</p>;
  return (
    <ul className="candidates">
      {candidates.map((c, i) => {
        const key = candidateKey(c);
        const belowBar = minRating !== undefined && c.place.rating !== undefined && c.place.rating < minRating;
        return (
          <li
            key={key}
            id={idPrefix ? `${idPrefix}-${i}` : undefined}
            className={`candidate${belowBar ? ' is-below' : ''}${activeKey === key ? ' is-active' : ''}${onActivate ? ' is-interactive' : ''}`}
            onMouseEnter={onActivate ? () => onActivate(key, 'hover') : undefined}
            onClick={onActivate ? () => onActivate(key, 'click') : undefined}
          >
            {numbered && <span className="candidate__number">{i + 1}</span>}
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
            <div className="candidate__actions" onClick={(e) => e.stopPropagation()}>
              {c.place.googleMapsUri && (
                <a href={c.place.googleMapsUri} target="_blank" rel="noreferrer" className="button button--ghost button--small">
                  Map <Icon name="external" size={12} />
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
