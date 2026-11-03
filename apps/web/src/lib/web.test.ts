import { describe, expect, it } from 'vitest';
import type { Stop, TripDay } from '@journey/shared';
import { applyDayEdit } from './dayEdits';
import { resolveTheme } from './theme';
import { dayColor } from '../map/colors';
import { dayStartIconKind, stopIcon, stopIconKind } from '../trip/stopIcons';
import { swappedStop } from '../trip/swapStop';
import { viewMoved } from '../map/mapModel';
import { ACTIVITY_CATALOG, activityRequestFromDefinition, searchCategoriesFor, type ActivityRequest } from '@journey/shared';
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

describe('activity defaults', () => {
  it('defaults every catalog selection to once per trip', () => {
    expect(ACTIVITY_CATALOG.length).toBeGreaterThan(0);
    for (const definition of ACTIVITY_CATALOG) {
      expect(activityRequestFromDefinition(definition).frequency).toBe('once');
    }
  });
});

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
  it('uses only driving, lodging, activity and meal icons', () => {
    const kinds = (['activity', 'meal', 'custom', 'lodging', 'destination'] as const).map((kind) => stopIconKind({ kind }));
    expect(kinds).toEqual(['activity', 'meal', 'activity', 'lodging', 'driving']);
    expect(stopIcon({ kind: 'meal' })).toBe('🍽️');
    expect(new Set((['activity', 'meal', 'custom', 'lodging', 'destination'] as const).map((kind) => stopIcon({ kind }))).size).toBe(4);
    expect([dayStartIconKind(0), dayStartIconKind(2)]).toEqual(['driving', 'lodging']);
  });
});

describe('swapping a stop', () => {
  const place = { name: 'New place', location: { lat: 1, lng: 1 } };
  const activityStop = { ...stop('golf'), activityId: 'disc_golf', activityLabel: 'Disc golf', durationMinutes: 180, links: [{ label: 'x', url: 'y' }] };
  const category = (group: 'activity' | 'meal' | 'lodging', id: string) => searchCategoriesFor(group, [] as ActivityRequest[]).find((c) => c.id === id)!;

  it('keeps the same activity and duration when only the place changes', () => {
    const next = swappedStop(activityStop, place, category('activity', 'disc_golf'));
    expect(next).toMatchObject({ kind: 'activity', activityId: 'disc_golf', durationMinutes: 180, locked: true, place });
    expect(next.links).toBeUndefined();
  });

  it("takes on a new activity's label and usual duration", () => {
    expect(swappedStop(activityStop, place, category('activity', 'kayaking'))).toMatchObject({
      activityId: 'kayaking',
      activityLabel: 'Kayaking',
      durationMinutes: 150,
      outdoor: true,
    });
  });

  it('keeps meals as the same meal and turns lodging into the new kind', () => {
    const lunch = { ...stop('diner', 'meal'), mealType: 'lunch' as const, durationMinutes: 60 };
    expect(swappedStop(lunch, place, category('meal', 'meal:pizza'))).toMatchObject({ kind: 'meal', mealType: 'lunch', durationMinutes: 60 });
    const night = { ...stop('camp', 'lodging'), lodgingType: 'campground' as const };
    expect(swappedStop(night, place, category('lodging', 'lodging:hotel'))).toMatchObject({
      kind: 'lodging',
      lodgingType: 'hotel',
      activityLabel: 'Hotels & resorts',
    });
  });
});

describe('viewMoved', () => {
  const base = { south: 40, west: -112, north: 41, east: -110 };
  it('ignores tiny nudges but notices pans and zooms', () => {
    expect(viewMoved({ south: 40.02, west: -111.98, north: 41.02, east: -109.98 }, base)).toBe(false);
    expect(viewMoved({ south: 40.5, west: -112, north: 41.5, east: -110 }, base)).toBe(true);
    expect(viewMoved({ south: 39.5, west: -113, north: 41.5, east: -109 }, base)).toBe(true);
  });
});
