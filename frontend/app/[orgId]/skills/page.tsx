'use client';

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
   type SkillScope,
} from '@/components/common/skills/skills-filters';
import type { FiltersState } from '@/components/data-table-filter/core/types';
import { PageStatement } from '@/components/common/page/page-parts';
import SkillsList from '@/components/common/skills/skills-list';
import DetailDrawerShell from '@/components/layout/detail-drawer-shell';
import MainLayout from '@/components/layout/main-layout';
import SkillDetailHeader from '@/components/layout/headers/skills/detail-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { BerryApiError } from '@/lib/api';
import { loadWorkspaceAgents, type Agent } from '@/lib/agents';
import { loadSkillLabels, type SkillCatalogueLabel } from '@/lib/skill-labels';
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
   const workspaceId = useSessionStore((state) => state.workspace?.id ?? '');
   const canEdit = canEditProduct(role);
   const revision = useSkillsCatalogueStore((state) => state.revision);
   const bump = useSkillsCatalogueStore((state) => state.bump);

   const [query, setQuery] = useState('');
   const [scope, setScope] = useState<SkillScope>('all');
   const [archivedTouched, setArchivedTouched] = useState(false);
   const [criteria, setCriteria] = useState<SkillCriteria>(DEFAULT_CRITERIA);
   const [filters, setFilters] = useState<FiltersState>([]);
   const [live, setLive] = useState<Skill[] | null>(null);
   const [archived, setArchived] = useState<Skill[] | null>(null);
   const [total, setTotal] = useState(0);
   const [archivedTotal, setArchivedTotal] = useState<number | null>(null);
   const [agents, setAgents] = useState<Agent[]>([]);
   const [error, setError] = useState<string | null>(null);
   const [creating, setCreating] = useState(false);
   const [catalogue, setCatalogue] = useState<SkillCatalogueLabel[] | null>(null);
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
         const term = query.trim();
         void listSkills(term ? { q: term } : {})
            .then((found) => {
               if (cancelled) return;
               setLive(found);
               if (!term) setTotal(found.length);
               if (scope === 'all') setError(null);
            })
            .catch((failure: unknown) => {
               if (cancelled || scope !== 'all') return;
               setError(failure instanceof BerryApiError ? failure.message : t('loadFailed'));
            });
         if (archivedTouched) {
            void listSkills({ ...(term ? { q: term } : {}), archived: true })
               .then((found) => {
                  if (cancelled) return;
                  setArchived(found);
                  if (!term) setArchivedTotal(found.length);
                  if (scope === 'archived') setError(null);
               })
               .catch((failure: unknown) => {
                  if (cancelled || scope !== 'archived') return;
                  setError(failure instanceof BerryApiError ? failure.message : t('loadFailed'));
               });
         }
      }, 200);
      return () => {
         cancelled = true;
         clearTimeout(timer);
      };
   }, [archivedTouched, query, revision, scope, t]);

   const skills = scope === 'archived' ? archived : live;

   useEffect(() => {
      if (!workspaceId) return;
      let cancelled = false;
      void loadSkillLabels(workspaceId)
         .then((labels) => {
            if (!cancelled) setCatalogue(labels);
         })
         .catch(() => {
            if (!cancelled) setCatalogue(null);
         });
      return () => {
         cancelled = true;
      };
   }, [workspaceId, revision]);

   const labelOptions = useMemo(() => {
      if (catalogue) {
         return catalogue
            .map((label) => label.name)
            .sort((left, right) => left.localeCompare(right));
      }
      return [...new Set((skills ?? []).flatMap((skill) => skill.labels))].sort((left, right) =>
         left.localeCompare(right)
      );
   }, [catalogue, skills]);

   const labelColors = useMemo(() => {
      const colors: Record<string, string> = {};
      for (const label of catalogue ?? []) colors[label.name] = label.color;
      return colors;
   }, [catalogue]);

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
         <PageStatement label={t('title')}>
            <div className="flex min-w-0 items-center gap-2">
               <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t('search')}
                  aria-label={t('search')}
                  className="h-[34px] w-48 min-w-0"
               />
               {canEdit ? (
                  <Button className="h-[34px] shrink-0 px-3" onClick={() => setCreating(true)}>
                     {t('create.button')}
                  </Button>
               ) : null}
            </div>
         </PageStatement>
         <SkillsFilters
            criteria={criteria}
            onChange={setCriteria}
            filter={filter}
            scope={scope}
            onScopeChange={(next) => {
               setScope(next);
               setFilters([]);
               if (next === 'archived') setArchivedTouched(true);
            }}
            counts={{ all: total ?? 0, archived: archivedTotal }}
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
            onCriteriaChange={setCriteria}
            labelColors={labelColors}
            archived={scope === 'archived'}
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
            existingNames={(live ?? []).map((skill) => skill.name)}
            labelOptions={labelOptions}
            labelColors={labelColors}
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
