import { Link } from 'react-router-dom';
import { formatDuration } from '@journey/shared';
import { useDeleteTrip, useTrips } from '../api/hooks';
import { Icon } from '../components/Icon';
import { ErrorNote, Spinner } from '../components/ui';
import { formatDate } from '../lib/time';

export function HomePage() {
  const trips = useTrips();
  const remove = useDeleteTrip();

  return (
    <div className="home">
      <section className="hero">
        <div className="hero__text">
          <p className="eyebrow">Road trip planner</p>
          <h1>The long way, on purpose.</h1>
          <p>
            Pick a start, a destination and the things you like to do. Enjoy the Journey splits the drive into days, finds
            well-reviewed stops along the route, and ends each night somewhere to sleep.
          </p>
          <Link to="/new" className="button button--primary button--large">
            Plan a trip
          </Link>
        </div>
        <TopoArt />
      </section>

      <section className="trips">
        <h2>Your journeys</h2>
        {trips.isLoading && <Spinner label="Loading trips…" />}
        {trips.isError && <ErrorNote error={trips.error} onRetry={() => void trips.refetch()} />}
        {trips.data?.length === 0 && (
          <div className="empty card">
            <p>No trips yet. Your first adventure is one click away.</p>
          </div>
        )}
        <ul className="trip-cards">
          {trips.data?.map((t) => (
            <li key={t.id} className="trip-card card">
              <Link to={`/trips/${t.id}`} className="trip-card__link">
                <h3>{t.name}</h3>
                <p>
                  {t.roundTrip ? `Round trip from ${t.originName}` : `${t.originName} → ${t.destinationName}`}
                  {t.mainEventCount > 0 && ` · ${t.mainEventCount} main event${t.mainEventCount === 1 ? '' : 's'}`}
                </p>
                <p className="muted">
                  {t.departureDate && formatDate(t.departureDate)} · {t.days} day{t.days === 1 ? '' : 's'} ·{' '}
                  {formatDuration(t.totalDriveSeconds)} driving
                </p>
              </Link>
              <button
                type="button"
                className="icon-button trip-card__delete"
                aria-label={`Delete ${t.name}`}
                onClick={() => {
                  if (confirm(`Delete "${t.name}"? This can't be undone.`)) remove.mutate(t.id);
                }}
              >
                <Icon name="trash" />
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/** A small topographic-map drawing: contour lines, a dashed route and three waypoints. */
function TopoArt() {
  const contours = [
    'M40 210 C 60 150, 140 120, 190 140 S 260 210, 230 250',
    'M70 205 C 85 165, 140 145, 178 158 S 230 205, 210 236',
    'M100 200 C 110 178, 145 166, 168 174 S 200 200, 188 220',
    'M300 40 C 360 20, 440 60, 430 120 S 350 170, 320 130 S 270 60, 300 40',
    'M318 62 C 360 46, 414 78, 406 116 S 356 146, 334 120 S 296 76, 318 62',
    'M338 82 C 362 74, 388 92, 384 112 S 358 126, 348 112 S 324 90, 338 82',
  ];
  return (
    <div className="hero__art" aria-hidden>
      <svg viewBox="0 0 480 300">
        <rect className="topo__paper" width="480" height="300" />
        <g className="topo__grid">
          {[60, 120, 180, 240].map((y) => (
            <line key={`h${y}`} x1="0" x2="480" y1={y} y2={y} />
          ))}
          {[80, 160, 240, 320, 400].map((x) => (
            <line key={`v${x}`} y1="0" y2="300" x1={x} x2={x} />
          ))}
        </g>
        <path className="topo__water" d="M0 268 C 70 250, 120 286, 200 272 S 330 240, 480 262 L480 300 L0 300 Z" />
        <g className="topo__contours">
          {contours.map((d) => (
            <path key={d} d={d} />
          ))}
        </g>
        <path className="topo__route" d="M30 70 C 110 60, 130 120, 200 112 S 300 190, 360 200 S 440 230, 455 250" />
        <g className="topo__waypoints">
          <circle cx="30" cy="70" r="7" />
          <circle cx="200" cy="112" r="6" />
          <circle cx="360" cy="200" r="6" />
          <rect x="447" y="242" width="16" height="16" />
        </g>
        <g className="topo__labels">
          <text x="44" y="60">START</text>
          <text x="212" y="104">DAY 1</text>
          <text x="372" y="194">DAY 2</text>
        </g>
      </svg>
    </div>
  );
}
