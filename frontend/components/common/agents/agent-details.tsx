'use client';

import Link from 'next/link';
import { useAgentCoverage } from '@/hooks/use-agent-coverage';
import { agentHasRuntime } from '@/lib/runtimes';
import { useParams, usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';

import { BerryMark } from '@/components/brand/berry-mark';
import { EmptyStateLoading } from '@/components/common/empty-state';
import { colorForAgent } from '@/lib/agent-color';
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
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BerryApiError } from '@/lib/api';
import {
   getWorkspaceAgent,
   listAgentTasks,
   loadAgentRoster,
   useAgentAvatarSrc,
   type Agent,
   type AgentRoster,
   type AgentTask,
} from '@/lib/agents';
import { useAgentsStore } from '@/store/agents-store';
import AgentCapabilitiesTab from './agent-capabilities-tab';
import AgentExecutionSettings from './agent-execution-settings';
import { AgentModelChip } from './agent-model-chip';
import AgentOverviewTab from './agent-overview-tab';
import { AgentRoleTab } from './agent-role-tab';
import AgentSettingsTab from './agent-settings-tab';
import { AgentWorkloadChip } from './agent-workload-chip';

const TABS = ['settings', 'instructions', 'role', 'skills', 'mcp', 'overview'] as const;
type DetailTab = (typeof TABS)[number];

const isTab = (value: string | null): value is DetailTab =>
   value !== null && (TABS as readonly string[]).includes(value);

/**
 * One agent, across overview (stats, assignments, runs), its role and
 * permissions, capabilities (skills), MCP servers and settings (name,
 * description, model or tier, runtime, concurrency and access).
 *
 * Every tab's changes are a draft until Save on its unsaved bar.
 *
 * The open tab lives in the URL rather than in state, so a tab can be linked,
 * reopened and navigated back to.
 */
export default function AgentDetails({ agentId }: { agentId: string }) {
   const { orgId } = useParams<{ orgId: string }>();
   const router = useRouter();
   const pathname = usePathname();
   const searchParams = useSearchParams();
   const t = useTranslations('agentsChat.detail');
   const coverage = useAgentCoverage();
   const admin = useTranslations('workspaceAdmin.agents');

   const storedAgent = useAgentsStore((state) => state.getAgentById(agentId));
   const upsertAgent = useAgentsStore((state) => state.upsertAgent);

   const [agent, setAgent] = useState<Agent | null>(storedAgent ?? null);
   const [status, setStatus] = useState<'loading' | 'ready' | 'missing' | 'forbidden'>(
      storedAgent ? 'ready' : 'loading'
   );
   const [roster, setRoster] = useState<AgentRoster | undefined>(undefined);
   const [tasks, setTasks] = useState<AgentTask[] | null>(null);
   const [cursor, setCursor] = useState<string | null>(null);
   const [loadingMore, setLoadingMore] = useState(false);
   const [readOnly, setReadOnly] = useState(false);
   const [dirty, setDirty] = useState(false);
   // The Settings tab holds two editors, each with its own draft.
   const [runtimeDirty, setRuntimeDirty] = useState(false);
   const [pendingTab, setPendingTab] = useState<DetailTab | null>(null);
   const unsaved = dirty || runtimeDirty;

   // Unknown or retired tab names (activity, work) open General.
   // `capabilities` is the Instructions tab's old name; links to it still land.
   const requestedView =
      searchParams?.get('view') === 'capabilities'
         ? 'instructions'
         : (searchParams?.get('view') ?? null);
   const view: DetailTab = isTab(requestedView) ? requestedView : 'settings';

   const avatarSrc = useAgentAvatarSrc(agent?.avatarUrl);

   const loadAgent = useCallback(async () => {
      try {
         const loaded = await getWorkspaceAgent(agentId);
         setAgent(loaded);
         upsertAgent(loaded);
         setStatus('ready');
      } catch (error) {
         if (error instanceof BerryApiError && error.status === 403) {
            setStatus('forbidden');
            return;
         }
         setStatus('missing');
      }
   }, [agentId, upsertAgent]);

   const loadRoster = useCallback(async () => {
      // Thirty days, because the overview's stat tiles are a month; the
      // sparkline takes the last seven points of the same series.
      const entries = await loadAgentRoster(30).catch(() => null);
      if (entries) setRoster(entries.get(agentId));
   }, [agentId]);

   const loadTasks = useCallback(async () => {
      try {
         const page = await listAgentTasks(agentId);
         setTasks(page.nodes);
         setCursor(page.pageInfo.hasNextPage ? (page.pageInfo.endCursor ?? null) : null);
      } catch {
         setTasks([]);
         setCursor(null);
      }
   }, [agentId]);

   useEffect(() => {
      void loadAgent();
      void loadRoster();
      void loadTasks();
   }, [loadAgent, loadRoster, loadTasks]);

   // A half-written instruction is the one thing on this page that a stray
   // click can destroy, so the browser is asked to confirm as well.
   useEffect(() => {
      if (!unsaved) return;
      const warn = (event: BeforeUnloadEvent) => event.preventDefault();
      window.addEventListener('beforeunload', warn);
      return () => window.removeEventListener('beforeunload', warn);
   }, [unsaved]);

   const openTab = useCallback(
      (next: DetailTab) => {
         const params = new URLSearchParams(searchParams?.toString() ?? '');
         params.set('view', next);
         router.replace(`${pathname}?${params.toString()}`, { scroll: false });
      },
      [pathname, router, searchParams]
   );

   const requestTab = (next: DetailTab) => {
      if (unsaved && next !== view) {
         setPendingTab(next);
         return;
      }
      openTab(next);
   };

   const onChanged = (next: Agent) => {
      setAgent(next);
      upsertAgent(next);
   };

   const loadMore = async () => {
      if (!cursor) return;
      setLoadingMore(true);
      try {
         const page = await listAgentTasks(agentId, cursor);
         setTasks((current) => [...(current ?? []), ...page.nodes]);
         setCursor(page.pageInfo.hasNextPage ? (page.pageInfo.endCursor ?? null) : null);
      } finally {
         setLoadingMore(false);
      }
   };

   if (status === 'loading') {
      return <EmptyStateLoading label={t('loading')} />;
   }

   if (status !== 'ready' || !agent) {
      return (
         <div className="flex flex-col items-start gap-3 px-8 py-16">
            <p className="text-muted-foreground">
               {status === 'forbidden' ? t('forbidden') : t('notFound')}
            </p>
            <Link href={`/${orgId}/agents`} className="underline-offset-2 hover:underline">
               {t('notFoundBack')}
            </Link>
         </div>
      );
   }

   // Workload from the roster: runs in flight, queued, or idle. The stored
   // agent.status (Online/Busy/Offline) is not shown here.
   const archived = Boolean(agent.archivedAt);
   const locked = readOnly || archived;
   const needsRuntime = roster !== undefined && !agentHasRuntime(coverage, agentId) && !archived;

   const tabLabel: Record<DetailTab, string> = {
      settings: t('tabGeneral'),
      instructions: t('capInstructions'),
      role: admin('rolePermissions'),
      skills: t('capSkills'),
      mcp: t('capMcpAgent'),
      overview: t('tabUsage'),
   };

   return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
         <div className="border-b px-8 pb-3 pt-6">
            <div className="flex min-w-0 gap-4">
               <span className="flex size-14 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted/40">
                  {avatarSrc ? (
                     // eslint-disable-next-line @next/next/no-img-element -- a blob or external URL, not an optimisable asset
                     <img src={avatarSrc} alt="" className="size-full object-cover" />
                  ) : (
                     <BerryMark
                        size="lg"
                        tone="working"
                        dotColor={colorForAgent(agent.id)}
                        label={agent.name}
                     />
                  )}
               </span>
               <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                     <h1 className="leading-none">{agent.name}</h1>
                     <AgentWorkloadChip roster={roster} />
                     <AgentModelChip agent={agent} />
                  </div>
                  {agent.description ? (
                     <p className="mt-2 max-w-3xl text-muted-foreground">{agent.description}</p>
                  ) : null}
               </div>
            </div>

            <div className="mt-4 flex flex-col gap-2">
               {readOnly ? (
                  <p className="rounded-md border border-border/70 px-3 py-2 text-muted-foreground">
                     {t('bannerReadOnly')}
                  </p>
               ) : null}
               {archived ? (
                  <p className="flex flex-wrap items-center gap-2 rounded-md border border-border/70 bg-muted/30 px-3 py-2">
                     {t('bannerArchived')}
                  </p>
               ) : null}
               {needsRuntime ? (
                  <p className="flex flex-wrap items-center gap-2 rounded-md border border-status-warning/40 bg-status-warning/5 px-3 py-2">
                     {t('bannerNoRuntime')}
                     <button
                        type="button"
                        onClick={() => requestTab('settings')}
                        className="underline underline-offset-2"
                     >
                        {t('bannerNoRuntimeLink')}
                     </button>
                  </p>
               ) : null}
            </div>
         </div>

         <Tabs
            value={view}
            onValueChange={(value) => requestTab(value as DetailTab)}
            className="flex min-h-0 flex-1 flex-col"
         >
            <div className="flex justify-center border-b px-8 py-2">
               <TabsList aria-label={agent.name}>
                  {TABS.map((tab) => (
                     <TabsTrigger key={tab} value={tab}>
                        {tabLabel[tab]}
                     </TabsTrigger>
                  ))}
               </TabsList>
            </div>

            {/* Rendered outside TabsContent so a tab's own state is dropped
                when it closes: a half-loaded task page that comes back on
                return would be showing a moment that has since passed. */}
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
               {view === 'overview' ? (
                  <div className="min-h-0 flex-1 overflow-auto">
                     <AgentOverviewTab
                        agent={agent}
                        roster={roster}
                        tasks={tasks}
                        cursor={cursor}
                        loadingMore={loadingMore}
                        onLoadMore={() => void loadMore()}
                        onActivityChanged={() => {
                           void loadTasks();
                           void loadRoster();
                        }}
                        onOpenSettings={() => requestTab('settings')}
                     />
                  </div>
               ) : null}
               {view === 'role' ? (
                  <AgentRoleTab
                     agent={agent}
                     readOnly={locked}
                     onReset={() => void loadAgent()}
                     onChange={onChanged}
                     onDirtyChange={setDirty}
                     onForbidden={() => setReadOnly(true)}
                  />
               ) : null}
               {view === 'instructions' || view === 'skills' ? (
                  <AgentCapabilitiesTab
                     key={view}
                     agent={agent}
                     readOnly={locked}
                     onChange={onChanged}
                     onDirtyChange={setDirty}
                     onForbidden={() => setReadOnly(true)}
                     section={view === 'skills' ? 'skills' : 'instructions'}
                  />
               ) : null}
               {view === 'mcp' ? (
                  <div className="min-h-0 flex-1 overflow-auto px-8 py-6">
                     <AgentExecutionSettings
                        agent={agent}
                        roster={roster}
                        readOnly={locked}
                        onChange={onChanged}
                        onRosterStale={() => void loadRoster()}
                        onDirtyChange={setDirty}
                        onForbidden={() => setReadOnly(true)}
                        view="mcp"
                     />
                  </div>
               ) : null}
               {view === 'settings' ? (
                  <AgentSettingsTab
                     agent={agent}
                     readOnly={locked}
                     onChange={onChanged}
                     onDirtyChange={setDirty}
                     onForbidden={() => setReadOnly(true)}
                  >
                     <AgentExecutionSettings
                        agent={agent}
                        roster={roster}
                        readOnly={locked}
                        onChange={onChanged}
                        onRosterStale={() => void loadRoster()}
                        onDirtyChange={setRuntimeDirty}
                        onForbidden={() => setReadOnly(true)}
                        view="runtime"
                     />
                  </AgentSettingsTab>
               ) : null}
            </div>
         </Tabs>

         <AlertDialog
            open={pendingTab !== null}
            onOpenChange={(open) => (open ? null : setPendingTab(null))}
         >
            <AlertDialogContent>
               <AlertDialogHeader>
                  <AlertDialogTitle>{t('unsavedTitle')}</AlertDialogTitle>
                  <AlertDialogDescription>{t('unsavedBody')}</AlertDialogDescription>
               </AlertDialogHeader>
               <AlertDialogFooter>
                  <AlertDialogCancel>{t('unsavedStay')}</AlertDialogCancel>
                  <AlertDialogAction
                     onClick={() => {
                        const next = pendingTab;
                        setPendingTab(null);
                        setDirty(false);
                        setRuntimeDirty(false);
                        if (next) openTab(next);
                     }}
                  >
                     {t('unsavedLeave')}
                  </AlertDialogAction>
               </AlertDialogFooter>
            </AlertDialogContent>
         </AlertDialog>
      </div>
   );
}
