import { describe, expect, it } from 'vitest';
import { decodePolyline, encodePolyline } from '@journey/shared';
import { destinationPoint, haversineMeters, simplifyToMaxPoints } from '../src/geo/geo.js';
import { checkOpen } from '../src/geo/openingHours.js';
import { RouteProfile } from '../src/geo/routeProfile.js';
import { epochToLocal, localTimeToEpoch, sunTimes, timeZoneAt } from '../src/geo/time.js';

describe('polyline codec', () => {
  it('decodes the reference example and round-trips', () => {
    const encoded = '_p~iF~ps|U_ulLnnqC_mqNvxq`@';
    const points = decodePolyline(encoded);
    expect(points).toEqual([
      { lat: 38.5, lng: -120.2 },
      { lat: 40.7, lng: -120.95 },
      { lat: 43.252, lng: -126.453 },
    ]);
    expect(encodePolyline(points)).toBe(encoded);
  });
});

describe('RouteProfile', () => {
  const start = { lat: 43.6, lng: -116.2 };
  const end = destinationPoint(start, 90, 100_000);
  const path = Array.from({ length: 101 }, (_, i) => ({
    lat: start.lat + ((end.lat - start.lat) * i) / 100,
    lng: start.lng + ((end.lng - start.lng) * i) / 100,
  }));
  const profile = RouteProfile.fromPath(path, 3600);

  it('maps drive time to positions', () => {
    expect(profile.totalSeconds).toBeCloseTo(3600, 5);
    const halfway = profile.pointAtSeconds(1800);
    expect(haversineMeters(start, halfway)).toBeGreaterThan(45_000);
    expect(haversineMeters(start, halfway)).toBeLessThan(55_000);
  });

  it('projects off-route places onto the route', () => {
    const offRoute = destinationPoint(profile.pointAtSeconds(900), 0, 2_000);
    const projection = profile.project(offRoute);
    expect(projection.seconds).toBeGreaterThan(850);
    expect(projection.seconds).toBeLessThan(950);
    expect(projection.offRouteMeters).toBeGreaterThan(1_900);
    expect(projection.offRouteMeters).toBeLessThan(2_100);
  });

  it('slices and simplifies', () => {
    const slice = profile.slice(600, 1200);
    expect(haversineMeters(slice[0]!, profile.pointAtSeconds(600))).toBeLessThan(1);
    expect(simplifyToMaxPoints(path, 10).length).toBeLessThanOrEqual(10);
  });

  it('builds from steps with cumulative durations', () => {
    const steps = [
      { durationSeconds: 600, distanceMeters: 10_000, polyline: encodePolyline(path.slice(0, 51)) },
      { durationSeconds: 1200, distanceMeters: 50_000, polyline: encodePolyline(path.slice(50)) },
    ];
    const p = RouteProfile.fromSteps(steps);
    expect(p.totalSeconds).toBeCloseTo(1800, 5);
    expect(p.totalMeters).toBeCloseTo(60_000, 5);
    expect(p.project(path[50]!).seconds).toBeCloseTo(600, 0);
  });
});

describe('time helpers', () => {
  it('resolves time zones and local times', () => {
    expect(timeZoneAt({ lat: 43.615, lng: -116.2023 })).toBe('America/Boise');
    const epoch = localTimeToEpoch('2026-06-12', 8 * 60, 'America/Boise');
    expect(new Date(epoch).toISOString()).toBe('2026-06-12T14:00:00.000Z');
    expect(epochToLocal(epoch, 'America/Los_Angeles')).toMatchObject({ isoDate: '2026-06-12', minutes: 7 * 60, weekday: 5 });
  });

  it('computes plausible sunset times', () => {
    const sun = sunTimes('2026-06-21', { lat: 43.6, lng: -116.2 }, 'America/Boise');
    expect(sun).not.toBeNull();
    const local = epochToLocal(sun!.sunset, 'America/Boise');
    expect(local.minutes).toBeGreaterThan(21 * 60);
    expect(local.minutes).toBeLessThan(22 * 60);
  });
});

describe('opening hours', () => {
  const tz = 'America/Boise';
  // Open 10:00–17:00 every day except Monday.
  const periods = [0, 2, 3, 4, 5, 6].map((day) => ({ open: { day, hour: 10, minute: 0 }, close: { day, hour: 17, minute: 0 } }));
  const opts = { maxWaitMinutes: 60, toleranceMinutes: 10 };
  const friday = (hhmm: number) => localTimeToEpoch('2026-06-12', hhmm, tz);

  it('reports open, opens later and closed', () => {
    expect(checkOpen(periods, friday(11 * 60), 60, tz, opts).status).toBe('open');
    expect(checkOpen(periods, friday(9 * 60 + 30), 60, tz, opts)).toEqual({ status: 'opens_later', waitMinutes: 30 });
    expect(checkOpen(periods, friday(8 * 60), 60, tz, opts).status).toBe('closed');
    expect(checkOpen(periods, friday(16 * 60 + 30), 60, tz, opts)).toEqual({ status: 'closed', reason: 'closes_during_visit' });
  });

  it('handles closed days, overnight hours and 24/7 places', () => {
    const monday = localTimeToEpoch('2026-06-15', 12 * 60, tz);
    expect(checkOpen(periods, monday, 30, tz, opts).status).toBe('closed');
    const lateNight = [{ open: { day: 5, hour: 18, minute: 0 }, close: { day: 6, hour: 2, minute: 0 } }];
    expect(checkOpen(lateNight, friday(23 * 60), 90, tz, opts).status).toBe('open');
    expect(checkOpen([{ open: { day: 0, hour: 0, minute: 0 } }], friday(3 * 60), 60, tz, opts).status).toBe('open');
    expect(checkOpen(undefined, friday(3 * 60), 60, tz, opts).status).toBe('unknown');
  });
});
