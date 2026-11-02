import { useMemo, useState } from 'react';
import type { Trip } from '@journey/shared';
import { useReplanTrip } from '../api/hooks';
import { Modal } from '../components/Modal';
import { PlaceAutocomplete } from '../components/PlaceAutocomplete';
import { PlanningOverlay } from '../components/PlanningOverlay';
import { ErrorNote } from '../components/ui';
import { draftFromRequest, toRequest, type TripDraft } from '../wizard/draft';
import { StepActivities } from '../wizard/StepActivities';
import { StepLodging } from '../wizard/StepLodging';
import { StepSchedule } from '../wizard/StepSchedule';

const TABS = [
  { id: 'route', label: 'Route' },
  { id: 'activities', label: 'Activities & meals' },
  { id: 'lodging', label: 'Lodging' },
  { id: 'schedule', label: 'Schedule & pace' },
] as const;

/** Change any trip input and re-run the planner. */
export function TripSettingsModal({ trip, onClose }: { trip: Trip; onClose: () => void }) {
  const replan = useReplanTrip(trip.id);
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('activities');
  const [draft, setDraft] = useState<TripDraft>(() => draftFromRequest(trip.request, trip.name));
  const update = (patch: Partial<TripDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const request = useMemo(() => toRequest({ ...draft, name: '' }), [draft]);
  const hasEdits = trip.days.some((d) => d.stops.some((s) => s.source === 'user' || s.locked));

  return (
    <>
      {replan.isPending && <PlanningOverlay title="Re-planning your journey" />}
      <Modal
        title="Trip settings"
        onClose={onClose}
        wide
        footer={
          <>
            {!request.ok && <span className="field__error">{request.message}</span>}
            <button type="button" className="button button--ghost" onClick={onClose}>
              Cancel
            </button>
            <button
              type="button"
              className="button button--primary"
              disabled={!request.ok || replan.isPending}
              onClick={() => request.ok && replan.mutate(request.request, { onSuccess: onClose })}
            >
              Re-plan trip
            </button>
          </>
        }
      >
        {hasEdits && (
          <p className="issue issue--warning">⚠️ Re-planning builds a fresh itinerary and replaces your manual edits and locked stops.</p>
        )}
        <div className="tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`tab${tab === t.id ? ' is-active' : ''}`} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
        {tab === 'route' && (
          <div className="form-stack">
            <PlaceAutocomplete label="Starting point" value={draft.origin} onChange={(origin) => update({ origin })} />
            <PlaceAutocomplete label="Destination" value={draft.destination} onChange={(destination) => update({ destination })} bias={draft.origin?.location} />
          </div>
        )}
        {tab === 'activities' && (
          <StepActivities
            activities={draft.activities}
            onChange={(activities) => update({ activities })}
            meals={draft.preferences.meals}
            onMealsChange={(meals) => update({ preferences: { ...draft.preferences, meals } })}
            maxActivitiesPerDay={draft.preferences.maxActivitiesPerDay}
            onMaxActivitiesPerDayChange={(maxActivitiesPerDay) => update({ preferences: { ...draft.preferences, maxActivitiesPerDay } })}
          />
        )}
        {tab === 'lodging' && <StepLodging value={draft.lodgingType} onChange={(lodgingType) => update({ lodgingType })} />}
        {tab === 'schedule' && (
          <StepSchedule
            departureDate={draft.departureDate}
            onDateChange={(departureDate) => update({ departureDate })}
            preferences={draft.preferences}
            onChange={(preferences) => update({ preferences })}
          />
        )}
        {replan.isError && <ErrorNote error={replan.error} />}
      </Modal>
    </>
  );
}
