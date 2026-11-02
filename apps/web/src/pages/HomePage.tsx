import { Link } from 'react-router-dom';
import { formatDuration } from '@journey/shared';
import { useDeleteTrip, useTrips } from '../api/hooks';
import { ErrorNote, Spinner } from '../components/ui';
import { formatDate } from '../lib/time';

export function HomePage() {
  const trips = useTrips();
  const remove = useDeleteTrip();

  return (
    <div className="home">
      <section className="hero">
        <div className="hero__text">
          <h1>
            Don't just get there.
            <br />
            <span>Enjoy the journey.</span>
          </h1>
          <p>
            Tell us where you're starting, where you're headed and what you love to do. We'll turn the drive into days full of
            top-rated stops — disc golf, hikes, local food, hidden gems — with a comfy place to sleep every night.
          </p>
          <Link to="/new" className="button button--primary button--large">
            Plan a new journey
          </Link>
        </div>
        <div className="hero__art" aria-hidden>
          <svg viewBox="0 0 400 220">
            <defs>
              <linearGradient id="sky" x1="0" x2="0" y1="0" y2="1">
                <stop className="hero-sky-top" offset="0" stopColor="#ffe8cc" />
                <stop className="hero-sky-bottom" offset="1" stopColor="#fff7ee" />
              </linearGradient>
            </defs>
            <rect width="400" height="220" rx="24" fill="url(#sky)" />
            <circle className="hero-sun" cx="300" cy="70" r="34" fill="#f4a259" />
            <g className="hero-stars" fill="#fff">
              <circle cx="60" cy="40" r="1.6" />
              <circle cx="130" cy="28" r="1.2" />
              <circle cx="200" cy="52" r="1.8" />
              <circle cx="250" cy="22" r="1.2" />
              <circle cx="360" cy="34" r="1.5" />
            </g>
            <path d="M0 160 L80 90 L150 150 L220 70 L320 160 Z" className="hero-mountain-far" fill="#5b8e7d" opacity="0.8" />
            <path d="M120 170 L210 100 L300 170 Z" className="hero-mountain-near" fill="#0f4c5c" opacity="0.85" />
            <path d="M-10 210 C 90 160, 150 200, 220 175 S 360 150, 410 170" fill="none" stroke="#3b3b3b" strokeWidth="16" strokeLinecap="round" />
            <path d="M-10 210 C 90 160, 150 200, 220 175 S 360 150, 410 170" fill="none" stroke="#fff" strokeWidth="2" strokeDasharray="10 10" />
            <g className="hero__pins">
              <text x="70" y="160" fontSize="26">🥏</text>
              <text x="190" y="150" fontSize="26">🍔</text>
              <text x="320" y="140" fontSize="26">🏕️</text>
            </g>
          </svg>
        </div>
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
                  {t.originName} → {t.destinationName}
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
                🗑
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
