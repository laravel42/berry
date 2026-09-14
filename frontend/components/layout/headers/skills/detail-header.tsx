'use client';

import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { getSkill } from '@/lib/skills';
import { useSkillsCatalogueStore } from '@/store/skills-catalogue-store';

interface SkillDetailHeaderProps {
   skillId: string;
}

export default function SkillDetailHeader({ skillId }: SkillDetailHeaderProps) {
   const { orgId } = useParams<{ orgId: string }>();
   const t = useTranslations('areas.skills');
   const revision = useSkillsCatalogueStore((state) => state.revision);
   const [name, setName] = useState<string | null>(null);

   useEffect(() => {
      let cancelled = false;
      void getSkill(skillId)
         .then((skill) => {
            if (!cancelled) setName(skill.name);
         })
         .catch(() => {
            if (!cancelled) setName(null);
         });
      return () => {
         cancelled = true;
      };
   }, [skillId, revision]);

   return (
      <div className="flex h-10 w-full items-center gap-2 border-b px-6 py-1.5">
         <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1">
            <Link
               href={`/${orgId}/skills`}
               className="text-muted-foreground transition-colors hover:text-foreground"
            >
               {t('title')}
            </Link>
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate font-medium">{name ?? t('detail.loading')}</span>
         </nav>
      </div>
   );
}
