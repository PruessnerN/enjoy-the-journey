import { describe, expect, it } from 'vitest';
import type { Stop, TripDay } from '@journey/shared';
import { applyDayEdit } from './dayEdits';
import { resolveTheme } from './theme';
import { dayColor } from '../map/colors';
import { dayStartIconKind, stopIcon, stopIconKind } from '../trip/stopIcons';
import { clocksDiffer, formatClock, formatDate, formatTime } from './time';

const stop = (id: string, kind: Stop['kind'] = 'activity'): Stop => ({
  id,
  kind,
  place: { name: id, location: { lat: 0, lng: 0 } },
  durationMinutes: 60,
  locked: false,
  source: 'planner',
  arrival: '2026-06-12T15:00:00Z',
  start: '2026-06-12T15:00:00Z',
  departure: '2026-06-12T16:00:00Z',
  timeZone: 'America/Boise',
  waitMinutes: 0,
  issues: [],
});

const day = { stops: [stop('a'), stop('b'), stop('hotel', 'lodging')] } as TripDay;

describe('applyDayEdit', () => {
  it('removes stops but never the night’s lodging', () => {
    expect(applyDayEdit(day, { type: 'remove', stopId: 'a' }).map((s) => s.id)).toEqual(['b', 'hotel']);
    expect(applyDayEdit(day, { type: 'remove', stopId: 'hotel' }).map((s) => s.id)).toEqual(['a', 'b', 'hotel']);
  });

  it('moves stops within the day and locks the moved stop', () => {
    const moved = applyDayEdit(day, { type: 'move', stopId: 'a', direction: 1 });
    expect(moved.map((s) => s.id)).toEqual(['b', 'a', 'hotel']);
    expect(moved[1]!.locked).toBe(true);
    expect(applyDayEdit(day, { type: 'move', stopId: 'b', direction: 1 }).map((s) => s.id)).toEqual(['a', 'b', 'hotel']);
  });

  it('inserts user stops before the lodging', () => {
    const inserted = applyDayEdit(day, {
      type: 'insert',
      index: 99,
      stop: { kind: 'custom', place: { name: 'Pie stand', location: { lat: 1, lng: 1 } }, durationMinutes: 20 },
    });
    expect(inserted.map((s) => s.place.name)).toEqual(['a', 'b', 'Pie stand', 'hotel']);
    expect(inserted[2]).toMatchObject({ locked: true, source: 'user' });
  });

  it('strips computed fields', () => {
    const [first] = applyDayEdit(day, { type: 'toggleLock', stopId: 'a' });
    expect(first).not.toHaveProperty('arrival');
    expect(first).not.toHaveProperty('issues');
    expect(first!.locked).toBe(true);
  });
});

describe('time formatting', () => {
  it('formats in the stop’s time zone', () => {
    expect(formatTime('2026-06-12T15:00:00Z', 'America/Boise')).toBe('9:00 AM');
    expect(formatTime('2026-06-12T15:00:00Z', 'America/Los_Angeles')).toBe('8:00 AM');
    expect(formatDate('2026-06-12')).toBe('Fri, Jun 12');
    expect(formatClock('19:30')).toBe('7:30 PM');
    expect(clocksDiffer('2026-06-12T15:00:00Z', 'America/Boise', 'America/Denver')).toBe(false);
    expect(clocksDiffer('2026-06-12T15:00:00Z', 'America/Boise', 'America/Los_Angeles')).toBe(true);
  });
});

describe('theme', () => {
  it('prefers the saved choice, otherwise follows the OS', () => {
    expect(resolveTheme('dark', false)).toBe('dark');
    expect(resolveTheme('light', true)).toBe('light');
    expect(resolveTheme(null, true)).toBe('dark');
    expect(resolveTheme('garbage', false)).toBe('light');
  });

  it('uses a lighter day palette in dark mode', () => {
    expect(dayColor(0, 'light')).not.toBe(dayColor(0, 'dark'));
    expect(dayColor(8, 'dark')).toBe(dayColor(0, 'dark'));
  });
});

describe('stop icons', () => {
  it('uses only driving, lodging and activity icons', () => {
    const kinds = (['activity', 'meal', 'custom', 'lodging', 'destination'] as const).map((kind) => stopIconKind({ kind }));
    expect(kinds).toEqual(['activity', 'activity', 'activity', 'lodging', 'driving']);
    expect(new Set((['activity', 'meal', 'custom', 'lodging', 'destination'] as const).map((kind) => stopIcon({ kind }))).size).toBe(3);
    expect([dayStartIconKind(0), dayStartIconKind(2)]).toEqual(['driving', 'lodging']);
  });
});
