import {
  DEFAULT_PREFERENCES,
  addDaysToIsoDate,
  tripRequestSchema,
  type ActivityRequest,
  type LodgingType,
  type PlaceInfo,
  type TripPreferences,
  type TripRequest,
} from '@journey/shared';
import { todayIso } from '../lib/time';

export interface TripDraft {
  name: string;
  origin: PlaceInfo | null;
  destination: PlaceInfo | null;
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
    destination: request.destination,
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
      return draft.destination !== null;
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
  const result = tripRequestSchema.safeParse({
    ...(draft.name.trim() ? { name: draft.name.trim() } : {}),
    origin: draft.origin,
    destination: draft.destination,
    activities: draft.activities,
    lodgingType: draft.lodgingType,
    departureDate: draft.departureDate,
    preferences: draft.preferences,
  });
  if (result.success) return { ok: true, request: result.data };
  const issue = result.error.issues[0];
  return { ok: false, message: issue?.message ?? 'Please complete every step.' };
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
