import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  defaultSearchCategory,
  searchCategoriesFor,
  swapGroupFor,
  type Stop,
  type SwapSearchResult,
  type Trip,
} from '@journey/shared';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { MemoryTripRepository } from '../src/db/tripRepository.js';
import { activities, demoProvider, makeRequest } from './helpers.js';

let app: FastifyInstance;
let trip: Trip;

beforeAll(async () => {
  const provider = demoProvider();
  app = await buildApp({ config: loadConfig({ DATA_SOURCE: 'demo', LOG_LEVEL: 'silent' }), repo: new MemoryTripRepository(), provider });
  const request = await makeRequest(provider, 'Boise', 'Salt Lake City', {
    lodgingType: 'campground',
    activities: activities('disc_golf', 'scenic_viewpoint', 'coffee'),
  });
  trip = (await app.inject({ method: 'POST', url: '/api/trips', payload: request })).json<Trip>();
});

afterAll(async () => {
  await app.close();
});

const stopOf = (kind: Stop['kind'], day = 0) => trip.days[day]!.stops.find((s) => s.kind === kind)!;
const search = (stop: Stop, params: Record<string, string | number> = {}, day = 0) =>
  app.inject(`/api/trips/${trip.id}/days/${day}/stops/${stop.id}/alternatives?${new URLSearchParams(Object.entries(params).map(([k, v]): [string, string] => [k, String(v)]))}`);

describe('swap categories', () => {
  it('keeps each kind of stop in its own group', () => {
    expect(['activity', 'custom', 'meal', 'lodging', 'destination'].map((k) => swapGroupFor(k as Stop['kind']))).toEqual([
      'activity',
      'activity',
      'meal',
      'lodging',
      null,
    ]);
  });

  it("lists the trip's own activities first, then the rest of the catalog", () => {
    const options = searchCategoriesFor('activity', trip.request.activities);
    expect(options.slice(0, 3).map((c) => c.id)).toEqual(['disc_golf', 'scenic_viewpoint', 'coffee']);
    expect(options.map((c) => c.id)).toContain('kayaking');
    expect(options.every((c) => c.group === 'activity')).toBe(true);
  });

  it('starts on what the stop currently is', () => {
    const acts = trip.request.activities;
    expect(defaultSearchCategory({ kind: 'activity', activityId: 'disc_golf' }, acts, 'campground')).toBe('disc_golf');
    expect(defaultSearchCategory({ kind: 'meal', mealType: 'breakfast' }, acts, 'campground')).toBe('meal:breakfast');
    expect(defaultSearchCategory({ kind: 'meal', mealType: 'dinner' }, acts, 'campground')).toBe('meal:restaurant');
    expect(defaultSearchCategory({ kind: 'lodging' }, acts, 'campground')).toBe('lodging:campground');
    expect(defaultSearchCategory({ kind: 'lodging', lodgingType: 'hotel' }, acts, 'campground')).toBe('lodging:hotel');
    expect(defaultSearchCategory({ kind: 'custom' }, acts, 'campground')).toBe('top_attractions');
    expect(defaultSearchCategory({ kind: 'destination' }, acts, 'campground')).toBeNull();
  });
});

describe('swap search API', () => {
  it("searches the stop's own category in the area around it by default", async () => {
    const stop = trip.days.flatMap((d) => d.stops).find((s) => s.activityId === 'disc_golf')!;
    const day = trip.days.findIndex((d) => d.stops.includes(stop));
    const res = await search(stop, {}, day);
    expect(res.statusCode).toBe(200);
    const body = res.json<SwapSearchResult>();
    expect(body.category).toBe('disc_golf');
    const { area } = body;
    expect(area.south).toBeLessThan(stop.place.location.lat);
    expect(area.north).toBeGreaterThan(stop.place.location.lat);
    for (const r of body.results) {
      expect(r.place.location.lat).toBeGreaterThanOrEqual(area.south);
      expect(r.place.location.lat).toBeLessThanOrEqual(area.north);
      expect(r.place.location.lng).toBeGreaterThanOrEqual(area.west);
      expect(r.place.location.lng).toBeLessThanOrEqual(area.east);
      expect(r.place.placeId).not.toBe(stop.place.placeId);
    }
  });

  it('lets an activity switch to another activity, but never to food or lodging', async () => {
    const stop = stopOf('activity');
    expect((await search(stop, { category: 'kayaking' })).json<SwapSearchResult>().category).toBe('kayaking');
    for (const category of ['meal:pizza', 'lodging:hotel', 'nonsense']) {
      const res = await search(stop, { category });
      expect(res.statusCode).toBe(400);
      expect(res.json().message).toMatch(/only be swapped for another activity/);
    }
  });

  it('keeps meals as meals and lodging as lodging', async () => {
    const meal = stopOf('meal');
    expect((await search(meal, { category: 'meal:pizza' })).statusCode).toBe(200);
    expect((await search(meal, { category: 'disc_golf' })).statusCode).toBe(400);

    const lodging = stopOf('lodging');
    const hotels = await search(lodging, { category: 'lodging:hotel' });
    expect(hotels.json<SwapSearchResult>().category).toBe('lodging:hotel');
    expect((await search(lodging, { category: 'kayaking' })).statusCode).toBe(400);
    const lastDay = trip.days.length - 1;
    const destination = await search(trip.days[lastDay]!.stops.at(-1)!, {}, lastDay);
    expect(destination.statusCode).toBe(400);
    expect(destination.json().message).toMatch(/destination/);
  });

  it('searches a custom map area, refuses huge ones and pages through results', async () => {
    const meal = stopOf('meal');
    const { lat, lng } = meal.place.location;
    const area = { south: lat - 0.5, west: lng - 0.7, north: lat + 0.5, east: lng + 0.7 };
    const first = (await search(meal, { category: 'meal:restaurant', ...area })).json<SwapSearchResult>();
    expect(first.area).toEqual(area);
    expect(first.nextPageToken).toBeTruthy();

    const second = (await search(meal, { category: 'meal:restaurant', ...area, pageToken: first.nextPageToken! })).json<SwapSearchResult>();
    const firstIds = new Set(first.results.map((r) => r.place.placeId));
    expect(second.results.length).toBeGreaterThan(0);
    expect(second.results.every((r) => !firstIds.has(r.place.placeId))).toBe(true);

    expect((await search(meal, { south: lat - 10, west: lng - 10, north: lat + 10, east: lng + 10 })).statusCode).toBe(400);
    expect((await search(meal, { south: lat })).statusCode).toBe(400);
  });

  it('swapping a campground for a hotel makes that night a hotel night', async () => {
    const day = trip.days[0]!;
    const lodging = day.stops.at(-1)!;
    expect(lodging.lodgingType).toBe('campground');
    const hotel = (await search(lodging, { category: 'lodging:hotel' })).json<SwapSearchResult>().results[0]!;
    const stops = [
      ...day.stops.slice(0, -1),
      { ...lodging, id: undefined, place: hotel.place, lodgingType: 'hotel', activityLabel: 'Hotels & resorts', emoji: '🏨', links: undefined },
    ];
    const updated = (await app.inject({ method: 'PUT', url: `/api/trips/${trip.id}/days/0`, payload: { stops } })).json<Trip>();
    const night = updated.days[0]!.stops.at(-1)!;
    expect(night).toMatchObject({ kind: 'lodging', lodgingType: 'hotel', activityLabel: 'Hotels & resorts' });
    expect(night.links?.map((l) => l.label)).not.toContain('Recreation.gov');
    expect(updated.days[1]!.start.name).toBe(hotel.place.name);
  });
});
