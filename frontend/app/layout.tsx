import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { Toaster } from '@/components/ui/sonner';
import './globals.css';

// Shipped with the app. next/font/google fetches at compile time, and Turbopack
// fails once Google's font URLs carry their own query string.
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
         className={theme === 'dark' ? 'dark' : undefined}
         suppressHydrationWarning
      >
         <body className={`${jetBrainsMono.variable} antialiased`} suppressHydrationWarning>
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
