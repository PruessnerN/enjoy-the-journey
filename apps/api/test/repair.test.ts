import { describe, expect, it } from 'vitest';
import type { PlaceInfo, TripDay } from '@journey/shared';
import { meetsRating, type Candidate } from '../src/planner/candidates.js';
import { calibrateDetours, measuredDetours, worstStop } from '../src/planner/dayBuilder.js';
import { spreadBonus } from '../src/planner/dayPlanner.js';
import type { SeqItem } from '../src/planner/sequence.js';
import { TUNING } from '../src/planner/tuning.js';

const place = (name: string, extra: Partial<PlaceInfo> = {}): PlaceInfo => ({ name, location: { lat: 0, lng: 0 }, ...extra });
const item = (name: string, seconds: number, detourSeconds: number, extra: Partial<SeqItem> = {}): SeqItem => ({
  kind: 'activity',
  place: place(name),
  durationMinutes: 60,
  seconds,
  detourSeconds,
  source: 'planner',
  ...extra,
});

describe('spreadBonus', () => {
  const { spreadBonusPerHour, spreadMaxHours } = TUNING.scoring;

  it('gives nothing to stops right after departure or next to another stop', () => {
    expect(spreadBonus(60, [3 * 3600])).toBeCloseTo((60 / 3600) * spreadBonusPerHour);
    expect(spreadBonus(2 * 3600, [2 * 3600 + 120])).toBeCloseTo((120 / 3600) * spreadBonusPerHour);
  });

  it('rewards breaking up long stretches, up to a cap', () => {
    expect(spreadBonus(3600, [2 * 3600])).toBeCloseTo(1 * spreadBonusPerHour);
    expect(spreadBonus(5 * 3600, [10 * 3600])).toBeCloseTo(spreadMaxHours * spreadBonusPerHour);
  });
});

describe('meetsRating', () => {
  it('never accepts a rating below the minimum, however few reviews', () => {
    expect(meetsRating(place('Meh', { rating: 3, userRatingCount: 2 }), 4, true)).toBe(false);
    expect(meetsRating(place('Good', { rating: 4.6, userRatingCount: 300 }), 4, false)).toBe(true);
  });

  it('treats a high rating from very few reviews as unrated', () => {
    expect(meetsRating(place('New', { rating: 5, userRatingCount: 1 }), 4, true)).toBe(true);
    expect(meetsRating(place('New', { rating: 5, userRatingCount: 1 }), 4, false)).toBe(false);
    expect(meetsRating(place('Unknown'), 4, false)).toBe(false);
  });
});

describe('repair helpers', () => {
  const end = item('Hotel', 4 * 3600, 0, { kind: 'lodging' });

  it('measures real detours from routed legs', () => {
    const items = [item('Overlook', 3600, 600), end];
    // Real: 70 min to the overlook, then 3h20 to the hotel = 4h30, vs. 4h driving straight through.
    const detours = measuredDetours(items, [{ durationSeconds: 70 * 60 }, { durationSeconds: 200 * 60 }]);
    expect(detours[0]).toBe(30 * 60);
  });

  it('calibrates underestimated candidates and leaves good estimates alone', () => {
    const overlook = item('Overlook', 3600, 600);
    const candidate: Candidate = { key: 'overlook@0.0000,0.0000', place: overlook.place, seconds: 3600, offRouteMeters: 2000, detourSeconds: 600, quality: 4.5, score: 3 };
    const routed = [{ durationSeconds: 70 * 60 }, { durationSeconds: 200 * 60 }];
    expect(calibrateDetours([overlook, end], routed, [[candidate]])).toBe(true);
    expect(candidate.detourSeconds).toBe(30 * 60);
    expect(candidate.score).toBeLessThan(3);

    const accurate = [{ durationSeconds: 65 * 60 }, { durationSeconds: 185 * 60 }];
    expect(calibrateDetours([{ ...overlook, detourSeconds: candidate.detourSeconds }, end], accurate, [[candidate]])).toBe(false);
  });

  it('blames only the stop with the largest excess, not its neighbours', () => {
    const lunch = item('Diner', 2 * 3600, 300, { kind: 'meal', mealType: 'lunch' });
    const mountain = item('Mountain overlook', 2.5 * 3600, 600);
    const mk = (it: SeqItem): Candidate => ({ key: `${it.place.name.toLowerCase()}@0.0000,0.0000`, place: it.place, seconds: it.seconds, offRouteMeters: 0, detourSeconds: it.detourSeconds, quality: 4.5, score: 3 });
    const diner = mk(lunch);
    const overlook = mk(mountain);
    // Estimated legs: 2h05m, 37m30s, 1h35m. The mountain road makes the legs around the overlook 40 min longer each.
    const legs = [{ durationSeconds: 7500 }, { durationSeconds: 2250 + 2400 }, { durationSeconds: 5700 + 2400 }];
    expect(calibrateDetours([lunch, mountain, end], legs, [[diner, overlook]])).toBe(true);
    expect(overlook.detourSeconds).toBeGreaterThan(600 + 60 * 60);
    expect(diner.detourSeconds).toBe(300);
  });

  it('drops a problem stop first, otherwise the last nice-to-have activity', () => {
    const mustDo = item('Disc golf', 3600, 0, { activity: { priority: 'high' } as SeqItem['activity'] });
    const nice = item('Coffee', 7200, 0, { activity: { priority: 'normal' } as SeqItem['activity'] });
    const locked = item('Tour', 9000, 0, { locked: true });
    const stops = (codes: string[][]) => ({ stops: codes.map((c) => ({ issues: c.map((code) => ({ code })) })) }) as unknown as TripDay;

    expect(worstStop([mustDo, nice, locked, end], stops([['closed'], [], [], []]))).toBe(worstStop([mustDo], stops([[]])));
    expect(worstStop([mustDo, nice, locked, end], stops([[], [], [], ['late_arrival']]))).toContain('coffee');
    expect(worstStop([locked, end], stops([[], ['late_arrival']]))).toBeNull();
  });
});
