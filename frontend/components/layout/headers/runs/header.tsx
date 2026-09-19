'use client';

import { useTranslations } from 'next-intl';
import { PageTitleBar } from '../page-title-bar';

export default function Header() {
   const t = useTranslations('runtimes.header');
   return <PageTitleBar title={t('title')} />;
}
