import { LODGING_TYPES, type Issue, type LatLng, type PlaceInfo, type TripRequest } from '@journey/shared';
import { haversineMeters } from '../geo/geo.js';
import type { RouteProfile } from '../geo/routeProfile.js';
import type { DataProvider } from '../providers/types.js';
import { meetsRating, placeKey, qualityScore, toCandidate } from './candidates.js';
import { toWaypoint } from './finalize.js';
import { lodgingLinks, townFromAddress } from './links.js';
import type { SeqItem } from './sequence.js';
import { TUNING } from './tuning.js';

export interface NightChoice {
  item: SeqItem;
  /** Where this lodging sits along the route searched (drive seconds from its start). */
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

/** A lodging option and how much its location costs it in the ranking. */
interface Option {
  place: PlaceInfo;
  seconds: number;
  detourSeconds: number;
  penalty: number;
}

interface SelectArgs {
  request: TripRequest;
  checkInDate: string;
  nights: number;
  search: (query: string, includedType?: string) => Promise<Option[]>;
  /** Where to anchor the night if nothing at all is found. */
  fallback: { location: LatLng; seconds: number };
}

/**
 * Picks where to sleep: well-rated lodging of the requested type close to the point where
 * the day's share of driving is done. Small deviations are fine; big ones cost score.
 */
export async function chooseLodging(args: LodgingSearch): Promise<NightChoice> {
  const { profile, targetSeconds, request } = args;
  const L = TUNING.lodging;
  const before = clamp(args.dayDriveSeconds * L.windowBeforeFraction, L.minWindowMinutes * 60, L.maxWindowBeforeMinutes * 60);
  const after = clamp(args.dayDriveSeconds * L.windowAfterFraction, L.minWindowMinutes * 60, L.maxWindowAfterMinutes * 60);
  const maxDetour = Math.max(request.preferences.maxDetourMinutes, L.minDetourAllowanceMinutes) * 60;

  return selectLodging({
    request,
    checkInDate: args.checkInDate,
    nights: 1,
    fallback: { location: profile.pointAtSeconds(targetSeconds), seconds: targetSeconds },
    search: async (query, includedType) => {
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
        )
        .map((c) => ({
          place: c.place,
          seconds: c.seconds,
          detourSeconds: c.detourSeconds,
          penalty: (Math.abs(c.seconds - targetSeconds) / 3600) * L.deviationPenaltyPerHour + (c.detourSeconds / 3600) * L.detourPenaltyPerHour,
        }));
    },
  });
}

interface StayLodgingSearch {
  provider: DataProvider;
  /** The main event to stay near. */
  place: PlaceInfo;
  /**
   * Where the drive actually reaches the main event. For big places (a national park) this can be
   * far from the place's centre, so lodging is searched around both.
   */
  arrival?: LatLng;
  request: TripRequest;
  checkInDate: string;
  nights: number;
  usedKeys: ReadonlySet<string>;
}

/**
 * Picks one place to stay for every night spent at a main event: well rated and a short real drive
 * from it. Straight-line distance isn't enough: seasonal road closures (a national park in winter)
 * can turn a nearby campground into a six-hour drive, so the best options are routed for real.
 */
export async function chooseStayLodging(args: StayLodgingSearch): Promise<SeqItem> {
  const L = TUNING.lodging;
  const radiusMeters = L.stayRadiusKm * 1000;
  const centers = [args.place.location];
  if (args.arrival && haversineMeters(args.arrival, args.place.location) > 5_000) centers.unshift(args.arrival);
  const from = toWaypoint(args.place);
  const minRating = args.request.preferences.minRating;

  const choice = await selectLodging({
    request: args.request,
    checkInDate: args.checkInDate,
    nights: args.nights,
    fallback: { location: centers[0]!, seconds: 0 },
    search: async (query, includedType) => {
      const found = await Promise.all(
        centers.map((center) =>
          args.provider.places.searchText({
            query,
            ...(includedType ? { includedType } : {}),
            near: { center, radiusMeters },
            maxResults: 20,
          }),
        ),
      );
      const seen = new Set<string>();
      const nearby = found.flat().flatMap((place) => {
        const key = placeKey(place);
        const meters = Math.min(...centers.map((c) => haversineMeters(place.location, c)));
        if (seen.has(key) || args.usedKeys.has(key) || meters > radiusMeters * 1.5) return [];
        seen.add(key);
        return [{ place, guess: qualityScore(place) - (meters / 1000) * L.stayDistancePenaltyPerKm }];
      });
      // Route the most promising options (well-rated ones first) and keep those a short drive away.
      const shortlist = nearby
        .sort((a, b) => Number(meetsRating(b.place, minRating, false)) - Number(meetsRating(a.place, minRating, false)) || b.guess - a.guess)
        .slice(0, L.stayCandidatesToRoute);
      const routed = await Promise.all(
        shortlist.map(async ({ place }) => {
          try {
            const route = await args.provider.routes.computeRoute(from, toWaypoint(place));
            return { place, driveSeconds: route.durationSeconds };
          } catch {
            return null;
          }
        }),
      );
      return routed.flatMap((r) =>
        r && r.driveSeconds <= L.stayMaxDriveMinutes * 60
          ? [{ place: r.place, seconds: 0, detourSeconds: 2 * r.driveSeconds, penalty: (r.driveSeconds / 3600) * L.stayDrivePenaltyPerHour }]
          : [],
      );
    },
  });
  return choice.item;
}

async function selectLodging(args: SelectArgs): Promise<NightChoice> {
  const { request } = args;
  const L = TUNING.lodging;
  const type = request.lodgingType;
  const def = LODGING_TYPES[type];

  const rank = (options: Option[], minRating: number): Option | undefined =>
    options
      .filter((o) => meetsRating(o.place, minRating, false))
      .map((o) => ({ o, score: qualityScore(o.place) - o.penalty }))
      .sort((a, b) => b.score - a.score)[0]?.o;

  const minRating = request.preferences.minRating;
  const primary = await args.search(def.query, def.includedType);
  let chosen = rank(primary, minRating);
  const issues: Issue[] = [];

  if (!chosen && type !== 'vacation_rental') {
    chosen = rank(primary, minRating - L.ratingRelaxation);
    if (!chosen && def.fallbackQuery) {
      const fallback = await args.search(def.fallbackQuery);
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

  const item = (place: PlaceInfo, option: { seconds: number; detourSeconds: number }, town: string | null, extra: Issue[]): NightChoice => ({
    item: lodgingItem(place, option.seconds, option.detourSeconds, request, args.checkInDate, args.nights, town, extra),
    baseSeconds: option.seconds,
  });

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
    return item(chosen.place, chosen, town, issues);
  }

  // Vacation rentals rarely appear on Google Maps. Anchor the night in a town that has
  // lodging and link out to Airbnb/VRBO searches for the right dates.
  if (type === 'vacation_rental') {
    const anchors = await args.search(def.fallbackQuery ?? 'hotel');
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
      return item(place, anchor, town, [
        { code: 'book_rental', severity: 'info', message: `Pick a rental in ${town} — we linked Airbnb and VRBO searches for your dates.` },
      ]);
    }
  }

  const point = args.fallback.location;
  const place: PlaceInfo = {
    name: `Overnight stop (${def.label.toLowerCase()})`,
    location: point,
    googleMapsUri: `https://www.google.com/maps/search/${encodeURIComponent(def.query)}/@${point.lat.toFixed(5)},${point.lng.toFixed(5)},11z`,
  };
  return item(place, { seconds: args.fallback.seconds, detourSeconds: 0 }, null, [
    {
      code: 'no_lodging_found',
      severity: 'warning',
      message: `We couldn't find ${def.label.toLowerCase()} near this point. Use "Swap" to search a wider area.`,
    },
  ]);
}

function lodgingItem(
  place: PlaceInfo,
  seconds: number,
  detourSeconds: number,
  request: TripRequest,
  checkInDate: string,
  nights: number,
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
    links: lodgingLinks(request.lodgingType, place, town, checkInDate, request.preferences.travelers, nights),
    planningIssues: issues,
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
