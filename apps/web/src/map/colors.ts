import type { Theme } from '../lib/theme';

/** One color per day. The dark palette is lighter so routes and badges stay visible on dark backgrounds. */
const DAY_COLORS: Record<Theme, string[]> = {
  light: ['#0f4c5c', '#e36414', '#6a4c93', '#2a9d8f', '#9a031e', '#1d3557', '#fb8b24', '#5f0f40'],
  dark: ['#5cc2d3', '#f4a259', '#b69ae0', '#6fd3c2', '#f2798a', '#8fb3ff', '#ffc46b', '#e58cc1'],
};

export function dayColor(index: number, theme: Theme): string {
  const palette = DAY_COLORS[theme];
  return palette[index % palette.length]!;
}
