'use client';

import { Plus } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';

import NewSkillDialog from '@/components/common/skills/new-skill-dialog';
import SkillDetail from '@/components/common/skills/skill-detail';
import SkillsFilters, {
   DEFAULT_CRITERIA,
   activeFilterCount,
   type SkillCriteria,
} from '@/components/common/skills/skills-filters';
import SkillsList from '@/components/common/skills/skills-list';
import DetailDrawerShell from '@/components/layout/detail-drawer-shell';
import MainLayout from '@/components/layout/main-layout';
import SkillDetailHeader from '@/components/layout/headers/skills/detail-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { BerryApiError } from '@/lib/api';
import { loadWorkspaceAgents, type Agent } from '@/lib/agents';
import { listSkills, type Skill } from '@/lib/skills';
import { canEditProduct } from '@/lib/workspace-role';
import { useSessionStore } from '@/store/session-store';
import { useSkillsCatalogueStore } from '@/store/skills-catalogue-store';

function SkillsScreen() {
   const t = useTranslations('areas.skills');
   const router = useRouter();
   const params = useSearchParams();
   const view = params.get('view');
   const role = useSessionStore((state) => state.workspace?.role);
   const canEdit = canEditProduct(role);
   const revision = useSkillsCatalogueStore((state) => state.revision);
   const bump = useSkillsCatalogueStore((state) => state.bump);

   const [query, setQuery] = useState('');
   const [criteria, setCriteria] = useState<SkillCriteria>(DEFAULT_CRITERIA);
   const [skills, setSkills] = useState<Skill[] | null>(null);
   const [agents, setAgents] = useState<Agent[]>([]);
   const [error, setError] = useState<string | null>(null);
   const [creating, setCreating] = useState(false);
   const reload = useCallback(() => bump(), [bump]);

   useEffect(() => {
      let cancelled = false;
      void loadWorkspaceAgents()
         .then((found) => {
            if (!cancelled) setAgents(found);
         })
         .catch(() => {
            /* The catalogue is still usable without the agent list. */
         });
      return () => {
         cancelled = true;
      };
   }, []);

   // The server answers the filters it knows (search, agent, creator, usage);
   // sort and columns are the reader's own view of the same answer.
   useEffect(() => {
      let cancelled = false;
      const timer = setTimeout(() => {
         listSkills({
            ...(query.trim() ? { q: query.trim() } : {}),
            ...(criteria.agentId ? { agentId: criteria.agentId } : {}),
            ...(criteria.createdBy ? { createdBy: criteria.createdBy } : {}),
            ...(criteria.usage === 'all' ? {} : { inUse: criteria.usage === 'inUse' }),
         })
            .then((found) => {
               if (cancelled) return;
               setSkills(found);
               setError(null);
            })
            .catch((failure: unknown) => {
               if (cancelled) return;
               setError(failure instanceof BerryApiError ? failure.message : t('loadFailed'));
            });
      }, 200);
      return () => {
         cancelled = true;
         clearTimeout(timer);
      };
   }, [query, criteria, revision, t]);

   /** Who has made a skill here, as the catalogue itself reports it. */
   const creators = useMemo(() => {
      const seen = new Map<string, string>();
      for (const skill of skills ?? []) {
         if (skill.createdBy) seen.set(skill.createdBy, skill.creatorName ?? skill.createdBy);
      }
      return [...seen].map(([id, name]) => ({ id, name }));
   }, [skills]);

   const open = (id: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (id) next.set('view', id);
      else next.delete('view');
      router.replace(`?${next.toString()}`, { scroll: false });
   };

   const header = (
      <div className="flex w-full flex-col border-b">
         <div className="flex flex-wrap items-start justify-between gap-4 px-6 py-3">
            <div className="min-w-0">
               <span className="font-medium">{t('title')}</span>
               <p className="mt-1 max-w-2xl text-muted-foreground">{t('subtitle')}</p>
            </div>
            {canEdit ? (
               <Button size="xs" variant="secondary" onClick={() => setCreating(true)}>
                  <Plus className="size-3.5" />
                  {t('create.title')}
               </Button>
            ) : null}
         </div>
         <div className="flex flex-wrap items-center justify-between gap-2 border-t px-6 py-2">
            <Input
               value={query}
               onChange={(event) => setQuery(event.target.value)}
               placeholder={t('search')}
               aria-label={t('search')}
               className="h-7 max-w-xs"
            />
            <SkillsFilters
               criteria={criteria}
               onChange={setCriteria}
               agents={agents}
               creators={creators}
            />
         </div>
      </div>
   );

   return (
      <MainLayout header={header}>
         <SkillsList
            skills={skills}
            error={error}
            criteria={criteria}
            agents={agents}
            canEdit={canEdit}
            openId={view}
            onOpen={(id) => open(id)}
            onChanged={reload}
            narrowed={query.trim() !== '' || activeFilterCount(criteria) > 0}
         />
         {view ? (
            <DetailDrawerShell
               header={<SkillDetailHeader skillId={view} />}
               onClose={() => open(null)}
            >
               <SkillDetail
                  key={view}
                  skillId={view}
                  canEdit={canEdit}
                  onChanged={reload}
                  onClose={() => open(null)}
               />
            </DetailDrawerShell>
         ) : null}
         <NewSkillDialog
            open={creating}
            onOpenChange={setCreating}
            onCreated={(skill) => {
               reload();
               open(skill.id);
            }}
            existingNames={(skills ?? []).map((skill) => skill.name)}
         />
      </MainLayout>
   );
}

export default function SkillsPage() {
   return (
      <Suspense>
         <SkillsScreen />
      </Suspense>
   );
}
