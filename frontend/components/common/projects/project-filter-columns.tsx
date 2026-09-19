'use client';

import {
   byLabel,
   memberFilterOption,
   priorityFilterOptions,
} from '@/components/common/filters/filter-options';
import { createColumnConfigHelper } from '@/components/data-table-filter/core/filters';
import type { ColumnOption } from '@/components/data-table-filter/core/types';
import { health as allHealth, type Project } from '@/data/projects';
import { useMembersStore } from '@/store/members-store';
import { BarChart3, CircleDashed, HeartPulse, Tag, UserRound } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';
import { projectCreateStatusOptions } from './create-project/project-status-options';

/** Lead value for a project nobody leads. */
const NO_LEAD = 'no-lead';

const healthOptions: ColumnOption[] = allHealth.map((entry) => ({
   value: entry.id,
   label: entry.name,
   icon: <span className="size-2.5 rounded-full" style={{ backgroundColor: entry.color }} />,
}));

const statusOptions: ColumnOption[] = projectCreateStatusOptions.map((option) => ({
   value: option.status.id,
   label: option.label,
   icon: <option.status.icon />,
}));

/** What the Projects list can be narrowed by. */
export function useProjectFilterColumns(projects: Project[]) {
   const t = useTranslations('issueLists');
   const members = useMembersStore((state) => state.members);

   // Labels are offered from the projects themselves, so the menu never lists
   // one that would match nothing.
   const labelOptions = useMemo(() => {
      const seen = new Map<string, ColumnOption>();
      for (const project of projects) {
         for (const label of project.labels) {
            seen.set(label.id, {
               value: label.id,
               label: label.name,
               icon: (
                  <span
                     className="size-2.5 rounded-full"
                     style={{ backgroundColor: label.color }}
                  />
               ),
            });
         }
      }
      return [...seen.values()].sort(byLabel);
   }, [projects]);

   return useMemo(() => {
      const dtf = createColumnConfigHelper<Project>();
      return [
         dtf
            .option()
            .id('health')
            .accessor((project: Project) => project.health.id)
            .displayName('Health')
            .icon(HeartPulse)
            .options(healthOptions)
            .build(),
         dtf
            .option()
            .id('status')
            .accessor((project: Project) => project.status.id)
            .displayName(t('projects.status'))
            .icon(CircleDashed)
            .options(statusOptions)
            .build(),
         dtf
            .option()
            .id('priority')
            .accessor((project: Project) => project.priority.id)
            .displayName(t('display.priority'))
            .icon(BarChart3)
            .options(priorityFilterOptions)
            .build(),
         dtf
            .option()
            .id('lead')
            .accessor((project: Project) => project.lead?.id || NO_LEAD)
            .displayName(t('projects.lead'))
            .icon(UserRound)
            .options([
               {
                  value: NO_LEAD,
                  label: 'No lead',
                  icon: <UserRound className="size-4 text-muted-foreground" />,
               },
               ...members.map(memberFilterOption),
            ])
            .build(),
         dtf
            .multiOption()
            .id('labels')
            .accessor((project: Project) => project.labels.map((label) => label.id))
            .displayName('Labels')
            .icon(Tag)
            .options(labelOptions)
            .build(),
      ] as const;
   }, [t, members, labelOptions]);
}
