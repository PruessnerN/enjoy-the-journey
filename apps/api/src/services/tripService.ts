import { randomUUID } from 'node:crypto';
import {
  LODGING_TYPES,
  defaultSearchCategory,
  routeLabel,
  searchCategoriesFor,
  swapGroupFor,
  type Bounds,
  type DayUpdate,
  type Issue,
  type LatLng,
  type PlaceCandidate,
  type Stop,
  type StopInput,
  type SwapGroup,
  type SwapSearchQuery,
  type SwapSearchResult,
  type Trip,
  type TripDay,
  type TripListItem,
  type TripRequest,
} from '@journey/shared';
import { boundsAround } from '../geo/geo.js';
import type { TripRepository } from '../db/tripRepository.js';
import { badRequest, notFound } from '../http/errors.js';
import { meetsRating, placeKey, toCandidate } from '../planner/candidates.js';
import { buildDayContext, withTimeZone } from '../planner/context.js';
import { buildDay } from '../planner/dayBuilder.js';
import { finalizeDay, profileFromDay, profileFromRoute, toWaypoint } from '../planner/finalize.js';
import { enabledMeals, gatherDayCandidates } from '../planner/gather.js';
import { lodgingLinks, townFromAddress } from '../planner/links.js';
import type { SeqItem } from '../planner/sequence.js';
import { planTrip, summarizeTrip } from '../planner/tripPlanner.js';
import { TUNING } from '../planner/tuning.js';
import { TripUsage } from '../planner/usage.js';
import type { DataProvider } from '../providers/types.js';
import { KeyedMutex } from '../util/keyedMutex.js';
import { buildCalendar } from './calendar.js';

const GROUP_NOUN: Record<SwapGroup, string> = { activity: 'activity', meal: 'meal stop', lodging: 'place to stay' };

/** Issues that come from planning (not from timing) and should survive edits of the same place. */
const STICKY_ISSUES = new Set<Issue['code']>(['book_rental', 'no_lodging_found', 'no_restaurant_found']);

export class TripService {
  private readonly mutex = new KeyedMutex();

  constructor(
    private readonly repo: TripRepository,
    private readonly provider: DataProvider,
  ) {}

  list(): Promise<TripListItem[]> {
    return this.repo.list();
  }

  async get(id: string): Promise<Trip> {
    const trip = await this.repo.get(id);
    if (!trip) throw notFound('Trip');
    return trip;
  }

  async create(request: TripRequest): Promise<Trip> {
    const plan = await planTrip(request, this.provider);
    const now = new Date().toISOString();
    const trip: Trip = {
      id: randomUUID(),
      name: request.name?.trim() || defaultTripName(request),
      createdAt: now,
      updatedAt: now,
      request: plan.request,
      days: plan.days,
      summary: plan.summary,
      overviewPolyline: plan.overviewPolyline,
      dataSource: this.provider.source,
      issues: plan.issues,
    };
    await this.repo.save(trip);
    return trip;
  }

  rename(id: string, name: string): Promise<Trip> {
    return this.mutate(id, async (trip) => {
      trip.name = name;
      return trip;
    });
  }

  async delete(id: string): Promise<void> {
    const deleted = await this.repo.delete(id);
    if (!deleted) throw notFound('Trip');
  }

  /** Re-runs the whole planner, optionally with changed preferences. */
  replan(id: string, request?: TripRequest): Promise<Trip> {
    return this.mutate(id, async (trip) => {
      const plan = await planTrip(request ?? trip.request, this.provider);
      return {
        ...trip,
        request: plan.request,
        days: plan.days,
        summary: plan.summary,
        overviewPolyline: plan.overviewPolyline,
        dataSource: this.provider.source,
        issues: plan.issues,
      };
    });
  }

  /** Applies the user's edits to one day (add/remove/reorder/swap stops, durations, times). */
  updateDay(id: string, index: number, update: DayUpdate): Promise<Trip> {
    return this.mutate(id, async (trip) => {
      const day = dayAt(trip, index);
      const isFinal = index === trip.days.length - 1;
      validateDayStops(update.stops, isFinal);
      validateEvents(day, update.stops);

      const previousById = new Map(day.stops.map((s) => [s.id, s]));
      const items = update.stops.map((input) => toSeqItem(input, previousById.get(input.id ?? '')));
      const end = items[items.length - 1]!;
      const oldEnd = day.stops[day.stops.length - 1]!;

      if (isFinal) {
        end.place = trip.request.destination;
      } else if (placeKey(end.place) !== placeKey(oldEnd.place)) {
        // The night may now be a different kind of lodging (e.g. campground swapped for a hotel).
        const lodgingType = end.lodgingType ?? trip.request.lodgingType;
        const town = townFromAddress(end.place.address);
        end.lodgingType = lodgingType;
        end.links = lodgingLinks(lodgingType, end.place, town, day.date, trip.request.preferences.travelers, stayNights(trip, index, oldEnd));
        end.planningIssues = [];
        end.emoji ??= LODGING_TYPES[lodgingType].emoji;
        end.activityLabel ??= LODGING_TYPES[lodgingType].label;
      }

      trip.days[index] = await this.finalize(trip, index, items, update.startTime ?? day.startTime);
      if (!isFinal && placeKey(end.place) !== placeKey(oldEnd.place)) {
        // The next morning starts somewhere new. Free days at a main event that stayed at the old
        // place move with it, up to the day the drive continues.
        const oldKey = placeKey(oldEnd.place);
        for (let j = index + 1; j < trip.days.length; j++) {
          const next = trip.days[j]!;
          const nextItems = next.stops.map((s) => toSeqItem(s, s));
          const nextEnd = nextItems[nextItems.length - 1]!;
          const staysToo = next.stay !== undefined && placeKey(nextEnd.place) === oldKey;
          if (staysToo) {
            Object.assign(nextEnd, {
              place: end.place,
              lodgingType: end.lodgingType,
              links: end.links,
              emoji: end.emoji,
              activityLabel: end.activityLabel,
              planningIssues: [],
            });
          }
          trip.days[j] = await this.finalize(trip, j, nextItems, next.startTime);
          if (!staysToo) break;
        }
      }
      return trip;
    });
  }

  /** Re-fills a day around its locked stops; `freshIdeas` avoids the current suggestions. */
  regenerateDay(id: string, index: number, freshIdeas: boolean): Promise<Trip> {
    return this.mutate(id, async (trip) => {
      const day = dayAt(trip, index);
      if (day.stay) throw badRequest("Free days at a main event aren't planned for you. Add the stops you'd like instead.");
      const isFinal = index === trip.days.length - 1;
      const request = trip.request;
      const ctx = buildDayContext(request, index, day.start, isFinal, day.startTime);
      const endStop = day.stops[day.stops.length - 1]!;
      // Main events are fixed, so the day's drive goes through them.
      const via = day.stops.filter((s) => s.kind === 'event').map((s) => toWaypoint(s.place));

      const route = await this.provider.routes.computeRoute(toWaypoint(day.start), toWaypoint(endStop.place), via);
      const profile = profileFromRoute(route);
      const candidates = await gatherDayCandidates(this.provider, profile, ctx, request);

      const project = (stop: Stop): SeqItem => {
        const c = toCandidate(stop.place, profile);
        return { ...toSeqItem(stop, stop), seconds: c.seconds, detourSeconds: c.detourSeconds };
      };
      const middle = day.stops.slice(0, -1);
      const locked = middle.filter((s) => s.locked).map(project);
      const excludeKeys = new Set(freshIdeas ? middle.filter((s) => !s.locked).map((s) => placeKey(s.place)) : []);
      const end: SeqItem = { ...toSeqItem(endStop, endStop), seconds: profile.totalSeconds, detourSeconds: 0 };

      const built = await buildDay({
        provider: this.provider,
        index,
        start: withTimeZone(day.start),
        profile,
        ctx,
        end,
        activities: request.activities,
        activityCandidates: candidates.activity,
        mealCandidates: candidates.meals,
        meals: enabledMeals(request),
        usage: TripUsage.fromDays(trip.days, index),
        locked,
        excludeKeys,
        minRating: request.preferences.minRating,
        maxDetourMinutes: request.preferences.maxDetourMinutes,
        position: { dayIndex: index, dayCount: trip.days.length, spread: false },
        maxActivitiesPerDay: request.preferences.maxActivitiesPerDay ?? null,
      });
      trip.days[index] = built.day;
      return trip;
    });
  }

  /**
   * Swap search: places of one category inside an area (by default, around the stop), ranked the
   * way the planner ranks them. The category must belong to the stop's group, so a meal can only
   * be swapped for somewhere to eat and lodging only for somewhere to stay.
   */
  async swapSearch(id: string, index: number, stopId: string, query: SwapSearchQuery): Promise<SwapSearchResult> {
    const trip = await this.get(id);
    const day = dayAt(trip, index);
    const stop = day.stops.find((s) => s.id === stopId);
    if (!stop) throw notFound('Stop');
    const group = swapGroupFor(stop.kind);
    if (!group) {
      throw badRequest(
        stop.kind === 'event'
          ? "Main events can't be swapped here. Change them in Trip settings."
          : "Your destination can't be swapped here. Change it in Trip settings.",
      );
    }

    const categoryId = query.category ?? defaultSearchCategory(stop, trip.request.activities, trip.request.lodgingType);
    const category = searchCategoriesFor(group, trip.request.activities).find((c) => c.id === categoryId);
    if (!category) {
      throw badRequest(`This ${GROUP_NOUN[group]} can only be swapped for another ${GROUP_NOUN[group]}.`);
    }

    const { swap } = TUNING;
    const area: Bounds =
      query.south !== undefined && query.west !== undefined && query.north !== undefined && query.east !== undefined
        ? { south: query.south, west: query.west, north: query.north, east: query.east }
        : boundsAround(stop.place.location, swap.areaRadiusKm[group]);
    if (area.south >= area.north || area.west >= area.east) throw badRequest('Invalid map area.');
    if (area.north - area.south > swap.maxAreaSpanDegrees.lat || area.east - area.west > swap.maxAreaSpanDegrees.lng) {
      throw badRequest('That area is too big to search. Zoom in a little and try again.');
    }

    const keyword = query.q?.trim();
    const page = await this.provider.places.searchPage(
      {
        query: keyword ? `${keyword} ${category.query}` : category.query,
        ...(category.includedType ? { includedType: category.includedType } : {}),
        within: area,
        maxResults: swap.resultsPerPage,
      },
      query.pageToken,
    );

    const used = new Set(trip.days.flatMap((d) => d.stops.map((s) => placeKey(s.place))));
    const minRating = trip.request.preferences.minRating;
    const profile = profileFromDay(day);
    const results = page.places
      .filter((p) => !used.has(placeKey(p)))
      .map((p) => toCandidate(p, profile))
      .sort((a, b) => Number(meetsRating(b.place, minRating, true)) - Number(meetsRating(a.place, minRating, true)) || b.score - a.score)
      .map((c) => ({
        place: c.place,
        detourMinutes: Math.round(c.detourSeconds / 60),
        distanceFromRouteMeters: Math.round(c.offRouteMeters),
        score: Math.round(c.score * 100) / 100,
      }));
    return { category: category.id, area, results, ...(page.nextPageToken ? { nextPageToken: page.nextPageToken } : {}) };
  }

  /** Free-text search near a day's route, e.g. a place the user found on their own. */
  async searchNearDay(id: string, index: number, query: string, near?: LatLng): Promise<PlaceCandidate[]> {
    const trip = await this.get(id);
    const day = dayAt(trip, index);
    const profile = profileFromDay(day);
    // A free day at a main event has no drive to search along; search around where we're staying.
    const center = near ?? (profile.totalSeconds > 0 ? profile.pointAtSeconds(profile.totalSeconds / 2) : day.start.location);
    const places = await this.provider.places.searchText({ query, near: { center, radiusMeters: 30_000 }, maxResults: 20 });
    return places
      .map((p) => toCandidate(p, profile))
      .map((c) => ({
        place: c.place,
        detourMinutes: Math.round(c.detourSeconds / 60),
        distanceFromRouteMeters: Math.round(c.offRouteMeters),
        score: Math.round(c.score * 100) / 100,
      }));
  }

  async calendar(id: string): Promise<{ name: string; ics: string }> {
    const trip = await this.get(id);
    return { name: trip.name, ics: buildCalendar(trip) };
  }

  private async finalize(trip: Trip, index: number, items: SeqItem[], startTime: string, extraIssues: Issue[] = []): Promise<TripDay> {
    const start = index === 0 ? trip.request.origin : trip.days[index - 1]!.stops[trip.days[index - 1]!.stops.length - 1]!.place;
    const ctx = buildDayContext(trip.request, index, start, index === trip.days.length - 1, startTime);
    const day = await finalizeDay({ provider: this.provider, index, ctx, start: withTimeZone(start), items, extraIssues });
    const stay = trip.days[index]?.stay;
    return stay ? { ...day, stay } : day;
  }

  private mutate(id: string, change: (trip: Trip) => Promise<Trip>): Promise<Trip> {
    return this.mutex.run(id, async () => {
      const trip = await this.get(id);
      const updated = await change(trip);
      updated.summary = summarizeTrip(updated.days, updated.summary.directDriveSeconds, updated.summary.directDistanceMeters);
      updated.updatedAt = new Date().toISOString();
      await this.repo.save(updated);
      return updated;
    });
  }
}

function dayAt(trip: Trip, index: number): TripDay {
  const day = trip.days[index];
  if (!day) throw notFound('Day');
  return day;
}

function defaultTripName(request: TripRequest): string {
  return routeLabel(request).slice(0, 120);
}

/** Nights booked at the lodging ending day `index`: that night plus following free days at a main event. */
function stayNights(trip: Trip, index: number, lodging: Stop): number {
  let nights = 1;
  for (let j = index + 1; j < trip.days.length; j++) {
    const next = trip.days[j]!;
    if (!next.stay || placeKey(next.stops[next.stops.length - 1]!.place) !== placeKey(lodging.place)) break;
    nights++;
  }
  return nights;
}

/** Main events are part of the trip's settings: day edits can move around them but not drop or change them. */
function validateEvents(day: TripDay, stops: StopInput[]): void {
  const describe = (list: readonly (StopInput | Stop)[]) =>
    list
      .filter((s) => s.kind === 'event')
      .map((s) => `${s.eventId ?? ''}@${placeKey(s.place)}`)
      .sort()
      .join('|');
  if (describe(day.stops) !== describe(stops)) {
    throw badRequest('Main events can only be added, removed or changed in Trip settings.');
  }
}

function validateDayStops(stops: StopInput[], isFinal: boolean): void {
  const last = stops[stops.length - 1]!;
  const expected = isFinal ? 'destination' : 'lodging';
  if (last.kind !== expected) {
    throw badRequest(isFinal ? 'The last day must end at your destination.' : 'Every night on the road must end at lodging.');
  }
  if (stops.slice(0, -1).some((s) => s.kind === 'lodging' || s.kind === 'destination')) {
    throw badRequest('Lodging and the destination can only be the last stop of a day.');
  }
}

function toSeqItem(input: StopInput | Stop, previous?: Stop): SeqItem {
  const isEnd = input.kind === 'lodging' || input.kind === 'destination';
  const samePlace = previous && placeKey(previous.place) === placeKey(input.place);
  const sticky = samePlace ? previous.issues.filter((i) => STICKY_ISSUES.has(i.code)) : [];
  const source = input.source ?? previous?.source ?? 'user';
  const item: SeqItem = {
    id: input.id ?? randomUUID(),
    kind: input.kind,
    place: withTimeZone(input.place),
    durationMinutes: isEnd ? 0 : input.durationMinutes,
    seconds: 0,
    detourSeconds: 0,
    source,
    locked: input.locked ?? source === 'user',
    planningIssues: sticky,
  };
  if (input.mealType) item.mealType = input.mealType;
  if (input.lodgingType) item.lodgingType = input.lodgingType;
  if (input.eventId) item.eventId = input.eventId;
  if (input.outdoor !== undefined) item.outdoor = input.outdoor;
  if (input.pinnedStart) item.pinnedStart = input.pinnedStart;
  if (input.arriveBy) item.arriveBy = input.arriveBy;
  if (input.activityId) item.activityId = input.activityId;
  if (input.activityLabel) item.activityLabel = input.activityLabel;
  if (input.emoji) item.emoji = input.emoji;
  if (input.notes) item.notes = input.notes;
  if (input.links?.length) item.links = input.links;
  return item;
}
