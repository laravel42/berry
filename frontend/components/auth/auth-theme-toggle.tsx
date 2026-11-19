'use client';

import { Moon, Sun } from 'lucide-react';
import { useSyncExternalStore } from 'react';

import { Button } from '@/components/ui/button';
import { saveUserSettings } from '@/lib/settings';
import { applyThemeClass, writeThemeCookie } from '@/lib/theme/client-theme';
import type { ResolvedTheme } from '@/lib/theme/theme';
import { cn } from '@/lib/utils';
import { useSessionStore } from '@/store/session-store';

/** The painted theme is the class on <html>; follow it wherever it changes. */
function subscribe(onChange: () => void) {
   const observer = new MutationObserver(onChange);
   observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
   return () => observer.disconnect();
}

const readTheme = (): ResolvedTheme =>
   document.documentElement.classList.contains('dark') ? 'dark' : 'light';

/**
 * Light / Dark for the screens before the shell. Someone signed out has no
 * account preference, so the cookie the server reads is the whole of it: write
 * it and paint the class. Someone signed in (onboarding, an invitation) owns a
 * preference that ThemeSync enforces, so the choice is saved to the account
 * too, or the next load would switch straight back.
 */
export function AuthThemeToggle({ className }: { className?: string }) {
   // Unknown on the server; the icons below follow the class with CSS alone,
   // so only the pressed state waits for the client.
   const theme = useSyncExternalStore(subscribe, readTheme, () => null);
   const signedIn = useSessionStore((state) => state.status === 'ready');
   const setPreferredTheme = useSessionStore((state) => state.setPreferredTheme);

   const choose = (next: ResolvedTheme) => {
      if (readTheme() === next) return;
      writeThemeCookie(next);
      applyThemeClass(next);
      if (signedIn) {
         setPreferredTheme(next);
         void saveUserSettings({ theme: next }).catch(() => undefined);
      }
   };

   return (
      <div
         role="group"
         aria-label="Theme"
         className={cn(
            'inline-flex items-center gap-0.5 rounded-pill bg-segment-track p-0.5',
            className
         )}
      >
         <Button
            type="button"
            variant="quiet"
            size="icon-sm"
            aria-label="Light"
            aria-pressed={theme === null ? undefined : theme === 'light'}
            className="bg-card text-foreground shadow-xs dark:bg-transparent dark:text-muted-foreground dark:shadow-none"
            onClick={() => choose('light')}
         >
            <Sun aria-hidden />
         </Button>
         <Button
            type="button"
            variant="quiet"
            size="icon-sm"
            aria-label="Dark"
            aria-pressed={theme === null ? undefined : theme === 'dark'}
            className="dark:bg-card dark:text-foreground dark:shadow-xs"
            onClick={() => choose('dark')}
         >
            <Moon aria-hidden />
         </Button>
      </div>
   );
}
