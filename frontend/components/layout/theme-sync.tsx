'use client';

import { useEffect } from 'react';

import {
   applyThemeClass,
   prefersDark,
   readThemeCookie,
   writeThemeCookie,
} from '@/lib/theme/client-theme';
import { themeForPreference } from '@/lib/theme/theme';
import { useSessionStore } from '@/store/session-store';

/**
 * The account is authoritative; the cookie is what the server can read.
 *
 * Same contract as LocaleSync, with one addition: the stored preference may be
 * `system`, which no document can be. This resolves it against the OS and puts
 * the *resolved* theme in the cookie, so the server only ever renders `light`
 * or `dark`. While the preference is `system` it keeps listening, because the
 * OS can flip while the tab is open.
 */
export function ThemeSync() {
   const preferred = useSessionStore((state) => state.preferredTheme);

   useEffect(() => {
      if (!preferred) return;

      const settle = () => {
         const next = themeForPreference(preferred, prefersDark());
         // Already written (Preferences wrote it, or the browser refuses the
         // cookie): nothing to do, and writing again could loop.
         if (readThemeCookie() === next) return;
         writeThemeCookie(next);
         // The server only reads the cookie to set the class on <html>, so
         // painting the class here is the whole job. No server re-render needed.
         applyThemeClass(next);
      };

      settle();

      if (preferred !== 'system') return;
      const query = window.matchMedia?.('(prefers-color-scheme: dark)');
      if (!query) return;
      query.addEventListener('change', settle);
      return () => query.removeEventListener('change', settle);
   }, [preferred]);

   return null;
}
