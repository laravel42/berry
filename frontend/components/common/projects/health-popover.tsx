'use client';

import { Button } from '@/components/ui/button';
import {
   Command,
   CommandEmpty,
   CommandGroup,
   CommandItem,
   CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { health as healthOptions, type Project } from '@/data/projects';
import { cn } from '@/lib/utils';
import { useProjectsStore } from '@/store/projects-store';
import { AlertCircle, CheckIcon, CircleCheck, CircleDashed, CircleX } from 'lucide-react';
import { useEffect, useId, useState } from 'react';

interface HealthPopoverProps {
   project: Project;
   /** Dot and label, for a board card. The list keeps the ghost button. */
   compact?: boolean;
   /** When false, the ghost button is icon-only (sidebar shows the name beside it). */
   showLabel?: boolean;
}

function HealthIcon({ healthId, className }: { healthId: string; className?: string }) {
   const iconClass = cn('size-4', className);
   switch (healthId) {
      case 'on-track':
         return <CircleCheck className={cn(iconClass, 'text-status-success')} aria-hidden />;
      case 'off-track':
         return <CircleX className={cn(iconClass, 'text-status-danger')} aria-hidden />;
      case 'at-risk':
         return <AlertCircle className={cn(iconClass, 'text-status-warning')} aria-hidden />;
      case 'no-update':
      default:
         return <CircleDashed className={cn(iconClass, 'text-status-neutral')} aria-hidden />;
   }
}

export function HealthPopover({ project, compact = false, showLabel = true }: HealthPopoverProps) {
   const id = useId();
   const [open, setOpen] = useState(false);
   const [value, setValue] = useState(project.health.id);
   const updateProjectHealth = useProjectsStore((state) => state.updateProjectHealth);

   useEffect(() => {
      setValue(project.health.id);
   }, [project.health.id]);

   const selected = healthOptions.find((entry) => entry.id === value) ?? project.health;

   const choose = (healthId: Project['health']['id']) => {
      setValue(healthId);
      setOpen(false);
      if (healthId !== project.health.id) {
         updateProjectHealth(project.id, healthId);
      }
   };

   return (
      <Popover open={open} onOpenChange={setOpen}>
         <PopoverTrigger asChild>
            {compact ? (
               <button
                  id={id}
                  type="button"
                  className="inline-flex items-center gap-1 text-muted-foreground"
                  aria-expanded={open}
                  aria-label={`Health: ${selected.name}`}
                  title={selected.name}
               >
                  <span
                     className="size-1.5 shrink-0 rounded-full"
                     style={{ backgroundColor: selected.color }}
                  />
                  {selected.name}
               </button>
            ) : (
               <Button
                  id={id}
                  className="flex h-7 items-center justify-start gap-1 px-2 has-[>svg]:px-2"
                  size="sm"
                  variant="ghost"
                  role="combobox"
                  aria-expanded={open}
                  aria-label={`Health: ${selected.name}`}
                  title={selected.name}
               >
                  <HealthIcon healthId={selected.id} />
                  {showLabel ? (
                     <span className="mt-[1px] ml-0.5 hidden xl:inline">{selected.name}</span>
                  ) : null}
               </Button>
            )}
         </PopoverTrigger>
         <PopoverContent className="border-input w-52 p-0" align="start">
            <Command>
               <CommandList>
                  <CommandEmpty>No health found.</CommandEmpty>
                  <CommandGroup>
                     {healthOptions.map((entry) => (
                        <CommandItem
                           key={entry.id}
                           value={entry.id}
                           onSelect={() => choose(entry.id)}
                           className="flex items-center justify-between"
                        >
                           <div className="flex items-center gap-2">
                              <HealthIcon healthId={entry.id} />
                              <span>{entry.name}</span>
                           </div>
                           {value === entry.id ? <CheckIcon size={14} className="ml-auto" /> : null}
                        </CommandItem>
                     ))}
                  </CommandGroup>
               </CommandList>
            </Command>
         </PopoverContent>
      </Popover>
   );
}
