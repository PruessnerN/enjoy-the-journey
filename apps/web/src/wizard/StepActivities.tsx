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
  /** Ranked: most important first. */
  activities: ActivityRequest[];
  onChange: (activities: ActivityRequest[]) => void;
  meals: TripPreferences['meals'];
  onMealsChange: (meals: TripPreferences['meals']) => void;
  maxActivitiesPerDay: number | null | undefined;
  onMaxActivitiesPerDayChange: (max: number | null) => void;
}

const DAILY_LIMITS = [1, 2, 3, 4, 5, 6];

/** Moves the item at `from` to position `to`. */
function moveItem<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  const [item] = next.splice(from, 1);
  if (item !== undefined) next.splice(Math.max(0, Math.min(to, next.length)), 0, item);
  return next;
}

const FREQUENCY_LABELS: Record<ActivityFrequency, string> = {
  once: 'Once this trip',
  few: '2–3 times this trip',
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

export function StepActivities({
  activities,
  onChange,
  meals,
  onMealsChange,
  maxActivitiesPerDay,
  onMaxActivitiesPerDayChange,
}: StepActivitiesProps) {
  const [custom, setCustom] = useState({ text: '', duration: 60, outdoor: false });
  const [dragging, setDragging] = useState<number | null>(null);
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
          <h3>Your activities, most important first</h3>
          <p className="muted">
            When a day can't fit everything, we go down this list in order and pick the best-rated spot we can fit for each
            one. Drag or use ↑ ↓ to reorder.
          </p>
          <ol>
            {activities.map((a, i) => {
              const def = findActivityDefinition(a.id);
              const options = durationOptions(def?.minDurationMinutes ?? 15, def?.maxDurationMinutes ?? 300, a.durationMinutes);
              return (
                <li
                  key={a.id}
                  className={`selected-activity${dragging === i ? ' is-dragging' : ''}`}
                  draggable
                  onDragStart={(e) => {
                    setDragging(i);
                    e.dataTransfer.effectAllowed = 'move';
                  }}
                  onDragOver={(e) => {
                    if (dragging === null) return;
                    e.preventDefault();
                    if (dragging !== i) {
                      onChange(moveItem(activities, dragging, i));
                      setDragging(i);
                    }
                  }}
                  onDragEnd={() => setDragging(null)}
                  onDrop={(e) => e.preventDefault()}
                >
                  <span className="selected-activity__handle" aria-hidden title="Drag to reorder">
                    ⠿
                  </span>
                  <span className="selected-activity__rank" aria-label={`Rank ${i + 1}`}>
                    {i + 1}
                  </span>
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
                  <span className="selected-activity__order">
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Move ${a.label} up`}
                      disabled={i === 0}
                      onClick={() => onChange(moveItem(activities, i, i - 1))}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="icon-button"
                      aria-label={`Move ${a.label} down`}
                      disabled={i === activities.length - 1}
                      onClick={() => onChange(moveItem(activities, i, i + 1))}
                    >
                      ↓
                    </button>
                  </span>
                  <button type="button" className="icon-button" aria-label={`Remove ${a.label}`} onClick={() => toggle(a.id)}>
                    ✕
                  </button>
                </li>
              );
            })}
          </ol>
          <label className="daily-limit">
            <span>Activities per day</span>
            <select
              className="input input--auto"
              value={maxActivitiesPerDay ?? 'none'}
              onChange={(e) => onMaxActivitiesPerDayChange(e.target.value === 'none' ? null : Number(e.target.value))}
            >
              <option value="none">No limit</option>
              {DAILY_LIMITS.map((n) => (
                <option key={n} value={n}>
                  Up to {n}
                </option>
              ))}
            </select>
            <small className="muted">Meals don't count toward this.</small>
          </label>
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
