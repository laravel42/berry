'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { McpServerManager } from '@/components/common/settings/mcp-servers';
import { SettingsSection } from '@/components/common/settings/shared';
import { UnsavedChangesBar } from '@/components/common/unsaved-changes-bar';
import { Button } from '@/components/ui/button';
import {
   Select,
   SelectContent,
   SelectItem,
   SelectTrigger,
   SelectValue,
} from '@/components/ui/select';
import { BerryApiError } from '@/lib/api';
import {
   getAgentAccess,
   setAgentAccess,
   updateAgentConfig,
   type Agent,
   type AgentAccess,
   type AgentRoster,
} from '@/lib/agents';
import { bindAgentRuntime, listRuntimes, unbindAgentRuntime, type Runtime } from '@/lib/runtimes';
import { useSessionStore } from '@/store/session-store';

const NO_RUNTIME = '__none__';
const DEFAULT_CONCURRENCY = 1;

const reason = (error: unknown, fallback: string) =>
   error instanceof BerryApiError ? error.message : fallback;

const concurrencyOf = (agent: Agent) => agent.maxConcurrency ?? DEFAULT_CONCURRENCY;

function accessModeOf(
   access: AgentAccess | null,
   sessionUserId: string | undefined
): 'me' | 'workspace' {
   if (
      access?.assign === 'listed' &&
      access.members.length === 1 &&
      access.members[0] === sessionUserId
   ) {
      return 'me';
   }
   return 'workspace';
}

function accessDraftFor(
   mode: 'me' | 'workspace',
   sessionUserId: string | undefined,
   baseline: AgentAccess | null
): AgentAccess {
   if (mode === 'workspace') {
      return {
         assign: 'everyone',
         mention: 'everyone',
         members: baseline?.members ?? [],
      };
   }
   return {
      assign: 'listed',
      mention: 'listed',
      members: sessionUserId ? [sessionUserId] : [],
   };
}

interface AgentExecutionSettingsProps {
   agent: Agent;
   roster: AgentRoster | undefined;
   readOnly: boolean;
   onChange: (agent: Agent) => void;
   /** Re-read the roster after a runtime binding changes. */
   onRosterStale: () => void;
   /** Told whenever a section holds unsaved settings, for the page's leave guard. */
   onDirtyChange: (dirty: boolean) => void;
   /** Called when the server refuses a write, so the page can say so once. */
   onForbidden: () => void;
   /**
    * Which part a tabbed page shows; the others stay mounted, hidden, so their
    * drafts survive a tab switch. `none` hides every part but the unsaved bar.
    * Absent: all of them, each under its own heading; on a tab the tab names
    * the part, so a heading that would repeat it is left out.
    */
   view?: ExecutionView;
}

export type ExecutionView = 'mcp' | 'runtime' | 'none';

/**
 * Where and how the agent runs: its MCP servers, runtime, concurrency, and who
 * may assign it work.
 *
 * Every section is a draft until Save on the one unsaved bar, MCP enable
 * switches included; adding, editing or removing a server writes at once, as
 * it does on the workspace MCP page.
 */
export default function AgentExecutionSettings({
   agent,
   roster,
   readOnly,
   onChange,
   onRosterStale,
   onDirtyChange,
   onForbidden,
   view,
}: AgentExecutionSettingsProps) {
   const hidden = (part: Exclude<ExecutionView, 'none'>) => view !== undefined && view !== part;
   const t = useTranslations('agentsChat.detail');
   const common = useTranslations('agentsChat.common');
   const list = useTranslations('agentsChat.list');
   const sessionUserId = useSessionStore((state) => state.user?.id);

   const failed = (error: unknown) => {
      if (error instanceof BerryApiError && error.status === 403) onForbidden();
      toast.error(reason(error, t('failureUnknown')));
   };

   const [runtimeId, setRuntimeId] = useState(roster?.runtimeId ?? null);
   const [concurrency, setConcurrency] = useState(() => concurrencyOf(agent));
   const [accessBaseline, setAccessBaseline] = useState<AgentAccess | null>(null);
   const [accessMode, setAccessMode] = useState<'me' | 'workspace'>('workspace');
   const [saving, setSaving] = useState(false);
   const [runtimes, setRuntimes] = useState<Runtime[]>([]);
   const [mcpDirty, setMcpDirty] = useState(false);
   const [mcpEpoch, setMcpEpoch] = useState(0);
   const flushMcpEnabled = useRef<(() => Promise<void>) | null>(null);

   useEffect(() => {
      setConcurrency(agent.maxConcurrency ?? DEFAULT_CONCURRENCY);
   }, [agent.maxConcurrency]);

   useEffect(() => {
      setRuntimeId(roster?.runtimeId ?? null);
   }, [roster?.runtimeId]);

   useEffect(() => {
      listRuntimes().then(setRuntimes, () => setRuntimes([]));
      getAgentAccess(agent.id).then(
         (access) => {
            setAccessBaseline(access);
            setAccessMode(accessModeOf(access, sessionUserId));
         },
         () => {
            setAccessBaseline(null);
            setAccessMode('workspace');
         }
      );
   }, [agent.id, sessionUserId]);

   const baselineAccessMode = accessModeOf(accessBaseline, sessionUserId);

   const runtimeDirty = (runtimeId ?? null) !== (roster?.runtimeId ?? null);
   const concurrencyDirty = concurrency !== concurrencyOf(agent);
   const accessDirty = accessMode !== baselineAccessMode;

   const dirty = mcpDirty || runtimeDirty || concurrencyDirty || accessDirty;

   useEffect(() => {
      onDirtyChange(dirty);
   }, [dirty, onDirtyChange]);

   const whatChanged = useMemo(() => {
      const parts: string[] = [];
      if (mcpDirty) parts.push(t('change_mcp'));
      if (runtimeDirty) parts.push(t('change_runtime'));
      if (concurrencyDirty) parts.push(t('change_concurrency'));
      if (accessDirty) parts.push(t('change_access'));
      return parts.join(', ');
   }, [mcpDirty, runtimeDirty, concurrencyDirty, accessDirty, t]);

   const discard = () => {
      setMcpDirty(false);
      setMcpEpoch((value) => value + 1);
      setRuntimeId(roster?.runtimeId ?? null);
      setConcurrency(concurrencyOf(agent));
      setAccessMode(baselineAccessMode);
   };

   const save = async () => {
      setSaving(true);
      try {
         let next = agent;
         const config: Parameters<typeof updateAgentConfig>[1] = {};
         if (concurrencyDirty) config.maxConcurrency = concurrency;

         if (Object.keys(config).length > 0) {
            next = await updateAgentConfig(agent.id, config);
         }

         if (mcpDirty) await flushMcpEnabled.current?.();

         if (runtimeDirty) {
            const previous = roster?.runtimeId ?? null;
            if (runtimeId === null) {
               if (previous) await unbindAgentRuntime(previous, agent.id);
            } else {
               await bindAgentRuntime(runtimeId, agent.id);
            }
            onRosterStale();
         }

         if (accessDirty) {
            const draft = accessDraftFor(accessMode, sessionUserId, accessBaseline);
            next = await setAgentAccess(agent.id, draft);
            setAccessBaseline(draft);
         }

         onChange(next);
         toast.success(common('saved'));
      } catch (error) {
         failed(error);
         if (accessDirty) {
            getAgentAccess(agent.id).then(
               (access) => {
                  setAccessBaseline(access);
                  setAccessMode(accessModeOf(access, sessionUserId));
               },
               () => undefined
            );
         }
      } finally {
         setSaving(false);
      }
   };

   return (
      <div className="flex flex-col gap-6">
         <div hidden={hidden('mcp')}>
            <SettingsSection
               title={view === undefined ? t('capMcpAgent') : undefined}
               description={t('capMcpAgentHint')}
            >
               <McpServerManager
                  key={mcpEpoch}
                  agentId={agent.id}
                  readOnly={readOnly}
                  deferEnabled
                  onEnabledDirtyChange={setMcpDirty}
                  onRegisterFlushEnabled={(flush) => {
                     flushMcpEnabled.current = flush;
                  }}
               />
            </SettingsSection>
         </div>

         {/* Runtime, concurrency and access: three short choices, read side by side. */}
         <div hidden={hidden('runtime')} className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <SettingsSection title={t('setRuntime')} description={t('setRuntimeHint')}>
               <Select
                  value={runtimeId ?? NO_RUNTIME}
                  disabled={readOnly}
                  onValueChange={(value) => setRuntimeId(value === NO_RUNTIME ? null : value)}
               >
                  <SelectTrigger className="w-full" aria-label={t('setRuntime')}>
                     <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                     <SelectItem value={NO_RUNTIME}>{t('setRuntimeNone')}</SelectItem>
                     {runtimes.map((runtime) => (
                        <SelectItem key={runtime.id} value={runtime.id}>
                           {runtime.name}
                           {runtime.status === 'active' ? '' : ` · ${list('runtimeUnreachable')}`}
                        </SelectItem>
                     ))}
                  </SelectContent>
               </Select>
            </SettingsSection>

            <SettingsSection title={t('setConcurrency')} description={t('setConcurrencyHint')}>
               <div className="flex flex-wrap gap-2">
                  {([1, 2, 3, 4, 5] as const).map((level) => (
                     <Button
                        key={level}
                        size="xs"
                        variant={concurrency === level ? 'default' : 'secondary'}
                        disabled={readOnly || saving}
                        aria-pressed={concurrency === level}
                        onClick={() => setConcurrency(level)}
                     >
                        {level}
                     </Button>
                  ))}
               </div>
            </SettingsSection>

            <SettingsSection title={t('setAccess')} description={t('setAccessHint')}>
               <div className="flex flex-wrap gap-2">
                  {(
                     [
                        ['me', t('accessOnlyMe')],
                        ['workspace', t('accessWorkspace')],
                     ] as const
                  ).map(([mode, label]) => (
                     <Button
                        key={mode}
                        size="xs"
                        variant={accessMode === mode ? 'default' : 'secondary'}
                        disabled={readOnly || !accessBaseline}
                        aria-pressed={accessMode === mode}
                        onClick={() => setAccessMode(mode)}
                     >
                        {label}
                     </Button>
                  ))}
               </div>
            </SettingsSection>
         </div>

         {!readOnly && dirty ? (
            <UnsavedChangesBar
               what={whatChanged}
               busy={saving}
               onDiscard={discard}
               onSave={() => void save()}
            />
         ) : null}
      </div>
   );
}
