import type { ActivityRequest, MealType, PlaceInfo } from '@journey/shared';
import type { RouteProfile } from '../geo/routeProfile.js';
import { TUNING } from './tuning.js';

/** A place found near the day's route, annotated with where it sits along the drive. */
export interface Candidate {
  key: string;
  place: PlaceInfo;
  /** Drive time from the day's start to the closest point on the route. */
  seconds: number;
  offRouteMeters: number;
  /** Estimated extra time to get to the place and back to the route. */
  detourSeconds: number;
  /** Bayesian-adjusted rating. */
  quality: number;
  score: number;
}

export function placeKey(place: PlaceInfo): string {
  return place.placeId ?? `${place.name.toLowerCase()}@${place.location.lat.toFixed(4)},${place.location.lng.toFixed(4)}`;
}

export function estimateDetourSeconds(offRouteMeters: number): number {
  const { roadFactor, offRouteSpeedKmh, overheadMinutes } = TUNING.detour;
  if (offRouteMeters < 150) return overheadMinutes * 30;
  const roundTripMeters = 2 * offRouteMeters * roadFactor;
  return (roundTripMeters / 1000 / offRouteSpeedKmh) * 3600 + overheadMinutes * 60;
}

export function bayesianRating(rating: number | undefined, count: number | undefined): number {
  const { priorMean, priorWeight } = TUNING.quality;
  if (rating === undefined || !count) return priorMean - 0.2;
  return (rating * count + priorMean * priorWeight) / (count + priorWeight);
}

/** Hard quality gate: the user's minimum rating applies to anything with enough reviews. */
export function meetsRating(place: PlaceInfo, minRating: number, allowUnrated: boolean): boolean {
  if (place.rating === undefined || (place.userRatingCount ?? 0) < TUNING.quality.minReviewCount) {
    return allowUnrated;
  }
  return place.rating >= minRating;
}

export function qualityScore(place: PlaceInfo): number {
  const { qualityWeight, popularityWeight, unratedPenalty } = TUNING.scoring;
  const q = bayesianRating(place.rating, place.userRatingCount);
  const popularity = Math.log10((place.userRatingCount ?? 0) + 1);
  const unrated = place.rating === undefined ? unratedPenalty : 0;
  return (q - 3.5) * qualityWeight + popularity * popularityWeight - unrated;
}

export function toCandidate(place: PlaceInfo, profile: RouteProfile): Candidate {
  const projection = profile.project(place.location);
  const detourSeconds = estimateDetourSeconds(projection.offRouteMeters);
  return {
    key: placeKey(place),
    place,
    seconds: projection.seconds,
    offRouteMeters: projection.offRouteMeters,
    detourSeconds,
    quality: bayesianRating(place.rating, place.userRatingCount),
    score: qualityScore(place) - (detourSeconds / 3600) * TUNING.scoring.detourPenaltyPerHour,
  };
}

export function activityScore(candidate: Candidate, activity: ActivityRequest): number {
  return candidate.score + (activity.priority === 'high' ? TUNING.scoring.highPriorityBonus : 0);
}

export interface MealCandidates {
  breakfast: Candidate[];
  lunch: Candidate[];
  dinner: Candidate[];
}

export type MealCandidateMap = Record<MealType, Candidate[]>;

export function dedupeCandidates(list: Candidate[]): Candidate[] {
  const seen = new Map<string, Candidate>();
  for (const c of list) {
    if (!seen.has(c.key)) seen.set(c.key, c);
  }
  return [...seen.values()];
}
