const timeFormatters = new Map<string, Intl.DateTimeFormat>();

function formatter(key: string, factory: () => Intl.DateTimeFormat): Intl.DateTimeFormat {
  let f = timeFormatters.get(key);
  if (!f) {
    f = factory();
    timeFormatters.set(key, f);
  }
  return f;
}

/** "8:30 AM" in the stop's local time zone. */
export function formatTime(iso: string, timeZone: string): string {
  return formatter(`t|${timeZone}`, () =>
    new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', timeZone }),
  ).format(new Date(iso));
}

/** "MDT" */
export function zoneAbbreviation(iso: string, timeZone: string): string {
  const parts = formatter(`z|${timeZone}`, () =>
    new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' }),
  ).formatToParts(new Date(iso));
  return parts.find((p) => p.type === 'timeZoneName')?.value ?? '';
}

/** "Fri, Jun 12" for a YYYY-MM-DD calendar date. */
export function formatDate(isoDate: string, options: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' }): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', { ...options, timeZone: 'UTC' }).format(new Date(Date.UTC(y!, m! - 1, d!)));
}

/** "08:30" → "8:30 AM" */
export function formatClock(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h! >= 12 ? 'PM' : 'AM';
  const hour = h! % 12 === 0 ? 12 : h! % 12;
  return `${hour}:${String(m).padStart(2, '0')} ${suffix}`;
}

export function todayIso(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

export function formatCount(n: number): string {
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : String(n);
}

/** True when two zones show different wall-clock times at that instant (e.g. America/Boise vs America/Denver → false). */
export function clocksDiffer(iso: string, zoneA: string, zoneB: string): boolean {
  return zoneA !== zoneB && formatTime(iso, zoneA) !== formatTime(iso, zoneB);
}
