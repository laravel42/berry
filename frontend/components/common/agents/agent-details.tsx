'use client';

import Link from 'next/link';
import { useAgentCoverage } from '@/hooks/use-agent-coverage';
import { agentHasRuntime } from '@/lib/runtimes';
import { useParams, usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { formatDistanceToNowStrict } from 'date-fns';
import { Archive, Lock, ShieldCheck, TriangleAlert } from 'lucide-react';

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
   isOrchestrator,
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
         // The address follows the tab without navigating. A router navigation
         // re-resolves the route, and in the drawer that can mount the full
         // agent page beside it; Next keeps `useSearchParams` in step with
         // the history API, so the tab still reads from the URL.
         window.history.replaceState(null, '', `${pathname}?${params.toString()}`);
      },
      [pathname, searchParams]
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
   // The Orchestrator is Berry's own router: shown, never edited.
   const managed = isOrchestrator(agent);
   const locked = readOnly || archived || managed;
   const needsRuntime = roster !== undefined && !agentHasRuntime(coverage, agentId) && !archived;

   const tabLabel: Record<DetailTab, string> = {
      settings: t('tabGeneral'),
      instructions: t('capInstructions'),
      role: admin('rolePermissions'),
      skills: t('capSkills'),
      mcp: t('capMcpAgent'),
      overview: t('tabUsage'),
   };

   const tint = colorForAgent(agent.id);
   const notices: { key: string; icon: typeof Lock; text: string }[] = [
      ...(managed ? [{ key: 'managed', icon: ShieldCheck, text: t('bannerManaged') }] : []),
      ...(!managed && readOnly ? [{ key: 'readOnly', icon: Lock, text: t('bannerReadOnly') }] : []),
      ...(archived ? [{ key: 'archived', icon: Archive, text: t('bannerArchived') }] : []),
   ];

   return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
         <div
            className="relative px-8 pt-7 pb-5"
            style={{
               // The agent's own hue, faded out, so each drawer reads as that agent.
               backgroundImage: `radial-gradient(120% 140% at 0% 0%, color-mix(in oklab, ${tint} 18%, transparent), transparent 60%)`,
            }}
         >
            <div className="flex min-w-0 items-start gap-5">
               <span
                  className="relative flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-card"
                  style={{
                     boxShadow: `0 0 0 1px color-mix(in oklab, ${tint} 45%, transparent), 0 8px 24px -12px ${tint}`,
                  }}
               >
                  {avatarSrc ? (
                     // eslint-disable-next-line @next/next/no-img-element -- a blob or external URL, not an optimisable asset
                     <img src={avatarSrc} alt="" className="size-full object-cover" />
                  ) : (
                     <BerryMark size="lg" tone="working" dotColor={tint} label={agent.name} />
                  )}
               </span>
               <div className="flex min-w-0 flex-1 flex-col gap-2 pt-0.5">
                  <h1 className="truncate leading-tight">{agent.name}</h1>
                  <div className="flex flex-wrap items-center gap-1.5">
                     <AgentWorkloadChip roster={roster} />
                     <AgentModelChip agent={agent} />
                     {needsRuntime ? (
                        <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-status-warning/40 bg-status-warning/10 px-2 py-0.5 leading-none text-status-warning">
                           <TriangleAlert className="size-3" aria-hidden />
                           {t('bannerNoRuntime')}
                        </span>
                     ) : null}
                  </div>
                  {agent.description ? (
                     <p className="max-w-3xl text-pretty text-muted-foreground">
                        {agent.description}
                     </p>
                  ) : null}
               </div>
            </div>

            {roster ? <AgentHeroStats roster={roster} tint={tint} /> : null}

            {notices.length > 0 ? (
               <div className="mt-4 flex flex-col gap-2">
                  {notices.map(({ key, icon: Icon, text }) => (
                     <p
                        key={key}
                        className="flex items-start gap-2.5 rounded-[10px] border border-border/70 bg-card/70 px-3 py-2.5 text-muted-foreground backdrop-blur-sm"
                     >
                        <Icon
                           className="mt-px size-4 shrink-0 text-subtle-foreground"
                           aria-hidden
                        />
                        <span className="text-pretty">{text}</span>
                     </p>
                  ))}
               </div>
            ) : null}
         </div>

         <Tabs
            value={view}
            onValueChange={(value) => requestTab(value as DetailTab)}
            className="flex min-h-0 flex-1 flex-col gap-0"
         >
            <div className="no-scrollbar overflow-x-auto border-b px-8">
               <TabsList
                  aria-label={agent.name}
                  className="h-auto gap-5 rounded-none bg-transparent p-0"
               >
                  {TABS.map((tab) => (
                     <TabsTrigger
                        key={tab}
                        value={tab}
                        className="relative h-10 rounded-none px-0 text-muted-foreground hover:text-foreground data-[state=active]:bg-transparent data-[state=active]:text-foreground data-[state=active]:after:absolute data-[state=active]:after:inset-x-0 data-[state=active]:after:-bottom-px data-[state=active]:after:h-0.5 data-[state=active]:after:rounded-full data-[state=active]:after:bg-[var(--agent-tint)]"
                        style={{ ['--agent-tint' as string]: tint }}
                     >
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
               {/* Staying is the safe choice, so Keep editing carries the
                   emphasis and sits last; leaving is the outlined one. */}
               <AlertDialogFooter>
                  <AlertDialogAction
                     variant="outline"
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
                  <AlertDialogCancel variant="default">{t('unsavedStay')}</AlertDialogCancel>
               </AlertDialogFooter>
            </AlertDialogContent>
         </AlertDialog>
      </div>
   );
}

/**
 * What the agent is doing and has done, at a glance: the same roster the list
 * reads, so the drawer and the row never disagree.
 */
function AgentHeroStats({ roster, tint }: { roster: AgentRoster; tint: string }) {
   const t = useTranslations('agentsChat.detail');
   const runs = roster.activity.reduce((sum, day) => sum + day.runs, 0);
   const lastActive = roster.lastActiveAt
      ? formatDistanceToNowStrict(new Date(roster.lastActiveAt), { addSuffix: true })
      : t('heroNever');
   const stats = [
      {
         key: 'running',
         label: t('heroRunning'),
         value: String(roster.running),
         live: roster.running > 0,
         figure: 'sm',
      },
      {
         key: 'queued',
         label: t('heroQueued'),
         value: String(roster.queued),
         live: false,
         figure: 'sm',
      },
      { key: 'runs', label: t('heroRuns'), value: String(runs), live: false, figure: 'sm' },
      { key: 'last', label: t('heroLastActive'), value: lastActive, live: false, figure: 'sm' },
   ];

   return (
      <dl className="mt-5 grid grid-cols-2 gap-px overflow-hidden rounded-[10px] border border-border/70 bg-border/70 sm:grid-cols-4">
         {stats.map((stat) => (
            <div
               key={stat.key}
               className="flex min-h-20 min-w-0 flex-col justify-between gap-2 bg-card/80 px-4 py-3"
            >
               <dt className="truncate text-subtle-foreground">{stat.label}</dt>
               <dd
                  data-figure={stat.figure}
                  className="flex min-w-0 items-center gap-2 font-medium text-foreground"
               >
                  {stat.live ? (
                     <span
                        className="size-2 shrink-0 animate-pulse rounded-full"
                        style={{ backgroundColor: tint }}
                        aria-hidden
                     />
                  ) : null}
                  <span className="truncate">{stat.value}</span>
               </dd>
            </div>
         ))}
      </dl>
   );
}
