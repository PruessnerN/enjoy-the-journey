import { type Issue, type PlaceInfo, type TripDay, type TripRequest, type TripSummary } from '@journey/shared';
import type { RouteProfile } from '../geo/routeProfile.js';
import type { DataProvider } from '../providers/types.js';
import { buildDayContext, computeDayCount, withTimeZone } from './context.js';
import { planDay } from './dayPlanner.js';
import { PlanningError } from './errors.js';
import { finalizeDay, profileFromRoute, toWaypoint } from './finalize.js';
import { enabledMeals, gatherDayCandidates } from './gather.js';
import { chooseLodging } from './lodging.js';
import type { SeqItem } from './sequence.js';
import { TUNING } from './tuning.js';
import { TripUsage } from './usage.js';

export interface PlannedTrip {
  request: TripRequest;
  days: TripDay[];
  summary: TripSummary;
  overviewPolyline: string;
  issues: Issue[];
}

export function destinationItem(destination: PlaceInfo): SeqItem {
  return {
    kind: 'destination',
    place: destination,
    durationMinutes: 0,
    seconds: 0,
    detourSeconds: 0,
    source: 'planner',
    activityLabel: 'Destination',
    emoji: '🏁',
  };
}

/**
 * Plans a whole trip:
 *  1. Route origin → destination and decide how many days the drive should take.
 *  2. Pick lodging near each even split of the drive so every day makes real progress.
 *  3. For each day, route between its endpoints and search along it for activities and meals.
 *  4. Fill each day greedily (sequentially, so places/limits are shared across days).
 *  5. Route each final day through its stops for accurate timing.
 */
export async function planTrip(rawRequest: TripRequest, provider: DataProvider): Promise<PlannedTrip> {
  const request: TripRequest = {
    ...rawRequest,
    origin: withTimeZone(rawRequest.origin),
    destination: withTimeZone(rawRequest.destination),
  };
  const { origin, destination } = request;

  const base = await provider.routes.computeRoute(toWaypoint(origin), toWaypoint(destination));
  if (base.durationSeconds < 5 * 60) {
    throw new PlanningError('Your origin and destination are too close together to plan a road trip.');
  }
  const profile = profileFromRoute(base);
  const dayCount = computeDayCount(profile.totalSeconds, request, origin);
  if (dayCount > TUNING.dayCount.maxDays) {
    throw new PlanningError(
      `This drive would take ${dayCount} days at your pace. Try a faster pace or more driving hours per day (max ${TUNING.dayCount.maxDays} days).`,
    );
  }

  const nights = await chooseNights(provider, profile, dayCount, request);
  const ends: SeqItem[] = [...nights, destinationItem(destination)];
  const starts: PlaceInfo[] = [origin, ...nights.map((n) => n.place)];

  const prepared = await Promise.all(
    ends.map(async (endTemplate, k) => {
      const start = starts[k]!;
      const ctx = buildDayContext(request, k, start, k === dayCount - 1);
      const route = await provider.routes.computeRoute(toWaypoint(start), toWaypoint(endTemplate.place));
      const dayProfile = profileFromRoute(route);
      const candidates = await gatherDayCandidates(provider, dayProfile, ctx, request);
      const end: SeqItem = { ...endTemplate, seconds: dayProfile.totalSeconds, detourSeconds: 0 };
      return { start, ctx, dayProfile, candidates, end };
    }),
  );

  const usage = new TripUsage();
  usage.commit(nights);
  const plans = prepared.map((day) => {
    const result = planDay({
      profile: day.dayProfile,
      ctx: day.ctx,
      end: day.end,
      activities: request.activities,
      activityCandidates: day.candidates.activity,
      mealCandidates: day.candidates.meals,
      meals: enabledMeals(request),
      usage,
      locked: [],
      excludeKeys: new Set(),
      minRating: request.preferences.minRating,
      maxDetourMinutes: request.preferences.maxDetourMinutes,
    });
    usage.commit(result.items);
    return result;
  });

  const days = await Promise.all(
    plans.map((plan, k) =>
      finalizeDay({
        provider,
        index: k,
        ctx: prepared[k]!.ctx,
        start: prepared[k]!.start,
        items: plan.items,
        extraIssues: plan.issues,
      }),
    ),
  );

  const issues: Issue[] = [];
  for (const activity of request.activities) {
    const found = prepared.some((d) => (d.candidates.activity.get(activity.id)?.length ?? 0) > 0);
    if (!found) {
      issues.push({
        code: 'no_activities_found',
        severity: 'info',
        message: `We couldn't find any "${activity.label}" near your route.`,
      });
    }
  }
  const failed = prepared.reduce((sum, d) => sum + d.candidates.failedSearches, 0);
  if (failed > 0) {
    issues.push({
      code: 'estimated_route',
      severity: 'warning',
      message: `${failed} place searches failed, so some suggestions may be missing. Re-plan to try again.`,
    });
  }

  return {
    request,
    days,
    summary: summarizeTrip(days, base.durationSeconds, base.distanceMeters),
    overviewPolyline: profile.encoded(500),
    issues,
  };
}

async function chooseNights(provider: DataProvider, profile: RouteProfile, dayCount: number, request: TripRequest): Promise<SeqItem[]> {
  const total = profile.totalSeconds;
  const share = total / dayCount;
  const choices = await Promise.all(
    Array.from({ length: dayCount - 1 }, (_, i) =>
      chooseLodging({
        provider,
        profile,
        targetSeconds: share * (i + 1),
        dayDriveSeconds: share,
        request,
        checkInDate: buildDayContext(request, i, request.origin, false).date,
        usedKeys: new Set(),
      }),
    ),
  );
  // Parallel searches could pick the same property for adjacent nights in sparse areas.
  const seen = new Set<string>();
  return choices.map((c) => {
    const key = c.item.place.placeId ?? c.item.place.name;
    if (seen.has(key)) {
      c.item.planningIssues = [
        ...(c.item.planningIssues ?? []),
        { code: 'no_lodging_found', severity: 'warning', message: 'Same lodging as the previous night — swap it for somewhere further along.' },
      ];
    }
    seen.add(key);
    return c.item;
  });
}

export function summarizeTrip(days: TripDay[], directDriveSeconds: number, directDistanceMeters: number): TripSummary {
  const stops = days.flatMap((d) => d.stops);
  return {
    days: days.length,
    nights: Math.max(0, days.length - 1),
    totalDriveSeconds: days.reduce((s, d) => s + d.driveSeconds, 0),
    totalDistanceMeters: days.reduce((s, d) => s + d.distanceMeters, 0),
    directDriveSeconds: Math.round(directDriveSeconds),
    directDistanceMeters: Math.round(directDistanceMeters),
    activityCount: stops.filter((s) => s.kind === 'activity' || s.kind === 'custom').length,
    mealCount: stops.filter((s) => s.kind === 'meal').length,
  };
}
