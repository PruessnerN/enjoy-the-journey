import {
  addDaysToIsoDate,
  decodePolyline,
  encodePolyline,
  stayLabel,
  type Issue,
  type MainEvent,
  type PlaceInfo,
  type TripDay,
  type TripRequest,
  type TripSummary,
} from '@journey/shared';
import { simplifyToMaxPoints } from '../geo/geo.js';
import type { RouteProfile } from '../geo/routeProfile.js';
import type { DataProvider, RouteResult } from '../providers/types.js';
import { placeKey } from './candidates.js';
import { buildDayContext, naturalDayCount, withTimeZone } from './context.js';
import { plannerProblems, repairDay, type BuildDayArgs, type BuiltDay } from './dayBuilder.js';
import { planDay } from './dayPlanner.js';
import { PlanningError } from './errors.js';
import { finalizeDay, profileFromRoute, toWaypoint } from './finalize.js';
import { enabledMeals, gatherDayCandidates } from './gather.js';
import { allocateDays, dayFractionFor, dayIndexOf, nightTargets, tripSegments, type SegmentTiming, type TripSegment } from './itinerary.js';
import { chooseLodging, chooseStayLodging } from './lodging.js';
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

/** A main event as a fixed stop in a day: a few hours there, or arriving for the night. */
export function eventItem(event: MainEvent, seconds: number): SeqItem {
  const hours = event.stayUnit === 'hours';
  return {
    kind: 'event',
    place: event.place,
    durationMinutes: hours ? event.stayAmount * 60 : 0,
    seconds,
    detourSeconds: 0,
    source: 'user',
    locked: true,
    eventId: event.id,
    activityLabel: `Main event · ${stayLabel(event)}`,
    emoji: '⭐',
    ...(hours && event.arrivalTime ? { pinnedStart: event.arrivalTime } : {}),
    ...(!hours && event.arrivalTime ? { arriveBy: event.arrivalTime } : {}),
  };
}

/** Time zones on every place, and a round trip ends where it started. */
export function normalizeRequest(raw: TripRequest): TripRequest {
  const origin = withTimeZone(raw.origin);
  const request: TripRequest = {
    ...raw,
    origin,
    destination: raw.roundTrip ? origin : withTimeZone(raw.destination),
  };
  if (raw.mainEvents) request.mainEvents = raw.mainEvents.map((e) => ({ ...e, place: withTimeZone(e.place) }));
  return request;
}

interface RoutedSegment {
  segment: TripSegment;
  route: RouteResult;
  profile: RouteProfile;
  /** Drive seconds from the segment's start to each few-hours main event. */
  stopSeconds: number[];
}

/** A driving day before it is filled with stops. */
interface DayFrame {
  index: number;
  start: PlaceInfo;
  end: SeqItem;
  /** Main events visited today, in order (including the one we stay at tonight). */
  events: MainEvent[];
}

/**
 * Plans a whole trip:
 *  1. Split the trip into drives at main events the travellers stay at overnight, and route each
 *     drive (via any few-hours main events).
 *  2. Decide each drive's number of days, honouring main event dates, and pick lodging near each
 *     even split of the drive plus one place to stay at each overnight main event.
 *  3. For each driving day, route between its endpoints and search along it for activities and meals.
 *  4. Fill each day greedily (sequentially, so places/limits are shared across days).
 *  5. Route each final day through its stops for accurate timing, and add free days at main events.
 */
export async function planTrip(rawRequest: TripRequest, provider: DataProvider): Promise<PlannedTrip> {
  const request = normalizeRequest(rawRequest);
  const prefs = request.preferences;
  const segments = tripSegments(request);

  const routed: RoutedSegment[] = await Promise.all(
    segments.map(async (segment) => {
      const route = await provider.routes.computeRoute(toWaypoint(segment.from), toWaypoint(segment.to), segment.stops.map((e) => toWaypoint(e.place)));
      const profile = profileFromRoute(route);
      return { segment, route, profile, stopSeconds: viaSeconds(route, profile, segment.stops.map((e) => e.place)) };
    }),
  );
  const directSeconds = routed.reduce((sum, r) => sum + r.route.durationSeconds, 0);
  const directMeters = routed.reduce((sum, r) => sum + r.route.distanceMeters, 0);
  if (directSeconds < 5 * 60) {
    throw new PlanningError(
      segments.length > 1
        ? 'All the places on this trip are too close together to plan a road trip.'
        : 'Your origin and destination are too close together to plan a road trip.',
    );
  }

  const timings: SegmentTiming[] = routed.map(({ segment, profile, stopSeconds }) => {
    const eventSeconds = segment.stops.reduce((sum, e) => sum + e.stayAmount * 3600, 0);
    return {
      driveSeconds: profile.totalSeconds,
      stops: segment.stops.map((e, i) => ({
        position: stopSeconds[i]!,
        durationSeconds: e.stayAmount * 3600,
        day: e.arrivalDate ? dayIndexOf(request.departureDate, e.arrivalDate) : null,
        dayFraction: dayFractionFor(e.arrivalTime, prefs),
      })),
      naturalDays: naturalDayCount(profile.totalSeconds + eventSeconds / TUNING.dayCount.driveOverheadFactor, request, segment.from),
      endDay: segment.endEvent?.arrivalDate ? dayIndexOf(request.departureDate, segment.endEvent.arrivalDate) : null,
    };
  });
  const allocation = allocateDays({ segments, timings, fixedDays: prefs.fixedDays });
  const drivingDays = allocation.days.reduce((a, b) => a + b, 0);
  if (drivingDays > TUNING.dayCount.maxDays) {
    throw new PlanningError(
      `This drive would take ${drivingDays} days at your pace. Try a faster pace or more driving hours per day (max ${TUNING.dayCount.maxDays} days of driving).`,
    );
  }
  if (allocation.totalDays > TUNING.dayCount.maxTripDays) {
    throw new PlanningError(`This trip would last ${allocation.totalDays} days. Plan trips of up to ${TUNING.dayCount.maxTripDays} days.`);
  }
  const dateOf = (index: number) => addDaysToIsoDate(request.departureDate, index);
  const arrivalDay = (s: number) => allocation.startDays[s]! + allocation.days[s]! - 1;

  // Nights along each drive, plus one place to stay for every night at an overnight main event.
  const [nightsBySegment, stays] = await Promise.all([
    Promise.all(
      routed.map(({ profile }, s) => {
        const n = allocation.days[s]!;
        const targets = nightTargets(timings[s]!, n, allocation.startDays[s]!);
        return Promise.all(
          targets.map((targetSeconds, k) =>
            chooseLodging({
              provider,
              profile,
              targetSeconds,
              dayDriveSeconds: profile.totalSeconds / n,
              request,
              checkInDate: dateOf(allocation.startDays[s]! + k),
              usedKeys: new Set(),
            }),
          ),
        );
      }),
    ),
    Promise.all(
      segments.map((segment, s) =>
        segment.endEvent
          ? chooseStayLodging({
              provider,
              place: segment.endEvent.place,
              arrival: routed[s]!.profile.end,
              request,
              checkInDate: dateOf(arrivalDay(s)),
              nights: segment.endEvent.stayAmount,
              usedKeys: new Set(),
            })
          : null,
      ),
    ),
  ]);
  const nights: SeqItem[] = [];
  segments.forEach((_, s) => {
    nights.push(...nightsBySegment[s]!.map((c) => c.item));
    if (stays[s]) nights.push(stays[s]);
  });
  warnRepeatedLodging(nights);

  const frames: DayFrame[] = [];
  segments.forEach((segment, s) => {
    const n = allocation.days[s]!;
    const segmentNights = nightsBySegment[s]!;
    const stopSeconds = routed[s]!.stopSeconds;
    for (let k = 0; k < n; k++) {
      const lower = k === 0 ? Number.NEGATIVE_INFINITY : segmentNights[k - 1]!.baseSeconds;
      const upper = k === n - 1 ? Number.POSITIVE_INFINITY : segmentNights[k]!.baseSeconds;
      const isLast = k === n - 1;
      frames.push({
        index: allocation.startDays[s]! + k,
        start: k > 0 ? segmentNights[k - 1]!.item.place : s === 0 ? request.origin : stays[s - 1]!.place,
        end: !isLast ? segmentNights[k]!.item : segment.endEvent ? stays[s]! : destinationItem(request.destination),
        events: [...segment.stops.filter((_, i) => stopSeconds[i]! > lower && stopSeconds[i]! <= upper), ...(isLast && segment.endEvent ? [segment.endEvent] : [])],
      });
    }
  });

  const prepared = await Promise.all(
    frames.map(async (frame) => {
      const ctx = buildDayContext(request, frame.index, frame.start, frame.index === allocation.totalDays - 1);
      const via = frame.events.map((e) => e.place);
      const route = await provider.routes.computeRoute(toWaypoint(frame.start), toWaypoint(frame.end.place), via.map(toWaypoint));
      const dayProfile = profileFromRoute(route);
      const seconds = viaSeconds(route, dayProfile, via);
      const locked = frame.events.map((e, i) => eventItem(e, seconds[i]!));
      const candidates = await gatherDayCandidates(provider, dayProfile, ctx, request);
      const end: SeqItem = { ...frame.end, seconds: dayProfile.totalSeconds, detourSeconds: 0 };
      return { ...frame, ctx, dayProfile, candidates, end, locked };
    }),
  );

  const dayArgs = (k: number, usage: TripUsage, spread: boolean): BuildDayArgs => {
    const day = prepared[k]!;
    return {
      provider,
      index: day.index,
      start: day.start,
      profile: day.dayProfile,
      ctx: day.ctx,
      end: day.end,
      activities: request.activities,
      activityCandidates: day.candidates.activity,
      mealCandidates: day.candidates.meals,
      meals: enabledMeals(request),
      usage,
      locked: day.locked,
      excludeKeys: new Set(),
      minRating: prefs.minRating,
      maxDetourMinutes: prefs.maxDetourMinutes,
      position: { dayIndex: k, dayCount: prepared.length, spread },
      maxActivitiesPerDay: prefs.maxActivitiesPerDay ?? null,
    };
  };

  // Fill days in order so places and "once per trip" limits are shared, then route them all at once.
  const usage = new TripUsage();
  usage.commit(nights);
  const plans = prepared.map((_, k) => {
    const result = planDay(dayArgs(k, usage, true));
    usage.commit(result.items);
    return result;
  });
  const built: BuiltDay[] = await Promise.all(
    plans.map(async (plan, k) => ({
      items: plan.items,
      day: await finalizeDay({ provider, index: prepared[k]!.index, ctx: prepared[k]!.ctx, start: prepared[k]!.start, items: plan.items, extraIssues: plan.issues }),
    })),
  );
  // Days that real drive times broke are re-planned one at a time, never reusing other days' places.
  for (let k = 0; k < built.length; k++) {
    if (plannerProblems(built[k]!.day) === 0) continue;
    const others = TripUsage.fromItemLists([nights, ...built.filter((_, j) => j !== k).map((b) => b.items)]);
    // `others` includes later days, so the even-spread quota no longer applies; keep the trip maximum.
    built[k] = await repairDay(dayArgs(k, others, false), built[k]!);
  }

  const stayDays = await Promise.all(
    segments.flatMap((segment, s) => {
      const event = segment.endEvent;
      const lodging = stays[s];
      if (!event || !lodging) return [];
      return Array.from({ length: event.stayAmount - 1 }, async (_, f) => {
        const index = arrivalDay(s) + 1 + f;
        const day = await finalizeDay({
          provider,
          index,
          ctx: buildDayContext(request, index, lodging.place, false),
          start: lodging.place,
          items: [{ ...lodging, id: undefined, seconds: 0, detourSeconds: 0, planningIssues: [] }],
        });
        return { ...day, stay: { eventId: event.id, name: event.place.name } };
      });
    }),
  );
  const days = [...built.map((b) => b.day), ...stayDays].sort((a, b) => a.index - b.index);

  const issues: Issue[] = allocation.notes.map((message) => ({ code: 'event_timing', severity: 'warning', message }));
  for (const frame of frames) {
    for (const event of frame.events) {
      if (event.arrivalDate && event.arrivalDate !== dateOf(frame.index)) {
        issues.push({
          code: 'event_timing',
          severity: 'warning',
          message: `${event.place.name} ended up on ${dateOf(frame.index)} instead of ${event.arrivalDate}. Swap a night's lodging to move it.`,
        });
      }
    }
  }
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
    summary: summarizeTrip(days, directSeconds, directMeters),
    overviewPolyline: overviewOf(routed.map((r) => r.profile)),
    issues,
  };
}

/** Drive seconds from a route's start to each intermediate waypoint. */
function viaSeconds(route: RouteResult, profile: RouteProfile, via: readonly PlaceInfo[]): number[] {
  if (route.legs.length === via.length + 1) {
    let t = 0;
    return via.map((_, i) => (t += route.legs[i]!.durationSeconds));
  }
  return via.map((p) => profile.project(p.location).seconds);
}

/** Parallel searches could pick the same property for consecutive nights in sparse areas. */
function warnRepeatedLodging(nights: SeqItem[]): void {
  const seen = new Set<string>();
  for (const night of nights) {
    const key = placeKey(night.place);
    if (seen.has(key)) {
      night.planningIssues = [
        ...(night.planningIssues ?? []),
        { code: 'no_lodging_found', severity: 'warning', message: 'Same lodging as an earlier night — swap it for somewhere else.' },
      ];
    }
    seen.add(key);
  }
}

function overviewOf(profiles: RouteProfile[]): string {
  const points = profiles.flatMap((p) => decodePolyline(p.encoded(Math.ceil(500 / profiles.length))));
  return encodePolyline(simplifyToMaxPoints(points, 500));
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
