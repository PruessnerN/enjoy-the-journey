import { PACES, type Pace, type TripPreferences } from '@journey/shared';
import { todayIso } from '../lib/time';

interface StepScheduleProps {
  departureDate: string;
  onDateChange: (date: string) => void;
  preferences: TripPreferences;
  onChange: (preferences: TripPreferences) => void;
}

export function StepSchedule({ departureDate, onDateChange, preferences: p, onChange }: StepScheduleProps) {
  const set = <K extends keyof TripPreferences>(key: K, value: TripPreferences[K]) => onChange({ ...p, [key]: value });

  return (
    <div className="step-schedule">
      <div className="form-grid">
        <label className="field">
          <span className="field__label">Leaving on</span>
          <input
            className="input"
            type="date"
            min={todayIso()}
            value={departureDate}
            onChange={(e) => e.target.value && onDateChange(e.target.value)}
          />
        </label>
        <label className="field">
          <span className="field__label">Hit the road each day at</span>
          <input className="input" type="time" value={p.dayStartTime} onChange={(e) => e.target.value && set('dayStartTime', e.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">Arrive for the night by</span>
          <input className="input" type="time" value={p.arriveByTime} onChange={(e) => e.target.value && set('arriveByTime', e.target.value)} />
        </label>
      </div>

      <label className="checkbox checkbox--card">
        <input type="checkbox" checked={p.avoidNightDriving} onChange={(e) => set('avoidNightDriving', e.target.checked)} />
        <span>
          <strong>No driving after dark</strong>
          <small>Each day wraps up by sunset (plus a little grace), even if that's earlier than your arrive-by time.</small>
        </span>
      </label>

      <h3>Pace</h3>
      <div className="pace-options" role="radiogroup" aria-label="Pace">
        {(Object.keys(PACES) as Pace[]).map((pace) => (
          <button
            key={pace}
            type="button"
            role="radio"
            aria-checked={p.pace === pace}
            className={`option-card option-card--compact${p.pace === pace ? ' is-selected' : ''}`}
            onClick={() => onChange({ ...p, pace, maxDrivingHoursPerDay: PACES[pace].maxDrivingHours })}
          >
            <strong>{PACES[pace].label}</strong>
            <span>{PACES[pace].description}</span>
            <small>Up to ~{PACES[pace].maxDrivingHours}h of driving a day</small>
          </button>
        ))}
      </div>

      <details className="advanced">
        <summary>Fine-tune</summary>
        <div className="form-grid">
          <label className="field">
            <span className="field__label">Max driving per day</span>
            <select className="input" value={p.maxDrivingHoursPerDay} onChange={(e) => set('maxDrivingHoursPerDay', Number(e.target.value))}>
              {[2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((h) => (
                <option key={h} value={h}>
                  {h} hours
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field__label">Trip length</span>
            <select
              className="input"
              value={p.fixedDays ?? 'auto'}
              onChange={(e) => set('fixedDays', e.target.value === 'auto' ? null : Number(e.target.value))}
            >
              <option value="auto">Let us decide</option>
              {Array.from({ length: 14 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>
                  {d} day{d > 1 ? 's' : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field__label">Longest detour per stop</span>
            <select className="input" value={p.maxDetourMinutes} onChange={(e) => set('maxDetourMinutes', Number(e.target.value))}>
              {[15, 30, 45, 60, 90].map((m) => (
                <option key={m} value={m}>
                  {m} min
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field__label">Minimum Google rating</span>
            <select className="input" value={p.minRating} onChange={(e) => set('minRating', Number(e.target.value))}>
              {[3.5, 4, 4.3, 4.5].map((r) => (
                <option key={r} value={r}>
                  {r.toFixed(1)}★ and up
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field__label">Travelers</span>
            <input
              className="input"
              type="number"
              min={1}
              max={16}
              value={p.travelers}
              onChange={(e) => set('travelers', Math.max(1, Math.min(16, Number(e.target.value) || 1)))}
            />
          </label>
        </div>
      </details>
    </div>
  );
}
