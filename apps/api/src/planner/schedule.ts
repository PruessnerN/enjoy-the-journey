import { MEALS, formatDuration, parseTimeOfDay, type Issue, type IssueCode } from '@journey/shared';
import { checkOpen } from '../geo/openingHours.js';
import { formatLocalTime, localTimeToEpoch, sunTimes, timeZoneAt } from '../geo/time.js';
import { placeKey } from './candidates.js';
import type { LegEstimate, SeqItem } from './sequence.js';
import { TUNING } from './tuning.js';

const MINUTE = 60_000;

export interface DayContext {
  /** Local calendar date the day starts on (YYYY-MM-DD). */
  date: string;
  /** Departure instant, epoch ms. */
  departure: number;
  startTime: string;
  timeZone: string;
  arriveByTime: string;
  avoidNightDriving: boolean;
  maxDrivingHours: number;
  isFinalDay: boolean;
  /** Finish this many minutes before hard limits (used while planning). */
  safetyMinutes?: number;
  /** Longest acceptable wait for a place to open; defaults to `TUNING.schedule.maxWaitForOpeningMinutes`. */
  maxOpeningWaitMinutes?: number;
}

export interface ScheduledItem {
  arrival: number;
  start: number;
  departure: number;
  waitMinutes: number;
  timeZone: string;
  issues: Issue[];
}

export interface DaySchedule {
  items: ScheduledItem[];
  breakMinutes: number[];
  arrival: number;
  driveSeconds: number;
  distanceMeters: number;
  issues: Issue[];
  /** Keys (`placeKey:code`) of issues that make a plan unacceptable. */
  blocking: Set<string>;
  /** True when the day ends too late (late arrival or driving after dark). */
  endBlocked: boolean;
}

/** Issues that the planner must not introduce. Users can still create them by editing. */
export const BLOCKING: ReadonlySet<IssueCode> = new Set([
  'closed',
  'after_dark',
  'meal_outside_window',
  'late_arrival',
  'night_driving',
  'pinned_late',
]);

export function breakMinutesFor(durationSeconds: number): number {
  const { everyDrivingMinutes, breakMinutes } = TUNING.restBreaks;
  return Math.floor(durationSeconds / 60 / everyDrivingMinutes) * breakMinutes;
}

/**
 * Walks the day in order and computes arrival/start/departure for every stop,
 * honouring meal windows, opening hours, daylight, pinned times and the arrive-by target.
 */
export function scheduleDay(items: SeqItem[], legs: LegEstimate[], ctx: DayContext): DaySchedule {
  const S = TUNING.schedule;
  const scheduled: ScheduledItem[] = [];
  const breaks: number[] = [];
  const blocking = new Set<string>();
  let endBlocked = false;
  const safety = (ctx.safetyMinutes ?? 0) * MINUTE;
  let t = ctx.departure;
  let driveSeconds = 0;
  let distanceMeters = 0;

  items.forEach((item, i) => {
    const leg = legs[i] ?? { durationSeconds: 0, distanceMeters: 0 };
    const breakMinutes = breakMinutesFor(leg.durationSeconds);
    breaks.push(breakMinutes);
    driveSeconds += leg.durationSeconds;
    distanceMeters += leg.distanceMeters;
    t += leg.durationSeconds * 1000 + breakMinutes * MINUTE;

    const arrival = t;
    const tz = item.place.timeZone ?? timeZoneAt(item.place.location);
    const isEnd = item.kind === 'lodging' || item.kind === 'destination';
    const duration = isEnd ? 0 : item.durationMinutes;
    const issues: Issue[] = [...(item.planningIssues ?? [])];
    const fmt = (epoch: number) => formatLocalTime(epoch, tz);
    // Meals are keyed by meal type so swapping the restaurant doesn't look like a new problem.
    const subject = item.kind === 'meal' && item.mealType ? `meal:${item.mealType}` : placeKey(item.place);
    const add = (code: IssueCode, message: string, severity: Issue['severity'] = 'warning') => {
      issues.push({ code, severity, message });
      if (BLOCKING.has(code)) blocking.add(`${subject}:${code}`);
    };
    let start = arrival;

    if (item.pinnedStart) {
      const pinned = localTimeToEpoch(ctx.date, parseTimeOfDay(item.pinnedStart), tz);
      if (pinned >= start) {
        start = pinned;
      } else if (arrival - pinned > 5 * MINUTE) {
        add('pinned_late', `You'll get here around ${fmt(arrival)}, after your planned ${fmt(pinned)} start.`);
      }
    }

    if (item.kind === 'meal' && item.mealType) {
      const meal = MEALS[item.mealType];
      const windowStart = localTimeToEpoch(ctx.date, parseTimeOfDay(meal.windowStart), tz);
      const windowEnd = localTimeToEpoch(ctx.date, parseTimeOfDay(meal.windowEnd), tz);
      // Dinner right before tonight's lodging can wait as long as needed: that's free time in town.
      const dinnerNearLodging = item.mealType === 'dinner' && i === items.length - 2 && items[items.length - 1]!.kind === 'lodging';
      if (start < windowStart) {
        const wait = windowStart - start;
        if (dinnerNearLodging || wait <= S.maxWaitForMealMinutes * MINUTE) {
          start = windowStart;
          if (wait >= S.freeTimeNoticeMinutes * MINUTE) {
            add('free_time', `About ${formatDuration(wait / 1000)} of free time before ${meal.label.toLowerCase()} — a good spot to add a stop.`, 'info');
          }
        } else {
          add('meal_outside_window', `${meal.label} at ${fmt(start)} is too early — ${meal.label.toLowerCase()} is usually ${fmt(windowStart)}–${fmt(windowEnd)}.`);
        }
      } else if (start > windowEnd) {
        add('meal_outside_window', `${meal.label} at ${fmt(start)} is late — ${meal.label.toLowerCase()} is usually ${fmt(windowStart)}–${fmt(windowEnd)}.`);
      }
    }

    if (!isEnd && item.place.openingHours?.length) {
      const status = checkOpen(item.place.openingHours, start, duration, tz, {
        maxWaitMinutes: ctx.maxOpeningWaitMinutes ?? S.maxWaitForOpeningMinutes,
        toleranceMinutes: S.closingToleranceMinutes,
      });
      if (status.status === 'opens_later') {
        start += status.waitMinutes * MINUTE;
        add('opens_later', `Opens at ${fmt(start)} — about ${Math.round(status.waitMinutes)} min wait.`, 'info');
      } else if (status.status === 'closed') {
        add(
          'closed',
          status.reason === 'closes_during_visit'
            ? `Closes before your visit would end (${fmt(start + duration * MINUTE)}).`
            : `Likely closed at ${fmt(start)}.`,
        );
      }
    }

    if (!isEnd && item.outdoor && duration > 0) {
      const sun = sunTimes(ctx.date, item.place.location, tz);
      if (sun) {
        const end = start + duration * MINUTE;
        if (end > sun.sunset + S.daylightToleranceMinutes * MINUTE - safety) {
          add('after_dark', `Outdoor stop ends after sunset (${fmt(sun.sunset)}).`);
        } else if (start < sun.sunrise - S.daylightToleranceMinutes * MINUTE) {
          add('after_dark', `Outdoor stop starts before sunrise (${fmt(sun.sunrise)}).`);
        }
      }
    }

    if (isEnd) {
      const latest = localTimeToEpoch(ctx.date, parseTimeOfDay(ctx.arriveByTime), tz);
      if (arrival > latest + S.lateArrivalToleranceMinutes * MINUTE - safety) {
        add('late_arrival', `Arrives around ${fmt(arrival)}, after your ${fmt(latest)} target.`);
        endBlocked = true;
      }
      if (ctx.avoidNightDriving) {
        const sun = sunTimes(ctx.date, item.place.location, tz);
        if (sun && arrival > sun.sunset + S.nightDrivingGraceMinutes * MINUTE - safety) {
          add('night_driving', `You'd be driving after dark — sunset is ${fmt(sun.sunset)}.`);
          endBlocked = true;
        }
      }
    }

    const departure = start + duration * MINUTE;
    scheduled.push({ arrival, start, departure, waitMinutes: Math.round((start - arrival) / MINUTE), timeZone: tz, issues });
    t = departure;
  });

  const issues: Issue[] = [];
  if (driveSeconds > ctx.maxDrivingHours * 3600 * TUNING.schedule.longDriveToleranceFactor) {
    issues.push({
      code: 'long_drive',
      severity: 'warning',
      message: `${formatDuration(driveSeconds)} of driving today — more than your ${ctx.maxDrivingHours}h daily comfort limit.`,
    });
  }

  return {
    items: scheduled,
    breakMinutes: breaks,
    arrival: scheduled[scheduled.length - 1]?.arrival ?? ctx.departure,
    driveSeconds,
    distanceMeters,
    issues,
    blocking,
    endBlocked,
  };
}
