import { THEME_COOKIE, type ResolvedTheme } from './theme';

/** A year: the account is authoritative, the cookie only saves a round trip. */
const MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

export function writeThemeCookie(theme: ResolvedTheme): void {
   document.cookie = `${THEME_COOKIE}=${theme}; path=/; max-age=${MAX_AGE_SECONDS}; samesite=lax`;
}

export function readThemeCookie(): string | undefined {
   for (const part of document.cookie.split(';')) {
      const [name, ...rest] = part.trim().split('=');
      if (name === THEME_COOKIE) return rest.join('=');
   }
   return undefined;
}

/** The OS preference, or `false` where the browser will not say. */
export function prefersDark(): boolean {
   return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
}

/**
 * Paint the resolved theme onto the document without waiting for a server
 * round trip, so a switch in Preferences is visible on the click rather than
 * on the refresh that follows it.
 */
export function applyThemeClass(theme: ResolvedTheme): void {
   document.documentElement.classList.toggle('dark', theme === 'dark');
}
