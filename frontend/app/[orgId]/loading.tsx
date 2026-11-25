'use client';

import { useTranslations } from 'next-intl';

import { SectionSkeleton } from '@/components/common/page/page-skeleton';

/**
 * Shown the moment a section link is clicked, while the next page's code and
 * render are on their way. Without it the old page stayed on screen — rail
 * highlight included — for up to a second, which read as a missed click. It
 * also lets Next prefetch the workspace frame ahead of the click: a dynamic
 * route with no loading boundary is not prefetched at all.
 *
 * Opening a drawer does not show it: an intercepted route keeps the page
 * underneath, so this boundary never suspends.
 */
export default function SectionLoading() {
   const t = useTranslations('common');
   return <SectionSkeleton label={t('loading')} />;
}
