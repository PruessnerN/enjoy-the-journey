import { LODGING_TYPES, MEALS, MEAL_ORDER, PACES, formatMinutes, type ActivityFrequency } from '@journey/shared';
import { formatClock, formatDate } from '../lib/time';
import type { TripDraft } from './draft';

const FREQUENCY_SUMMARY: Record<ActivityFrequency, string> = {
  once: 'once',
  few: '2–3 times',
  daily: 'daily',
  often: 'up to twice a day',
};

export function StepReview({ draft, onNameChange }: { draft: TripDraft; onNameChange: (name: string) => void }) {
  const p = draft.preferences;
  const meals = MEAL_ORDER.filter((m) => p.meals[m]).map((m) => MEALS[m].label.toLowerCase());
  const placeholder = draft.origin && draft.destination ? `${draft.origin.name.split(',')[0]} → ${draft.destination.name.split(',')[0]}` : '';

  return (
    <div className="review">
      <label className="field">
        <span className="field__label">Name your journey</span>
        <input className="input input--large" value={draft.name} placeholder={placeholder} onChange={(e) => onNameChange(e.target.value)} maxLength={120} />
      </label>
      <dl className="review__list">
        <dt>Route</dt>
        <dd>
          {draft.origin?.name} → {draft.destination?.name}
        </dd>
        <dt>Leaving</dt>
        <dd>
          {formatDate(draft.departureDate, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}, on the road{' '}
          {formatClock(p.dayStartTime)}–{formatClock(p.arriveByTime)}
          {p.avoidNightDriving && ' (never after dark)'}
        </dd>
        <dt>Activities</dt>
        <dd>
          <ol className="review__activities">
            {draft.activities.map((a) => (
              <li key={a.id}>
                {a.emoji} {a.label} · ~{formatMinutes(a.durationMinutes)} · {FREQUENCY_SUMMARY[a.frequency]}
              </li>
            ))}
          </ol>
          <small className="muted">
            {p.maxActivitiesPerDay ? `Up to ${p.maxActivitiesPerDay} a day, ` : ''}most important first
          </small>
        </dd>
        <dt>Meals</dt>
        <dd>{meals.length ? `Stop for ${meals.join(', ')}` : 'No meal stops'}</dd>
        <dt>Sleeping at</dt>
        <dd>{draft.lodgingType ? `${LODGING_TYPES[draft.lodgingType].emoji} ${LODGING_TYPES[draft.lodgingType].label}` : '—'}</dd>
        <dt>Pace</dt>
        <dd>
          {PACES[p.pace].label} · up to {p.maxDrivingHoursPerDay}h driving/day ·{' '}
          {p.fixedDays ? `${p.fixedDays} day${p.fixedDays > 1 ? 's' : ''}` : 'we pick the number of days'} · detours up to {p.maxDetourMinutes} min ·{' '}
          {p.minRating.toFixed(1)}★+ places
        </dd>
      </dl>
    </div>
  );
}
