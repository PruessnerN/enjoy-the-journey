import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTrip } from '../api/hooks';
import { ErrorNote, IssueList, Spinner } from '../components/ui';
import { formatDate } from '../lib/time';
import { useTheme } from '../components/ThemeProvider';
import { dayColor } from '../map/colors';
import { TripMap } from '../map/TripMap';
import { DayTimeline } from '../trip/DayTimeline';
import { TripHeader } from '../trip/TripHeader';
import { TripOverview } from '../trip/TripOverview';
import { TripSettingsModal } from '../trip/TripSettingsModal';

export function TripPage() {
  const { id = '' } = useParams();
  const trip = useTrip(id);
  const { theme } = useTheme();
  const [selected, setSelected] = useState<number | 'overview' | null>(null);
  const [focusedStopId, setFocusedStopId] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  if (trip.isLoading) return <Spinner label="Loading your journey…" />;
  if (trip.isError || !trip.data) {
    return (
      <div className="card empty">
        <ErrorNote error={trip.error} />
        <Link to="/">← Back to my trips</Link>
      </div>
    );
  }

  const data = trip.data;
  const view = selected ?? (data.days.length > 1 ? 'overview' : 0);
  const dayIndex = view === 'overview' ? null : Math.min(view, data.days.length - 1);
  const day = dayIndex === null ? null : data.days[dayIndex]!;

  const focusStop = (stopId: string | null) => {
    setFocusedStopId(stopId);
    if (stopId) document.getElementById(`stop-${stopId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  return (
    <div className="trip-page">
      <Link to="/" className="back-link">
        ← My trips
      </Link>
      <TripHeader trip={data} onOpenSettings={() => setSettingsOpen(true)} />
      <IssueList issues={data.issues} />

      <nav className="day-tabs" aria-label="Days">
        {data.days.length > 1 && (
          <button type="button" className={`day-tab${view === 'overview' ? ' is-active' : ''}`} onClick={() => setSelected('overview')}>
            Overview
          </button>
        )}
        {data.days.map((d) => (
          <button
            key={d.index}
            type="button"
            className={`day-tab${dayIndex === d.index ? ' is-active' : ''}`}
            onClick={() => setSelected(d.index)}
            style={{ '--day-color': dayColor(d.index, theme) } as React.CSSProperties}
          >
            <span className="day-tab__dot" aria-hidden />
            Day {d.index + 1}
            <small>{formatDate(d.date)}</small>
          </button>
        ))}
      </nav>

      <div className="trip-layout">
        <div className="trip-layout__timeline">
          {day ? (
            <DayTimeline trip={data} day={day} focusedStopId={focusedStopId} onFocusStop={setFocusedStopId} />
          ) : (
            <TripOverview trip={data} onSelectDay={setSelected} />
          )}
        </div>
        <aside className="trip-layout__map">
          <TripMap trip={data} selectedDay={dayIndex} focusedStopId={focusedStopId} onSelectStop={(dayIdx, stopId) => {
            if (dayIdx !== dayIndex) setSelected(dayIdx);
            setTimeout(() => focusStop(stopId), 50);
          }} />
        </aside>
      </div>

      {settingsOpen && <TripSettingsModal trip={data} onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}
