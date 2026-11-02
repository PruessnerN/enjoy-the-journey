import { describe, expect, it } from 'vitest';
import type { PlaceInfo } from '@journey/shared';
import { localTimeToEpoch } from '../src/geo/time.js';
import { breakMinutesFor, scheduleDay, type DayContext } from '../src/planner/schedule.js';
import type { SeqItem } from '../src/planner/sequence.js';

const tz = 'America/Boise';
const at = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return localTimeToEpoch('2026-06-12', h! * 60 + m!, tz);
};
const place = (name: string, extra: Partial<PlaceInfo> = {}): PlaceInfo => ({
  name,
  location: { lat: 43.6, lng: -116.2 },
  timeZone: tz,
  ...extra,
});
const item = (kind: SeqItem['kind'], name: string, durationMinutes: number, extra: Partial<SeqItem> = {}): SeqItem => ({
  kind,
  place: place(name),
  durationMinutes,
  seconds: 0,
  detourSeconds: 0,
  source: 'planner',
  ...extra,
});
const ctx: DayContext = {
  date: '2026-06-12',
  departure: at('08:00'),
  startTime: '08:00',
  timeZone: tz,
  arriveByTime: '19:30',
  avoidNightDriving: true,
  maxDrivingHours: 6,
  isFinalDay: false,
};
const leg = (minutes: number) => ({ durationSeconds: minutes * 60, distanceMeters: minutes * 1500 });
const codes = (issues: { code: string }[]) => issues.map((i) => i.code);

describe('scheduleDay', () => {
  it('chains drive and visit times', () => {
    const s = scheduleDay([item('activity', 'A', 60), item('lodging', 'Hotel', 0)], [leg(30), leg(45)], ctx);
    expect(s.items[0]).toMatchObject({ arrival: at('08:30'), start: at('08:30'), departure: at('09:30') });
    expect(s.items[1]!.arrival).toBe(at('10:15'));
    expect(s.blocking.size).toBe(0);
  });

  it('adds rest breaks on long legs', () => {
    expect(breakMinutesFor(2 * 3600)).toBe(0);
    expect(breakMinutesFor(3 * 3600)).toBe(15);
    expect(breakMinutesFor(5.5 * 3600)).toBe(30);
  });

  it('waits a little for mealtime but flags a lunch that is far too early', () => {
    const ok = scheduleDay([item('meal', 'Diner', 60, { mealType: 'lunch' }), item('lodging', 'Hotel', 0)], [leg(140), leg(10)], ctx);
    expect(ok.items[0]!.start).toBe(at('11:00'));
    expect(ok.items[0]!.waitMinutes).toBe(40);
    expect(codes(ok.items[0]!.issues)).toEqual(['free_time']);
    expect(ok.blocking.size).toBe(0);

    const early = scheduleDay([item('meal', 'Diner', 60, { mealType: 'lunch' }), item('lodging', 'Hotel', 0)], [leg(30), leg(10)], ctx);
    expect(codes(early.items[0]!.issues)).toContain('meal_outside_window');
    expect(early.blocking.has('meal:lunch:meal_outside_window')).toBe(true);
  });

  it('lets dinner right before the lodging wait as free time', () => {
    const s = scheduleDay([item('meal', 'Grill', 75, { mealType: 'dinner' }), item('lodging', 'Hotel', 0)], [leg(6 * 60), leg(5)], ctx);
    expect(s.items[0]!.start).toBe(at('17:00'));
    expect(codes(s.items[0]!.issues)).toEqual(['free_time']);
    expect(s.blocking.size).toBe(0);
  });

  it('flags closed places, outdoor stops after dark and late arrivals', () => {
    const museum = item('activity', 'Museum', 90, {
      place: place('Museum', {
        openingHours: [{ open: { day: 5, hour: 10, minute: 0 }, close: { day: 5, hour: 12, minute: 0 } }],
      }),
    });
    const hike = item('activity', 'Hike', 180, { outdoor: true });
    const s = scheduleDay([museum, hike, item('lodging', 'Hotel', 0)], [leg(180), leg(10 * 60), leg(30)], ctx);
    expect(codes(s.items[0]!.issues)).toContain('closed');
    expect(codes(s.items[1]!.issues)).toContain('after_dark');
    expect(codes(s.items[2]!.issues)).toEqual(expect.arrayContaining(['late_arrival', 'night_driving']));
    expect(s.endBlocked).toBe(true);
  });

  it('honours pinned start times and warns when they cannot be met', () => {
    const pinned = scheduleDay([item('activity', 'Tour', 60, { pinnedStart: '10:00' }), item('lodging', 'Hotel', 0)], [leg(30), leg(10)], ctx);
    expect(pinned.items[0]!.start).toBe(at('10:00'));
    const late = scheduleDay([item('activity', 'Tour', 60, { pinnedStart: '08:15' }), item('lodging', 'Hotel', 0)], [leg(60), leg(10)], ctx);
    expect(codes(late.items[0]!.issues)).toContain('pinned_late');
  });
});
