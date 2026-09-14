/**
 * The interface languages Berry ships, and how a request picks one.
 *
 * Pure on purpose: `i18n/request.ts` imports it on the server and the settings
 * page imports it in the browser. The list must match `LOCALES` in
 * `server-ts/src/http/validation.ts`, which refuses anything else.
 *
 * English is the only catalogue. A second language is a new catalogue under
 * `messages/`, an entry here, and the matching server enum — not a row that
 * claims a language the UI cannot render.
 */

export const LOCALES = ['en'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

/** Cookie the request config reads; mirrors the account setting. */
export const LOCALE_COOKIE = 'berry_locale';

export const LOCALE_NAMES: Record<Locale, string> = {
   en: 'English',
};

/** One JSON file per namespace per locale under `messages/<locale>/`. */
export const NAMESPACES = [
   'common',
   'settings',
   'shell',
   'tasks',
   'projects',
   'goals',
   'reviews',
   'agents',
   'runtimes',
   'navigation',
   'issueDetail',
   'issueLists',
   'inbox',
   'agentsChat',
   'workspaceAdmin',
   'areas',
   'organization',
] as const;
export type Namespace = (typeof NAMESPACES)[number];

export function isLocale(value: unknown): value is Locale {
   return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/** Cookie if it names a shipped catalogue, otherwise English. */
export function resolveLocale(
   cookie: string | null | undefined,
   // Kept for callers that pass the request's Accept-Language; English is the
   // only shipped catalogue, so there is nothing to negotiate with it yet.
   // eslint-disable-next-line @typescript-eslint/no-unused-vars
   _acceptLanguage: string | null | undefined
): Locale {
   if (isLocale(cookie)) return cookie;
   return DEFAULT_LOCALE;
}
