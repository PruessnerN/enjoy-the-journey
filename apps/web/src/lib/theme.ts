export type Theme = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'ejt.theme';

const THEME_COLORS: Record<Theme, string> = { light: '#0f4c5c', dark: '#121a1e' };

/** An explicit user choice wins; otherwise follow the operating system. */
export function resolveTheme(stored: string | null, systemPrefersDark: boolean): Theme {
  if (stored === 'light' || stored === 'dark') return stored;
  return systemPrefersDark ? 'dark' : 'light';
}

export function readStoredTheme(): Theme | null {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : null;
  } catch {
    return null;
  }
}

export function storeTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Storage can be unavailable (private browsing); the choice just won't persist.
  }
}

export function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches === true;
}

/** Mirrors the inline script in index.html, which applies the theme before first paint. */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[theme]);
}
