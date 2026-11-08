import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { addDaysToIsoDate, tripRequestSchema, type MainEvent, type PlaceInfo, type Trip, type TripDay, type TripRequest } from '@journey/shared';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { MemoryTripRepository } from '../src/db/tripRepository.js';
import { placeKey } from '../src/planner/candidates.js';
import { allocateDays, nightTargets, tripSegments, type SegmentTiming } from '../src/planner/itinerary.js';
import { chooseStayLodging } from '../src/planner/lodging.js';
import { planTrip } from '../src/planner/tripPlanner.js';
import { cityPlace, demoProvider, makeRequest } from './helpers.js';

const BLOCKING = ['closed', 'after_dark', 'meal_outside_window', 'late_arrival', 'night_driving'];

const event = (id: string, place: PlaceInfo, patch: Partial<MainEvent> = {}): MainEvent => ({
  id,
  place,
  stayUnit: 'nights',
  stayAmount: 1,
  ...patch,
});

const lastStop = (day: TripDay) => day.stops[day.stops.length - 1]!;

function assertContinuous(days: TripDay[], request: TripRequest): void {
  days.forEach((day, i) => {
    expect(day.index).toBe(i);
    expect(day.date).toBe(addDaysToIsoDate(request.departureDate, i));
    expect(lastStop(day).kind).toBe(i === days.length - 1 ? 'destination' : 'lodging');
    if (i > 0) expect(placeKey(day.start)).toBe(placeKey(lastStop(days[i - 1]!).place));
    // The planner never creates blocking problems on the stops it picked.
    const problems = day.stops.filter((s) => s.kind !== 'event').flatMap((s) => s.issues).filter((issue) => BLOCKING.includes(issue.code));
    expect(problems).toEqual([]);
  });
}

describe('main event itinerary rules', () => {
  const timing = (patch: Partial<SegmentTiming> = {}): SegmentTiming => ({ driveSeconds: 8 * 3600, stops: [], naturalDays: 2, endDay: null, ...patch });

  it('splits the trip at overnight main events and keeps few-hours events on the drive', async () => {
    const provider = demoProvider();
    const request = await makeRequest(provider, 'Boise', 'Seattle', {
      mainEvents: [
        event('show', await cityPlace(provider, 'Twin Falls'), { stayUnit: 'hours', stayAmount: 3 }),
        event('park', await cityPlace(provider, 'West Yellowstone'), { stayAmount: 2 }),
      ],
    });
    const segments = tripSegments(request);
    expect(segments.map((s) => [s.from.name, s.to.name, s.stops.map((e) => e.id), s.endEvent?.id ?? null])).toEqual([
      ['Boise, ID', 'West Yellowstone, MT', ['show'], 'park'],
      ['West Yellowstone, MT', 'Seattle, WA', [], null],
    ]);
  });

  it('counts stay nights and stretches a drive to arrive on a dated main event', () => {
    const segments = [
      { index: 0, from: {} as PlaceInfo, to: {} as PlaceInfo, endEvent: { stayAmount: 3, place: { name: 'Moab, UT' }, arrivalDate: '2026-06-12' } as MainEvent, stops: [] },
      { index: 1, from: {} as PlaceInfo, to: {} as PlaceInfo, endEvent: null, stops: [] },
    ];
    const free = allocateDays({ segments, timings: [timing(), timing({ naturalDays: 1 })], fixedDays: null });
    // Drive 2 days, 2 free days, then a 1-day drive that starts with checking out.
    expect(free).toMatchObject({ days: [2, 1], startDays: [0, 4], totalDays: 5, notes: [] });

    const dated = allocateDays({ segments, timings: [timing({ endDay: 3 }), timing({ naturalDays: 1 })], fixedDays: null });
    expect(dated).toMatchObject({ days: [4, 1], startDays: [0, 6], totalDays: 7 });

    const rushed = allocateDays({ segments, timings: [timing({ endDay: 0, naturalDays: 2 }), timing({ naturalDays: 1 })], fixedDays: null });
    expect(rushed.days[0]).toBe(1);
    expect(rushed.notes[0]).toMatch(/Getting to Moab by 2026-06-12 means longer driving days/);
  });

  it('meets a fixed trip length with the drives after the last dated event', () => {
    const segments = [
      { index: 0, from: {} as PlaceInfo, to: {} as PlaceInfo, endEvent: { stayAmount: 2 } as MainEvent, stops: [] },
      { index: 1, from: {} as PlaceInfo, to: {} as PlaceInfo, endEvent: null, stops: [] },
    ];
    const timings = [timing({ endDay: 2 }), timing({ naturalDays: 1 })];
    expect(allocateDays({ segments, timings, fixedDays: 7 })).toMatchObject({ days: [3, 3], totalDays: 7, notes: [] });
    const tooShort = allocateDays({ segments, timings, fixedDays: 3 });
    expect(tooShort.totalDays).toBe(5);
    expect(tooShort.notes[0]).toMatch(/need 5 days/);
  });

  it('places nights so a dated few-hours event lands on its day', () => {
    const stops = [{ position: 2 * 3600, durationSeconds: 3 * 3600, day: 2, dayFraction: 0.5 }];
    const [first, second] = nightTargets({ driveSeconds: 6 * 3600, stops }, 3, 0);
    // Two days' worth of the 2h drive before the event, then the event mid-way through day 3.
    expect(first!).toBeLessThan(second!);
    expect(second!).toBeLessThan(2 * 3600);
    // Undated: evenly split effort, and a night never falls in the middle of the event.
    const even = nightTargets({ driveSeconds: 6 * 3600, stops: [{ ...stops[0]!, day: null }] }, 3, 0);
    expect(even[0]).toBe(2 * 3600);
    expect(even[1]).toBe(3 * 3600);
  });

  it('validates main events in requests', async () => {
    const provider = demoProvider();
    const base = await makeRequest(provider, 'Boise', 'Salt Lake City');
    const park = event('park', await cityPlace(provider, 'Jackson'));
    expect(tripRequestSchema.safeParse({ ...base, roundTrip: true }).success).toBe(false);
    expect(tripRequestSchema.safeParse({ ...base, roundTrip: true, mainEvents: [park] }).success).toBe(true);
    expect(tripRequestSchema.safeParse({ ...base, mainEvents: [{ ...park, stayUnit: 'hours', stayAmount: 20 }] }).success).toBe(false);
    expect(tripRequestSchema.safeParse({ ...base, mainEvents: [{ ...park, arrivalTime: '15:00' }] }).success).toBe(false);
    expect(tripRequestSchema.safeParse({ ...base, mainEvents: [{ ...park, arrivalDate: '2026-06-01' }] }).success).toBe(false);
    const later = { ...park, id: 'later', arrivalDate: '2026-06-20' };
    const earlier = { ...park, id: 'earlier', arrivalDate: '2026-06-15' };
    expect(tripRequestSchema.safeParse({ ...base, mainEvents: [later, earlier] }).success).toBe(false);
    expect(tripRequestSchema.safeParse({ ...base, mainEvents: Array.from({ length: 11 }, (_, i) => ({ ...park, id: `e${i}` })) }).success).toBe(false);
  });
});

describe('lodging for a stay at a main event', () => {
  it('skips nearby-looking lodging that is a long drive away (e.g. roads closed for winter)', async () => {
    const provider = demoProvider();
    const request = await makeRequest(provider, 'Boise', 'Seattle', { lodgingType: 'hotel' });
    const park = await cityPlace(provider, 'West Yellowstone');
    const args = { provider, place: park, request, checkInDate: '2026-11-16', nights: 2, usedKeys: new Set<string>() };
    const usual = await chooseStayLodging(args);
    expect(usual.place.placeId).toBeTruthy();

    const route = provider.routes.computeRoute.bind(provider.routes);
    const spy = vi.spyOn(provider.routes, 'computeRoute').mockImplementation(async (from, to, via) => {
      const result = await route(from, to, via);
      // The usual pick is open in summer only: reaching it means driving around the park.
      return to.placeId === usual.place.placeId ? { ...result, durationSeconds: 6.4 * 3600 } : result;
    });
    try {
      const winter = await chooseStayLodging(args);
      expect(winter.kind).toBe('lodging');
      expect(winter.place.placeId).not.toBe(usual.place.placeId);
      expect(winter.detourSeconds).toBeLessThanOrEqual(2 * 60 * 60);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('planTrip with main events (demo data)', () => {
  it('visits a dated few-hours event on its day, at its time, on the way to the destination', async () => {
    const provider = demoProvider();
    const twinFalls = await cityPlace(provider, 'Twin Falls');
    const request = await makeRequest(provider, 'Boise', 'Salt Lake City', {
      mainEvents: [event('show', twinFalls, { stayUnit: 'hours', stayAmount: 2, arrivalDate: '2026-06-13', arrivalTime: '13:00' })],
    });
    const plan = await planTrip(request, provider);
    assertContinuous(plan.days, plan.request);
    const showDay = plan.days.find((d) => d.stops.some((s) => s.eventId === 'show'))!;
    expect(showDay.date).toBe('2026-06-13');
    const show = showDay.stops.find((s) => s.eventId === 'show')!;
    expect(show).toMatchObject({ kind: 'event', durationMinutes: 120, pinnedStart: '13:00', locked: true });
    expect(show.issues.filter((i) => i.code === 'pinned_late')).toEqual([]);
    expect(lastStop(plan.days.at(-1)!).place.name).toBe('Salt Lake City, UT');
    expect(plan.issues.filter((i) => i.code === 'event_timing')).toEqual([]);
  });

  it('plans a round trip with free days at an overnight main event', async () => {
    const provider = demoProvider();
    const slc = await cityPlace(provider, 'Salt Lake City');
    const request = await makeRequest(provider, 'Boise', 'Boise', {
      lodgingType: 'hotel',
      roundTrip: true,
      mainEvents: [event('slc', slc, { stayAmount: 3, arrivalDate: '2026-06-13', arrivalTime: '18:00' })],
    });
    const plan = await planTrip(request, provider);
    assertContinuous(plan.days, plan.request);
    const { days } = plan;
    expect(plan.request.destination).toEqual(plan.request.origin);
    expect(lastStop(days.at(-1)!).place.name).toBe('Boise, ID');

    const arrival = days.findIndex((d) => d.stops.some((s) => s.eventId === 'slc'));
    expect(days[arrival]!.date).toBe('2026-06-13');
    const arrive = days[arrival]!.stops.find((s) => s.eventId === 'slc')!;
    expect(arrive).toMatchObject({ kind: 'event', durationMinutes: 0, arriveBy: '18:00' });
    expect(arrive.issues.filter((i) => i.code === 'late_arrival')).toEqual([]);
    // 3 nights: two free days at the same lodging, then the drive home.
    const stay = lastStop(days[arrival]!);
    expect(stay.links?.map((l) => l.label)).toBeDefined();
    for (const day of [days[arrival + 1]!, days[arrival + 2]!]) {
      expect(day.stay).toEqual({ eventId: 'slc', name: slc.name });
      expect(day.stops).toHaveLength(1);
      expect(placeKey(lastStop(day).place)).toBe(placeKey(stay.place));
      expect(day.driveSeconds).toBe(0);
    }
    expect(days[arrival + 3]!.stay).toBeUndefined();
    expect(days[arrival + 3]!.driveSeconds).toBeGreaterThan(0);
    expect(plan.summary.days).toBe(days.length);
  });

  it('refuses dates the trip cannot meet', async () => {
    const provider = demoProvider();
    const request = await makeRequest(provider, 'Boise', 'Seattle', {
      mainEvents: [
        event('a', await cityPlace(provider, 'Salt Lake City'), { stayAmount: 4 }),
        event('b', await cityPlace(provider, 'Spokane'), { arrivalDate: '2026-06-14' }),
      ],
    });
    await expect(planTrip(request, provider)).rejects.toThrow(/can't reach Spokane by 2026-06-14/);
  });
});

describe('editing trips with main events', () => {
  let app: FastifyInstance;
  let trip: Trip;

  beforeAll(async () => {
    const provider = demoProvider();
    app = await buildApp({ config: loadConfig({ DATA_SOURCE: 'demo', LOG_LEVEL: 'silent' }), repo: new MemoryTripRepository(), provider });
    const request = await makeRequest(provider, 'Boise', 'Boise', {
      roundTrip: true,
      lodgingType: 'hotel',
      mainEvents: [
        event('falls', await cityPlace(provider, 'Twin Falls'), { stayUnit: 'hours', stayAmount: 2 }),
        event('slc', await cityPlace(provider, 'Salt Lake City'), { stayAmount: 3 }),
      ],
    });
    const res = await app.inject({ method: 'POST', url: '/api/trips', payload: request });
    expect(res.statusCode).toBe(201);
    trip = res.json<Trip>();
  });

  afterAll(async () => {
    await app.close();
  });

  const arrivalIndex = () => trip.days.findIndex((d) => d.stops.some((s) => s.eventId === 'slc'));

  it('names the trip after its route', () => {
    expect(trip.name).toBe('Boise → Twin Falls → Salt Lake City → Boise');
  });

  it('keeps main events out of day edits and free days out of regeneration', async () => {
    const day = trip.days[arrivalIndex()]!;
    const withoutEvent = day.stops.filter((s) => s.kind !== 'event');
    const res = await app.inject({ method: 'PUT', url: `/api/trips/${trip.id}/days/${day.index}`, payload: { stops: withoutEvent } });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(/Trip settings/);

    const free = trip.days[arrivalIndex() + 1]!;
    const regen = await app.inject({ method: 'POST', url: `/api/trips/${trip.id}/days/${free.index}/regenerate`, payload: { freshIdeas: true } });
    expect(regen.statusCode).toBe(400);
    const swap = await app.inject(`/api/trips/${trip.id}/days/${day.index}/stops/${day.stops.find((s) => s.kind === 'event')!.id}/alternatives`);
    expect(swap.statusCode).toBe(400);
  });

  it('lets travellers add stops to a free day', async () => {
    const free = trip.days[arrivalIndex() + 1]!;
    const ideas = (await app.inject(`/api/trips/${trip.id}/days/${free.index}/search?q=museum`)).json<{ place: PlaceInfo }[]>();
    expect(ideas.length).toBeGreaterThan(0);
    const stops = [{ kind: 'custom', place: ideas[0]!.place, durationMinutes: 90, source: 'user' }, ...free.stops];
    const res = await app.inject({ method: 'PUT', url: `/api/trips/${trip.id}/days/${free.index}`, payload: { stops } });
    expect(res.statusCode).toBe(200);
    const updated = res.json<Trip>().days[free.index]!;
    expect(updated.stay?.eventId).toBe('slc');
    expect(updated.stops).toHaveLength(2);
    expect(updated.driveSeconds).toBeGreaterThan(0);
    trip = res.json<Trip>();
  });

  it('moves every night of a stay when its lodging is swapped', async () => {
    const index = arrivalIndex();
    const day = trip.days[index]!;
    const lodging = lastStop(day);
    const [alternative] = (await app.inject(`/api/trips/${trip.id}/days/${index}/stops/${lodging.id}/alternatives`)).json<{ results: { place: PlaceInfo }[] }>().results;
    const stops = [...day.stops.slice(0, -1), { ...lodging, id: undefined, place: alternative!.place, links: undefined }];
    const res = await app.inject({ method: 'PUT', url: `/api/trips/${trip.id}/days/${index}`, payload: { stops } });
    expect(res.statusCode).toBe(200);
    const updated = res.json<Trip>();
    const key = placeKey(alternative!.place);
    expect(placeKey(lastStop(updated.days[index]!).place)).toBe(key);
    expect(lastStop(updated.days[index]!).lodgingType).toBe('hotel');
    for (const j of [index + 1, index + 2]) {
      expect(placeKey(updated.days[j]!.start)).toBe(key);
      expect(placeKey(lastStop(updated.days[j]!).place)).toBe(key);
      expect(updated.days[j]!.stay?.eventId).toBe('slc');
    }
    expect(placeKey(updated.days[index + 3]!.start)).toBe(key);
    // The stay's booking links cover all three nights.
    const checkIn = updated.days[index]!.date;
    const links = lastStop(updated.days[index]!).links ?? [];
    expect(links.every((l) => !l.url.includes('checkout=') || l.url.includes(`checkout=${addDaysToIsoDate(checkIn, 3)}`))).toBe(true);
  });

  it('exports main events to the calendar and checks into a stay once', async () => {
    const ics = (await app.inject(`/api/trips/${trip.id}/calendar.ics`)).body.replace(/\r\n /g, '');
    expect(ics).toContain('Main event: Twin Falls');
    expect(ics).toContain('Main event: Salt Lake City');
    expect(ics.match(/Check in:/g)?.length).toBe(trip.days.length - 1 - 2);
  });

  it('lists round trips with their main events', async () => {
    const [item] = (await app.inject('/api/trips')).json<{ roundTrip: boolean; mainEventCount: number }[]>();
    expect(item).toMatchObject({ roundTrip: true, mainEventCount: 2 });
  });
});
