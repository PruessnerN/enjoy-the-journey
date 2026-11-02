import { MEALS, parseTimeOfDay, type MealType, type PlaceInfo, type TripRequest } from '@journey/shared';
import type { RouteProfile } from '../geo/routeProfile.js';
import { localTimeToEpoch } from '../geo/time.js';
import type { DataProvider, TextSearchRequest } from '../providers/types.js';
import { dedupeCandidates, toCandidate, type Candidate, type MealCandidateMap } from './candidates.js';
import type { DayContext } from './schedule.js';
import { TUNING } from './tuning.js';

export interface DayCandidates {
  activity: Map<string, Candidate[]>;
  meals: MealCandidateMap;
  failedSearches: number;
  totalSearches: number;
}

/** Splits [0, total] into chunks of at most `size`. */
export function segments(total: number, size: number): [number, number][] {
  const count = Math.max(1, Math.ceil(total / size));
  const step = total / count;
  return Array.from({ length: count }, (_, i) => [i * step, (i + 1) * step] as [number, number]);
}

/**
 * Searches along the day's route for every requested activity and for restaurants
 * wherever a meal could plausibly happen. Individual search failures are tolerated;
 * if every search fails the first error is re-thrown.
 */
export async function gatherDayCandidates(
  provider: DataProvider,
  profile: RouteProfile,
  ctx: DayContext,
  request: TripRequest,
): Promise<DayCandidates> {
  const total = profile.totalSeconds;
  const searches: Promise<void>[] = [];
  const errors: unknown[] = [];
  let totalSearches = 0;

  const run = (req: TextSearchRequest, sink: (places: PlaceInfo[]) => void) => {
    totalSearches++;
    searches.push(
      provider.places.searchText(req).then(sink, (error: unknown) => {
        errors.push(error);
      }),
    );
  };

  const activity = new Map<string, Candidate[]>();
  const activitySegments = segments(total, TUNING.candidates.segmentMaxMinutes * 60);
  for (const a of request.activities) {
    activity.set(a.id, []);
    for (const [from, to] of activitySegments) {
      run(
        {
          query: a.query,
          ...(a.includedType ? { includedType: a.includedType } : {}),
          alongRoutePolyline: profile.encodedSlice(from, to),
          maxResults: TUNING.candidates.maxResultsPerSearch,
        },
        (places) => activity.get(a.id)!.push(...places.map((p) => toCandidate(p, profile))),
      );
    }
  }

  const mealTypes = enabledMeals(request);
  const cellSize = TUNING.meals.searchSegmentMinutes * 60;
  const latestArrival = localTimeToEpoch(ctx.date, parseTimeOfDay(ctx.arriveByTime), ctx.timeZone);
  const slack = Math.max(0, (latestArrival - ctx.departure) / 1000 - total);
  const cellsByQuery = new Map<string, { includedType?: string; cells: Set<number>; meals: Set<MealType> }>();

  for (const mealType of mealTypes) {
    const meal = MEALS[mealType];
    const windowStart = localTimeToEpoch(ctx.date, parseTimeOfDay(meal.windowStart), ctx.timeZone);
    const windowEnd = localTimeToEpoch(ctx.date, parseTimeOfDay(meal.windowEnd), ctx.timeZone);
    if (windowEnd <= ctx.departure) continue;
    // Where could we be during the meal window? Somewhere between "drove non-stop" and
    // "spent all spare time at stops before eating".
    const hi = clamp((windowEnd - ctx.departure) / 1000, 0, total);
    const lo = clamp((windowStart - ctx.departure) / 1000 - slack, 0, hi);
    const entry = cellsByQuery.get(meal.query) ?? {
      ...(meal.includedType ? { includedType: meal.includedType } : {}),
      cells: new Set<number>(),
      meals: new Set<MealType>(),
    };
    const maxCell = Math.max(0, Math.ceil(total / cellSize) - 1);
    for (let c = Math.floor(lo / cellSize); c <= Math.min(maxCell, Math.floor(hi / cellSize)); c++) entry.cells.add(c);
    entry.meals.add(mealType);
    cellsByQuery.set(meal.query, entry);
  }

  const mealPools: Record<MealType, Candidate[]> = { breakfast: [], lunch: [], dinner: [] };
  for (const [query, entry] of cellsByQuery) {
    for (const cell of entry.cells) {
      const from = Math.max(0, cell * cellSize - 300);
      const to = Math.min(total, (cell + 1) * cellSize + 300);
      run(
        {
          query,
          ...(entry.includedType ? { includedType: entry.includedType } : {}),
          alongRoutePolyline: profile.encodedSlice(from, to),
          maxResults: TUNING.candidates.maxResultsPerSearch,
        },
        (places) => {
          const found = places.map((p) => toCandidate(p, profile));
          for (const m of entry.meals) mealPools[m].push(...found);
        },
      );
    }
  }

  await Promise.all(searches);
  if (totalSearches > 0 && errors.length === totalSearches) throw errors[0];

  for (const [id, list] of activity) activity.set(id, dedupeCandidates(list));
  // Breakfast can also be had at any restaurant that is open early.
  const meals: MealCandidateMap = {
    breakfast: dedupeCandidates([...mealPools.breakfast, ...mealPools.lunch]),
    lunch: dedupeCandidates(mealPools.lunch),
    dinner: dedupeCandidates(mealPools.dinner),
  };
  return { activity, meals, failedSearches: errors.length, totalSearches };
}

export function enabledMeals(request: TripRequest): MealType[] {
  return (['breakfast', 'lunch', 'dinner'] as const).filter((m) => request.preferences.meals[m]);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
