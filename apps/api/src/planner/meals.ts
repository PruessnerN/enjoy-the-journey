import { MEALS, parseTimeOfDay, type MealType } from '@journey/shared';
import { checkOpen } from '../geo/openingHours.js';
import type { RouteProfile } from '../geo/routeProfile.js';
import { localTimeToEpoch, timeZoneAt } from '../geo/time.js';
import { meetsRating, placeKey, qualityScore, type Candidate, type MealCandidateMap } from './candidates.js';
import { scheduleDay, type DayContext } from './schedule.js';
import { estimateLegs, type SeqItem } from './sequence.js';
import { TUNING } from './tuning.js';

const MINUTE = 60_000;
/** We'll stop a little before mealtime and wait rather than skip a meal. */
const EARLY_SLACK_MINUTES = 30;

export interface MealPlacementInput {
  /** Non-meal stops (and any locked meals), sorted by route position. */
  items: SeqItem[];
  end: SeqItem;
  meals: MealType[];
  ctx: DayContext;
  profile: RouteProfile;
  restaurants: MealCandidateMap;
  usedKeys: ReadonlySet<string>;
  minRating: number;
  /** Allow leaving dinner for after check-in when it would otherwise force driving after dark. */
  allowSkippingDinner?: boolean;
}

export type MealPlacement =
  | { ok: true; items: SeqItem[]; skipped: MealType[] }
  | { ok: false; reason: string };

interface Slot {
  gap: number;
  tau: number;
  cost: number;
  gapStart: number;
  gapEnd: number;
  atEnd: boolean;
}

/**
 * Inserts each meal where the travellers will naturally be at mealtime. A meal can
 * happen in any driving gap that overlaps its window; we choose the gap whose time is
 * closest to the ideal meal time. If an activity swallows the entire window, the
 * combination is rejected so the planner tries something shorter or different.
 */
export function placeMeals(input: MealPlacementInput): MealPlacement {
  const { ctx, end, profile } = input;
  let items = [...input.items];
  const skipped: MealType[] = [];

  for (const mealType of input.meals) {
    const meal = MEALS[mealType];
    const full = [...items, end];
    const schedule = scheduleDay(full, estimateLegs(full, profile.averageSpeed), ctx);
    let best: Slot | null = null;

    for (let g = 0; g < full.length; g++) {
      const gapStart = g === 0 ? ctx.departure : schedule.items[g - 1]!.departure;
      const gapEnd = schedule.items[g]!.arrival;
      const tz = g === 0 ? ctx.timeZone : timeZoneAt(full[g - 1]!.place.location);
      const windowStart = localTimeToEpoch(ctx.date, parseTimeOfDay(meal.windowStart), tz);
      const windowEnd = localTimeToEpoch(ctx.date, parseTimeOfDay(meal.windowEnd), tz);
      const target = localTimeToEpoch(ctx.date, parseTimeOfDay(meal.target), tz);

      const lo = Math.max(gapStart, windowStart);
      const hi = Math.min(gapEnd, windowEnd);
      let slot: Slot | null = null;
      if (lo <= hi) {
        const tau = Math.min(Math.max(target, lo), hi);
        slot = { gap: g, tau, cost: Math.abs(tau - target), gapStart, gapEnd, atEnd: false };
      } else if (gapEnd < windowStart && windowStart - gapEnd <= EARLY_SLACK_MINUTES * MINUTE && g < full.length - 1) {
        // Arrive just before mealtime: eat near the next stop after a short wait.
        const wait = windowStart - gapEnd;
        slot = { gap: g, tau: gapEnd, cost: Math.abs(windowStart - target) + wait * 1.5, gapStart, gapEnd, atEnd: false };
      }
      if (slot && (!best || slot.cost < best.cost)) best = slot;
    }

    if (!best) {
      const startWindowEnd = localTimeToEpoch(ctx.date, parseTimeOfDay(meal.windowEnd), ctx.timeZone);
      if (startWindowEnd <= ctx.departure) continue; // Mealtime is over before we leave.
      const endTz = timeZoneAt(end.place.location);
      const endWindowStart = localTimeToEpoch(ctx.date, parseTimeOfDay(meal.windowStart), endTz);
      if (endWindowStart >= schedule.arrival) {
        // We arrive before mealtime. On the last day the travellers eat at their destination;
        // otherwise dinner happens near tonight's lodging.
        if (ctx.isFinalDay || mealType !== 'dinner') continue;
        const g = full.length - 1;
        best = { gap: g, tau: endWindowStart, cost: 0, gapStart: schedule.arrival, gapEnd: schedule.arrival, atEnd: true };
      } else {
        return { ok: false, reason: `${meal.label} time is fully taken by other stops` };
      }
    }

    const fromSeconds = best.gap === 0 ? 0 : full[best.gap - 1]!.seconds;
    const toSeconds = full[best.gap]!.seconds;
    const span = best.gapEnd - best.gapStart;
    const fraction = best.atEnd ? 1 : span > 0 ? (best.tau - best.gapStart) / span : 1;
    const seconds = fromSeconds + Math.min(1, Math.max(0, fraction)) * (toSeconds - fromSeconds);
    const taken = new Set([...input.usedKeys, ...items.map((i) => placeKey(i.place))]);
    const stop = chooseRestaurant(mealType, seconds, best.tau, input, taken);
    const withMeal = [...items.slice(0, best.gap), stop, ...items.slice(best.gap)];

    // Short winter days: rather than drive after dark, have dinner in town after check-in.
    if (input.allowSkippingDinner && mealType === 'dinner' && !ctx.isFinalDay && !schedule.endBlocked) {
      const fullWithMeal = [...withMeal, end];
      if (scheduleDay(fullWithMeal, estimateLegs(fullWithMeal, profile.averageSpeed), ctx).endBlocked) {
        skipped.push(mealType);
        continue;
      }
    }
    items = withMeal;
  }

  return { ok: true, items, skipped };
}

function chooseRestaurant(
  mealType: MealType,
  seconds: number,
  tau: number,
  input: MealPlacementInput,
  taken: ReadonlySet<string>,
): SeqItem {
  const meal = MEALS[mealType];
  const { maxDetourMinutes, maxRouteOffsetMinutes, routeOffsetPenaltyPerHour } = TUNING.meals;
  let best: { candidate: Candidate; score: number } | null = null;

  for (const c of input.restaurants[mealType]) {
    if (taken.has(c.key)) continue;
    if (Math.abs(c.seconds - seconds) > maxRouteOffsetMinutes * 60) continue;
    if (c.detourSeconds > maxDetourMinutes * 60) continue;
    if (!meetsRating(c.place, input.minRating, false)) continue;
    const tz = c.place.timeZone ?? timeZoneAt(c.place.location);
    const arrivalGuess = tau + (c.seconds - seconds) * 1000;
    const open = checkOpen(c.place.openingHours, Math.max(tau, arrivalGuess), meal.durationMinutes, tz, {
      maxWaitMinutes: 20,
      toleranceMinutes: TUNING.schedule.closingToleranceMinutes,
    });
    if (open.status === 'closed') continue;
    const score =
      qualityScore(c.place) -
      (c.detourSeconds / 3600) * TUNING.scoring.detourPenaltyPerHour -
      (Math.abs(c.seconds - seconds) / 3600) * routeOffsetPenaltyPerHour;
    if (!best || score > best.score) best = { candidate: c, score };
  }

  if (best) {
    const c = best.candidate;
    return {
      kind: 'meal',
      mealType,
      place: c.place,
      durationMinutes: meal.durationMinutes,
      seconds: c.seconds,
      detourSeconds: c.detourSeconds,
      source: 'planner',
      activityLabel: meal.label,
      emoji: meal.emoji,
    };
  }

  const point = input.profile.pointAtSeconds(seconds);
  return {
    kind: 'meal',
    mealType,
    place: {
      name: `${meal.label} stop`,
      location: point,
      googleMapsUri: `https://www.google.com/maps/search/restaurants/@${point.lat.toFixed(5)},${point.lng.toFixed(5)},13z`,
    },
    durationMinutes: meal.durationMinutes,
    seconds,
    detourSeconds: 0,
    source: 'planner',
    activityLabel: meal.label,
    emoji: meal.emoji,
    planningIssues: [
      {
        code: 'no_restaurant_found',
        severity: 'warning',
        message: `No open restaurants rated ${input.minRating}+ near this part of the drive. Use "Swap" to search nearby.`,
      },
    ],
  };
}
