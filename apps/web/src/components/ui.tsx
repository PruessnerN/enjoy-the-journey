import type { Issue, PlaceInfo } from '@journey/shared';
import { formatCount } from '../lib/time';

export function Rating({ place }: { place: PlaceInfo }) {
  if (place.rating === undefined) return null;
  return (
    <span className="rating" title={`${place.rating} stars from ${place.userRatingCount ?? 0} reviews`}>
      <span className="rating__star" aria-hidden>
        ★
      </span>
      {place.rating.toFixed(1)}
      {place.userRatingCount !== undefined && <span className="rating__count">({formatCount(place.userRatingCount)})</span>}
      {place.priceLevel !== undefined && place.priceLevel > 0 && (
        <span className="rating__price" aria-label={`Price level ${place.priceLevel}`}>
          {'$'.repeat(place.priceLevel)}
        </span>
      )}
    </span>
  );
}

export function IssueList({ issues, compact }: { issues: Issue[]; compact?: boolean }) {
  if (issues.length === 0) return null;
  return (
    <ul className={`issues${compact ? ' issues--compact' : ''}`}>
      {issues.map((issue, i) => (
        <li key={`${issue.code}-${i}`} className={`issue issue--${issue.severity}`}>
          {issue.message}
        </li>
      ))}
    </ul>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <span className="spinner-wrap" role="status">
      <span className="spinner" aria-hidden />
      {label && <span>{label}</span>}
    </span>
  );
}

export function ErrorNote({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  const message = error instanceof Error ? error.message : 'Something went wrong.';
  return (
    <div className="error-note" role="alert">
      <span>{message}</span>
      {onRetry && (
        <button type="button" className="button button--small" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}
