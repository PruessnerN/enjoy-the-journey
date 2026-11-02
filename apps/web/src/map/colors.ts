import type { Theme } from '../lib/theme';

/** One color per day. The dark palette is lighter so routes and badges stay visible on dark backgrounds. */
const DAY_COLORS: Record<Theme, string[]> = {
  light: ['#2f5233', '#c4562d', '#2c5c78', '#b0702e', '#6b4f8a', '#6f7f24', '#a63124', '#3e6f6a'],
  dark: ['#9cc28a', '#e07a52', '#9cc7d9', '#d6a467', '#b9a3dc', '#c7d68a', '#f08a7a', '#8fcac2'],
};

export function dayColor(index: number, theme: Theme): string {
  const palette = DAY_COLORS[theme];
  return palette[index % palette.length]!;
}
