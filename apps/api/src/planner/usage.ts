import type { ActivityRequest, TripDay } from '@journey/shared';
import { placeKey } from './candidates.js';
import { TUNING } from './tuning.js';

/** Where the day being planned sits in the trip. */
export interface TripPosition {
  dayIndex: number;
  dayCount: number;
  /**
   * Spread "2–3 times this trip" activities evenly across days. On when planning a whole trip in
   * order; off when re-planning a single day (then only the trip-wide maximum applies).
   */
  spread: boolean;
}

/** How many times a "2–3 times this trip" activity should happen on a trip of `dayCount` days. */
export function fewTimesTarget(dayCount: number): number {
  const { everyNDays, minTimes } = TUNING.fewTimes;
  return Math.max(minTimes, Math.min(TUNING.frequency.few.perTrip, Math.ceil(dayCount / everyNDays)));
}

/**
 * Uses allowed by the end of day `dayIndex` when spreading `target` uses over `dayCount` days
 * (e.g. 3 over 6 days → days 1, 3, 5). A day without a good option passes its turn to the next day.
 */
export function spreadQuota(target: number, dayIndex: number, dayCount: number): number {
  return Math.floor((target * (dayIndex + 1)) / dayCount + 0.5);
}

interface UsageItem {
  place: { placeId?: string; name: string; location: { lat: number; lng: number } };
  activityId?: string;
  kind: string;
}

/**
 * Tracks what the trip already includes so the planner never repeats a place
 * and respects "once per trip" / "once per day" activity limits.
 */
export class TripUsage {
  private readonly keys = new Set<string>();
  private readonly activityCounts = new Map<string, number>();

  static fromDays(days: TripDay[], exceptIndex?: number): TripUsage {
    const usage = new TripUsage();
    days.forEach((day, i) => {
      if (i !== exceptIndex) usage.commit(day.stops);
      // The night stops bounding the excluded day stay reserved.
      else usage.commit(day.stops.filter((s) => s.kind === 'lodging' || s.kind === 'destination'));
    });
    return usage;
  }

  static fromItemLists(lists: readonly (readonly UsageItem[])[]): TripUsage {
    const usage = new TripUsage();
    for (const list of lists) usage.commit(list);
    return usage;
  }

  get usedKeys(): ReadonlySet<string> {
    return this.keys;
  }

  isUsed(key: string): boolean {
    return this.keys.has(key);
  }

  canUse(activity: ActivityRequest, dayCounts: ReadonlyMap<string, number>, position?: TripPosition): boolean {
    const limits = TUNING.frequency[activity.frequency];
    const today = dayCounts.get(activity.id) ?? 0;
    const total = (this.activityCounts.get(activity.id) ?? 0) + today;
    if (today >= limits.perDay) return false;
    if (activity.frequency === 'few' && position) {
      const target = fewTimesTarget(position.dayCount);
      if (total >= target) return false;
      return !position.spread || total < spreadQuota(target, position.dayIndex, position.dayCount);
    }
    return total < limits.perTrip;
  }

  commit(items: readonly UsageItem[]): void {
    for (const item of items) {
      this.keys.add(placeKey(item.place));
      if (item.activityId && item.kind === 'activity') {
        this.activityCounts.set(item.activityId, (this.activityCounts.get(item.activityId) ?? 0) + 1);
      }
    }
  }
}
