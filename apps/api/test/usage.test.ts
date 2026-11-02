import { describe, expect, it } from 'vitest';
import { activityRequestFromDefinition, findActivityDefinition, type ActivityRequest } from '@journey/shared';
import { TripUsage, fewTimesTarget, spreadQuota } from '../src/planner/usage.js';

const fishing = (): ActivityRequest => ({ ...activityRequestFromDefinition(findActivityDefinition('fishing')!), frequency: 'few' });

/** Simulates planning a trip in order where every day has a good option available. */
function plannedDays(dayCount: number, spread = true): number[] {
  const usage = new TripUsage();
  const activity = fishing();
  const days: number[] = [];
  for (let day = 0; day < dayCount; day++) {
    const today = new Map<string, number>();
    while (usage.canUse(activity, today, { dayIndex: day, dayCount, spread })) {
      today.set(activity.id, (today.get(activity.id) ?? 0) + 1);
      days.push(day + 1);
    }
    usage.commit([...Array(today.get(activity.id) ?? 0)].map(() => ({ kind: 'activity', activityId: activity.id, place: { name: `Spot ${day}`, location: { lat: day, lng: 0 } } })));
  }
  return days;
}

describe('"2–3 times this trip"', () => {
  it('aims for about every other day, between 2 and 3 times', () => {
    expect([1, 2, 3, 4, 5, 6, 10].map(fewTimesTarget)).toEqual([2, 2, 2, 2, 3, 3, 3]);
  });

  it('spreads the visits out instead of front-loading them', () => {
    expect(plannedDays(1)).toEqual([1]);
    expect(plannedDays(2)).toEqual([1, 2]);
    expect(plannedDays(3)).toEqual([1, 3]);
    expect(plannedDays(4)).toEqual([1, 3]);
    expect(plannedDays(5)).toEqual([1, 3, 5]);
    expect(plannedDays(6)).toEqual([1, 3, 5]);
    expect(plannedDays(7)).toEqual([2, 4, 6]);
  });

  it('passes a missed turn on to the next day', () => {
    // Day 1 had no fishing nearby: day 2 may still have it.
    expect(spreadQuota(3, 1, 6)).toBe(1);
    const usage = new TripUsage();
    expect(usage.canUse(fishing(), new Map(), { dayIndex: 1, dayCount: 6, spread: true })).toBe(true);
  });

  it('only enforces the trip maximum when re-planning a single day', () => {
    const usage = new TripUsage();
    const used = (day: number) => ({ kind: 'activity', activityId: 'fishing', place: { name: `Spot ${day}`, location: { lat: day, lng: 0 } } });
    usage.commit([used(0), used(4)]);
    // Day 3 of 6 with day 1 and 5 already fishing: the spread quota says no, but a single-day re-plan may keep its slot.
    expect(usage.canUse(fishing(), new Map(), { dayIndex: 2, dayCount: 6, spread: true })).toBe(false);
    expect(usage.canUse(fishing(), new Map(), { dayIndex: 2, dayCount: 6, spread: false })).toBe(true);
    usage.commit([used(2)]);
    expect(usage.canUse(fishing(), new Map(), { dayIndex: 3, dayCount: 6, spread: false })).toBe(false);
  });

  it('never allows twice in one day', () => {
    const usage = new TripUsage();
    expect(usage.canUse(fishing(), new Map([['fishing', 1]]), { dayIndex: 0, dayCount: 1, spread: false })).toBe(false);
  });
});
