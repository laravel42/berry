import { getRequestConfig } from 'next-intl/server';
import { cookies, headers } from 'next/headers';

import { LOCALE_COOKIE, NAMESPACES, resolveLocale, type Locale } from '@/lib/i18n/locales';

const catalogues = new Map<Locale, Promise<Record<string, unknown>>>();

function loadCatalogues(locale: Locale): Promise<Record<string, unknown>> {
   const cached = catalogues.get(locale);
   if (cached) return cached;
   const pending = Promise.all(
      NAMESPACES.map(
         async (namespace) =>
            [namespace, (await import(`../messages/${locale}/${namespace}.json`)).default] as const
      )
   ).then((entries) => Object.fromEntries(entries));
   catalogues.set(locale, pending);
   return pending;
}

/**
 * No locale in the URL: Berry's routes are workspace-scoped already, and a
 * language prefix would split every tab and bookmark in two. The cookie mirrors
 * the account setting (see LocaleSync), so the server renders the right
 * language on the first byte.
 */
export default getRequestConfig(async () => {
   const cookieStore = await cookies();
   const headerStore = await headers();
   const locale = resolveLocale(
      cookieStore.get(LOCALE_COOKIE)?.value,
      headerStore.get('accept-language')
   );
   const messages = await loadCatalogues(locale);
   // A shared `now` for `format.relativeTime`. Without it next-intl falls back
   // to the clock at each call — it logs an ENVIRONMENT_FALLBACK error per
   // call, and the server and the browser can render the same row differently.
   return { locale, messages, now: new Date() };
});
