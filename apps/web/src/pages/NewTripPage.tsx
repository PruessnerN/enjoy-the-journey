import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useCreateTrip } from '../api/hooks';
import { PlaceAutocomplete } from '../components/PlaceAutocomplete';
import { PlanningOverlay } from '../components/PlanningOverlay';
import { ErrorNote } from '../components/ui';
import { STEPS, isStepComplete, loadDraft, saveDraft, toRequest, type StepId, type TripDraft } from '../wizard/draft';
import { StepActivities } from '../wizard/StepActivities';
import { StepLodging } from '../wizard/StepLodging';
import { StepReview } from '../wizard/StepReview';
import { StepSchedule } from '../wizard/StepSchedule';

const COPY: Record<StepId, { title: string; subtitle: string }> = {
  origin: { title: 'Where does the journey begin?', subtitle: 'Your home, a hotel, a city — wherever you start driving.' },
  destination: { title: 'Where are you headed?', subtitle: "We'll split the drive into days and find the good stuff in between." },
  activities: {
    title: 'What do you love doing along the way?',
    subtitle: "Pick as many as you like. We'll find the best-rated spots near your route and fit them into each day.",
  },
  lodging: { title: 'Where do you like to sleep?', subtitle: 'Every night on the road ends somewhere comfortable.' },
  schedule: { title: 'When are you going, and how fast?', subtitle: 'Set your daily rhythm. You can fine-tune every day later.' },
  review: { title: 'Ready to enjoy the journey?', subtitle: 'Here is what we will plan for you.' },
};

export function NewTripPage() {
  const navigate = useNavigate();
  const create = useCreateTrip();
  const [draft, setDraft] = useState<TripDraft>(loadDraft);
  const [stepIndex, setStepIndex] = useState(() => {
    const d = loadDraft();
    const firstIncomplete = STEPS.findIndex((s) => !isStepComplete(s.id, d));
    return firstIncomplete === -1 ? STEPS.length - 1 : firstIncomplete;
  });
  const step = STEPS[stepIndex]!.id;

  useEffect(() => {
    saveDraft(draft);
  }, [draft]);
  useEffect(() => {
    // Block body on purpose: newer browsers return a Promise from scrollTo, which React would treat as a cleanup.
    void window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [stepIndex]);

  const update = (patch: Partial<TripDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const canContinue = isStepComplete(step, draft);
  const request = useMemo(() => toRequest(draft), [draft]);

  const next = () => {
    if (!canContinue) return;
    if (step === 'review') {
      if (!request.ok) return;
      create.mutate(request.request, {
        onSuccess: (trip) => {
          saveDraft(null);
          navigate(`/trips/${trip.id}`);
        },
      });
      return;
    }
    setStepIndex((i) => Math.min(i + 1, STEPS.length - 1));
  };

  const maxReachable = STEPS.findIndex((s) => !isStepComplete(s.id, draft));

  return (
    <div className="wizard">
      {create.isPending && <PlanningOverlay />}
      <ol className="stepper">
        {STEPS.map((s, i) => {
          const reachable = maxReachable === -1 || i <= maxReachable;
          return (
            <li key={s.id} className={`stepper__item${i === stepIndex ? ' is-current' : ''}${i < stepIndex ? ' is-done' : ''}`}>
              <button type="button" disabled={!reachable} onClick={() => setStepIndex(i)} aria-current={i === stepIndex ? 'step' : undefined}>
                <span className="stepper__dot">{i < stepIndex ? '✓' : i + 1}</span>
                <span className="stepper__label">{s.label}</span>
              </button>
            </li>
          );
        })}
      </ol>

      <section className="card wizard__card">
        <header className="wizard__header">
          <h1>{COPY[step].title}</h1>
          <p>{COPY[step].subtitle}</p>
        </header>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            next();
          }}
        >
          {step === 'origin' && (
            <PlaceAutocomplete
              key="origin"
              label="Starting point"
              placeholder="Search a city, address or place"
              value={draft.origin}
              onChange={(origin) => update({ origin })}
              autoFocus
            />
          )}
          {step === 'destination' && (
            <PlaceAutocomplete
              key="destination"
              label="Destination"
              placeholder="Search a city, address or place"
              value={draft.destination}
              onChange={(destination) => update({ destination })}
              bias={draft.origin?.location}
              autoFocus
            />
          )}
          {step === 'activities' && (
            <StepActivities
              activities={draft.activities}
              onChange={(activities) => update({ activities })}
              meals={draft.preferences.meals}
              onMealsChange={(meals) => update({ preferences: { ...draft.preferences, meals } })}
            />
          )}
          {step === 'lodging' && <StepLodging value={draft.lodgingType} onChange={(lodgingType) => update({ lodgingType })} />}
          {step === 'schedule' && (
            <StepSchedule
              departureDate={draft.departureDate}
              onDateChange={(departureDate) => update({ departureDate })}
              preferences={draft.preferences}
              onChange={(preferences) => update({ preferences })}
            />
          )}
          {step === 'review' && <StepReview draft={draft} onNameChange={(name) => update({ name })} />}

          {step === 'schedule' && !request.ok && <p className="field__error">{request.message}</p>}
          {create.isError && <ErrorNote error={create.error} />}

          <div className="wizard__nav">
            <button type="button" className="button button--ghost" disabled={stepIndex === 0} onClick={() => setStepIndex((i) => Math.max(0, i - 1))}>
              ← Back
            </button>
            {step === 'activities' && !canContinue && <span className="muted">Pick at least one activity</span>}
            {step === 'lodging' && !canContinue && <span className="muted">Choose where you'd like to sleep</span>}
            <button type="submit" className="button button--primary button--large" disabled={!canContinue || create.isPending}>
              {step === 'review' ? 'Plan my journey ✨' : 'Continue →'}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
