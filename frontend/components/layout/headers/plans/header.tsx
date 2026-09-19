'use client';

import { useTranslations } from 'next-intl';
import { PageTitleBar } from '../page-title-bar';

/** Plans list header. */
export default function Header() {
   const t = useTranslations('goals.plans.header');
   return <PageTitleBar title={t('title')} />;
}
