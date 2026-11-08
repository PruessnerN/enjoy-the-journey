import type { Stop, StopInput, TripDay } from '@journey/shared';

/** Strips computed timeline fields so a stop can be sent back to the API. */
export function toStopInput(stop: Stop | StopInput): StopInput {
  const input: StopInput = {
    kind: stop.kind,
    place: stop.place,
    durationMinutes: stop.durationMinutes,
  };
  if (stop.id) input.id = stop.id;
  if (stop.activityId) input.activityId = stop.activityId;
  if (stop.activityLabel) input.activityLabel = stop.activityLabel;
  if (stop.emoji) input.emoji = stop.emoji;
  if (stop.mealType) input.mealType = stop.mealType;
  if (stop.lodgingType) input.lodgingType = stop.lodgingType;
  if (stop.eventId) input.eventId = stop.eventId;
  if (stop.pinnedStart) input.pinnedStart = stop.pinnedStart;
  if (stop.arriveBy) input.arriveBy = stop.arriveBy;
  if (stop.locked !== undefined) input.locked = stop.locked;
  if (stop.outdoor !== undefined) input.outdoor = stop.outdoor;
  if (stop.notes) input.notes = stop.notes;
  if (stop.links?.length) input.links = stop.links;
  if (stop.source) input.source = stop.source;
  return input;
}

export type DayEdit =
  | { type: 'remove'; stopId: string }
  | { type: 'move'; stopId: string; direction: -1 | 1 }
  | { type: 'replace'; stopId: string; stop: StopInput }
  | { type: 'insert'; index: number; stop: StopInput }
  | { type: 'toggleLock'; stopId: string };

/**
 * Applies an edit to a day's stops. The last stop (lodging or destination) always stays last.
 * Any stop the user touches becomes locked so regenerating the day keeps it.
 */
export function applyDayEdit(day: TripDay, edit: DayEdit): StopInput[] {
  const stops = day.stops.map(toStopInput);
  const end = stops.length - 1;
  const indexOf = (id: string) => stops.findIndex((s) => s.id === id);

  switch (edit.type) {
    case 'remove': {
      const i = indexOf(edit.stopId);
      if (i < 0 || i === end) return stops;
      return stops.filter((_, k) => k !== i);
    }
    case 'move': {
      const i = indexOf(edit.stopId);
      const j = i + edit.direction;
      if (i < 0 || i === end || j < 0 || j >= end) return stops;
      const next = [...stops];
      [next[i], next[j]] = [{ ...next[j]! }, { ...next[i]!, locked: true }];
      return next;
    }
    case 'replace': {
      const i = indexOf(edit.stopId);
      if (i < 0) return stops;
      return stops.map((s, k) => (k === i ? { ...edit.stop, locked: edit.stop.locked ?? true } : s));
    }
    case 'insert': {
      const index = Math.max(0, Math.min(edit.index, end));
      return [...stops.slice(0, index), { ...edit.stop, locked: true, source: 'user' }, ...stops.slice(index)];
    }
    case 'toggleLock': {
      return stops.map((s) => (s.id === edit.stopId ? { ...s, locked: !s.locked } : s));
    }
  }
}
