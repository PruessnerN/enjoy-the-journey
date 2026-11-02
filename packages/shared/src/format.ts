export function parseTimeOfDay(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function formatTimeOfDay(minutes: number): string {
  const normalized = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** "2h 30m", "45m", "3h" */
export function formatDuration(seconds: number): string {
  const totalMinutes = Math.max(0, Math.round(seconds / 60));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export function formatMinutes(minutes: number): string {
  return formatDuration(minutes * 60);
}

const METERS_PER_MILE = 1609.344;

export function formatDistance(meters: number, units: 'imperial' | 'metric' = 'imperial'): string {
  if (units === 'metric') {
    const km = meters / 1000;
    return km < 10 ? `${km.toFixed(1)} km` : `${Math.round(km)} km`;
  }
  const miles = meters / METERS_PER_MILE;
  return miles < 10 ? `${miles.toFixed(1)} mi` : `${Math.round(miles)} mi`;
}

/** Adds whole days to a YYYY-MM-DD date string without timezone drift. */
export function addDaysToIsoDate(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split('-').map(Number);
  const date = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, (d ?? 1) + days));
  return date.toISOString().slice(0, 10);
}
