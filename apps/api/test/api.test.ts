import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { Trip, TripRequest } from '@journey/shared';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { MemoryTripRepository } from '../src/db/tripRepository.js';
import { buildCalendar } from '../src/services/calendar.js';
import { demoProvider, makeRequest } from './helpers.js';

let app: FastifyInstance;
let request: TripRequest;

beforeAll(async () => {
  const provider = demoProvider();
  const config = loadConfig({ DATA_SOURCE: 'demo', LOG_LEVEL: 'silent' });
  app = await buildApp({ config, repo: new MemoryTripRepository(), provider });
  request = await makeRequest(provider, 'Boise', 'Salt Lake City', { lodgingType: 'campground' });
});

afterAll(async () => {
  await app.close();
});

async function createTrip(): Promise<Trip> {
  const res = await app.inject({ method: 'POST', url: '/api/trips', payload: request });
  expect(res.statusCode).toBe(201);
  return res.json<Trip>();
}

describe('API', () => {
  it('reports health and public config without leaking keys', async () => {
    expect((await app.inject('/api/health')).json()).toEqual({ status: 'ok', dataSource: 'demo' });
    expect((await app.inject('/api/config')).json()).toEqual({ dataSource: 'demo', mapsBrowserKey: null, mapId: null });
  });

  it('autocompletes places and resolves details', async () => {
    const suggestions = (await app.inject('/api/places/autocomplete?q=boi')).json<{ placeId: string }[]>();
    expect(suggestions.length).toBeGreaterThan(0);
    const place = (await app.inject(`/api/places/${encodeURIComponent(suggestions[0]!.placeId)}`)).json();
    expect(place).toMatchObject({ name: 'Boise, ID', timeZone: 'America/Boise' });
    const jackson = (await app.inject('/api/places/autocomplete?q=jackson')).json<{ primaryText: string }[]>();
    expect(jackson[0]!.primaryText).toBe('Jackson');
  });

  it('creates, lists, renames and deletes trips', async () => {
    const trip = await createTrip();
    expect(trip.name).toBe('Boise → Salt Lake City');
    expect(trip.dataSource).toBe('demo');

    const list = (await app.inject('/api/trips')).json<{ id: string }[]>();
    expect(list.map((t) => t.id)).toContain(trip.id);

    const renamed = await app.inject({ method: 'PATCH', url: `/api/trips/${trip.id}`, payload: { name: 'Fun run' } });
    expect(renamed.json<Trip>().name).toBe('Fun run');

    expect((await app.inject({ method: 'DELETE', url: `/api/trips/${trip.id}` })).statusCode).toBe(204);
    expect((await app.inject(`/api/trips/${trip.id}`)).statusCode).toBe(404);
  });

  it('validates trip requests', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/trips', payload: { ...request, activities: [] } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ error: 'validation_error', message: expect.stringContaining('activity') });
  });

  it('edits a day and re-times it', async () => {
    const trip = await createTrip();
    const day = trip.days[0]!;
    const firstActivity = day.stops.find((s) => s.kind === 'activity')!;
    const stops = day.stops
      .filter((s) => s.id !== firstActivity.id)
      .map((s) => ({ ...s }));
    stops.unshift({ ...firstActivity, durationMinutes: 30, locked: true });

    const res = await app.inject({ method: 'PUT', url: `/api/trips/${trip.id}/days/0`, payload: { startTime: '09:00', stops } });
    expect(res.statusCode).toBe(200);
    const updated = res.json<Trip>().days[0]!;
    expect(updated.startTime).toBe('09:00');
    expect(updated.stops[0]).toMatchObject({ id: firstActivity.id, durationMinutes: 30, locked: true });
    expect(new Date(updated.departure).getTime()).toBe(new Date(day.departure).getTime() + 3600_000);
  });

  it('refuses to end a night anywhere but lodging', async () => {
    const trip = await createTrip();
    const stops = trip.days[0]!.stops.slice(0, -1);
    const res = await app.inject({ method: 'PUT', url: `/api/trips/${trip.id}/days/0`, payload: { stops } });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/lodging/);
  });

  it('swapping lodging re-plans the next morning', async () => {
    const trip = await createTrip();
    const day = trip.days[0]!;
    const lodging = day.stops[day.stops.length - 1]!;
    const alternatives = (await app.inject(`/api/trips/${trip.id}/days/0/stops/${lodging.id}/alternatives`)).json<{ place: Trip['request']['origin'] }[]>();
    expect(alternatives.length).toBeGreaterThan(0);
    const stops = [...day.stops.slice(0, -1), { ...lodging, id: undefined, place: alternatives[0]!.place }];
    const res = await app.inject({ method: 'PUT', url: `/api/trips/${trip.id}/days/0`, payload: { stops } });
    expect(res.statusCode).toBe(200);
    const updated = res.json<Trip>();
    expect(updated.days[1]!.start.name).toBe(alternatives[0]!.place.name);
  });

  it('regenerates a day while keeping locked stops', async () => {
    const trip = await createTrip();
    const day = trip.days[1]!;
    const keep = day.stops.find((s) => s.kind === 'activity')!;
    const stops = day.stops.map((s) => (s.id === keep.id ? { ...s, locked: true } : s));
    await app.inject({ method: 'PUT', url: `/api/trips/${trip.id}/days/1`, payload: { stops } });

    const res = await app.inject({ method: 'POST', url: `/api/trips/${trip.id}/days/1/regenerate`, payload: { freshIdeas: true } });
    expect(res.statusCode).toBe(200);
    const regenerated = res.json<Trip>().days[1]!;
    expect(regenerated.stops.some((s) => s.id === keep.id && s.locked)).toBe(true);
    const oldUnlocked = new Set(day.stops.filter((s) => s.kind === 'activity' && s.id !== keep.id).map((s) => s.place.name));
    expect(regenerated.stops.filter((s) => s.kind === 'activity' && !s.locked).every((s) => !oldUnlocked.has(s.place.name))).toBe(true);
  });

  it('searches near a day and exports a calendar', async () => {
    const trip = await createTrip();
    const results = (await app.inject(`/api/trips/${trip.id}/days/0/search?q=museum`)).json<{ detourMinutes: number }[]>();
    expect(results.length).toBeGreaterThan(0);
    expect(typeof results[0]!.detourMinutes).toBe('number');

    const ics = await app.inject(`/api/trips/${trip.id}/calendar.ics`);
    expect(ics.headers['content-type']).toContain('text/calendar');
    expect(ics.body).toContain('BEGIN:VEVENT');
    expect(ics.body.split('\r\n').every((line) => new TextEncoder().encode(line).length <= 75)).toBe(true);
    expect(ics.body).toBe(buildCalendar(trip));
  });

  it('returns JSON 404s for unknown routes and trips', async () => {
    expect((await app.inject('/api/nope')).statusCode).toBe(404);
    expect((await app.inject('/api/trips/00000000-0000-0000-0000-000000000000')).json()).toMatchObject({ error: 'not_found' });
  });
});
