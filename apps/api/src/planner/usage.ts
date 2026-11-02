import type { ActivityRequest, TripDay } from '@journey/shared';
import { placeKey } from './candidates.js';
import { TUNING } from './tuning.js';

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

  get usedKeys(): ReadonlySet<string> {
    return this.keys;
  }

  isUsed(key: string): boolean {
    return this.keys.has(key);
  }

  canUse(activity: ActivityRequest, dayCounts: ReadonlyMap<string, number>): boolean {
    const limits = TUNING.frequency[activity.frequency];
    const today = dayCounts.get(activity.id) ?? 0;
    const total = (this.activityCounts.get(activity.id) ?? 0) + today;
    return today < limits.perDay && total < limits.perTrip;
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
