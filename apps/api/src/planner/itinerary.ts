import { parseTimeOfDay, type MainEvent, type PlaceInfo, type TripPreferences, type TripRequest } from '@journey/shared';
import { PlanningError } from './errors.js';

/**
 * One drive between two places the travellers sleep at: the origin, a main event they stay at
 * overnight, or the destination. Main events of a few hours are visited along the way.
 */
export interface TripSegment {
  index: number;
  from: PlaceInfo;
  to: PlaceInfo;
  /** The main event this drive ends at, when staying there overnight; null for the destination. */
  endEvent: MainEvent | null;
  /** Main events of a few hours visited on this drive, in order. */
  stops: MainEvent[];
}

export function tripSegments(request: TripRequest): TripSegment[] {
  const segments: TripSegment[] = [];
  let from = request.origin;
  let stops: MainEvent[] = [];
  for (const event of request.mainEvents ?? []) {
    if (event.stayUnit === 'hours') {
      stops.push(event);
      continue;
    }
    segments.push({ index: segments.length, from, to: event.place, endEvent: event, stops });
    from = event.place;
    stops = [];
  }
  segments.push({ index: segments.length, from, to: request.destination, endEvent: null, stops });
  return segments;
}

/** Whole days from the departure date to `date` (both YYYY-MM-DD). */
export function dayIndexOf(departureDate: string, date: string): number {
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${departureDate}T00:00:00Z`)) / 86_400_000);
}

/** A few-hours main event, located on its segment's route. */
export interface StopTiming {
  /** Drive seconds from the segment's start. */
  position: number;
  durationSeconds: number;
  /** Trip day it must happen on, if dated. */
  day: number | null;
  /** How far through the travel day it should happen (0–1). */
  dayFraction: number;
}

export interface SegmentTiming {
  driveSeconds: number;
  stops: StopTiming[];
  /** Days the drive needs at the travellers' pace. */
  naturalDays: number;
  /** Trip day the segment must arrive on, if its main event is dated. */
  endDay: number | null;
}

/** Where the time-of-day of a dated event falls within the travel day, so nights split around it. */
export function dayFractionFor(time: string | null | undefined, prefs: Pick<TripPreferences, 'dayStartTime' | 'arriveByTime'>): number {
  if (!time) return 0.5;
  const start = parseTimeOfDay(prefs.dayStartTime);
  const end = parseTimeOfDay(prefs.arriveByTime);
  return Math.min(0.9, Math.max(0.1, (parseTimeOfDay(time) - start) / Math.max(60, end - start)));
}

export interface DayAllocation {
  /** Driving days per segment. */
  days: number[];
  /** Trip day each segment starts on. */
  startDays: number[];
  totalDays: number;
  /** Things the travellers should know about how the dates worked out. */
  notes: string[];
}

interface AllocateArgs {
  segments: readonly TripSegment[];
  timings: readonly SegmentTiming[];
  fixedDays: number | null;
}

/**
 * Decides how many driving days each segment gets. Dated main events fix when segments must
 * arrive; extra time before a date becomes a more leisurely drive. A fixed trip length is met by
 * adjusting the segments after the last dated event.
 */
export function allocateDays({ segments, timings, fixedDays }: AllocateArgs): DayAllocation {
  const notes: string[] = [];
  const dated = (s: number) => timings[s]!.endDay !== null || timings[s]!.stops.some((t) => t.day !== null);
  const lastDated = segments.reduce((last, _, s) => (dated(s) ? s : last), -1);

  const pass = (overrides: ReadonlyMap<number, number>, collectNotes: boolean): Omit<DayAllocation, 'notes'> => {
    const days: number[] = [];
    const startDays: number[] = [];
    let start = 0;
    segments.forEach((segment, s) => {
      const timing = timings[s]!;
      const name = (event: MainEvent) => event.place.name.split(',')[0];
      const minDays = Math.max(1, ...timing.stops.map((t) => (t.day === null ? 1 : t.day - start + 1)));
      for (const [i, stop] of timing.stops.entries()) {
        if (stop.day !== null && stop.day < start) {
          throw new PlanningError(`The trip can't reach ${name(segment.stops[i]!)} by ${segment.stops[i]!.arrivalDate}. Pick a later date or remove an earlier stay.`);
        }
      }
      let n: number;
      if (timing.endDay !== null) {
        n = timing.endDay - start + 1;
        if (n < 1) {
          throw new PlanningError(`The trip can't reach ${name(segment.endEvent!)} by ${segment.endEvent!.arrivalDate}. Pick a later date or shorten an earlier stay.`);
        }
        if (n < minDays) {
          throw new PlanningError(`${name(segment.endEvent!)} is dated before a main event on the way to it. Reorder them or change the dates.`);
        }
        if (collectNotes && n < timing.naturalDays) {
          notes.push(`Getting to ${name(segment.endEvent!)} by ${segment.endEvent!.arrivalDate} means longer driving days than your pace.`);
        }
      } else {
        n = Math.max(overrides.get(s) ?? timing.naturalDays, minDays);
      }
      days.push(n);
      startDays.push(start);
      const nights = segment.endEvent?.stayAmount ?? 0;
      start += n - 1 + nights;
    });
    return { days, startDays, totalDays: start + 1 };
  };

  let result = pass(new Map(), true);
  if (fixedDays !== null && fixedDays !== result.totalDays) {
    const adjustable = segments.map((_, s) => s).filter((s) => s > lastDated);
    const days = new Map(adjustable.map((s) => [s, result.days[s]!]));
    const effort = (s: number) => timings[s]!.driveSeconds + timings[s]!.stops.reduce((sum, t) => sum + t.durationSeconds, 0);
    let diff = fixedDays - result.totalDays;
    while (diff !== 0 && adjustable.length > 0) {
      // Add a day where days are fullest, or take one where they are emptiest.
      const perDay = (s: number, n: number) => effort(s) / n;
      const options = adjustable.filter((s) => diff > 0 || days.get(s)! > 1);
      if (options.length === 0) break;
      const pick = options.reduce((best, s) =>
        diff > 0
          ? perDay(s, days.get(s)!) > perDay(best, days.get(best)!) ? s : best
          : perDay(s, days.get(s)! - 1) < perDay(best, days.get(best)! - 1) ? s : best,
      );
      days.set(pick, days.get(pick)! + Math.sign(diff));
      diff -= Math.sign(diff);
    }
    result = pass(days, false);
    if (result.totalDays !== fixedDays) {
      notes.push(
        `Your main event dates and stays need ${result.totalDays} days, so the trip is ${result.totalDays} days instead of ${fixedDays}.`,
      );
    }
  }
  return { ...result, notes };
}

/**
 * Where (in drive seconds along the segment) each night of a segment should fall. Driving and
 * few-hours events are split evenly across days, except that dated events land on their day.
 */
export function nightTargets(timing: Pick<SegmentTiming, 'driveSeconds' | 'stops'>, dayCount: number, startDay: number): number[] {
  if (dayCount <= 1) return [];
  // "Effort" = drive time plus time spent at events up to a point along the route.
  let spent = 0;
  const stops = timing.stops.map((t) => {
    const effort = t.position + spent;
    spent += t.durationSeconds;
    return { ...t, effort };
  });
  const totalEffort = timing.driveSeconds + spent;

  const anchors: { day: number; effort: number }[] = [{ day: 0, effort: 0 }];
  for (const stop of stops) {
    if (stop.day === null) continue;
    const day = Math.max(anchors[anchors.length - 1]!.day + 0.01, stop.day - startDay + stop.dayFraction);
    anchors.push({ day: Math.min(day, dayCount - 0.01), effort: stop.effort });
  }
  anchors.push({ day: dayCount, effort: totalEffort });

  const effortAt = (day: number): number => {
    for (let i = 1; i < anchors.length; i++) {
      const a = anchors[i - 1]!;
      const b = anchors[i]!;
      if (day <= b.day) return a.effort + ((b.effort - a.effort) * (day - a.day)) / Math.max(1e-6, b.day - a.day);
    }
    return totalEffort;
  };
  const routeSecondsAt = (effort: number): number => {
    let skipped = 0;
    for (const stop of stops) {
      if (effort <= stop.effort) break;
      // A night that would fall during an event starts right after it.
      if (effort <= stop.effort + stop.durationSeconds) return stop.position;
      skipped += stop.durationSeconds;
    }
    return effort - skipped;
  };

  return Array.from({ length: dayCount - 1 }, (_, k) => Math.min(timing.driveSeconds, Math.max(0, routeSecondsAt(effortAt(k + 1)))));
}
