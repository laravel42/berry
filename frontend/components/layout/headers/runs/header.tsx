'use client';

import { useTranslations } from 'next-intl';

import { PageStatement } from '@/components/common/page/page-parts';
import { isTerminalRunStatus } from '@/lib/runs';
import { useRunsStore } from '@/store/runs-store';

export default function Header() {
   const t = useTranslations('runtimes.header');
   const runs = useRunsStore((state) => state.runs);
   const inProgress = runs.filter((run) => !isTerminalRunStatus(run.status)).length;

   // The runs store has no loaded flag: an empty list is either still loading
   // or truly empty, so the figure waits for the first run rather than claim zero.
   return (
      <PageStatement
         label={t('title')}
         figure={runs.length > 0 ? inProgress : undefined}
         line={t('statement.line', { count: inProgress })}
         sub={t('statement.sub')}
      />
   );
}
