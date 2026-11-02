import tzLookup from '@photostructure/tz-lookup';
import { DateTime } from 'luxon';
import { getTimes } from 'suncalc';
import type { LatLng } from '@journey/shared';

const MINUTE_MS = 60_000;

const tzCache = new Map<string, string>();

/** IANA time zone at a coordinate (offline lookup, cached at ~1 km resolution). */
export function timeZoneAt(p: LatLng): string {
  const key = `${p.lat.toFixed(2)},${p.lng.toFixed(2)}`;
  let tz = tzCache.get(key);
  if (!tz) {
    try {
      tz = tzLookup(p.lat, p.lng);
    } catch {
      tz = 'UTC';
    }
    if (tzCache.size > 50_000) tzCache.clear();
    tzCache.set(key, tz);
  }
  return tz;
}

const localCache = new Map<string, number>();

/** Epoch milliseconds for a local wall-clock time (minutes after midnight) on a date in a zone. */
export function localTimeToEpoch(isoDate: string, minutesAfterMidnight: number, timeZone: string): number {
  const key = `${isoDate}|${minutesAfterMidnight}|${timeZone}`;
  const cached = localCache.get(key);
  if (cached !== undefined) return cached;
  const [year, month, day] = isoDate.split('-').map(Number);
  const midnight = DateTime.fromObject({ year, month, day }, { zone: timeZone });
  const epoch = midnight.plus({ minutes: minutesAfterMidnight }).toMillis();
  if (localCache.size > 100_000) localCache.clear();
  localCache.set(key, epoch);
  return epoch;
}

export interface LocalParts {
  isoDate: string;
  minutes: number;
  /** 0 = Sunday … 6 = Saturday (Google Places convention). */
  weekday: number;
}

export function epochToLocal(epochMs: number, timeZone: string): LocalParts {
  const dt = DateTime.fromMillis(epochMs, { zone: timeZone });
  return {
    isoDate: dt.toISODate() ?? '1970-01-01',
    minutes: dt.hour * 60 + dt.minute + dt.second / 60,
    weekday: dt.weekday % 7,
  };
}

export function toIso(epochMs: number): string {
  return new Date(epochMs).toISOString();
}

export function minutesBetween(fromMs: number, toMs: number): number {
  return (toMs - fromMs) / MINUTE_MS;
}

export interface SunTimes {
  sunrise: number;
  sunset: number;
}

const sunCache = new Map<string, SunTimes | null>();

/** Sunrise/sunset (epoch ms) for the local calendar date at a location; null in polar day/night. */
export function sunTimes(isoDate: string, p: LatLng, timeZone: string): SunTimes | null {
  const key = `${isoDate}|${p.lat.toFixed(1)},${p.lng.toFixed(1)}`;
  if (sunCache.has(key)) return sunCache.get(key)!;
  const localNoon = localTimeToEpoch(isoDate, 12 * 60, timeZone);
  const times = getTimes(new Date(localNoon), p.lat, p.lng);
  const sunrise = times.sunrise?.getTime() ?? Number.NaN;
  const sunset = times.sunset?.getTime() ?? Number.NaN;
  const result = Number.isFinite(sunrise) && Number.isFinite(sunset) ? { sunrise, sunset } : null;
  if (sunCache.size > 20_000) sunCache.clear();
  sunCache.set(key, result);
  return result;
}

/** "1:30 PM" in the given zone. */
export function formatLocalTime(epochMs: number, timeZone: string): string {
  return DateTime.fromMillis(epochMs, { zone: timeZone }).toFormat('h:mm a');
}
