'use client';

import { Check, ChevronDown, FolderKanban } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

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
import { cn } from '@/lib/utils';
import { useProjectsStore } from '@/store/projects-store';

interface UsageProjectFilterProps {
   /** The chosen project, or `null` for every project. */
   projectId: string | null;
   onChange: (projectId: string | null) => void;
   className?: string;
}

/**
 * Which project a usage or dashboard read is narrowed to: "All projects" or
 * one of the workspace's projects, searchable. A read narrowed to a project
 * counts the tasks linked to it (`projectId` on the usage and dashboard API).
 *
 * Projects come from the projects store, which the workspace hydrator fills
 * on every page, so the list costs no request of its own.
 */
export function UsageProjectFilter({ projectId, onChange, className }: UsageProjectFilterProps) {
   const t = useTranslations('areas.usage.filters');
   const projects = useProjectsStore((state) => state.projects);
   const [open, setOpen] = useState(false);
   const chosen = projects.find((project) => project.id === projectId);

   const choose = (next: string | null) => {
      setOpen(false);
      onChange(next);
   };

   return (
      <Popover open={open} onOpenChange={setOpen}>
         <PopoverTrigger asChild>
            {/* The list toolbars' button (Projects: Filter, Sort, Display), with
                the Projects rail icon. */}
            <Button
               variant="outline"
               // Field height, like the range control and the tabs on its line.
               size="sm"
               role="combobox"
               aria-label={`${t('project')}: ${chosen ? chosen.name : t('allProjects')}`}
               className={cn('max-w-56 border-muted-foreground/15', className)}
            >
               <FolderKanban className="size-4 shrink-0" aria-hidden />
               <span className="truncate">{chosen ? chosen.name : t('allProjects')}</span>
               <ChevronDown
                  className="ml-auto size-4 shrink-0 text-muted-foreground sm:hidden"
                  aria-hidden
               />
            </Button>
         </PopoverTrigger>
         <PopoverContent
            className="w-[max(16rem,var(--radix-popover-trigger-width))] p-0"
            align="start"
         >
            <Command>
               <CommandInput placeholder={t('searchProjects')} />
               <CommandList>
                  <CommandEmpty>{t('noProjects')}</CommandEmpty>
                  <CommandGroup>
                     <CommandItem
                        value={`__all__ ${t('allProjects')}`}
                        onSelect={() => choose(null)}
                        className="justify-between"
                     >
                        {t('allProjects')}
                        {projectId === null ? <Check className="text-(--primary) size-4" /> : null}
                     </CommandItem>
                     {projects.map((project) => (
                        <CommandItem
                           key={project.id}
                           value={`${project.name} ${project.id}`}
                           onSelect={() => choose(project.id)}
                           className="justify-between"
                        >
                           <span className="truncate">{project.name}</span>
                           {projectId === project.id ? (
                              <Check className="text-(--primary) size-4 shrink-0" />
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
