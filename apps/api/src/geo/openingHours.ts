import type { OpeningPeriod } from '@journey/shared';
import { epochToLocal } from './time.js';

const WEEK_MINUTES = 7 * 1440;

export type OpenStatus =
  | { status: 'unknown' }
  | { status: 'open' }
  | { status: 'opens_later'; waitMinutes: number }
  | { status: 'closed'; reason: 'closed_at_arrival' | 'closes_during_visit' };

interface Interval {
  open: number;
  close: number;
}

function toIntervals(periods: OpeningPeriod[]): Interval[] | 'always' {
  const intervals: Interval[] = [];
  for (const p of periods) {
    if (!p.close) return 'always';
    const open = p.open.day * 1440 + p.open.hour * 60 + p.open.minute;
    let close = p.close.day * 1440 + p.close.hour * 60 + p.close.minute;
    if (close <= open) close += WEEK_MINUTES;
    // Include copies shifted a week back/forward so visits crossing the week boundary match.
    intervals.push({ open, close }, { open: open - WEEK_MINUTES, close: close - WEEK_MINUTES }, { open: open + WEEK_MINUTES, close: close + WEEK_MINUTES });
  }
  return intervals;
}

/**
 * Checks whether a place is open for a whole visit. If it opens shortly after we arrive
 * (within `maxWaitMinutes`) the caller can choose to wait.
 */
export function checkOpen(
  periods: OpeningPeriod[] | undefined,
  startMs: number,
  durationMinutes: number,
  timeZone: string,
  options: { maxWaitMinutes: number; toleranceMinutes: number },
): OpenStatus {
  if (!periods || periods.length === 0) return { status: 'unknown' };
  const intervals = toIntervals(periods);
  if (intervals === 'always') return { status: 'open' };

  const local = epochToLocal(startMs, timeZone);
  const a = local.weekday * 1440 + local.minutes;
  const b = a + durationMinutes;

  const openNow = intervals.find((i) => i.open <= a && a < i.close);
  if (openNow) {
    return b <= openNow.close + options.toleranceMinutes
      ? { status: 'open' }
      : { status: 'closed', reason: 'closes_during_visit' };
  }

  const upcoming = intervals
    .filter((i) => i.open > a && i.open - a <= options.maxWaitMinutes && i.open + durationMinutes <= i.close + options.toleranceMinutes)
    .sort((x, y) => x.open - y.open)[0];
  if (upcoming) return { status: 'opens_later', waitMinutes: upcoming.open - a };

  return { status: 'closed', reason: 'closed_at_arrival' };
}
