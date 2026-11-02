import { randomUUID } from 'node:crypto';
import {
  LODGING_TYPES,
  MEALS,
  findActivityDefinition,
  type DayUpdate,
  type Issue,
  type LatLng,
  type PlaceCandidate,
  type Stop,
  type StopInput,
  type Trip,
  type TripDay,
  type TripListItem,
  type TripRequest,
} from '@journey/shared';
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
import { TripUsage } from '../planner/usage.js';
import type { DataProvider } from '../providers/types.js';
import { KeyedMutex } from '../util/keyedMutex.js';
import { buildCalendar } from './calendar.js';

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

      const previousById = new Map(day.stops.map((s) => [s.id, s]));
      const items = update.stops.map((input) => toSeqItem(input, previousById.get(input.id ?? '')));
      const end = items[items.length - 1]!;
      const oldEnd = day.stops[day.stops.length - 1]!;

      if (isFinal) {
        end.place = trip.request.destination;
      } else if (placeKey(end.place) !== placeKey(oldEnd.place)) {
        const town = townFromAddress(end.place.address);
        end.links = lodgingLinks(trip.request.lodgingType, end.place, town, day.date, trip.request.preferences.travelers);
        end.planningIssues = [];
        end.emoji ??= LODGING_TYPES[trip.request.lodgingType].emoji;
        end.activityLabel ??= LODGING_TYPES[trip.request.lodgingType].label;
      }

      trip.days[index] = await this.finalize(trip, index, items, update.startTime ?? day.startTime);
      if (!isFinal && placeKey(end.place) !== placeKey(oldEnd.place)) {
        const next = trip.days[index + 1]!;
        trip.days[index + 1] = await this.finalize(trip, index + 1, next.stops.map((s) => toSeqItem(s, s)), next.startTime);
      }
      return trip;
    });
  }

  /** Re-fills a day around its locked stops; `freshIdeas` avoids the current suggestions. */
  regenerateDay(id: string, index: number, freshIdeas: boolean): Promise<Trip> {
    return this.mutate(id, async (trip) => {
      const day = dayAt(trip, index);
      const isFinal = index === trip.days.length - 1;
      const request = trip.request;
      const ctx = buildDayContext(request, index, day.start, isFinal, day.startTime);
      const endStop = day.stops[day.stops.length - 1]!;

      const route = await this.provider.routes.computeRoute(toWaypoint(day.start), toWaypoint(endStop.place));
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

  /** Similar places near a stop, ranked the same way the planner ranks them. */
  async alternatives(id: string, index: number, stopId: string): Promise<PlaceCandidate[]> {
    const trip = await this.get(id);
    const day = dayAt(trip, index);
    const stop = day.stops.find((s) => s.id === stopId);
    if (!stop) throw notFound('Stop');

    const { query, includedType } = searchTermsFor(stop, trip.request);
    const radiusMeters = stop.kind === 'lodging' ? 35_000 : 25_000;
    const places = await this.provider.places.searchText({
      query,
      ...(includedType ? { includedType } : {}),
      near: { center: stop.place.location, radiusMeters },
      maxResults: 20,
    });
    const used = new Set(trip.days.flatMap((d) => d.stops.map((s) => placeKey(s.place))));
    const minRating = trip.request.preferences.minRating;
    const profile = profileFromDay(day);
    return places
      .filter((p) => !used.has(placeKey(p)))
      .map((p) => toCandidate(p, profile))
      .sort(
        (a, b) =>
          Number(meetsRating(b.place, minRating, true)) - Number(meetsRating(a.place, minRating, true)) || b.score - a.score,
      )
      .slice(0, 15)
      .map((c) => ({
        place: c.place,
        detourMinutes: Math.round(c.detourSeconds / 60),
        distanceFromRouteMeters: Math.round(c.offRouteMeters),
        score: Math.round(c.score * 100) / 100,
      }));
  }

  /** Free-text search near a day's route, e.g. a place the user found on their own. */
  async searchNearDay(id: string, index: number, query: string, near?: LatLng): Promise<PlaceCandidate[]> {
    const trip = await this.get(id);
    const day = dayAt(trip, index);
    const profile = profileFromDay(day);
    const center = near ?? profile.pointAtSeconds(profile.totalSeconds / 2);
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
    return finalizeDay({ provider: this.provider, index, ctx, start: withTimeZone(start), items, extraIssues });
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
  const short = (name: string) => name.split(',')[0]!.trim();
  return `${short(request.origin.name)} → ${short(request.destination.name)}`;
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
  if (input.outdoor !== undefined) item.outdoor = input.outdoor;
  if (input.pinnedStart) item.pinnedStart = input.pinnedStart;
  if (input.activityId) item.activityId = input.activityId;
  if (input.activityLabel) item.activityLabel = input.activityLabel;
  if (input.emoji) item.emoji = input.emoji;
  if (input.notes) item.notes = input.notes;
  if (input.links?.length) item.links = input.links;
  return item;
}

function searchTermsFor(stop: Stop, request: TripRequest): { query: string; includedType?: string } {
  if (stop.kind === 'lodging') {
    const def = LODGING_TYPES[request.lodgingType];
    return { query: def.query, ...(def.includedType ? { includedType: def.includedType } : {}) };
  }
  if (stop.kind === 'meal' && stop.mealType) {
    const meal = MEALS[stop.mealType];
    return { query: meal.query, ...(meal.includedType ? { includedType: meal.includedType } : {}) };
  }
  const activity = request.activities.find((a) => a.id === stop.activityId) ?? (stop.activityId ? findActivityDefinition(stop.activityId) : undefined);
  if (activity) return { query: activity.query, ...(activity.includedType ? { includedType: activity.includedType } : {}) };
  return { query: stop.activityLabel ?? stop.place.primaryTypeLabel ?? 'things to do' };
}
