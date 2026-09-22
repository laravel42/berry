'use client';

import { Button } from '@/components/ui/button';
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

function OptionRow({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
   return (
      <div className="flex items-center justify-between gap-3 min-h-8">
         <span>{label}</span>
         {children}
      </div>
   );
}

/** Display popover for the Projects page. */
export function ProjectsDisplayOptions() {
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

   return (
      <Popover>
         <PopoverTrigger asChild>
            <Button size="xs" variant="outline" className="border-muted-foreground/15">
               <SlidersHorizontal className="size-4" />
               Display
            </Button>
         </PopoverTrigger>
         <PopoverContent align="end" className="w-[420px] p-0">
            <div className="p-3 flex flex-col gap-3">
               {/* Grouping / ordering */}
               <div className="flex flex-col gap-1.5">
                  <OptionRow
                     label={
                        <span className="flex items-center gap-2">
                           <ArrowUpDown className="size-4 text-muted-foreground" />
                           Grouping
                        </span>
                     }
                  >
                     <Select
                        value={grouping}
                        onValueChange={(value) => setGrouping(value as ProjectsGrouping)}
                     >
                        <SelectTrigger className="h-8 w-36">
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
                  </OptionRow>
                  <OptionRow
                     label={
                        <span className="flex items-center gap-2">
                           <ArrowUpNarrowWide className="size-4 text-muted-foreground" />
                           Ordering
                        </span>
                     }
                  >
                     <div className="flex items-center gap-1">
                        <Select
                           value={ordering}
                           onValueChange={(value) => setOrdering(value as ProjectsOrdering)}
                        >
                           <SelectTrigger className="h-8 w-36" aria-label="Ordering">
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
                        <Button
                           size="icon"
                           variant="ghost"
                           className="size-8"
                           aria-label={direction === 'asc' ? 'Ascending' : 'Descending'}
                           title={direction === 'asc' ? 'Ascending' : 'Descending'}
                           onClick={() => setDirection(direction === 'asc' ? 'desc' : 'asc')}
                        >
                           {direction === 'asc' ? (
                              <ArrowUpNarrowWide className="size-3.5" />
                           ) : (
                              <ArrowDownWideNarrow className="size-3.5" />
                           )}
                        </Button>
                     </div>
                  </OptionRow>
               </div>

               <div className="border-t -mx-3" />

               <OptionRow label="Show closed projects">
                  <Select
                     value={closedProjects}
                     onValueChange={(value) => setClosedProjects(value as 'all' | 'hide')}
                  >
                     <SelectTrigger className="h-8 w-36">
                        <SelectValue />
                     </SelectTrigger>
                     <SelectContent>
                        <SelectItem value="all">All</SelectItem>
                        <SelectItem value="hide">Hide closed</SelectItem>
                     </SelectContent>
                  </Select>
               </OptionRow>

               <div className="border-t -mx-3" />

               {/* Per-view options */}
               <div className="flex flex-col gap-1.5">
                  <span className="font-medium">
                     {viewType === 'board' ? 'Board options' : 'List options'}
                  </span>
                  <OptionRow
                     label={viewType === 'board' ? 'Show empty columns' : 'Show empty groups'}
                  >
                     <Switch checked={showEmptyGroups} onCheckedChange={setShowEmptyGroups} />
                  </OptionRow>
               </div>

               {/* Display properties */}
               <div className="flex flex-col gap-2">
                  <span className="text-muted-foreground">Display properties</span>
                  <div className="flex flex-wrap gap-1.5">
                     {PROJECT_DISPLAY_PROPERTIES.map((property) => {
                        const enabled = displayProperties[property.key];
                        return (
                           <button
                              key={property.key}
                              type="button"
                              onClick={() => toggleDisplayProperty(property.key)}
                              className={cn(
                                 'px-2.5 h-7 rounded-full border transition-colors',
                                 enabled
                                    ? 'bg-accent text-foreground border-border'
                                    : 'border-border/60 text-muted-foreground hover:text-foreground'
                              )}
                           >
                              {property.label}
                           </button>
                        );
                     })}
                  </div>
               </div>
            </div>

            <div className="border-t px-3 py-2.5 flex items-center justify-between">
               <button
                  type="button"
                  onClick={resetDisplaySettings}
                  className="text-muted-foreground hover:text-foreground transition-colors"
               >
                  Reset
               </button>
               <button type="button" className="text-status-info hover:underline">
                  Set default for everyone
               </button>
            </div>
         </PopoverContent>
      </Popover>
   );
}
