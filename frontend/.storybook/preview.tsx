import type { Preview } from '@storybook/nextjs-vite';
import MockDate from 'mockdate';
import { mswLoader } from 'msw-storybook-addon/csf3';
import { NextIntlClientProvider } from 'next-intl';
import { NuqsTestingAdapter } from 'nuqs/adapters/testing';
import '../app/globals.css';
import { Toaster } from '../components/ui/sonner';
import messages from '../i18n/messages-en';
import { mswHandlers } from './msw-handlers';

/** The instant every story renders at, so relative times read the same. */
const NOW = new Date('2026-09-18T12:00:00Z');

// The app's forced dark theme, set the way app/layout.tsx sets it: a class on <html>.
document.documentElement.classList.add('dark');

const preview: Preview = {
   // The app's own provider tree from app/layout.tsx, minus SessionGate (auth
   // is the page's concern, not a component's): English messages, URL state
   // and the forced dark theme.
   // A story seeds URL state (`?filters=`, `?tab=`) with
   // `parameters: { nuqs: { searchParams: { tab: 'work' } } }`.
   decorators: [
      (Story, { parameters }) => (
         <NextIntlClientProvider locale="en" messages={messages} now={NOW} timeZone="UTC">
            <NuqsTestingAdapter
               searchParams={
                  (parameters.nuqs as { searchParams?: Record<string, string> } | undefined)
                     ?.searchParams
               }
            >
               {/* Popovers and toasts enter with a fade from opacity 0; stories
                      assert on them the moment they mount, so motion is off. */}
               <style>{`*, *::before, *::after { animation-duration: 0s !important; animation-delay: 0s !important; transition-duration: 0s !important; transition-delay: 0s !important; }`}</style>
               <div className="bg-background p-4 text-foreground antialiased">
                  <Story />
               </div>
               <Toaster />
            </NuqsTestingAdapter>
         </NextIntlClientProvider>
      ),
   ],
   loaders: [mswLoader()],
   async beforeEach({ msw }) {
      msw.use(...mswHandlers);
      MockDate.set(NOW);
      return () => MockDate.reset();
   },
   parameters: {
      // Components use the App Router hooks (useParams, useRouter).
      nextjs: { appDirectory: true },

      controls: {
         matchers: {
            color: /(background|color)$/i,
            date: /Date$/i,
         },
      },

      a11y: {
         // 'todo' - show a11y violations in the test UI only
         // 'error' - fail CI on a11y violations
         // 'off' - skip a11y checks entirely
         test: 'todo',
      },
   },
};

export default preview;
