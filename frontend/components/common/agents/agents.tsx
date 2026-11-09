'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import {
   AlertDialog,
   AlertDialogAction,
   AlertDialogCancel,
   AlertDialogContent,
   AlertDialogDescription,
   AlertDialogFooter,
   AlertDialogHeader,
   AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Command, CommandGroup, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
   EmptyState,
   EmptyStateLoading,
   EmptyStateMark,
   EmptyStateText,
   EmptyStateTitle,
} from '@/components/common/empty-state';
import { BerryApiError } from '@/lib/api';
import {
   archiveAgent,
   cancelAgentTasks,
   getAgentAccess,
   loadAgentRoster,
   loadArchivedAgents,
   loadWorkspaceAgents,
   restoreAgent,
   gatewayPin,
   isOrchestrator,
   setAgentAccess,
   updateAgentConfig,
   type Agent,
   type Tier,
} from '@/lib/agents';
import { bindAgentRuntime, listRuntimes, unbindAgentRuntime, type Runtime } from '@/lib/runtimes';
import { cn } from '@/lib/utils';
import {
   useAgentsListStore,
   type AgentColumn,
   type AgentsSortKey,
} from '@/store/agents-list-store';
import { useAgentsStore } from '@/store/agents-store';
import {
   applyListFilters,
   ListFilterBar,
   useListFilters,
} from '@/components/common/filters/list-filters';
import { useAgentFilterColumns } from './agent-filter-columns';
import AgentLine, { COLUMN_BREAKPOINT, COLUMN_WIDTH } from './agent-line';
import { roleDefaultTier, TIER_ORDER } from './agent-tier-section';
import { TierChip } from './tier-chip';

/** Which column heading sorts by what; the rest are labels only. */
const SORT_FOR_COLUMN: Partial<Record<AgentColumn, AgentsSortKey>> = {
   lastActive: 'activity',
};

interface Confirm {
   kind: 'cancel-runs' | 'archive';
   agent: Agent;
   running: number;
   queued: number;
}

interface BulkReport {
   done: number;
   total: number;
   failures: string[];
}

const reason = (error: unknown, fallback: string) =>
   error instanceof BerryApiError ? error.message : fallback;

/**
 * The agents table.
 *
 * Three lists are in play and only one is on screen: the live roster (held in
 * the agents store, shared with every other agent surface), the archive (read
 * on demand) and the per-agent facts the rows draw. Scope, filters and
 * sort and search are the toolbar's, read from the list store.
 */
export default function Agents() {
   const t = useTranslations('agentsChat.list');
   const common = useTranslations('agentsChat.common');
   const detail = useTranslations('agentsChat.detail');
   const tiers = useTranslations('agentsChat.detail.tiers');
   const { orgId } = useParams<{ orgId: string }>();
   const router = useRouter();

   const agents = useAgentsStore((state) => state.agents);
   const archived = useAgentsStore((state) => state.archived);
   const roster = useAgentsStore((state) => state.roster);
   const storedError = useAgentsStore((state) => state.error);
   const agentsReady = useAgentsStore((state) => state.ready);
   const hydrateAgents = useAgentsStore((state) => state.hydrateAgents);
   const hydrateArchived = useAgentsStore((state) => state.hydrateArchived);
   const hydrateRoster = useAgentsStore((state) => state.hydrateRoster);
   const upsertAgent = useAgentsStore((state) => state.upsertAgent);
   const removeAgent = useAgentsStore((state) => state.removeAgent);

   const { scope, sortKey, sortDescending, filters, query, columns, selected } =
      useAgentsListStore();
   const sortBy = useAgentsListStore((state) => state.sortBy);
   const toggleSelected = useAgentsListStore((state) => state.toggleSelected);
   const setSelected = useAgentsListStore((state) => state.setSelected);
   const clearSelection = useAgentsListStore((state) => state.clearSelection);
   const setFilters = useAgentsListStore((state) => state.setFilters);
   const filterColumns = useAgentFilterColumns();
   // The Orchestrator works behind the scenes: it routes work and is never
   // assigned or edited from here, so the list leaves it out.
   const source = useMemo(
      () =>
         (scope === 'archived' ? (archived ?? []) : agents).filter(
            (agent) => !isOrchestrator(agent)
         ),
      [scope, archived, agents]
   );
   const filter = useListFilters({
      data: source,
      columns: filterColumns,
      filters,
      onFiltersChange: setFilters,
   });

   const [loading, setLoading] = useState(!agentsReady);
   const [confirm, setConfirm] = useState<Confirm | null>(null);
   const [bulkAccessOpen, setBulkAccessOpen] = useState(false);
   const [bulkRuntimeOpen, setBulkRuntimeOpen] = useState(false);
   const [bulkTierOpen, setBulkTierOpen] = useState(false);
   const [bulkReport, setBulkReport] = useState<BulkReport | null>(null);
   const [busy, setBusy] = useState(false);
   const [runtimes, setRuntimes] = useState<Runtime[]>([]);

   const load = useCallback(
      async (silent = false) => {
         if (!silent) setLoading(true);
         try {
            const [live, entries] = await Promise.all([
               loadWorkspaceAgents(),
               // Best effort: an agent list without its roster still lists agents,
               // and the cells that need the roster simply stay empty.
               loadAgentRoster(7).catch(() => new Map()),
            ]);
            hydrateAgents(live, null);
            hydrateRoster(entries);
         } catch (error) {
            hydrateAgents([], reason(error, t('errorTitle')));
         } finally {
            setLoading(false);
         }
      },
      [hydrateAgents, hydrateRoster, t]
   );

   useEffect(() => {
      void load(useAgentsStore.getState().ready);
   }, [load]);

   useEffect(() => {
      void listRuntimes().then(setRuntimes, () => setRuntimes([]));
   }, []);

   // The archive is read up front so the Archived tab can show a count, and
   // re-read whenever something in it changes (callers clear it to null).
   const loadArchive = useCallback(async () => {
      try {
         hydrateArchived(await loadArchivedAgents());
      } catch (error) {
         toast.error(reason(error, t('errorTitle')));
      }
   }, [hydrateArchived, t]);

   useEffect(() => {
      if (archived !== null) return;
      void loadArchive();
   }, [archived, loadArchive]);

   const rows = useMemo(() => {
      const term = query.trim().toLowerCase();
      const matched = applyListFilters(source, filterColumns, filters).filter((agent) => {
         if (!term) return true;
         if (agent.name.toLowerCase().includes(term)) return true;
         return (agent.description ?? '').toLowerCase().includes(term);
      });

      const direction = sortDescending ? -1 : 1;
      return matched.slice().sort((left, right) => {
         if (sortKey === 'name') return direction * left.name.localeCompare(right.name);
         if (sortKey === 'created')
            return direction * left.createdAt.localeCompare(right.createdAt);
         if (sortKey === 'runs') {
            return (
               direction *
               ((roster.get(left.id)?.totalRuns ?? 0) - (roster.get(right.id)?.totalRuns ?? 0))
            );
         }
         // Recent activity. Agents that have never run read "Never" and go
         // after those that have, by name: in a new workspace that is every
         // agent, and an order by when each row last changed looked random.
         const leftAt = roster.get(left.id)?.lastActiveAt ?? null;
         const rightAt = roster.get(right.id)?.lastActiveAt ?? null;
         if (leftAt && rightAt) return direction * leftAt.localeCompare(rightAt);
         if (leftAt) return -1;
         if (rightAt) return 1;
         return left.name.localeCompare(right.name);
      });
   }, [source, filterColumns, roster, filters, query, sortKey, sortDescending]);

   const selectedRows = rows.filter((agent) => selected.includes(agent.id));
   const allSelected = rows.length > 0 && selectedRows.length === rows.length;

   const runConfirm = async () => {
      if (!confirm) return;
      setBusy(true);
      try {
         if (confirm.kind === 'cancel-runs') {
            const cancelled = await cancelAgentTasks(confirm.agent.id);
            toast.success(t('cancelRunsDone', { count: cancelled }));
            hydrateRoster(await loadAgentRoster(7).catch(() => roster));
         } else {
            await archiveAgent(confirm.agent.id);
            removeAgent(confirm.agent.id);
            hydrateArchived(null);
            toast.success(t('archiveDone', { name: confirm.agent.name }));
         }
         setConfirm(null);
      } catch (error) {
         toast.error(reason(error, t('errorTitle')));
      } finally {
         setBusy(false);
      }
   };

   const restore = async (agent: Agent) => {
      try {
         const restored = await restoreAgent(agent.id);
         upsertAgent(restored);
         hydrateArchived(null);
         await load();
         toast.success(t('restoreDone', { name: agent.name }));
      } catch (error) {
         toast.error(reason(error, t('errorTitle')));
      }
   };

   /** Applies one change across the selection and reports what did not take. */
   const bulk = async (label: string, apply: (agent: Agent) => Promise<void>) => {
      setBusy(true);
      const failures: string[] = [];
      let done = 0;
      for (const agent of selectedRows) {
         try {
            await apply(agent);
            done += 1;
         } catch (error) {
            failures.push(`${agent.name}: ${reason(error, label)}`);
         }
      }
      setBulkReport({ done, total: selectedRows.length, failures });
      setBusy(false);
      clearSelection();
      hydrateArchived(null);
      await load();
   };

   /**
    * Puts the selection on one tier. A tier that is the agent's role default
    * is stored as none, as on the agent's page, and a pinned model is cleared:
    * it would otherwise override the tier.
    */
   const bulkTier = (next: Tier) => {
      setBulkTierOpen(false);
      void bulk(t('errorTitle'), async (agent) => {
         const config: Parameters<typeof updateAgentConfig>[1] = {
            tier: next === roleDefaultTier(agent) ? null : next,
         };
         if (gatewayPin(agent)) {
            config.provider = null;
            config.model = null;
         }
         upsertAgent(await updateAgentConfig(agent.id, config));
      });
   };

   const bulkAccess = (next: 'everyone' | 'admins') => {
      setBulkAccessOpen(false);
      void bulk(t('errorTitle'), async (agent) => {
         // The member list is the agent's own and is left alone; only the
         // scope is being set here.
         const current = await getAgentAccess(agent.id);
         await setAgentAccess(agent.id, {
            ...current,
            assign: next,
            mention: next,
         });
      });
   };

   /**
    * Puts the selection on one runtime, or clears the binding so each agent
    * falls back to the workspace default (or has nowhere to run).
    */
   const bulkRuntime = (next: string | null) => {
      setBulkRuntimeOpen(false);
      void bulk(t('errorTitle'), async (agent) => {
         const previous = roster.get(agent.id)?.runtimeId ?? null;
         if (next === previous) return;
         if (next === null) {
            if (previous) await unbindAgentRuntime(previous, agent.id);
         } else {
            await bindAgentRuntime(next, agent.id);
         }
      });
   };

   const header = (column: AgentColumn, label: string, align?: string, hint?: string) => {
      if (!columns.includes(column)) return null;
      const key = SORT_FOR_COLUMN[column];
      const classes = cn(
         'shrink-0 items-center gap-1',
         COLUMN_WIDTH[column],
         COLUMN_BREAKPOINT[column] ?? 'flex',
         align
      );
      if (!key) {
         return (
            <div className={cn(classes, 'uppercase')} title={hint}>
               {label}
            </div>
         );
      }
      return (
         <div className={classes}>
            <button
               type="button"
               onClick={() => sortBy(key)}
               aria-label={label}
               className={cn(
                  'truncate uppercase hover:text-foreground',
                  sortKey === key && 'text-foreground'
               )}
            >
               {label}
               {sortKey === key ? <span aria-hidden>{sortDescending ? ' ↓' : ' ↑'}</span> : null}
            </button>
         </div>
      );
   };

   return (
      <div className="flex h-full min-h-0 w-full flex-col">
         <div className="w-full shrink-0">
            <ListFilterBar filter={filter} />
         </div>
         <div className="min-h-0 w-full flex-1 overflow-y-auto">
            {loading ? (
               <EmptyStateLoading label={common('loading')} />
            ) : storedError ? (
               <div className="flex flex-col items-start gap-3 px-6 py-10">
                  <p className="text-muted-foreground">{storedError}</p>
                  <Button size="xs" variant="secondary" onClick={() => void load()}>
                     {common('retry')}
                  </Button>
               </div>
            ) : rows.length === 0 ? (
               <EmptyState
                  icon={
                     <EmptyStateMark
                        label={
                           filter.filters.length > 0 || query.trim() !== ''
                              ? t('noMatch')
                              : scope === 'archived'
                                ? t('emptyArchived')
                                : t('empty')
                        }
                     />
                  }
               >
                  {filter.filters.length > 0 || query.trim() !== '' ? (
                     <EmptyStateText>{t('noMatch')}</EmptyStateText>
                  ) : scope === 'archived' ? (
                     <EmptyStateText>{t('emptyArchived')}</EmptyStateText>
                  ) : (
                     <>
                        <EmptyStateTitle>{t('empty')}</EmptyStateTitle>
                        <EmptyStateText>{t('emptyHint')}</EmptyStateText>
                     </>
                  )}
               </EmptyState>
            ) : (
               <>
                  <div
                     data-heading="label"
                     className="sticky top-0 z-10 flex h-9 w-full items-center gap-3 border-b bg-container px-6 text-subtle-foreground"
                  >
                     <Checkbox
                        checked={allSelected}
                        onCheckedChange={() =>
                           setSelected(allSelected ? [] : rows.map((agent) => agent.id))
                        }
                        aria-label={t('selectAll')}
                        className="shrink-0"
                     />
                     <button
                        type="button"
                        onClick={() => sortBy('name')}
                        className={cn(
                           'min-w-0 flex-1 text-left uppercase hover:text-foreground',
                           sortKey === 'name' && 'text-foreground'
                        )}
                     >
                        {t('colAgent')}
                        {sortKey === 'name' ? (
                           <span aria-hidden>{sortDescending ? ' ↓' : ' ↑'}</span>
                        ) : null}
                     </button>
                     {header('activity', t('colActivity'))}
                     {header('lastActive', t('colLastActive'))}
                     {header('access', t('colAccess'), 'justify-end')}
                  </div>

                  {bulkReport ? (
                     <div className="border-b bg-sidebar/20 px-6 py-2" role="status">
                        <div className="flex items-center gap-3">
                           <span>
                              {t('bulkDone', { done: bulkReport.done, total: bulkReport.total })}
                           </span>
                           <Button size="xs" variant="ghost" onClick={() => setBulkReport(null)}>
                              {common('close')}
                           </Button>
                        </div>
                        {bulkReport.failures.length > 0 ? (
                           <ul className="mt-1 text-muted-foreground">
                              <li>{t('bulkFailed', { count: bulkReport.failures.length })}</li>
                              {bulkReport.failures.map((failure) => (
                                 <li key={failure}>{failure}</li>
                              ))}
                           </ul>
                        ) : null}
                     </div>
                  ) : null}

                  {rows.map((agent) => (
                     <AgentLine
                        key={agent.id}
                        agent={agent}
                        roster={roster.get(agent.id)}
                        columns={columns}
                        selected={selected.includes(agent.id)}
                        onToggleSelected={toggleSelected}
                        actions={{
                           onDuplicate: (target) =>
                              router.push(`/${orgId}/agents/new?duplicate=${target.id}`),
                           onCancelRuns: (target) => {
                              const entry = roster.get(target.id);
                              const running = entry?.running ?? 0;
                              const queued = entry?.queued ?? 0;
                              if (running + queued === 0) {
                                 toast.info(t('cancelRunsNone'));
                                 return;
                              }
                              setConfirm({ kind: 'cancel-runs', agent: target, running, queued });
                           },
                           onArchive: (target) =>
                              setConfirm({ kind: 'archive', agent: target, running: 0, queued: 0 }),
                           onRestore: (target) => void restore(target),
                        }}
                     />
                  ))}
               </>
            )}
         </div>

         {selectedRows.length > 0 ? (
            <div className="sticky bottom-0 z-20 flex flex-wrap items-center gap-3 border-t bg-container px-6 py-2">
               <span className="font-bold">
                  {t('bulkSelected', { count: selectedRows.length })}
               </span>
               {scope === 'archived' ? (
                  <Button
                     size="sm"
                     variant="secondary"
                     disabled={busy}
                     onClick={() =>
                        void bulk(t('errorTitle'), async (agent) => {
                           await restoreAgent(agent.id);
                        })
                     }
                  >
                     {t('bulkRestore')}
                  </Button>
               ) : (
                  <>
                     <Popover open={bulkTierOpen} onOpenChange={setBulkTierOpen}>
                        <PopoverTrigger asChild>
                           <Button size="sm" variant="secondary" disabled={busy}>
                              {t('bulkTier')}
                           </Button>
                        </PopoverTrigger>
                        <PopoverContent align="start" side="top" className="w-80 p-0">
                           <Command>
                              <CommandList>
                                 <CommandGroup>
                                    {TIER_ORDER.map((name) => (
                                       <CommandItem
                                          key={name}
                                          disabled={busy}
                                          onSelect={() => bulkTier(name)}
                                          className="items-start gap-3"
                                       >
                                          <span className="w-24 shrink-0">
                                             <TierChip tier={name} className="px-2 py-1" />
                                          </span>
                                          <span className="text-muted-foreground">
                                             {tiers(`outcome.${name}`)}
                                          </span>
                                       </CommandItem>
                                    ))}
                                 </CommandGroup>
                              </CommandList>
                           </Command>
                        </PopoverContent>
                     </Popover>
                     <Popover open={bulkAccessOpen} onOpenChange={setBulkAccessOpen}>
                        <PopoverTrigger asChild>
                           <Button size="sm" variant="secondary" disabled={busy}>
                              {t('bulkAccess')}
                           </Button>
                        </PopoverTrigger>
                        <PopoverContent align="start" side="top" className="w-72 p-0">
                           <Command>
                              <CommandList>
                                 <CommandGroup>
                                    {(['everyone', 'admins'] as const).map((next) => (
                                       <CommandItem
                                          key={next}
                                          disabled={busy}
                                          onSelect={() => bulkAccess(next)}
                                       >
                                          {next === 'everyone'
                                             ? t('accessEveryone')
                                             : t('accessAdmins')}
                                       </CommandItem>
                                    ))}
                                 </CommandGroup>
                              </CommandList>
                           </Command>
                        </PopoverContent>
                     </Popover>
                     <Popover open={bulkRuntimeOpen} onOpenChange={setBulkRuntimeOpen}>
                        <PopoverTrigger asChild>
                           <Button size="sm" variant="secondary" disabled={busy}>
                              {t('bulkRuntime')}
                           </Button>
                        </PopoverTrigger>
                        <PopoverContent align="start" side="top" className="w-72 p-0">
                           <Command>
                              <CommandList>
                                 <CommandGroup>
                                    <CommandItem disabled={busy} onSelect={() => bulkRuntime(null)}>
                                       {detail('setRuntimeNone')}
                                    </CommandItem>
                                    {runtimes.map((runtime) => (
                                       <CommandItem
                                          key={runtime.id}
                                          disabled={busy}
                                          onSelect={() => bulkRuntime(runtime.id)}
                                       >
                                          {runtime.status === 'active'
                                             ? runtime.name
                                             : `${runtime.name} · ${t('runtimeUnreachable')}`}
                                       </CommandItem>
                                    ))}
                                 </CommandGroup>
                              </CommandList>
                           </Command>
                        </PopoverContent>
                     </Popover>
                     <Button
                        size="sm"
                        variant="destructive"
                        disabled={busy}
                        onClick={() =>
                           void bulk(t('errorTitle'), async (agent) => {
                              await archiveAgent(agent.id);
                           })
                        }
                     >
                        {t('bulkArchive')}
                     </Button>
                  </>
               )}
               <Button
                  size="sm"
                  variant="ghost"
                  className="font-bold underline underline-offset-2"
                  onClick={() => clearSelection()}
               >
                  {t('bulkClear')}
               </Button>
            </div>
         ) : null}

         <AlertDialog
            open={confirm !== null}
            onOpenChange={(open) => (open ? null : setConfirm(null))}
         >
            <AlertDialogContent>
               <AlertDialogHeader>
                  <AlertDialogTitle>
                     {confirm?.kind === 'archive'
                        ? t('archiveTitle', { name: confirm.agent.name })
                        : t('cancelRunsTitle', { name: confirm?.agent.name ?? '' })}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                     {confirm?.kind === 'archive'
                        ? t('archiveBody')
                        : t('cancelRunsBody', {
                             running: confirm?.running ?? 0,
                             queued: confirm?.queued ?? 0,
                          })}
                  </AlertDialogDescription>
               </AlertDialogHeader>
               <AlertDialogFooter>
                  <AlertDialogCancel disabled={busy}>{common('cancel')}</AlertDialogCancel>
                  <AlertDialogAction
                     disabled={busy}
                     onClick={(event) => {
                        // Kept open until the request settles: a dialog that
                        // closes on click reports success before there is any.
                        event.preventDefault();
                        void runConfirm();
                     }}
                  >
                     {confirm?.kind === 'archive' ? t('archiveAction') : t('cancelRunsAction')}
                  </AlertDialogAction>
               </AlertDialogFooter>
            </AlertDialogContent>
         </AlertDialog>
      </div>
   );
}
