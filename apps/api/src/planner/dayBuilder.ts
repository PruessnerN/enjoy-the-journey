import type { PlaceInfo, TripDay } from '@journey/shared';
import type { DataProvider } from '../providers/types.js';
import { placeKey, type Candidate } from './candidates.js';
import { planDay, type DayPlanInput } from './dayPlanner.js';
import { finalizeDay } from './finalize.js';
import { BLOCKING } from './schedule.js';
import type { SeqItem } from './sequence.js';
import { TUNING } from './tuning.js';

export interface BuildDayArgs extends DayPlanInput {
  provider: DataProvider;
  index: number;
  start: PlaceInfo;
}

export interface BuiltDay {
  day: TripDay;
  items: SeqItem[];
}

/** Plans a day, routes it for real, and repairs it if real drive times break it. */
export async function buildDay(args: BuildDayArgs): Promise<BuiltDay> {
  return repairDay(args, await planAndFinalize(args, args.excludeKeys));
}

/**
 * Planning uses estimated detours. If the real routing shows the day doesn't work (late
 * arrival, closed, after dark), record the measured detours on the candidates and plan the day
 * again. If no estimate was off, drop the most troublesome stop instead so each round makes progress.
 */
export async function repairDay(args: BuildDayArgs, first: BuiltDay): Promise<BuiltDay> {
  const exclude = new Set(args.excludeKeys);
  const pools = [...args.activityCandidates.values(), ...Object.values(args.mealCandidates)];
  let current = first;
  let best = { ...first, problems: plannerProblems(first.day) };

  for (let round = 1; round < TUNING.repair.maxRounds && best.problems > 0; round++) {
    if (current.day.legs.some((l) => l.estimated)) break; // No real routing to learn from.
    if (!calibrateDetours(current.items, current.day.legs, pools)) {
      const worst = worstStop(current.items, current.day);
      if (!worst) break;
      exclude.add(worst);
    }
    current = await planAndFinalize(args, exclude);
    const problems = plannerProblems(current.day);
    if (problems < best.problems) best = { ...current, problems };
  }
  return { day: best.day, items: best.items };
}

async function planAndFinalize(args: BuildDayArgs, excludeKeys: ReadonlySet<string>): Promise<BuiltDay> {
  const { provider, index, start, ...input } = args;
  const plan = planDay({ ...input, excludeKeys });
  const day = await finalizeDay({ provider, index, ctx: input.ctx, start, items: plan.items, extraIssues: plan.issues });
  return { day, items: plan.items };
}

/** Problems the planner caused and could avoid (problems on stops the user locked don't count). */
export function plannerProblems(day: TripDay): number {
  return day.stops.reduce((count, stop) => {
    const isEnd = stop.kind === 'lodging' || stop.kind === 'destination';
    if (stop.locked && !isEnd) return count;
    return count + stop.issues.filter((i) => BLOCKING.has(i.code)).length;
  }, 0);
}

/**
 * Real extra drive time each stop costs: the real legs into and out of it minus the planner's
 * estimate of driving straight from its previous stop to its next one.
 */
export function measuredDetours(items: readonly SeqItem[], legs: readonly { durationSeconds: number }[]): number[] {
  return items.map((item, i) => {
    const next = items[i + 1];
    if (!next) return item.detourSeconds;
    const prev = i === 0 ? { seconds: 0, detourSeconds: 0 } : items[i - 1]!;
    const direct = Math.abs(next.seconds - prev.seconds) + prev.detourSeconds / 2 + next.detourSeconds / 2;
    const real = (legs[i]?.durationSeconds ?? 0) + (legs[i + 1]?.durationSeconds ?? 0);
    return Math.max(0, real - direct);
  });
}

/**
 * Re-estimates the detour of the stop whose real detour was most underestimated. Only one stop per
 * round: a slow stop also inflates its neighbours' measurements (by about half), so the largest
 * excess is the real culprit. Returns true if a candidate changed.
 */
export function calibrateDetours(items: readonly SeqItem[], legs: readonly { durationSeconds: number }[], pools: Candidate[][]): boolean {
  const measured = measuredDetours(items, legs);
  const threshold = TUNING.repair.detourErrorThresholdMinutes * 60;
  let worst: { key: string; real: number; excess: number } | null = null;
  items.forEach((item, i) => {
    if (item.source !== 'planner' || item.locked || (item.kind !== 'activity' && item.kind !== 'meal')) return;
    const real = measured[i]!;
    const excess = real - item.detourSeconds;
    if (excess > threshold && (!worst || excess > worst.excess)) worst = { key: placeKey(item.place), real, excess };
  });
  if (!worst) return false;
  const { key, real } = worst;
  let changed = false;
  for (const pool of pools) {
    for (const c of pool) {
      if (c.key !== key || c.detourSeconds >= real) continue;
      c.score -= ((real - c.detourSeconds) / 3600) * TUNING.scoring.detourPenaltyPerHour;
      c.detourSeconds = real;
      changed = true;
    }
  }
  return changed;
}

/** The planner-chosen activity to drop: one that is itself a problem, else the least important late one. */
export function worstStop(items: readonly SeqItem[], day: TripDay): string | null {
  const options = items
    .map((item, i) => ({ item, stop: day.stops[i] }))
    .filter(({ item }) => item.kind === 'activity' && item.source === 'planner' && !item.locked);
  const flagged = options.find(({ stop }) => stop?.issues.some((issue) => BLOCKING.has(issue.code)));
  const pick = flagged ?? options.filter(({ item }) => item.activity?.priority !== 'high').at(-1) ?? options.at(-1);
  return pick ? placeKey(pick.item.place) : null;
}
