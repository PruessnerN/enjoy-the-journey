import { LODGING_TYPES, type Issue, type PlaceInfo, type TripRequest } from '@journey/shared';
import type { RouteProfile } from '../geo/routeProfile.js';
import type { DataProvider } from '../providers/types.js';
import { meetsRating, qualityScore, toCandidate, type Candidate } from './candidates.js';
import { lodgingLinks, townFromAddress } from './links.js';
import type { SeqItem } from './sequence.js';
import { TUNING } from './tuning.js';

export interface NightChoice {
  item: SeqItem;
  /** Where this lodging sits along the whole trip's route (drive seconds from origin). */
  baseSeconds: number;
}

interface LodgingSearch {
  provider: DataProvider;
  profile: RouteProfile;
  targetSeconds: number;
  dayDriveSeconds: number;
  request: TripRequest;
  checkInDate: string;
  usedKeys: ReadonlySet<string>;
}

/**
 * Picks where to sleep: well-rated lodging of the requested type close to the point where
 * the day's share of driving is done. Small deviations are fine; big ones cost score.
 */
export async function chooseLodging(args: LodgingSearch): Promise<NightChoice> {
  const { profile, targetSeconds, request } = args;
  const L = TUNING.lodging;
  const type = request.lodgingType;
  const def = LODGING_TYPES[type];
  const before = clamp(args.dayDriveSeconds * L.windowBeforeFraction, L.minWindowMinutes * 60, L.maxWindowBeforeMinutes * 60);
  const after = clamp(args.dayDriveSeconds * L.windowAfterFraction, L.minWindowMinutes * 60, L.maxWindowAfterMinutes * 60);
  const maxDetour = Math.max(request.preferences.maxDetourMinutes, L.minDetourAllowanceMinutes) * 60;

  const search = async (query: string, includedType?: string): Promise<Candidate[]> => {
    const places = await args.provider.places.searchText({
      query,
      ...(includedType ? { includedType } : {}),
      alongRoutePolyline: profile.encodedSlice(targetSeconds - before, targetSeconds + after),
      maxResults: 20,
    });
    return places
      .map((p) => toCandidate(p, profile))
      .filter(
        (c) =>
          !args.usedKeys.has(c.key) &&
          c.detourSeconds <= maxDetour &&
          c.seconds >= targetSeconds - before * 1.5 &&
          c.seconds <= targetSeconds + after * 1.5,
      );
  };

  const rank = (candidates: Candidate[], minRating: number): Candidate | undefined =>
    candidates
      .filter((c) => meetsRating(c.place, minRating, false))
      .map((c) => ({
        c,
        score:
          qualityScore(c.place) -
          (Math.abs(c.seconds - targetSeconds) / 3600) * L.deviationPenaltyPerHour -
          (c.detourSeconds / 3600) * L.detourPenaltyPerHour,
      }))
      .sort((a, b) => b.score - a.score)[0]?.c;

  const minRating = request.preferences.minRating;
  const primary = await search(def.query, def.includedType);
  let chosen = rank(primary, minRating);
  const issues: Issue[] = [];

  if (!chosen && type !== 'vacation_rental') {
    chosen = rank(primary, minRating - L.ratingRelaxation);
    if (!chosen && def.fallbackQuery) {
      const fallback = await search(def.fallbackQuery);
      chosen = rank(fallback, minRating) ?? rank(fallback, minRating - L.ratingRelaxation);
    }
    if (chosen && (chosen.place.rating ?? 5) < minRating) {
      issues.push({
        code: 'no_lodging_found',
        severity: 'info',
        message: `Nothing rated ${minRating}+ nearby, so this is the best-rated option we found.`,
      });
    }
  }

  if (chosen) {
    const town = townFromAddress(chosen.place.address);
    if (type === 'vacation_rental') {
      issues.push({
        code: 'book_rental',
        severity: 'info',
        message: town
          ? `Book this rental directly, or compare Airbnb and VRBO listings in ${town}.`
          : 'Book this rental directly, or compare Airbnb and VRBO listings nearby.',
      });
    }
    return {
      item: lodgingItem(chosen.place, chosen.seconds, chosen.detourSeconds, request, args.checkInDate, town, issues),
      baseSeconds: chosen.seconds,
    };
  }

  // Vacation rentals rarely appear on Google Maps. Anchor the night in a town that has
  // lodging and link out to Airbnb/VRBO searches for the right dates.
  if (type === 'vacation_rental') {
    const anchors = await search(def.fallbackQuery ?? 'hotel');
    const anchor = rank(anchors, 0) ?? anchors[0];
    if (anchor) {
      const town = townFromAddress(anchor.place.address) ?? anchor.place.name;
      const place: PlaceInfo = {
        name: `Airbnb / VRBO in ${town}`,
        location: anchor.place.location,
        address: town,
        ...(anchor.place.timeZone ? { timeZone: anchor.place.timeZone } : {}),
        googleMapsUri: `https://www.google.com/maps/search/vacation+rentals/@${anchor.place.location.lat.toFixed(5)},${anchor.place.location.lng.toFixed(5)},12z`,
      };
      return {
        item: lodgingItem(place, anchor.seconds, anchor.detourSeconds, request, args.checkInDate, town, [
          {
            code: 'book_rental',
            severity: 'info',
            message: `Pick a rental in ${town} — we linked Airbnb and VRBO searches for your dates.`,
          },
        ]),
        baseSeconds: anchor.seconds,
      };
    }
  }

  const point = profile.pointAtSeconds(targetSeconds);
  const place: PlaceInfo = {
    name: `Overnight stop (${def.label.toLowerCase()})`,
    location: point,
    googleMapsUri: `https://www.google.com/maps/search/${encodeURIComponent(def.query)}/@${point.lat.toFixed(5)},${point.lng.toFixed(5)},11z`,
  };
  return {
    item: lodgingItem(place, targetSeconds, 0, request, args.checkInDate, null, [
      {
        code: 'no_lodging_found',
        severity: 'warning',
        message: `We couldn't find ${def.label.toLowerCase()} near this point. Use "Swap" to search a wider area.`,
      },
    ]),
    baseSeconds: targetSeconds,
  };
}

function lodgingItem(
  place: PlaceInfo,
  seconds: number,
  detourSeconds: number,
  request: TripRequest,
  checkInDate: string,
  town: string | null,
  issues: Issue[],
): SeqItem {
  const def = LODGING_TYPES[request.lodgingType];
  return {
    kind: 'lodging',
    lodgingType: request.lodgingType,
    place,
    durationMinutes: 0,
    seconds,
    detourSeconds,
    source: 'planner',
    activityLabel: def.label,
    emoji: def.emoji,
    links: lodgingLinks(request.lodgingType, place, town, checkInDate, request.preferences.travelers),
    planningIssues: issues,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
