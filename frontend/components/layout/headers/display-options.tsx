'use client';

import {
   groupingKeysForMode,
   modeTakesPropertyGrouping,
   ORDERING_KEYS,
   useIssueListView,
} from '@/components/common/issues/use-issue-list-view';
import { useWorkspaceProperties } from '@/components/common/issues/issue-grouping';
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
   DISPLAY_PROPERTIES,
   GroupingKey,
   OrderingKey,
   useDisplaySettingsStore,
} from '@/store/display-settings-store';
import {
   ArrowDownWideNarrow,
   ArrowUpDown,
   ArrowUpNarrowWide,
   SlidersHorizontal,
} from 'lucide-react';
import { useTranslations } from 'next-intl';

/** A control in the popover is at least 44px tall where a finger taps it. */
const touchRow = 'max-lg:min-h-11';

/**
 * The Display popover of a task list.
 *
 * Layout (list / board / table) lives on the page toolbar where it is
 * switched often; this popover is everything else — grouping, ordering,
 * visibility and per-row properties — always shown together.
 */
export function DisplayOptions({ iconOnly = false }: { iconOnly?: boolean }) {
   const t = useTranslations('issueLists.display');
   const view = useIssueListView();
   const properties = useWorkspaceProperties();
   const {
      orderCompletedByRecency,
      completedIssues,
      showSubIssues,
      showEmptyGroups,
      displayProperties,
      setOrderCompletedByRecency,
      setCompletedIssues,
      setShowSubIssues,
      setShowEmptyGroups,
      toggleDisplayProperty,
      resetDisplaySettings,
   } = useDisplaySettingsStore();

   const isDefault =
      view.mode === 'list' &&
      view.grouping === 'status' &&
      view.ordering === 'priority' &&
      view.direction === 'asc' &&
      !orderCompletedByRecency &&
      completedIssues === 'all' &&
      showSubIssues &&
      !showEmptyGroups;

   // The URL carries layout, grouping and ordering per link, so those go
   // back through the view (which clears the URL too); the rest is the store's.
   const reset = () => {
      view.setMode('list');
      view.setGrouping('status');
      view.setOrdering('priority');
      view.setDirection('asc');
      resetDisplaySettings();
   };

   const groupings = groupingKeysForMode(view.mode);
   const takesProperties = modeTakesPropertyGrouping(view.mode);

   // Spelled out rather than built from the key: `t()` is typed against the
   // English catalogue, and a template-literal key is not a key it can check.
   const groupingLabel: Record<string, string> = {
      status: t('status'),
      assignee: t('assignee'),
      priority: t('priority'),
      project: t('project'),
      parent: t('parent'),
      none: t('none'),
   };
   const orderingLabel: Record<OrderingKey, string> = {
      manual: t('manual'),
      status: t('status'),
      priority: t('priority'),
      dueDate: t('dueDate'),
      created: t('created'),
      updated: t('updated'),
      title: t('title'),
   };

   const directionLabel = view.direction === 'asc' ? t('ascending') : t('descending');

   return (
      <Popover>
         <PopoverTrigger asChild>
            <Button
               className="relative border-muted-foreground/15"
               size="xs"
               variant="outline"
               aria-label={iconOnly ? t('label') : undefined}
            >
               <SlidersHorizontal className={cn('size-4', !iconOnly && 'mr-1')} />
               {iconOnly ? null : t('label')}
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
                  {t('grouping')}
               </span>
               <Select
                  value={view.grouping}
                  onValueChange={(value) => view.setGrouping(value as GroupingKey)}
               >
                  <SelectTrigger aria-label={t('grouping')} className="h-7 w-36 max-lg:h-11">
                     <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                     {groupings.map((key) => (
                        <SelectItem key={key} value={key}>
                           {groupingLabel[key] ?? key}
                        </SelectItem>
                     ))}
                     {takesProperties &&
                        properties.map((definition) => (
                           <SelectItem key={definition.id} value={`property:${definition.id}`}>
                              {definition.name}
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
                     {t('ordering')}
                  </span>
                  <div className="flex items-center gap-1">
                     <Select
                        value={view.ordering}
                        onValueChange={(value) => view.setOrdering(value as OrderingKey)}
                     >
                        <SelectTrigger aria-label={t('ordering')} className="h-7 w-28 max-lg:h-11">
                           <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                           {ORDERING_KEYS.map((key) => (
                              <SelectItem key={key} value={key}>
                                 {orderingLabel[key]}
                              </SelectItem>
                           ))}
                        </SelectContent>
                     </Select>
                     <Button
                        size="icon"
                        variant="ghost"
                        className="size-7 max-lg:size-11"
                        aria-label={directionLabel}
                        title={directionLabel}
                        onClick={() => view.setDirection(view.direction === 'asc' ? 'desc' : 'asc')}
                     >
                        {view.direction === 'asc' ? (
                           <ArrowUpNarrowWide className="size-3.5" />
                        ) : (
                           <ArrowDownWideNarrow className="size-3.5" />
                        )}
                     </Button>
                  </div>
               </div>

               <div className={cn('flex items-center justify-between', touchRow)}>
                  <Label
                     htmlFor="order-completed-recency"
                     className="flex-1 font-normal text-muted-foreground max-lg:min-h-11"
                  >
                     {t('orderCompletedByRecency')}
                  </Label>
                  <Switch
                     id="order-completed-recency"
                     checked={orderCompletedByRecency}
                     onCheckedChange={setOrderCompletedByRecency}
                  />
               </div>
            </div>

            {/* What counts as visible */}
            <div className="flex flex-col gap-2.5 border-t px-3 py-3">
               <div className={cn('flex items-center justify-between', touchRow)}>
                  <Label
                     htmlFor="show-completed-tasks"
                     className="flex-1 font-normal text-muted-foreground max-lg:min-h-11"
                  >
                     {t('completedTasks')}
                  </Label>
                  <Switch
                     id="show-completed-tasks"
                     checked={completedIssues === 'all'}
                     onCheckedChange={(checked) => setCompletedIssues(checked ? 'all' : 'none')}
                  />
               </div>

               <div className={cn('flex items-center justify-between', touchRow)}>
                  <Label
                     htmlFor="show-sub-issues"
                     className="flex-1 font-normal text-muted-foreground max-lg:min-h-11"
                  >
                     {t('subIssues')}
                  </Label>
                  <Switch
                     id="show-sub-issues"
                     checked={showSubIssues}
                     onCheckedChange={setShowSubIssues}
                  />
               </div>

               <div className={cn('flex items-center justify-between', touchRow)}>
                  <Label
                     htmlFor="show-empty-groups"
                     className="flex-1 font-normal text-muted-foreground max-lg:min-h-11"
                  >
                     {t('showEmptyGroups')}
                  </Label>
                  <Switch
                     id="show-empty-groups"
                     checked={showEmptyGroups}
                     onCheckedChange={setShowEmptyGroups}
                  />
               </div>
            </div>

            {/* Per-row properties */}
            <div className="flex flex-col gap-2 border-t px-3 py-3">
               <span id="display-card-properties" className="text-muted-foreground">
                  {t('cardProperties')}
               </span>
               <div
                  role="group"
                  aria-labelledby="display-card-properties"
                  className="flex flex-wrap gap-1.5"
               >
                  {DISPLAY_PROPERTIES.map((property) => {
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
                  <Button variant="ghost" size="xs" onClick={reset} className={touchRow}>
                     {t('reset')}
                  </Button>
               </div>
            ) : null}
         </PopoverContent>
      </Popover>
   );
}
