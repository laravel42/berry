/**
 * The themes Berry renders, and how a request picks one.
 *
 * Pure on purpose, exactly like `lib/i18n/locales.ts`: `app/layout.tsx` imports
 * it on the server and the preferences page imports it in the browser. The
 * preference list must match `THEMES` in `server-ts/src/http/validation.ts`,
 * which refuses anything else on `PATCH /api/v1/me/settings`.
 *
 * Two vocabularies, deliberately separate:
 *
 *   ThemePreference  what the account stores — system | light | dark
 *   ResolvedTheme    what a document can actually be — light | dark
 *
 * `system` is a preference, never a rendering. The server cannot read
 * `prefers-color-scheme` (it is not a request header unless client hints are
 * negotiated), so the cookie only ever holds a *resolved* theme and the server
 * renders two states rather than three. ThemeSync is what keeps the cookie in
 * step with the operating system while the preference says `system`.
 */

export const THEMES = ['system', 'light', 'dark'] as const;
export type ThemePreference = (typeof THEMES)[number];

export const RESOLVED_THEMES = ['light', 'dark'] as const;
export type ResolvedTheme = (typeof RESOLVED_THEMES)[number];

/**
 * What renders before anything is known: no cookie, no account, first paint.
 * Light because the redesign is drawn light-first and sign-in is the screen
 * that most often gets that first paint.
 */
export const DEFAULT_THEME: ResolvedTheme = 'light';

/** Cookie the root layout reads; mirrors the resolved account setting. */
export const THEME_COOKIE = 'berry_theme';

export const THEME_NAMES: Record<ThemePreference, string> = {
   system: 'Match system',
   light: 'Light',
   dark: 'Dark',
};

export function isThemePreference(value: unknown): value is ThemePreference {
   return typeof value === 'string' && (THEMES as readonly string[]).includes(value);
}

export function isResolvedTheme(value: unknown): value is ResolvedTheme {
   return typeof value === 'string' && (RESOLVED_THEMES as readonly string[]).includes(value);
}

/** Cookie if it names a theme a document can be, otherwise the default. */
export function resolveTheme(cookie: string | null | undefined): ResolvedTheme {
   if (isResolvedTheme(cookie)) return cookie;
   return DEFAULT_THEME;
}

/**
 * The theme a preference asks for, given what the operating system reports.
 * `prefersDark` is only consulted for `system`, so a caller with no way to ask
 * the OS can pass `false` and still get `light`/`dark` right.
 */
export function themeForPreference(
   preference: ThemePreference,
   prefersDark: boolean
): ResolvedTheme {
   if (preference === 'system') return prefersDark ? 'dark' : 'light';
   return preference;
}
