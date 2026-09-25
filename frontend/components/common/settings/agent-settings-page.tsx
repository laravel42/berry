'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import AgentExecutionSettings, {
   type ExecutionView,
} from '@/components/common/agents/agent-execution-settings';
import { AgentRoleTab } from '@/components/common/agents/agent-role-tab';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BerryApiError } from '@/lib/api';
import {
   AGENT_PERMISSIONS,
   getWorkspaceAgent,
   loadAgentRoster,
   setAgentPermissions,
   type Agent,
   type AgentRoster,
} from '@/lib/agents';
import { cn } from '@/lib/utils';
import { useAgentsStore } from '@/store/agents-store';
import { SettingsCard, SettingsSection, SettingsShell } from './shared';

const sameJson = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

/**
 * The page's tabs. Role also holds the agent's permissions; Settings holds
 * runtime, concurrency and access, read side by side. Every tab stays mounted,
 * hidden, so a draft survives a switch.
 */
const SETTINGS_TABS = ['role', 'mcp', 'settings'] as const;
type SettingsTab = (typeof SETTINGS_TABS)[number];
const isSettingsTab = (value: string): value is SettingsTab =>
   (SETTINGS_TABS as readonly string[]).includes(value);

/**
 * Takes a newer copy of the agent, keeping the old references for fields whose
 * value did not change: the role editor and the starters editor reset their
 * drafts when those references move, and a save in one section must not wipe
 * a draft in another.
 */
function mergeAgent(current: Agent | null, next: Agent): Agent {
   if (!current) return next;
   return {
      ...next,
      contract: sameJson(current.contract, next.contract) ? current.contract : next.contract,
      conversationStarters: sameJson(current.conversationStarters, next.conversationStarters)
         ? current.conversationStarters
         : next.conversationStarters,
   };
}

/**
 * One agent under Settings → Agents: its role contract, MCP servers, runtime,
 * concurrency, access, conversation starters and permissions.
 *
 * The role editor keeps its own unsaved bar; MCP, runtime, concurrency, access
 * and starters share one; permissions save as they are switched, because
 * revoking one is the change most likely to be urgent.
 */
export default function AgentSettingsPage({ agentId }: { agentId: string }) {
   const { orgId } = useParams<{ orgId: string }>();
   const t = useTranslations('workspaceAdmin.agents');
   const detail = useTranslations('agentsChat.detail');

   const storedAgent = useAgentsStore((state) => state.getAgentById(agentId));
   const upsertAgent = useAgentsStore((state) => state.upsertAgent);

   const [agent, setAgent] = useState<Agent | null>(storedAgent ?? null);
   const [status, setStatus] = useState<'loading' | 'ready' | 'missing' | 'forbidden'>(
      storedAgent ? 'ready' : 'loading'
   );
   const [roster, setRoster] = useState<AgentRoster | undefined>(undefined);
   const [readOnly, setReadOnly] = useState(false);
   const [roleDirty, setRoleDirty] = useState(false);
   const [settingsDirty, setSettingsDirty] = useState(false);
   const [permissionsSaving, setPermissionsSaving] = useState(false);

   const onChanged = useCallback(
      (next: Agent) => {
         setAgent((current) => mergeAgent(current, next));
         upsertAgent(next);
      },
      [upsertAgent]
   );

   const loadAgent = useCallback(async () => {
      try {
         onChanged(await getWorkspaceAgent(agentId));
         setStatus('ready');
      } catch (error) {
         setStatus(
            error instanceof BerryApiError && error.status === 403 ? 'forbidden' : 'missing'
         );
      }
   }, [agentId, onChanged]);

   const loadRoster = useCallback(async () => {
      const entries = await loadAgentRoster().catch(() => null);
      if (entries) setRoster(entries.get(agentId));
   }, [agentId]);

   useEffect(() => {
      void loadAgent();
      void loadRoster();
   }, [loadAgent, loadRoster]);

   const dirty = roleDirty || settingsDirty;
   useEffect(() => {
      if (!dirty) return;
      const warn = (event: BeforeUnloadEvent) => event.preventDefault();
      window.addEventListener('beforeunload', warn);
      return () => window.removeEventListener('beforeunload', warn);
   }, [dirty]);

   // The open tab, kept in the URL's #fragment so a link can open one.
   const [tab, setTab] = useState<SettingsTab>('role');
   useEffect(() => {
      const hash = window.location.hash.slice(1);
      // `#permissions` predates the merged tab; Permissions sit under Role.
      if (hash === 'permissions') setTab('role');
      // `#runtime` predates the Settings tab, which holds runtime, concurrency and access.
      else if (hash === 'runtime') setTab('settings');
      else if (isSettingsTab(hash)) setTab(hash);
   }, []);
   const openTab = (next: string) => {
      if (!isSettingsTab(next)) return;
      setTab(next);
      window.history.replaceState(null, '', `#${next}`);
   };

   const togglePermission = async (key: string, granted: boolean) => {
      if (!agent) return;
      const previous = agent.permissions;
      const next = granted
         ? [...new Set([...previous, key])]
         : previous.filter((entry) => entry !== key);
      setAgent((current) => (current ? { ...current, permissions: next } : current));
      setPermissionsSaving(true);
      try {
         const written = await setAgentPermissions(agent.id, next);
         setAgent((current) =>
            current ? { ...current, permissions: written.permissions } : current
         );
         upsertAgent(written);
      } catch (error) {
         setAgent((current) => (current ? { ...current, permissions: previous } : current));
         if (error instanceof BerryApiError && error.status === 403) setReadOnly(true);
         toast.error(error instanceof Error ? error.message : detail('failureUnknown'));
      } finally {
         setPermissionsSaving(false);
      }
   };

   if (status !== 'ready' || !agent) {
      return (
         <SettingsShell title={t('title')}>
            <div className="flex flex-col items-start gap-3">
               <p className="text-muted-foreground">
                  {status === 'loading'
                     ? detail('loading')
                     : status === 'forbidden'
                       ? detail('forbidden')
                       : detail('notFound')}
               </p>
               {status === 'loading' ? null : (
                  <Link
                     href={`/${orgId}/settings/ai`}
                     className="underline-offset-2 hover:underline"
                  >
                     {t('backToList')}
                  </Link>
               )}
            </div>
         </SettingsShell>
      );
   }

   const archived = Boolean(agent.archivedAt);
   const locked = readOnly || archived;

   // What the agent may do; shown in the role, right after its autonomy level.
   const permissionsPanel = (
      <SettingsSection panel title={t('permissions')} description={t('permissionsHint')}>
         <SettingsCard>
            {AGENT_PERMISSIONS.map((permission) => (
               <label
                  key={permission.key}
                  className="flex items-start gap-3 px-4 py-3"
                  htmlFor={`${agent.id}-${permission.key}`}
               >
                  <span className="min-w-0 flex-1">
                     <span
                        className={cn('block', 'dangerous' in permission && 'text-status-danger')}
                     >
                        {permission.label}
                     </span>
                     <span className="block text-muted-foreground">{permission.description}</span>
                  </span>
                  <Switch
                     id={`${agent.id}-${permission.key}`}
                     checked={agent.permissions.includes(permission.key)}
                     disabled={locked || permissionsSaving}
                     onCheckedChange={(granted) => void togglePermission(permission.key, granted)}
                  />
               </label>
            ))}
         </SettingsCard>
      </SettingsSection>
   );

   const tabs: { id: SettingsTab; label: string }[] = [
      { id: 'role', label: t('rolePermissions') },
      { id: 'mcp', label: detail('capMcpAgent') },
      { id: 'settings', label: t('tabSettings') },
   ];
   const executionView: ExecutionView =
      tab === 'mcp' ? 'mcp' : tab === 'settings' ? 'runtime' : 'none';

   return (
      <SettingsShell wide compact title={agent.name}>
         <Tabs value={tab} onValueChange={openTab}>
            <TabsList aria-label={t('sections')}>
               {tabs.map((entry) => (
                  <TabsTrigger key={entry.id} value={entry.id}>
                     {entry.label}
                  </TabsTrigger>
               ))}
            </TabsList>
         </Tabs>
         <div className="flex min-w-0 flex-col gap-6">
            {readOnly || archived ? (
               <div className="flex flex-col gap-2">
                  {readOnly ? (
                     <p className="rounded-md border border-border/70 px-3 py-2 text-muted-foreground">
                        {detail('bannerReadOnly')}
                     </p>
                  ) : null}
                  {archived ? (
                     <p className="rounded-md border border-border/70 bg-muted/30 px-3 py-2">
                        {detail('bannerArchived')}
                     </p>
                  ) : null}
               </div>
            ) : null}

            <div hidden={tab !== 'role'}>
               <SettingsSection>
                  <AgentRoleTab
                     agent={agent}
                     readOnly={locked}
                     onReset={() => void loadAgent()}
                     onChange={onChanged}
                     onDirtyChange={setRoleDirty}
                     afterAutonomy={permissionsPanel}
                  />
               </SettingsSection>
            </div>

            <AgentExecutionSettings
               agent={agent}
               roster={roster}
               readOnly={locked}
               onChange={onChanged}
               onRosterStale={() => void loadRoster()}
               onDirtyChange={setSettingsDirty}
               onForbidden={() => setReadOnly(true)}
               view={executionView}
            />
         </div>
      </SettingsShell>
   );
}
