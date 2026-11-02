import { formatDistance, formatDuration, type Trip } from '@journey/shared';
import { formatDate, formatTime } from '../lib/time';
import { useTheme } from '../components/ThemeProvider';
import { dayColor } from '../map/colors';
import { stopEmoji } from './StopCard';

export function TripOverview({ trip, onSelectDay }: { trip: Trip; onSelectDay: (index: number) => void }) {
  const { theme } = useTheme();
  return (
    <ol className="overview">
      {trip.days.map((day) => {
        const end = day.stops[day.stops.length - 1]!;
        const warnings = [...day.issues, ...day.stops.flatMap((s) => s.issues)].filter((i) => i.severity === 'warning').length;
        return (
          <li key={day.index}>
            <button type="button" className="overview__day card" onClick={() => onSelectDay(day.index)} style={{ borderLeftColor: dayColor(day.index, theme) }}>
              <div className="overview__head">
                <span className="day__badge" style={{ background: dayColor(day.index, theme) }}>
                  Day {day.index + 1}
                </span>
                <strong>{formatDate(day.date)}</strong>
                {warnings > 0 && <span className="overview__warn">⚠️ {warnings}</span>}
              </div>
              <p>
                {day.start.name} → <strong>{end.place.name}</strong>
              </p>
              <p className="muted">
                {formatTime(day.departure, day.timeZone)} – {formatTime(day.arrival, end.timeZone)} · 🚗 {formatDuration(day.driveSeconds)} ·{' '}
                {formatDistance(day.distanceMeters)}
              </p>
              <div className="overview__stops" aria-label="Stops">
                {day.stops.map((s) => (
                  <span key={s.id} title={s.place.name}>
                    {stopEmoji(s, trip)}
                  </span>
                ))}
              </div>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
