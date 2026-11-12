import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { Toaster } from '@/components/ui/sonner';
import './globals.css';

// Shipped with the app. next/font/google fetches at compile time, and Turbopack
// fails once Google's font URLs carry their own query string.
//
// Both faces are woff2 subsets of the full files beside them, cut to Latin so
// every page stops preloading ~540 KB of fonts; variable axes and all OpenType
// features are kept. Regenerate with pyftsubset (fonttools) --flavor=woff2
// --layout-features='*' over Google Fonts' latin + latin-ext ranges plus every
// non-ASCII character in messages/en, components, app and lib.
const jetBrainsMono = localFont({
   src: './fonts/jetbrains-mono-variable-latin.woff2',
   variable: '--font-jetbrains-mono',
   weight: '100 800',
   display: 'swap',
});

// The prose face. Shipped rather than fetched for the same reason, and because
// until now the stack fell through to -apple-system, so the redesign's type
// only looked right on a Mac. Upright only: `italic` is synthesised, as it
// already is for the mono above.
//
// Both variables go on <html>, not <body>: next/font emits a class name, and
// :root is <html>, so binding them there is what lets @theme resolve
// `--font-sans: var(--font-inter)` on the same element. Bound on <body> the
// @theme declaration resolves against an undefined value and silently
// computes to nothing.
const inter = localFont({
   src: './fonts/inter-variable-latin.woff2',
   variable: '--font-inter',
   weight: '100 900',
   display: 'swap',
});

// DM Serif Display is deliberately NOT loaded. It existed for one thing, the
// wordmark, which set "berry." as live text in that face. The lockup is the
// brand asset's own outlines now (components/brand/berry-mark.tsx), so nothing
// renders in it, and shipping a webfont with no reader costs a request for an
// empty result. The files stay in app/fonts for whoever needs them next.

export const metadata: Metadata = {
   title: {
      template: '%s | Berry',
      default: 'Berry',
   },
   description:
      'Berry — a team workspace where humans and AI coding agents share one board. Tasks, projects, cycles and review gates in one place.',
};

import { SessionGate } from '@/components/layout/session-gate';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale } from 'next-intl/server';
import { cookies } from 'next/headers';

import { THEME_COOKIE, resolveTheme } from '@/lib/theme/theme';

export default async function RootLayout({
   children,
}: Readonly<{
   children: React.ReactNode;
}>) {
   const locale = await getLocale();
   // Decided on the server from a cookie, exactly as the locale is: the class
   // is in the first byte, so light mode needs no inline script and has
   // nothing to reconcile during hydration. ThemeSync maintains the cookie.
   const theme = resolveTheme((await cookies()).get(THEME_COOKIE)?.value);
   return (
      <html
         lang={locale}
         className={`${inter.variable} ${jetBrainsMono.variable} ${theme === 'dark' ? 'dark' : ''}`}
         suppressHydrationWarning
      >
         <body className="antialiased" suppressHydrationWarning>
            <NextIntlClientProvider>
               <NuqsAdapter>
                  <SessionGate>
                     {children}
                     <Toaster />
                  </SessionGate>
               </NuqsAdapter>
            </NextIntlClientProvider>
         </body>
      </html>
   );
}
