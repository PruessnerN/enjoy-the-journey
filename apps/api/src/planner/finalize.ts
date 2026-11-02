import { randomUUID } from 'node:crypto';
import { decodePolyline, encodePolyline, type Issue, type Leg, type PlaceInfo, type Stop, type TripDay } from '@journey/shared';
import { simplifyToMaxPoints } from '../geo/geo.js';
import { RouteProfile } from '../geo/routeProfile.js';
import { sunTimes, toIso } from '../geo/time.js';
import type { DataProvider, RouteResult, Waypoint } from '../providers/types.js';
import { scheduleDay, type DayContext } from './schedule.js';
import { straightLineLegs, type SeqItem } from './sequence.js';

const MAX_INTERMEDIATES = 25;

export function toWaypoint(place: PlaceInfo): Waypoint {
  return { location: place.location, ...(place.placeId ? { placeId: place.placeId } : {}) };
}

export function profileFromRoute(route: RouteResult): RouteProfile {
  const steps = route.legs.flatMap((leg) => leg.steps).filter((s) => s.polyline);
  if (steps.length > 0) return RouteProfile.fromSteps(steps);
  return RouteProfile.fromPath(decodePolyline(route.polyline), route.durationSeconds, route.distanceMeters);
}

/** Rebuilds a usable route profile for a saved day from its stored legs. */
export function profileFromDay(day: TripDay): RouteProfile {
  const steps = day.legs
    .map((leg, i) => {
      const polyline =
        leg.polyline ||
        encodePolyline([i === 0 ? day.start.location : day.stops[i - 1]!.place.location, day.stops[i]!.place.location]);
      return { durationSeconds: leg.durationSeconds, distanceMeters: leg.distanceMeters, polyline };
    })
    .filter((s) => s.polyline);
  if (steps.length === 0) {
    return RouteProfile.fromPath([day.start.location, day.stops[day.stops.length - 1]!.place.location], 3600);
  }
  return RouteProfile.fromSteps(steps);
}

function simplifyEncoded(polyline: string, maxPoints = 300): string {
  if (!polyline) return polyline;
  return encodePolyline(simplifyToMaxPoints(decodePolyline(polyline), maxPoints));
}

export interface FinalizeDayArgs {
  provider: DataProvider;
  index: number;
  ctx: DayContext;
  start: PlaceInfo;
  items: SeqItem[];
  extraIssues?: Issue[];
}

/**
 * Routes the day through its stops with the real routing provider and computes the
 * final timeline. Falls back to straight-line estimates if routing fails.
 */
export async function finalizeDay(args: FinalizeDayArgs): Promise<TripDay> {
  const { provider, ctx, start, items } = args;
  const dayIssues: Issue[] = [...(args.extraIssues ?? [])];
  let legs: Leg[];

  try {
    if (items.length - 1 > MAX_INTERMEDIATES) {
      throw new Error(`More than ${MAX_INTERMEDIATES} stops in one day`);
    }
    const waypoints = items.map((i) => toWaypoint(i.place));
    const route = await provider.routes.computeRoute(toWaypoint(start), waypoints[waypoints.length - 1]!, waypoints.slice(0, -1));
    if (route.legs.length !== items.length) throw new Error('Routing returned an unexpected number of legs');
    legs = route.legs.map((leg) => ({
      durationSeconds: leg.durationSeconds,
      distanceMeters: leg.distanceMeters,
      breakMinutes: 0,
      polyline: simplifyEncoded(leg.polyline),
      estimated: false,
    }));
  } catch (error) {
    legs = straightLineLegs(start, items).map((l) => ({ ...l, breakMinutes: 0, estimated: true }));
    dayIssues.push({
      code: 'estimated_route',
      severity: 'warning',
      message: `Drive times today are rough estimates (${error instanceof Error ? error.message : 'routing unavailable'}).`,
    });
  }

  const schedule = scheduleDay(items, legs, ctx);
  legs.forEach((leg, i) => {
    leg.breakMinutes = schedule.breakMinutes[i] ?? 0;
  });

  const stops: Stop[] = items.map((item, i) => {
    const s = schedule.items[i]!;
    const stop: Stop = {
      id: item.id ?? randomUUID(),
      kind: item.kind,
      place: item.place,
      durationMinutes: item.durationMinutes,
      locked: item.locked ?? false,
      source: item.source,
      arrival: toIso(s.arrival),
      start: toIso(s.start),
      departure: toIso(s.departure),
      timeZone: s.timeZone,
      waitMinutes: s.waitMinutes,
      issues: s.issues,
    };
    if (item.activityId) stop.activityId = item.activityId;
    if (item.activityLabel) stop.activityLabel = item.activityLabel;
    if (item.emoji) stop.emoji = item.emoji;
    if (item.mealType) stop.mealType = item.mealType;
    if (item.lodgingType) stop.lodgingType = item.lodgingType;
    if (item.pinnedStart) stop.pinnedStart = item.pinnedStart;
    if (item.outdoor !== undefined) stop.outdoor = item.outdoor;
    if (item.notes) stop.notes = item.notes;
    if (item.links?.length) stop.links = item.links;
    return stop;
  });

  // Sunrise where the day starts, sunset where it ends (that's what matters for arriving before dark).
  const sunStart = sunTimes(ctx.date, start.location, ctx.timeZone);
  const last = schedule.items[schedule.items.length - 1];
  const endPlace = items[items.length - 1]?.place ?? start;
  const sunEnd = sunTimes(ctx.date, endPlace.location, last?.timeZone ?? ctx.timeZone);
  return {
    index: args.index,
    date: ctx.date,
    startTime: ctx.startTime,
    departure: toIso(ctx.departure),
    timeZone: ctx.timeZone,
    start,
    stops,
    legs,
    arrival: toIso(schedule.arrival),
    driveSeconds: Math.round(schedule.driveSeconds),
    distanceMeters: Math.round(schedule.distanceMeters),
    ...(sunStart ? { sunrise: toIso(sunStart.sunrise) } : {}),
    ...(sunEnd ? { sunset: toIso(sunEnd.sunset) } : {}),
    issues: [...dayIssues, ...schedule.issues],
  };
}
