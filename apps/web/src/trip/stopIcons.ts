import type { Stop } from '@journey/shared';

/** The only three stop icons used across the timeline, map and overview. */
export type StopIconKind = 'driving' | 'lodging' | 'activity';

export const STOP_ICONS: Record<StopIconKind, { emoji: string; label: string }> = {
  driving: { emoji: '🚗', label: 'Driving' },
  lodging: { emoji: '🛏️', label: 'Lodging' },
  activity: { emoji: '⛰️', label: 'Activity' },
};

/** Lodging is lodging; the destination ends the drive; everything else (activities, meals, your own stops) is an activity. */
export function stopIconKind(stop: Pick<Stop, 'kind'>): StopIconKind {
  if (stop.kind === 'lodging') return 'lodging';
  if (stop.kind === 'destination') return 'driving';
  return 'activity';
}

export function stopIcon(stop: Pick<Stop, 'kind'>): string {
  return STOP_ICONS[stopIconKind(stop)].emoji;
}

/** A day starts by driving away from home, or by checking out of last night's lodging. */
export function dayStartIconKind(dayIndex: number): StopIconKind {
  return dayIndex === 0 ? 'driving' : 'lodging';
}
