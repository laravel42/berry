'use client';

import { useTranslations } from 'next-intl';
import { PageTitleBar } from '../page-title-bar';

/**
 * Goals list header. No action, deliberately: planning is what makes a goal and
 * it starts in a project, so the button lives there. Offering it here would
 * invite a goal with no project to hang off.
 */
export default function Header() {
   const t = useTranslations('goals.header');
   return <PageTitleBar title={t('title')} />;
}
