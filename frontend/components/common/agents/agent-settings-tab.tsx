'use client';

import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { AgentModelPicker } from '@/components/common/agents/agent-model-picker';
import { UnsavedChangesBar } from '@/components/common/unsaved-changes-bar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
   Select,
   SelectContent,
   SelectItem,
   SelectTrigger,
   SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { BerryApiError } from '@/lib/api';
import {
   setAgentAccess,
   updateAgentConfig,
   getAgentAccess,
   type Agent,
   type AgentAccess,
   type AgentRoster,
} from '@/lib/agents';
import { bindAgentRuntime, listRuntimes, unbindAgentRuntime, type Runtime } from '@/lib/runtimes';
import { useSessionStore } from '@/store/session-store';

const NO_RUNTIME = '__none__';
const MAX_STARTERS = 3;
const DEFAULT_CONCURRENCY = 1;

const reason = (error: unknown, fallback: string) =>
   error instanceof BerryApiError ? error.message : fallback;

const concurrencyOf = (agent: Agent) => agent.maxConcurrency ?? DEFAULT_CONCURRENCY;

interface AgentSettingsTabProps {
   agent: Agent;
   roster: AgentRoster | undefined;
   readOnly: boolean;
   onChange: (agent: Agent) => void;
   /** Re-read the roster after a runtime binding changes. */
   onRosterStale: () => void;
   /** Told whenever an editor holds unsaved settings, for the page's leave guard. */
   onDirtyChange: (dirty: boolean) => void;
   /** Called when the server refuses a write, so the page can say so once. */
   onForbidden: () => void;
}

function Section({
   title,
   hint,
   children,
}: {
   title: string;
   hint?: string;
   children: React.ReactNode;
}) {
   return (
      <section className="flex flex-col gap-2 border-t border-border/70 pt-6 first:border-t-0 first:pt-0">
         <div className="flex flex-wrap items-baseline gap-2">
            <h3 className="font-medium">{title}</h3>
            {hint ? <p className="text-muted-foreground">{hint}</p> : null}
         </div>
         {children}
      </section>
   );
}

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

/**
 * Everything about the agent that is a setting rather than a capability.
 * Edits stay local until Save on the unsaved bar.
 */
export default function AgentSettingsTab({
   agent,
   roster,
   readOnly,
   onChange,
   onRosterStale,
   onDirtyChange,
   onForbidden,
}: AgentSettingsTabProps) {
   const t = useTranslations('agentsChat.detail');
   const common = useTranslations('agentsChat.common');
   const list = useTranslations('agentsChat.list');

   const failed = (error: unknown) => {
      if (error instanceof BerryApiError && error.status === 403) onForbidden();
      toast.error(reason(error, t('failureUnknown')));
   };
   const sessionUserId = useSessionStore((state) => state.user?.id);

   const [name, setName] = useState(agent.name);
   const [description, setDescription] = useState(agent.description ?? '');
   const [provider, setProvider] = useState(agent.modelProvider ?? null);
   const [model, setModel] = useState(agent.modelName ?? null);
   const [runtimeId, setRuntimeId] = useState(roster?.runtimeId ?? null);
   const [concurrency, setConcurrency] = useState(() => concurrencyOf(agent));
   const [starters, setStarters] = useState<string[]>(agent.conversationStarters);
   const [accessBaseline, setAccessBaseline] = useState<AgentAccess | null>(null);
   const [accessMode, setAccessMode] = useState<'me' | 'workspace'>('workspace');
   const [saving, setSaving] = useState(false);
   const [runtimes, setRuntimes] = useState<Runtime[]>([]);

   useEffect(() => {
      setName(agent.name);
      setDescription(agent.description ?? '');
      setProvider(agent.modelProvider ?? null);
      setModel(agent.modelName ?? null);
      setConcurrency(concurrencyOf(agent));
      setStarters(agent.conversationStarters);
   }, [
      agent.name,
      agent.description,
      agent.modelProvider,
      agent.modelName,
      agent.maxConcurrency,
      agent.conversationStarters,
   ]);

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

   const nameDirty = name.trim() !== agent.name;
   const descriptionDirty = description !== (agent.description ?? '');
   const modelDirty =
      (provider ?? null) !== (agent.modelProvider ?? null) ||
      (model ?? null) !== (agent.modelName ?? null);
   const runtimeDirty = (runtimeId ?? null) !== (roster?.runtimeId ?? null);
   const concurrencyDirty = concurrency !== concurrencyOf(agent);
   const accessDirty = accessMode !== baselineAccessMode;
   const startersDirty =
      starters.length !== agent.conversationStarters.length ||
      starters.some((entry, index) => entry !== agent.conversationStarters[index]);

   const dirty =
      nameDirty ||
      descriptionDirty ||
      modelDirty ||
      runtimeDirty ||
      concurrencyDirty ||
      accessDirty ||
      startersDirty;

   useEffect(() => {
      onDirtyChange(dirty);
   }, [dirty, onDirtyChange]);

   const whatChanged = useMemo(() => {
      const parts: string[] = [];
      if (nameDirty || descriptionDirty) parts.push(t('change_general'));
      if (modelDirty) parts.push(t('change_model'));
      if (runtimeDirty) parts.push(t('change_runtime'));
      if (concurrencyDirty) parts.push(t('change_concurrency'));
      if (accessDirty) parts.push(t('change_access'));
      if (startersDirty) parts.push(t('change_starters'));
      return parts.join(', ');
   }, [
      nameDirty,
      descriptionDirty,
      modelDirty,
      runtimeDirty,
      concurrencyDirty,
      accessDirty,
      startersDirty,
      t,
   ]);

   const discard = () => {
      setName(agent.name);
      setDescription(agent.description ?? '');
      setProvider(agent.modelProvider ?? null);
      setModel(agent.modelName ?? null);
      setRuntimeId(roster?.runtimeId ?? null);
      setConcurrency(concurrencyOf(agent));
      setStarters(agent.conversationStarters);
      setAccessMode(baselineAccessMode);
   };

   const save = async () => {
      if (nameDirty && !name.trim()) {
         toast.error(t('setNameRequired'));
         return;
      }
      setSaving(true);
      try {
         let next = agent;
         const config: Parameters<typeof updateAgentConfig>[1] = {};
         if (nameDirty) config.name = name.trim();
         if (descriptionDirty) config.description = description;
         if (modelDirty) {
            config.provider = provider;
            config.model = model;
         }
         if (concurrencyDirty) config.maxConcurrency = concurrency;
         if (startersDirty) config.starters = starters.filter((entry) => entry.trim());

         if (Object.keys(config).length > 0) {
            next = await updateAgentConfig(agent.id, config);
         }

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
      <div className="flex h-full min-h-0 flex-col">
         <div className="flex min-h-0 flex-1 flex-col gap-8 overflow-auto px-8 py-6">
            <Section title={t('setGeneral')}>
               <label className="flex flex-col gap-1.5">
                  <span className="text-muted-foreground">{t('setName')}</span>
                  <Input
                     value={name}
                     disabled={readOnly}
                     onChange={(event) => setName(event.target.value)}
                  />
               </label>

               <label className="flex flex-col gap-1.5">
                  <span className="text-muted-foreground">{t('setDescription')}</span>
                  <Textarea
                     rows={3}
                     value={description}
                     disabled={readOnly}
                     onChange={(event) => setDescription(event.target.value)}
                  />
               </label>
            </Section>

            <section className="flex flex-col gap-2 border-t border-border/70 pt-6">
               <AgentModelPicker
                  provider={provider}
                  model={model}
                  disabled={readOnly}
                  onChange={(nextProvider, nextModel) => {
                     setProvider(nextProvider);
                     setModel(nextModel);
                  }}
               />
            </section>

            <div className="grid grid-cols-1 gap-6 border-t border-border/70 pt-6 md:grid-cols-3 md:items-stretch md:gap-0">
               <div className="flex min-w-0 flex-col gap-2 md:pr-6">
                  <div className="flex flex-col gap-1">
                     <h3 className="font-medium">{t('setRuntime')}</h3>
                     <p className="text-muted-foreground">{t('setRuntimeHint')}</p>
                  </div>
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
                              {runtime.status === 'active'
                                 ? ''
                                 : ` · ${list('runtimeUnreachable')}`}
                           </SelectItem>
                        ))}
                     </SelectContent>
                  </Select>
               </div>

               <div className="flex min-w-0 flex-col gap-2 md:border-l md:border-border/40 md:px-6">
                  <div className="flex flex-col gap-1">
                     <h3 className="font-medium">{t('setConcurrency')}</h3>
                     <p className="text-muted-foreground">{t('setConcurrencyHint')}</p>
                  </div>
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
               </div>

               <div className="flex min-w-0 flex-col gap-2 md:border-l md:border-border/40 md:pl-6">
                  <div className="flex flex-col gap-1">
                     <h3 className="font-medium">{t('setAccess')}</h3>
                     <p className="text-muted-foreground">{t('setAccessHint')}</p>
                  </div>
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
                           onClick={() => setAccessMode(mode)}
                        >
                           {label}
                        </Button>
                     ))}
                  </div>
               </div>
            </div>

            <Section title={t('capStarters')} hint={t('capStartersHint')}>
               <div className="flex flex-col gap-2">
                  {starters.map((starter, index) => (
                     <div key={index} className="flex items-center gap-2">
                        <Input
                           value={starter}
                           disabled={readOnly}
                           aria-label={`${t('capStarters')} ${index + 1}`}
                           onChange={(event) =>
                              setStarters(
                                 starters.map((entry, at) =>
                                    at === index ? event.target.value : entry
                                 )
                              )
                           }
                        />
                        {readOnly ? null : (
                           <Button
                              size="xs"
                              variant="ghost"
                              aria-label={t('capStarterRemove')}
                              onClick={() => setStarters(starters.filter((_, at) => at !== index))}
                           >
                              <Trash2 className="size-4" />
                           </Button>
                        )}
                     </div>
                  ))}
                  {readOnly ? null : starters.length < MAX_STARTERS ? (
                     <Button
                        size="xs"
                        variant="secondary"
                        className="w-fit"
                        onClick={() => setStarters([...starters, ''])}
                     >
                        <Plus className="size-4" />
                        {t('capStarterAdd')}
                     </Button>
                  ) : (
                     <p className="text-muted-foreground">{t('capStartersFull')}</p>
                  )}
               </div>

               {starters.some((entry) => entry.trim()) ? (
                  <div className="mt-2 rounded-lg border border-border/70 p-3">
                     <p className="text-muted-foreground">{t('capStarterPreview')}</p>
                     <div className="mt-2 flex flex-wrap gap-2">
                        {starters
                           .filter((entry) => entry.trim())
                           .map((entry, index) => (
                              <span
                                 key={index}
                                 className="rounded-md bg-muted/60 px-2.5 py-1 text-muted-foreground"
                              >
                                 {entry.trim()}
                              </span>
                           ))}
                     </div>
                  </div>
               ) : null}
            </Section>
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
