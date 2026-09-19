import type { Metadata } from 'next';
import { DM_Serif_Display, JetBrains_Mono } from 'next/font/google';
import { Toaster } from '@/components/ui/sonner';
import './globals.css';

const dmSerifDisplay = DM_Serif_Display({
   variable: '--font-dm-serif',
   subsets: ['latin'],
   weight: '400',
});

const jetBrainsMono = JetBrains_Mono({
   variable: '--font-jetbrains-mono',
   subsets: ['latin'],
   weight: ['300', '400', '500', '600'],
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
            className={`${dmSerifDisplay.variable} ${jetBrainsMono.variable} bg-background antialiased`}
            suppressHydrationWarning
         >
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
