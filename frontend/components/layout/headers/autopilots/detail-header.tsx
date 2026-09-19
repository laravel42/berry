'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { ChevronRight } from 'lucide-react';

import { useAutopilot } from '@/hooks/use-autopilot';

interface AutopilotDetailHeaderProps {
   autopilotId: string;
}

/** Breadcrumb bar for the autopilot detail drawer. */
export default function AutopilotDetailHeader({ autopilotId }: AutopilotDetailHeaderProps) {
   const t = useTranslations('areas.autopilots');
   const { orgId } = useParams<{ orgId: string }>();
   const { autopilot } = useAutopilot(autopilotId);
   const name = autopilot?.name ?? t('detail.loading');

   return (
      <div className="flex h-10 w-full items-center gap-2 border-b px-6 py-1.5">
         <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1">
            <Link
               href={`/${orgId}/autopilots`}
               className="text-muted-foreground transition-colors hover:text-foreground"
            >
               {t('title')}
            </Link>
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate font-medium">{name}</span>
         </nav>
      </div>
   );
}
