import {
  DEFAULT_PREFERENCES,
  addDaysToIsoDate,
  mainEventSchema,
  tripRequestSchema,
  type ActivityRequest,
  type LodgingType,
  type MainEvent,
  type PlaceInfo,
  type StayUnit,
  type TripPreferences,
  type TripRequest,
} from '@journey/shared';
import { randomId } from '../lib/id';
import { todayIso } from '../lib/time';

/** A main event while it's being entered (the place may not be chosen yet). */
export interface MainEventDraft {
  id: string;
  place: PlaceInfo | null;
  stayUnit: StayUnit;
  stayAmount: number;
  arrivalDate: string | null;
  arrivalTime: string | null;
}

export interface TripDraft {
  name: string;
  origin: PlaceInfo | null;
  destination: PlaceInfo | null;
  /** Ordered places the trip is built around, visited before the destination. */
  mainEvents: MainEventDraft[];
  /** End back at the origin instead of at `destination`. */
  roundTrip: boolean;
  activities: ActivityRequest[];
  lodgingType: LodgingType | null;
  departureDate: string;
  preferences: TripPreferences;
}

export const STEPS = [
  { id: 'origin', label: 'Start' },
  { id: 'destination', label: 'Destination' },
  { id: 'activities', label: 'Activities' },
  { id: 'lodging', label: 'Lodging' },
  { id: 'schedule', label: 'Schedule' },
  { id: 'review', label: 'Review' },
] as const;

export type StepId = (typeof STEPS)[number]['id'];

function nextSaturday(): string {
  const today = todayIso();
  const weekday = new Date(`${today}T12:00:00Z`).getUTCDay();
  return addDaysToIsoDate(today, ((6 - weekday + 7) % 7) || 7);
}

export function emptyDraft(): TripDraft {
  return {
    name: '',
    origin: null,
    destination: null,
    mainEvents: [],
    roundTrip: false,
    activities: [],
    lodgingType: null,
    departureDate: nextSaturday(),
    preferences: structuredClone(DEFAULT_PREFERENCES),
  };
}

export function draftFromRequest(request: TripRequest, name = ''): TripDraft {
  // Older trips marked some activities "must do"; those become the top of the ranking.
  const ranked = [...request.activities]
    .sort((a, b) => Number(b.priority === 'high') - Number(a.priority === 'high'))
    .map((a) => ({ ...a, priority: 'normal' as const }));
  return {
    name,
    origin: request.origin,
    destination: request.roundTrip ? null : request.destination,
    mainEvents: (request.mainEvents ?? []).map((e) => ({
      id: e.id,
      place: e.place,
      stayUnit: e.stayUnit,
      stayAmount: e.stayAmount,
      arrivalDate: e.arrivalDate ?? null,
      arrivalTime: e.arrivalTime ?? null,
    })),
    roundTrip: request.roundTrip ?? false,
    activities: ranked,
    lodgingType: request.lodgingType,
    departureDate: request.departureDate,
    preferences: request.preferences,
  };
}

export function isStepComplete(step: StepId, draft: TripDraft): boolean {
  switch (step) {
    case 'origin':
      return draft.origin !== null;
    case 'destination':
      return destinationProblem(draft) === null;
    case 'activities':
      return draft.activities.length > 0;
    case 'lodging':
      return draft.lodgingType !== null;
    case 'schedule':
    case 'review':
      return toRequest(draft).ok;
  }
}

export function toRequest(draft: TripDraft): { ok: true; request: TripRequest } | { ok: false; message: string } {
  const problem = draft.origin ? destinationProblem(draft) : 'Choose where the journey begins';
  if (problem) return { ok: false, message: problem };
  const result = tripRequestSchema.safeParse({
    ...(draft.name.trim() ? { name: draft.name.trim() } : {}),
    origin: draft.origin,
    destination: draft.roundTrip ? draft.origin : draft.destination,
    ...(draft.mainEvents.length ? { mainEvents: draft.mainEvents.map(toMainEvent) } : {}),
    ...(draft.roundTrip ? { roundTrip: true } : {}),
    activities: draft.activities,
    lodgingType: draft.lodgingType,
    departureDate: draft.departureDate,
    preferences: draft.preferences,
  });
  if (result.success) return { ok: true, request: result.data };
  const issue = result.error.issues[0];
  return { ok: false, message: issue?.message ?? 'Please complete every step.' };
}

export function newMainEvent(): MainEventDraft {
  return { id: randomId(), place: null, stayUnit: 'nights', stayAmount: 1, arrivalDate: null, arrivalTime: null };
}

function toMainEvent(e: MainEventDraft): Partial<MainEvent> {
  return {
    id: e.id,
    ...(e.place ? { place: e.place } : {}),
    stayUnit: e.stayUnit,
    stayAmount: e.stayAmount,
    ...(e.arrivalDate ? { arrivalDate: e.arrivalDate } : {}),
    ...(e.arrivalDate && e.arrivalTime ? { arrivalTime: e.arrivalTime } : {}),
  };
}

/** Why the destination step isn't complete yet, or null when it is. */
export function destinationProblem(draft: TripDraft): string | null {
  if (!draft.roundTrip && !draft.destination) return 'Choose where you are headed';
  if (draft.roundTrip && draft.mainEvents.length === 0) return 'Add at least one main event for a round trip';
  let previous = '';
  for (const [i, event] of draft.mainEvents.entries()) {
    if (!event.place) return `Choose a place for main event ${i + 1}, or remove it`;
    const result = mainEventSchema.safeParse(toMainEvent(event));
    if (!result.success) return result.error.issues[0]?.message ?? `Check main event ${i + 1}`;
    if (event.arrivalDate) {
      if (event.arrivalDate < previous) return `${event.place.name.split(',')[0]} is dated before an earlier main event`;
      previous = event.arrivalDate;
    }
  }
  return null;
}

const STORAGE_KEY = 'ejt.draft.v1';

export function loadDraft(): TripDraft {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (raw) return { ...emptyDraft(), ...(JSON.parse(raw) as Partial<TripDraft>) };
  } catch {
    // Ignore corrupt drafts.
  }
  return emptyDraft();
}

export function saveDraft(draft: TripDraft | null): void {
  try {
    if (draft) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
    else sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage may be unavailable (private mode); drafts are a convenience only.
  }
}
