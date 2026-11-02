import { describe, expect, it } from 'vitest';
import { activityRequestFromDefinition, findActivityDefinition, type ActivityRequest, type PlaceInfo } from '@journey/shared';
import { destinationPoint } from '../src/geo/geo.js';
import { RouteProfile } from '../src/geo/routeProfile.js';
import { localTimeToEpoch } from '../src/geo/time.js';
import { toCandidate, type Candidate } from '../src/planner/candidates.js';
import { activityStopCount, planDay, type DayPlanInput } from '../src/planner/dayPlanner.js';
import type { SeqItem } from '../src/planner/sequence.js';
import { TripUsage } from '../src/planner/usage.js';

const tz = 'America/Boise';
const start = { lat: 43.615, lng: -116.2 };
const profile = RouteProfile.fromPath([start, destinationPoint(start, 90, 300_000)], 3 * 3600);
const activity = (id: string): ActivityRequest => activityRequestFromDefinition(findActivityDefinition(id)!);

/** A place half a kilometre off the route, `minutes` into the drive. */
function spot(id: string, minutes: number, rating: number, reviews: number): PlaceInfo {
  return {
    placeId: id,
    name: id,
    location: destinationPoint(profile.pointAtSeconds(minutes * 60), 0, 500),
    rating,
    userRatingCount: reviews,
    timeZone: tz,
  };
}

function dayInput(activities: ActivityRequest[], candidates: Record<string, PlaceInfo[]>, overrides: Partial<DayPlanInput> = {}): DayPlanInput {
  const end: SeqItem = {
    kind: 'destination',
    place: { name: 'Destination', location: profile.end, timeZone: tz },
    durationMinutes: 0,
    seconds: profile.totalSeconds,
    detourSeconds: 0,
    source: 'planner',
  };
  return {
    profile,
    ctx: {
      date: '2027-06-19',
      departure: localTimeToEpoch('2027-06-19', 8 * 60, tz),
      startTime: '08:00',
      timeZone: tz,
      arriveByTime: '19:30',
      avoidNightDriving: true,
      maxDrivingHours: 6,
      isFinalDay: true,
    },
    end,
    activities,
    activityCandidates: new Map(Object.entries(candidates).map(([id, places]) => [id, places.map((p): Candidate => toCandidate(p, profile))])),
    mealCandidates: { breakfast: [], lunch: [], dinner: [] },
    meals: [],
    usage: new TripUsage(),
    locked: [],
    excludeKeys: new Set(),
    minRating: 4,
    maxDetourMinutes: 30,
    position: { dayIndex: 0, dayCount: 1, spread: true },
    maxActivitiesPerDay: null,
    ...overrides,
  };
}

const chosen = (input: DayPlanInput) => planDay(input).items.filter((i) => i.kind === 'activity').map((i) => i.place.name);

describe('ranking and daily limits', () => {
  const museum = spot('Small-town museum', 90, 4.1, 40);
  const discGolf = spot('Famous disc golf course', 95, 4.9, 2500);

  it('gives higher-ranked activities first claim, even over better-rated places', () => {
    const candidates = { museums: [museum], disc_golf: [discGolf] };
    expect(chosen(dayInput([activity('museums'), activity('disc_golf')], candidates, { maxActivitiesPerDay: 1 }))).toEqual([museum.name]);
    expect(chosen(dayInput([activity('disc_golf'), activity('museums')], candidates, { maxActivitiesPerDay: 1 }))).toEqual([discGolf.name]);
  });

  it('picks the best-rated spot for an activity', () => {
    const okay = spot('Okay course', 90, 4.2, 300);
    const great = spot('Great course', 90, 4.8, 300);
    expect(chosen(dayInput([activity('disc_golf')], { disc_golf: [okay, great] }))).toEqual([great.name]);
  });

  it('fits everything when there is no limit, and stops at the limit otherwise', () => {
    const candidates = { museums: [museum], disc_golf: [discGolf], coffee: [spot('Coffee', 30, 4.7, 400)] };
    const ranked = [activity('disc_golf'), activity('museums'), activity('coffee')];
    expect(chosen(dayInput(ranked, candidates))).toHaveLength(3);
    expect(chosen(dayInput(ranked, candidates, { maxActivitiesPerDay: 2 }))).toEqual(
      expect.arrayContaining([discGolf.name, museum.name]),
    );
    expect(chosen(dayInput(ranked, candidates, { maxActivitiesPerDay: 2 }))).toHaveLength(2);
  });

  it("counts the user's own stops toward the limit", () => {
    const pieStand: SeqItem = {
      kind: 'custom',
      place: { name: 'Pie stand', location: profile.pointAtSeconds(3600), timeZone: tz },
      durationMinutes: 20,
      seconds: 3600,
      detourSeconds: 0,
      source: 'user',
      locked: true,
    };
    const result = planDay(dayInput([activity('disc_golf')], { disc_golf: [discGolf] }, { locked: [pieStand], maxActivitiesPerDay: 1 }));
    expect(activityStopCount(result.items)).toBe(1);
    expect(result.items.some((i) => i.place.name === 'Pie stand')).toBe(true);
  });
});
