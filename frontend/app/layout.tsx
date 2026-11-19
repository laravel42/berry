import type { Metadata, Viewport } from 'next';
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
//
// Inter is cut further: `opsz` is pinned at its default (14) so only `wght`
// stays variable, and only the OpenType features the app can reach are kept
// (shaping basics plus tnum and zero, which Tailwind's tabular-nums and
// slashed-zero ask for). Regenerate it with
//   fonttools varLib.instancer inter-variable.woff2 opsz=14 -o inst.woff2
//   pyftsubset inst.woff2 --unicodes=<codepoints of the current file>
//     --flavor=woff2 --notdef-outline
//     --layout-features='kern,liga,calt,ccmp,locl,mark,mkmk,case,frac,sups,subs,numr,dnom,tnum,zero'
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

// viewport-fit=cover so env(safe-area-inset-*) reports the notch and home indicator.
export const viewport: Viewport = {
   width: 'device-width',
   initialScale: 1,
   viewportFit: 'cover',
   // Chrome on Android keeps the layout viewport when the keyboard opens unless told
   // to resize it, which leaves bottom actions under the keyboard.
   interactiveWidget: 'resizes-content',
   // The browser bar takes the frame colour (--app-frame in globals.css), so the
   // chrome and the 8px frame around the workspace read as one surface.
   themeColor: [
      { media: '(prefers-color-scheme: light)', color: '#f4f4f5' },
      { media: '(prefers-color-scheme: dark)', color: '#111113' },
   ],
};

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
   const jar = await cookies();
   const theme = resolveTheme(jar.get(THEME_COOKIE)?.value);
   // Same test as proxy.ts and app/page.tsx. It only tells the gate whether to
   // draw the app's structure while the session loads; the session itself is
   // still resolved by the client.
   const hasSession = jar.has('berry.session_token');
   return (
      <html
         lang={locale}
         className={`${inter.variable} ${jetBrainsMono.variable} ${theme === 'dark' ? 'dark' : ''}`}
         suppressHydrationWarning
      >
         <body className="antialiased" suppressHydrationWarning>
            <NextIntlClientProvider>
               <NuqsAdapter>
                  <SessionGate hasSession={hasSession}>
                     {children}
                     <Toaster />
                  </SessionGate>
               </NuqsAdapter>
            </NextIntlClientProvider>
         </body>
      </html>
   );
}
