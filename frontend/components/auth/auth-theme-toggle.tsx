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
            'relative inline-flex items-center gap-0.5 rounded-pill bg-segment-track p-0.5',
            className
         )}
      >
         {/*
            The selection is one thumb that slides between the two, drawn as
            SegmentIndicator draws its own. It follows the class on <html>, so
            it is right on the first paint and needs no state; it moves on a
            transform, which reduced motion settles instantly.
         */}
         <span
            aria-hidden
            className="pointer-events-none absolute top-0.5 left-0.5 size-(--field-h) rounded-full bg-segment-selected shadow-[0_1px_2px_rgb(0_0_0/0.08),0_0_0_0.5px_rgb(0_0_0/0.04)] transition-transform duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] dark:translate-x-[calc(var(--field-h)+0.125rem)] dark:bg-[#3a3a40] dark:shadow-[inset_0_1px_0_rgb(255_255_255/0.07),0_1px_3px_rgb(0_0_0/0.5)]"
         />
         <Button
            type="button"
            variant="quiet"
            size="icon-sm"
            aria-label="Light"
            aria-pressed={theme === null ? undefined : theme === 'light'}
            className="relative text-foreground hover:bg-transparent hover:text-foreground dark:text-muted-foreground"
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
            className="relative text-muted-foreground hover:bg-transparent hover:text-foreground dark:text-foreground"
            onClick={() => choose('dark')}
         >
            <Moon aria-hidden />
         </Button>
      </div>
   );
}
