import { MEALS, type ActivityRequest, type Issue, type MealType } from '@journey/shared';
import type { RouteProfile } from '../geo/routeProfile.js';
import { activityScore, meetsRating, placeKey, type Candidate, type MealCandidateMap } from './candidates.js';
import { placeMeals } from './meals.js';
import { scheduleDay, type DayContext, type DaySchedule } from './schedule.js';
import { estimateLegs, type SeqItem } from './sequence.js';
import { TUNING } from './tuning.js';
import type { TripPosition, TripUsage } from './usage.js';

export interface DayPlanInput {
  profile: RouteProfile;
  ctx: DayContext;
  /** Tonight's lodging, or the destination on the final day. */
  end: SeqItem;
  activities: ActivityRequest[];
  activityCandidates: Map<string, Candidate[]>;
  mealCandidates: MealCandidateMap;
  meals: MealType[];
  usage: TripUsage;
  /** Stops the user locked; they are always kept. */
  locked: SeqItem[];
  /** Places to avoid (e.g. when asking for fresh ideas). */
  excludeKeys: ReadonlySet<string>;
  minRating: number;
  maxDetourMinutes: number;
  position: TripPosition;
  /** Cap on activity stops (including the user's own) per day; null = no limit. */
  maxActivitiesPerDay: number | null;
}

export interface DayPlanResult {
  items: SeqItem[];
  issues: Issue[];
}

interface Evaluation {
  activities: SeqItem[];
  items: SeqItem[];
  schedule: DaySchedule;
  skippedMeals: MealType[];
}

/**
 * Builds one day greedily: start from the fixed endpoints (and any locked stops),
 * then repeatedly try to add the best remaining candidate for each activity. A
 * candidate is kept only if the whole day still works: meals land in their windows,
 * places are open, outdoor stops end before dark and we arrive on time.
 */
export function planDay(input: DayPlanInput): DayPlanResult {
  const { end, profile, usage } = input;
  const ctx = {
    ...input.ctx,
    safetyMinutes: TUNING.schedule.planningSafetyMinutes,
    maxOpeningWaitMinutes: TUNING.schedule.planningMaxOpeningWaitMinutes,
  };
  const lockedMeals = new Set(input.locked.filter((i) => i.kind === 'meal' && i.mealType).map((i) => i.mealType!));
  let mealsToPlace = input.meals.filter((m) => !lockedMeals.has(m));
  let allowSkippingDinner = true;

  const evaluate = (activities: SeqItem[], withMeals = true): Evaluation | null => {
    const sorted = [...activities].sort((a, b) => a.seconds - b.seconds);
    const placement = placeMeals({
      items: sorted,
      end,
      meals: withMeals ? mealsToPlace : [],
      ctx,
      profile,
      restaurants: input.mealCandidates,
      usedKeys: new Set([...usage.usedKeys, ...input.excludeKeys]),
      minRating: input.minRating,
      allowSkippingDinner,
    });
    if (!placement.ok) return null;
    const items = [...placement.items, end];
    return {
      activities,
      items,
      schedule: scheduleDay(items, estimateLegs(items, profile.averageSpeed), ctx),
      skippedMeals: placement.skipped,
    };
  };

  let current = evaluate(input.locked) ?? evaluate(input.locked, false)!;
  // Only a day that can't fit dinner even without activities (short winter days) skips it;
  // activities must never crowd out a meal.
  const skippedMeals = current.skippedMeals;
  mealsToPlace = mealsToPlace.filter((m) => !skippedMeals.includes(m));
  allowSkippingDinner = false;
  const dayCounts = new Map<string, number>();
  // Activities arrive ranked by the user, most important first, so higher-ranked activities get
  // first claim on the day's time. (Older trips may carry a "must do" flag; those still go first.)
  const ordered = [...input.activities].sort((a, b) => Number(b.priority === 'high') - Number(a.priority === 'high'));
  const limit = input.maxActivitiesPerDay ?? Number.POSITIVE_INFINITY;

  fill: for (let pass = 0; pass < TUNING.maxFillPasses && !current.schedule.endBlocked; pass++) {
    let added = false;
    for (const activity of ordered) {
      if (activityStopCount(current.items) >= limit) break fill;
      if (!usage.canUse(activity, dayCounts, input.position)) continue;
      const inDay = new Set(current.items.map((i) => placeKey(i.place)));
      // Meals are re-placed on every trial, so only fixed stops anchor the spacing.
      const anchors = current.items.filter((i) => i.kind !== 'meal').map((i) => i.seconds);
      // Within an activity, the best-rated spot wins, nudged by detour length and by spacing along the drive.
      const candidateRank = (c: Candidate) => activityScore(c, activity) + spreadBonus(c.seconds, anchors);
      const pool = (input.activityCandidates.get(activity.id) ?? [])
        .filter(
          (c) =>
            !usage.isUsed(c.key) &&
            !input.excludeKeys.has(c.key) &&
            !inDay.has(c.key) &&
            c.detourSeconds <= input.maxDetourMinutes * 60 &&
            meetsRating(c.place, input.minRating, true),
        )
        .sort((a, b) => candidateRank(b) - candidateRank(a))
        .slice(0, TUNING.scoring.candidatesToTry);

      const durations = [...new Set([activity.durationMinutes, activity.minDurationMinutes])];
      search: for (const candidate of pool) {
        for (const duration of durations) {
          const trial = evaluate([...current.activities, activityItem(candidate, activity, duration)]);
          if (trial && isImprovement(trial.schedule, current.schedule)) {
            current = trial;
            dayCounts.set(activity.id, (dayCounts.get(activity.id) ?? 0) + 1);
            added = true;
            break search;
          }
        }
      }
    }
    if (!added) break;
  }

  const issues: Issue[] = skippedMeals.map((meal) => ({
    code: 'meal_skipped' as const,
    severity: 'info' as const,
    message: `${MEALS[meal].label} is left for after you check in, so you're not on the road after dark.`,
  }));
  const hasActivities = current.items.some((i) => i.kind === 'activity' || i.kind === 'custom');
  if (!hasActivities && input.activities.length > 0) {
    const anyCandidates = input.activities.some((a) => (input.activityCandidates.get(a.id)?.length ?? 0) > 0);
    issues.push({
      code: 'no_activities_found',
      severity: 'info',
      message: anyCandidates
        ? 'No activities fit into today without arriving late. Try a longer day, a bigger detour limit or add a stop yourself.'
        : 'We could not find any of your activities near today\'s route. Use "Add a stop" to search for something else.',
    });
  }
  return { items: current.items, issues };
}

export function activityStopCount(items: readonly SeqItem[]): number {
  return items.filter((i) => i.kind === 'activity' || i.kind === 'custom').length;
}

/**
 * Rewards candidates that break up long stretches of driving: the further a candidate is (in
 * drive time) from the day's start and from the nearest fixed stop, the higher the bonus.
 */
export function spreadBonus(seconds: number, anchors: readonly number[]): number {
  let nearest = seconds; // distance back to the day's start
  for (const a of anchors) nearest = Math.min(nearest, Math.abs(seconds - a));
  const { spreadBonusPerHour, spreadMaxHours } = TUNING.scoring;
  return Math.min(nearest / 3600, spreadMaxHours) * spreadBonusPerHour;
}

/** Accept a change only if it introduces no new blocking problems. */
function isImprovement(trial: DaySchedule, current: DaySchedule): boolean {
  if (current.endBlocked) return false;
  for (const key of trial.blocking) {
    if (!current.blocking.has(key)) return false;
  }
  return true;
}

function activityItem(candidate: Candidate, activity: ActivityRequest, durationMinutes: number): SeqItem {
  return {
    kind: 'activity',
    place: candidate.place,
    durationMinutes,
    seconds: candidate.seconds,
    detourSeconds: candidate.detourSeconds,
    outdoor: activity.outdoor,
    source: 'planner',
    activityId: activity.id,
    activityLabel: activity.label,
    ...(activity.emoji ? { emoji: activity.emoji } : {}),
    activity,
  };
}
