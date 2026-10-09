import type { Metadata } from 'next';
import localFont from 'next/font/local';
import Script from 'next/script';
import { Toaster } from '@/components/ui/sonner';
import './globals.css';

/**
 * Development builds of React's server-component client call
 * `performance.measure` when a render is rejected or aborted (`redirect()`,
 * `notFound()`). The end time can be negative, and the browser then throws
 * `cannot have a negative time stamp`, which Next shows as a runtime error.
 * Clamp those times before the client runtime loads. Production builds do not
 * take this path.
 */
const DEV_PERFORMANCE_MEASURE = `(() => {
   const measure = performance.measure.bind(performance);
   performance.measure = function (name, startOrOptions, endMark) {
      if (!startOrOptions || typeof startOrOptions !== 'object') {
         return measure(name, startOrOptions, endMark);
      }
      let start = startOrOptions.start;
      let end = startOrOptions.end;
      if (typeof start === 'number' && start < 0) start = 0;
      if (typeof end === 'number' && end < 0) end = 0;
      if (typeof start === 'number' && typeof end === 'number' && end < start) end = start;
      if (start === startOrOptions.start && end === startOrOptions.end) {
         return measure(name, startOrOptions);
      }
      return measure(name, Object.assign({}, startOrOptions, { start: start, end: end }));
   };
})();`;

// Shipped with the app. next/font/google fetches at compile time, and Turbopack
// fails once Google's font URLs carry their own query string.
const dmSerifDisplay = localFont({
   src: './fonts/dm-serif-display-400-latin.woff2',
   variable: '--font-dm-serif',
   weight: '400',
   display: 'swap',
});

const jetBrainsMono = localFont({
   src: './fonts/jetbrains-mono-variable.ttf',
   variable: '--font-jetbrains-mono',
   weight: '100 800',
   display: 'swap',
});

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

export default async function RootLayout({
   children,
}: Readonly<{
   children: React.ReactNode;
}>) {
   const locale = await getLocale();
   return (
      // Berry is dark only, so the theme is a static class rather than a
      // provider: next-themes injected an inline script React 19 refuses to run.
      <html lang={locale} className="dark" suppressHydrationWarning>
         <body
            className={`${dmSerifDisplay.variable} ${jetBrainsMono.variable} antialiased`}
            suppressHydrationWarning
         >
            {process.env.NODE_ENV === 'development' ? (
               <Script id="dev-performance-measure" strategy="beforeInteractive">
                  {DEV_PERFORMANCE_MEASURE}
               </Script>
            ) : null}
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
