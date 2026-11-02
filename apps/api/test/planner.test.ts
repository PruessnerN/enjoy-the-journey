import { describe, expect, it } from 'vitest';
import { MEALS, parseTimeOfDay, type Trip } from '@journey/shared';
import { epochToLocal } from '../src/geo/time.js';
import { computeDayCount } from '../src/planner/context.js';
import { placeKey } from '../src/planner/candidates.js';
import { townFromAddress } from '../src/planner/links.js';
import { planTrip, type PlannedTrip } from '../src/planner/tripPlanner.js';
import { TUNING } from '../src/planner/tuning.js';
import { activities, demoProvider, makeRequest } from './helpers.js';

const BLOCKING = ['closed', 'after_dark', 'meal_outside_window', 'late_arrival', 'night_driving'];

function assertTripInvariants(plan: PlannedTrip, request: Awaited<ReturnType<typeof makeRequest>>): void {
  const days = plan.days;
  days.forEach((day, i) => {
    const last = day.stops[day.stops.length - 1]!;
    // Every night ends at lodging; the trip ends at the destination.
    expect(last.kind).toBe(i === days.length - 1 ? 'destination' : 'lodging');
    expect(day.stops.slice(0, -1).every((s) => s.kind !== 'lodging' && s.kind !== 'destination')).toBe(true);
    expect(day.legs.length).toBe(day.stops.length);

    // Next day starts where we slept.
    if (i > 0) expect(day.start).toEqual(days[i - 1]!.stops[days[i - 1]!.stops.length - 1]!.place);

    // Timeline moves forward.
    let t = new Date(day.departure).getTime();
    for (const stop of day.stops) {
      const arrival = new Date(stop.arrival).getTime();
      expect(arrival).toBeGreaterThanOrEqual(t);
      expect(new Date(stop.start).getTime()).toBeGreaterThanOrEqual(arrival);
      expect(new Date(stop.departure).getTime()).toBeGreaterThanOrEqual(new Date(stop.start).getTime());
      t = new Date(stop.departure).getTime();
    }

    // Meals happen at mealtime, once each per day.
    const meals = day.stops.filter((s) => s.kind === 'meal');
    expect(new Set(meals.map((m) => m.mealType)).size).toBe(meals.length);
    for (const meal of meals) {
      const def = MEALS[meal.mealType!];
      const local = epochToLocal(new Date(meal.start).getTime(), meal.timeZone).minutes;
      expect(local).toBeGreaterThanOrEqual(parseTimeOfDay(def.windowStart) - 1);
      expect(local).toBeLessThanOrEqual(parseTimeOfDay(def.windowEnd) + 1);
    }

    // The planner never creates blocking problems.
    const problems = day.stops.flatMap((s) => s.issues).filter((issue) => BLOCKING.includes(issue.code));
    expect(problems).toEqual([]);

    // Frequency limits per day.
    for (const activity of request.activities) {
      const count = day.stops.filter((s) => s.kind === 'activity' && s.activityId === activity.id).length;
      expect(count).toBeLessThanOrEqual(TUNING.frequency[activity.frequency].perDay);
    }
  });

  // Never visit the same place twice (e.g. no campground twice).
  const keys = days.flatMap((d) => d.stops.map((s) => placeKey(s.place)));
  expect(new Set(keys).size).toBe(keys.length);

  for (const activity of request.activities.filter((a) => a.frequency === 'once')) {
    const count = days.flatMap((d) => d.stops).filter((s) => s.activityId === activity.id).length;
    expect(count).toBeLessThanOrEqual(1);
  }
}

describe('planTrip (demo data)', () => {
  const routes: [string, string, Parameters<typeof makeRequest>[3]][] = [
    ['Boise', 'Salt Lake City', { lodgingType: 'campground' }],
    ['Seattle', 'Denver', { lodgingType: 'hotel', preferences: { meals: { breakfast: true, lunch: true, dinner: true } } }],
    ['Twin Falls', 'Las Vegas', { lodgingType: 'vacation_rental', activities: activities('disc_golf', 'hot_springs', 'brewery', 'coffee') }],
    ['Portland', 'Bend', { activities: activities('hiking', 'waterfalls', 'sweets') }],
    ['Missoula', 'Jackson', { departureDate: '2026-12-05', activities: activities('hiking', 'museums', 'scenic_viewpoint') }],
  ];

  it.each(routes)('plans %s → %s with sensible invariants', async (from, to, overrides) => {
    const provider = demoProvider();
    const request = await makeRequest(provider, from, to, overrides);
    const plan = await planTrip(request, provider);
    expect(plan.days.length).toBeGreaterThanOrEqual(1);
    expect(plan.summary.activityCount).toBeGreaterThan(0);
    assertTripInvariants(plan, request);
  });

  it('turns a short drive into a full day of stops', async () => {
    const provider = demoProvider();
    const request = await makeRequest(provider, 'Boise', 'McCall');
    const plan = await planTrip(request, provider);
    expect(plan.days).toHaveLength(1);
    expect(plan.summary.activityCount).toBeGreaterThanOrEqual(2);
    expect(plan.summary.totalDriveSeconds).toBeGreaterThanOrEqual(plan.summary.directDriveSeconds);
  });

  it('makes steady progress: each day drives a fair share', async () => {
    const provider = demoProvider();
    const request = await makeRequest(provider, 'Seattle', 'Denver');
    const plan = await planTrip(request, provider);
    const share = plan.summary.directDriveSeconds / plan.days.length;
    for (const day of plan.days) {
      expect(day.driveSeconds).toBeGreaterThan(share * 0.6);
      expect(day.driveSeconds).toBeLessThan(share * 1.8);
    }
  });

  it('fits "2–3 times this trip" activities in a few times, spread out', async () => {
    const provider = demoProvider();
    const request = await makeRequest(provider, 'Seattle', 'Denver', {
      activities: activities('fishing', 'kayaking', 'scenic_viewpoint'),
      preferences: { pace: 'relaxed', maxDrivingHoursPerDay: 4 },
    });
    expect(request.activities.find((a) => a.id === 'fishing')!.frequency).toBe('few');
    const plan = await planTrip(request, provider);
    expect(plan.days.length).toBeGreaterThanOrEqual(5);
    assertTripInvariants(plan, request);
    for (const id of ['fishing', 'kayaking']) {
      const days = plan.days.filter((d) => d.stops.some((s) => s.activityId === id)).map((d) => d.index);
      expect(days.length).toBeGreaterThanOrEqual(2);
      expect(days.length).toBeLessThanOrEqual(3);
      expect(days.length).toBeLessThan(plan.days.length);
    }
  });

  it('never schedules more activities per day than the limit', async () => {
    const provider = demoProvider();
    const request = await makeRequest(provider, 'Boise', 'Salt Lake City', {
      activities: activities('scenic_viewpoint', 'coffee', 'historic_sites', 'museums'),
      preferences: { maxActivitiesPerDay: 2 },
    });
    const plan = await planTrip(request, provider);
    assertTripInvariants(plan, request);
    for (const day of plan.days) {
      expect(day.stops.filter((s) => s.kind === 'activity' || s.kind === 'custom').length).toBeLessThanOrEqual(2);
    }
    expect(plan.summary.activityCount).toBeGreaterThan(0);
  });

  it('respects a fixed number of days', async () => {
    const provider = demoProvider();
    const request = await makeRequest(provider, 'Boise', 'Salt Lake City', { preferences: { fixedDays: 3 } });
    const plan = await planTrip(request, provider);
    expect(plan.days).toHaveLength(3);
    assertTripInvariants(plan, request);
  });

  it('adds booking links for vacation rentals', async () => {
    const provider = demoProvider();
    const request = await makeRequest(provider, 'Seattle', 'Salt Lake City', { lodgingType: 'vacation_rental' });
    const plan = await planTrip(request, provider);
    const lodging = plan.days.slice(0, -1).map((d) => d.stops[d.stops.length - 1]!);
    expect(lodging.length).toBeGreaterThan(0);
    for (const stop of lodging) {
      expect(stop.links?.map((l) => l.label)).toEqual(expect.arrayContaining(['Airbnb', 'VRBO']));
    }
  });

  it('rejects trips whose ends are basically the same place', async () => {
    const provider = demoProvider();
    const request = await makeRequest(provider, 'Boise', 'Meridian');
    request.destination = { ...request.origin, name: 'Also Boise' };
    await expect(planTrip(request, provider)).rejects.toThrow(/too close/);
  });
});

describe('computeDayCount', () => {
  it('scales with pace and honours fixed days', async () => {
    const provider = demoProvider();
    const base = await makeRequest(provider, 'Boise', 'Salt Lake City');
    const tenHours = 10 * 3600;
    const relaxed = computeDayCount(tenHours, { ...base, preferences: { ...base.preferences, pace: 'relaxed', maxDrivingHoursPerDay: 4 } }, base.origin);
    const efficient = computeDayCount(tenHours, { ...base, preferences: { ...base.preferences, pace: 'efficient', maxDrivingHoursPerDay: 8 } }, base.origin);
    expect(relaxed).toBeGreaterThan(efficient);
    expect(computeDayCount(2 * 3600, base, base.origin)).toBe(1);
    expect(computeDayCount(tenHours, { ...base, preferences: { ...base.preferences, fixedDays: 4 } }, base.origin)).toBe(4);
  });
});

describe('townFromAddress', () => {
  it.each([
    ['123 Main St, Twin Falls, ID 83301, USA', 'Twin Falls, ID'],
    ['Twin Falls, ID, USA', 'Twin Falls, ID'],
    ['1234 Main St, Wells, NV', 'Wells, NV'],
    ['Banff, AB T1L, Canada', 'Banff, AB'],
    ['US-93, ID 83301, USA', 'US-93, ID'],
  ])('%s → %s', (address, town) => {
    expect(townFromAddress(address)).toBe(town);
  });
});

export type { Trip };
