'use client';

import { Button } from '@/components/ui/button';
import {
   Command,
   CommandEmpty,
   CommandGroup,
   CommandInput,
   CommandItem,
   CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { Issue } from '@/data/issues';
import { describePatchFailure, setIssueProject } from '@/lib/issues';
import { cn } from '@/lib/utils';
import { useIssuesStore } from '@/store/issues-store';
import { useProjectsStore } from '@/store/projects-store';
import { CheckIcon, FolderKanban } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

/**
 * Which project this task belongs to, in the properties sidebar.
 *
 * Same control shape as status and priority: a mark beside a name, opened to
 * pick another project or clear the link. Persist goes through the issue
 * project link endpoint, not a column patch.
 */
export function IssueProjectProperty({ issue }: { issue: Issue }) {
   const t = useTranslations('issueDetail.properties');
   const projects = useProjectsStore((state) => state.projects);
   const updateIssueProject = useIssuesStore((state) => state.updateIssueProject);
   const [open, setOpen] = useState(false);

   const choose = (projectId: string | null) => {
      const next = projectId ? projects.find((entry) => entry.id === projectId) : undefined;
      const previous = issue.project;
      updateIssueProject(issue.id, next);
      setOpen(false);
      void setIssueProject(issue.identifier, projectId).catch((cause: unknown) => {
         updateIssueProject(issue.id, previous);
         toast.error(describePatchFailure(cause) || t('saveFailed'));
      });
   };

   const Icon = issue.project?.icon ?? FolderKanban;

   return (
      <Popover open={open} onOpenChange={setOpen}>
         <PopoverTrigger asChild>
            <Button
               type="button"
               variant="ghost"
               size="sm"
               aria-haspopup="listbox"
               aria-expanded={open}
               aria-label={t('project')}
               className="w-full min-w-0 justify-start gap-2 px-1.5"
            >
               <Icon className="size-4 text-status-warning" aria-hidden />
               <span className={cn('min-w-0 truncate', !issue.project && 'text-muted-foreground')}>
                  {issue.project?.name ?? t('noProject')}
               </span>
            </Button>
         </PopoverTrigger>
         <PopoverContent align="start" className="w-64 p-0">
            <Command>
               <CommandInput placeholder={t('project')} aria-label={t('project')} />
               <CommandList>
                  <CommandEmpty>No project matches.</CommandEmpty>
                  <CommandGroup>
                     <CommandItem
                        value="__none__"
                        onSelect={() => choose(null)}
                        className="flex items-center gap-2"
                     >
                        <FolderKanban className="size-4 text-muted-foreground" aria-hidden />
                        <span className="min-w-0 flex-1 truncate">{t('noProject')}</span>
                        {!issue.project ? <CheckIcon className="size-4 shrink-0" /> : null}
                     </CommandItem>
                     {projects.map((project) => (
                        <CommandItem
                           key={project.id}
                           value={`${project.name} ${project.id}`}
                           onSelect={() => choose(project.id)}
                           className="flex items-center gap-2"
                        >
                           <project.icon className="size-4 shrink-0 text-muted-foreground" />
                           <span className="min-w-0 flex-1 truncate">{project.name}</span>
                           {issue.project?.id === project.id ? (
                              <CheckIcon className="size-4 shrink-0" />
                           ) : null}
                        </CommandItem>
                     ))}
                  </CommandGroup>
               </CommandList>
            </Command>
         </PopoverContent>
      </Popover>
   );
}
