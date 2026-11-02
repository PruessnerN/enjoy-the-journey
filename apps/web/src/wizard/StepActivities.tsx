import { useState } from 'react';
import {
  ACTIVITY_CATALOG,
  ACTIVITY_CATEGORIES,
  MEALS,
  MEAL_ORDER,
  activityRequestFromDefinition,
  findActivityDefinition,
  formatMinutes,
  type ActivityFrequency,
  type ActivityRequest,
  type TripPreferences,
} from '@journey/shared';
import { formatClock } from '../lib/time';

interface StepActivitiesProps {
  activities: ActivityRequest[];
  onChange: (activities: ActivityRequest[]) => void;
  meals: TripPreferences['meals'];
  onMealsChange: (meals: TripPreferences['meals']) => void;
}

const FREQUENCY_LABELS: Record<ActivityFrequency, string> = {
  once: 'Once this trip',
  daily: 'Once a day',
  often: 'Up to twice a day',
};

function durationOptions(min: number, max: number, current: number): number[] {
  const step = max > 120 ? 30 : 15;
  const options = new Set<number>([current]);
  for (let m = Math.ceil(min / step) * step; m <= max; m += step) options.add(m);
  return [...options].sort((a, b) => a - b);
}

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

export function StepActivities({ activities, onChange, meals, onMealsChange }: StepActivitiesProps) {
  const [custom, setCustom] = useState({ text: '', duration: 60, outdoor: false });
  const selected = new Set(activities.map((a) => a.id));

  const toggle = (id: string) => {
    if (selected.has(id)) {
      onChange(activities.filter((a) => a.id !== id));
    } else {
      const def = findActivityDefinition(id);
      if (def) onChange([...activities, activityRequestFromDefinition(def)]);
    }
  };

  const update = (id: string, patch: Partial<ActivityRequest>) =>
    onChange(activities.map((a) => (a.id === id ? { ...a, ...patch } : a)));

  const addCustom = () => {
    const text = custom.text.trim();
    if (text.length < 2) return;
    const id = `custom-${slugify(text) || 'activity'}`;
    if (selected.has(id)) return;
    onChange([
      ...activities,
      {
        id,
        label: text.charAt(0).toUpperCase() + text.slice(1),
        emoji: '📍',
        query: text,
        durationMinutes: custom.duration,
        minDurationMinutes: Math.max(10, Math.round((custom.duration * 0.6) / 5) * 5),
        frequency: 'daily',
        priority: 'normal',
        outdoor: custom.outdoor,
      },
    ]);
    setCustom({ text: '', duration: 60, outdoor: false });
  };

  return (
    <div className="step-activities">
      {ACTIVITY_CATEGORIES.map((category) => (
        <section key={category.id} className="chip-group">
          <h3>{category.label}</h3>
          <div className="chips">
            {ACTIVITY_CATALOG.filter((a) => a.category === category.id).map((a) => (
              <button
                key={a.id}
                type="button"
                className={`chip${selected.has(a.id) ? ' is-selected' : ''}`}
                aria-pressed={selected.has(a.id)}
                title={a.description}
                onClick={() => toggle(a.id)}
              >
                <span aria-hidden>{a.emoji}</span> {a.label}
              </button>
            ))}
          </div>
        </section>
      ))}

      <section className="custom-activity">
        <h3>Something else?</h3>
        <div className="custom-activity__row">
          <input
            className="input"
            placeholder="e.g. bookstores, BBQ joints, train museums"
            value={custom.text}
            onChange={(e) => setCustom({ ...custom, text: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                addCustom();
              }
            }}
            aria-label="Custom activity"
          />
          <select
            className="input input--auto"
            value={custom.duration}
            onChange={(e) => setCustom({ ...custom, duration: Number(e.target.value) })}
            aria-label="Time to spend"
          >
            {[20, 30, 45, 60, 90, 120, 180, 240].map((m) => (
              <option key={m} value={m}>
                {formatMinutes(m)}
              </option>
            ))}
          </select>
          <label className="checkbox">
            <input type="checkbox" checked={custom.outdoor} onChange={(e) => setCustom({ ...custom, outdoor: e.target.checked })} />
            Outdoors
          </label>
          <button type="button" className="button" onClick={addCustom} disabled={custom.text.trim().length < 2}>
            Add
          </button>
        </div>
      </section>

      {activities.length > 0 && (
        <section className="selected-activities">
          <h3>Your activities</h3>
          <p className="muted">We'll fit these in where they make sense — and only at places with great reviews.</p>
          <ul>
            {activities.map((a) => {
              const def = findActivityDefinition(a.id);
              const options = durationOptions(def?.minDurationMinutes ?? 15, def?.maxDurationMinutes ?? 300, a.durationMinutes);
              return (
                <li key={a.id} className="selected-activity">
                  <span className="selected-activity__name">
                    <span aria-hidden>{a.emoji ?? '📍'}</span> {a.label}
                  </span>
                  <select
                    className="input input--auto"
                    aria-label={`How often for ${a.label}`}
                    value={a.frequency}
                    onChange={(e) => update(a.id, { frequency: e.target.value as ActivityFrequency })}
                  >
                    {Object.entries(FREQUENCY_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                  <select
                    className="input input--auto"
                    aria-label={`Time to spend at ${a.label}`}
                    value={a.durationMinutes}
                    onChange={(e) => {
                      const duration = Number(e.target.value);
                      update(a.id, { durationMinutes: duration, minDurationMinutes: Math.min(a.minDurationMinutes, duration) });
                    }}
                  >
                    {options.map((m) => (
                      <option key={m} value={m}>
                        ~{formatMinutes(m)}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className={`chip chip--small${a.priority === 'high' ? ' is-selected' : ''}`}
                    aria-pressed={a.priority === 'high'}
                    onClick={() => update(a.id, { priority: a.priority === 'high' ? 'normal' : 'high' })}
                    title="Must-do activities are scheduled first"
                  >
                    ★ Must do
                  </button>
                  <button type="button" className="icon-button" aria-label={`Remove ${a.label}`} onClick={() => toggle(a.id)}>
                    ✕
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section className="meals">
        <h3>Meals on the road</h3>
        <p className="muted">We only stop to eat at mealtime, at restaurants that meet your rating bar.</p>
        <div className="meal-toggles">
          {MEAL_ORDER.map((m) => {
            const meal = MEALS[m];
            return (
              <label key={m} className={`toggle-card${meals[m] ? ' is-selected' : ''}`}>
                <input type="checkbox" checked={meals[m]} onChange={(e) => onMealsChange({ ...meals, [m]: e.target.checked })} />
                <span className="toggle-card__emoji" aria-hidden>
                  {meal.emoji}
                </span>
                <span>
                  <strong>{meal.label}</strong>
                  <small>
                    {formatClock(meal.windowStart)}–{formatClock(meal.windowEnd)} · ~{formatMinutes(meal.durationMinutes)}
                  </small>
                </span>
              </label>
            );
          })}
        </div>
      </section>
    </div>
  );
}
