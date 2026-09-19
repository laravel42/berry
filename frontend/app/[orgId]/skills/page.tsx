'use client';

import { Plus } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';

import NewSkillDialog from '@/components/common/skills/new-skill-dialog';
import SkillDetail from '@/components/common/skills/skill-detail';
import {
   applyListFilters,
   ListFilterBar,
   useListFilters,
} from '@/components/common/filters/list-filters';
import SkillsFilters, {
   DEFAULT_CRITERIA,
   useSkillFilterColumns,
   type SkillCriteria,
} from '@/components/common/skills/skills-filters';
import type { FiltersState } from '@/components/data-table-filter/core/types';
import SkillsList from '@/components/common/skills/skills-list';
import DetailDrawerShell from '@/components/layout/detail-drawer-shell';
import MainLayout from '@/components/layout/main-layout';
import SkillDetailHeader from '@/components/layout/headers/skills/detail-header';
import { Button } from '@/components/ui/button';
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
   const [filters, setFilters] = useState<FiltersState>([]);
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

   // The server answers the search; the filters, sort and columns are the
   // reader's own view of that answer, matched here from the list payload.
   useEffect(() => {
      let cancelled = false;
      const timer = setTimeout(() => {
         listSkills(query.trim() ? { q: query.trim() } : {})
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
   }, [query, revision, t]);

   /** Who has made a skill here, as the catalogue itself reports it. */
   const creators = useMemo(() => {
      const seen = new Map<string, string>();
      for (const skill of skills ?? []) {
         if (skill.createdBy) seen.set(skill.createdBy, skill.creatorName ?? skill.createdBy);
      }
      return [...seen].map(([id, name]) => ({ id, name }));
   }, [skills]);

   const filterColumns = useSkillFilterColumns(skills ?? [], agents, creators);
   const filter = useListFilters({
      data: skills ?? [],
      columns: filterColumns,
      filters,
      onFiltersChange: setFilters,
   });
   const shown = useMemo(
      () => (skills ? applyListFilters(skills, filterColumns, filters) : null),
      [skills, filterColumns, filters]
   );

   const open = (id: string | null) => {
      const next = new URLSearchParams(params.toString());
      if (id) next.set('view', id);
      else next.delete('view');
      router.replace(`?${next.toString()}`, { scroll: false });
   };

   const header = (
      <>
         <SkillsFilters
            criteria={criteria}
            onChange={setCriteria}
            filter={filter}
            query={query}
            onQueryChange={setQuery}
            action={
               canEdit ? (
                  <Button
                     size="xs"
                     className="ml-1 h-[34px] w-[42px] shrink-0 px-0"
                     aria-label={t('create.title')}
                     title={t('create.title')}
                     onClick={() => setCreating(true)}
                  >
                     <Plus className="size-4" />
                  </Button>
               ) : null
            }
         />
         <ListFilterBar filter={filter} />
      </>
   );

   return (
      <MainLayout header={header}>
         <SkillsList
            skills={shown}
            error={error}
            criteria={criteria}
            agents={agents}
            canEdit={canEdit}
            openId={view}
            onOpen={(id) => open(id)}
            onChanged={reload}
            narrowed={query.trim() !== '' || filter.filters.length > 0}
         />
         {view ? (
            <DetailDrawerShell
               header={<SkillDetailHeader skillId={view} />}
               onClose={() => open(null)}
            >
               <SkillDetail key={view} skillId={view} canEdit={canEdit} onChanged={reload} />
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
