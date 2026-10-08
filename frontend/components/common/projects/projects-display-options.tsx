'use client';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
   Select,
   SelectContent,
   SelectItem,
   SelectTrigger,
   SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import {
   PROJECT_DISPLAY_PROPERTIES,
   ProjectsGrouping,
   ProjectsOrdering,
   useProjectsDisplayStore,
} from '@/store/projects-display-store';
import {
   ArrowDownWideNarrow,
   ArrowUpDown,
   ArrowUpNarrowWide,
   SlidersHorizontal,
} from 'lucide-react';

const GROUPINGS: { value: ProjectsGrouping; label: string }[] = [
   { value: 'status', label: 'Status' },
   { value: 'priority', label: 'Priority' },
   { value: 'lead', label: 'Lead' },
   { value: 'health', label: 'Health' },
   { value: 'none', label: 'No grouping' },
];

const ORDERINGS: { value: ProjectsOrdering; label: string }[] = [
   { value: 'title', label: 'Title' },
   { value: 'start-date', label: 'Start date' },
   { value: 'target-date', label: 'Target date' },
   { value: 'status', label: 'Status' },
   { value: 'priority', label: 'Priority' },
   { value: 'created', label: 'Created' },
   { value: 'updated', label: 'Updated' },
];

/** A control in the popover is at least 44px tall where a finger taps it. */
const touchRow = 'max-lg:min-h-11';

/** Display popover for the Projects page, laid out as a task list's. */
export function ProjectsDisplayOptions({ iconOnly = false }: { iconOnly?: boolean }) {
   const {
      viewType,
      grouping,
      ordering,
      direction,
      closedProjects,
      showEmptyGroups,
      displayProperties,
      setGrouping,
      setOrdering,
      setDirection,
      setClosedProjects,
      setShowEmptyGroups,
      toggleDisplayProperty,
      resetDisplaySettings,
   } = useProjectsDisplayStore();

   const isDefault =
      viewType === 'list' &&
      grouping === 'status' &&
      ordering === 'title' &&
      direction === 'asc' &&
      closedProjects === 'all' &&
      !showEmptyGroups;

   const directionLabel = direction === 'asc' ? 'Ascending' : 'Descending';

   return (
      <Popover>
         <PopoverTrigger asChild>
            <Button
               size="xs"
               variant="outline"
               className="relative border-muted-foreground/15"
               aria-label={iconOnly ? 'Display' : undefined}
               title={iconOnly ? 'Display' : undefined}
            >
               <SlidersHorizontal className={cn('size-4', !iconOnly && 'mr-1')} />
               {iconOnly ? null : 'Display'}
               {!isDefault && (
                  <span
                     aria-hidden="true"
                     className="absolute right-0 top-0 size-2 rounded-full bg-status-warning"
                  />
               )}
            </Button>
         </PopoverTrigger>
         <PopoverContent className="w-80 p-0" align="end">
            <div className={cn('flex items-center justify-between gap-2 px-3 pt-3 pb-3', touchRow)}>
               <span className="flex items-center gap-1.5 text-muted-foreground">
                  <ArrowUpDown className="size-3.5" aria-hidden="true" />
                  Grouping
               </span>
               <Select
                  value={grouping}
                  onValueChange={(value) => setGrouping(value as ProjectsGrouping)}
               >
                  <SelectTrigger aria-label="Grouping" className="h-7 w-36 max-lg:h-11">
                     <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                     {GROUPINGS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                           {option.label}
                        </SelectItem>
                     ))}
                  </SelectContent>
               </Select>
            </div>

            {/* Ordering */}
            <div className="flex flex-col gap-2.5 border-t px-3 py-3">
               <div className={cn('flex items-center justify-between gap-2', touchRow)}>
                  <span className="flex items-center gap-1.5 text-muted-foreground">
                     <ArrowUpNarrowWide className="size-3.5" aria-hidden="true" />
                     Ordering
                  </span>
                  <div className="flex items-center gap-1">
                     <Button
                        size="icon"
                        variant="ghost"
                        className="size-7 max-lg:size-11"
                        aria-label={directionLabel}
                        title={directionLabel}
                        onClick={() => setDirection(direction === 'asc' ? 'desc' : 'asc')}
                     >
                        {direction === 'asc' ? (
                           <ArrowUpNarrowWide className="size-3.5" />
                        ) : (
                           <ArrowDownWideNarrow className="size-3.5" />
                        )}
                     </Button>
                     <Select
                        value={ordering}
                        onValueChange={(value) => setOrdering(value as ProjectsOrdering)}
                     >
                        <SelectTrigger aria-label="Ordering" className="h-7 w-28 max-lg:h-11">
                           <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                           {ORDERINGS.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                 {option.label}
                              </SelectItem>
                           ))}
                        </SelectContent>
                     </Select>
                  </div>
               </div>
            </div>

            {/* What counts as visible */}
            <div className="flex flex-col gap-2.5 border-t px-3 py-3">
               <div className={cn('flex items-center justify-between', touchRow)}>
                  <Label
                     htmlFor="show-closed-projects"
                     className="flex-1 font-normal text-muted-foreground max-lg:min-h-11"
                  >
                     Show closed projects
                  </Label>
                  <Switch
                     id="show-closed-projects"
                     checked={closedProjects === 'all'}
                     onCheckedChange={(checked) => setClosedProjects(checked ? 'all' : 'hide')}
                  />
               </div>

               <div className={cn('flex items-center justify-between', touchRow)}>
                  <Label
                     htmlFor="show-empty-project-groups"
                     className="flex-1 font-normal text-muted-foreground max-lg:min-h-11"
                  >
                     {viewType === 'board' ? 'Show empty columns' : 'Show empty groups'}
                  </Label>
                  <Switch
                     id="show-empty-project-groups"
                     checked={showEmptyGroups}
                     onCheckedChange={setShowEmptyGroups}
                  />
               </div>
            </div>

            {/* Per-row properties */}
            <div className="flex flex-col gap-2 border-t px-3 py-3">
               <span id="display-project-properties" className="text-muted-foreground">
                  Display properties
               </span>
               <div
                  role="group"
                  aria-labelledby="display-project-properties"
                  className="flex flex-wrap gap-1.5"
               >
                  {PROJECT_DISPLAY_PROPERTIES.map((property) => {
                     const on = displayProperties[property.key];
                     return (
                        <button
                           key={property.key}
                           type="button"
                           aria-pressed={on}
                           onClick={() => toggleDisplayProperty(property.key)}
                           className={cn(
                              'h-6 rounded-md border px-2 transition-colors max-lg:min-h-11',
                              'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ring',
                              on
                                 ? 'border-border bg-accent text-foreground'
                                 : 'border-transparent bg-accent/40 text-muted-foreground hover:text-foreground'
                           )}
                        >
                           {property.label}
                        </button>
                     );
                  })}
               </div>
            </div>

            {!isDefault ? (
               <div className="flex justify-end border-t px-2 py-1.5">
                  <Button
                     variant="ghost"
                     size="xs"
                     onClick={resetDisplaySettings}
                     className={touchRow}
                  >
                     Reset
                  </Button>
               </div>
            ) : null}
         </PopoverContent>
      </Popover>
   );
}
