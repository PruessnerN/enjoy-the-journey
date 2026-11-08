import type { ActivityRequest, Issue, Link, LodgingType, MealType, PlaceInfo, StopKind } from '@journey/shared';
import { haversineMeters } from '../geo/geo.js';

/** A stop in the planner's working sequence for a single day. */
export interface SeqItem {
  id?: string;
  kind: StopKind;
  place: PlaceInfo;
  durationMinutes: number;
  /** Position along the day's route, as drive seconds from the day's start. */
  seconds: number;
  /** Extra drive time to reach the place from the route and come back. */
  detourSeconds: number;
  mealType?: MealType;
  lodgingType?: LodgingType;
  outdoor?: boolean;
  pinnedStart?: string | null;
  /** Arrive no later than this local time (HH:mm). */
  arriveBy?: string | null;
  /** Main event stops: which main event of the request. */
  eventId?: string;
  locked?: boolean;
  source: 'planner' | 'user';
  activityId?: string;
  activityLabel?: string;
  emoji?: string;
  notes?: string;
  links?: Link[];
  /** Issues known while planning, e.g. "no well-rated restaurant nearby". */
  planningIssues?: Issue[];
  activity?: ActivityRequest;
}

export interface LegEstimate {
  durationSeconds: number;
  distanceMeters: number;
}

/**
 * Estimates drive legs between consecutive items using their positions along the route:
 * the along-route difference plus half of each end's detour (the trip off-route and back).
 */
export function estimateLegs(items: SeqItem[], averageSpeedMps: number): LegEstimate[] {
  const legs: LegEstimate[] = [];
  let prevSeconds = 0;
  let prevDetour = 0;
  for (const item of items) {
    const durationSeconds = Math.abs(item.seconds - prevSeconds) + prevDetour / 2 + item.detourSeconds / 2;
    legs.push({ durationSeconds, distanceMeters: durationSeconds * averageSpeedMps });
    prevSeconds = item.seconds;
    prevDetour = item.detourSeconds;
  }
  return legs;
}

/** Straight-line based legs, used only when the routing provider is unavailable. */
export function straightLineLegs(start: PlaceInfo, items: SeqItem[]): LegEstimate[] {
  let prev = start.location;
  return items.map((item) => {
    const meters = haversineMeters(prev, item.place.location) * 1.3;
    prev = item.place.location;
    return { durationSeconds: (meters / 1000 / 80) * 3600, distanceMeters: meters };
  });
}
