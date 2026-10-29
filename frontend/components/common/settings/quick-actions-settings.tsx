'use client';

import { AgentPicker } from '@/components/common/agents/agent-multiselect';
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
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { loadWorkspaceAgents, type Agent } from '@/lib/agents';
import {
   archiveQuickAction,
   createQuickAction,
   deleteQuickAction,
   FILLABLE_VARIABLES,
   isStale,
   loadQuickActions,
   STALE_AFTER_DAYS,
   unfillableVariables,
   updateQuickAction,
   type QuickAction,
} from '@/lib/quick-actions';
import { useSessionStore } from '@/store/session-store';
import { Archive, ChevronDown, Trash2, Zap } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
   SelectMenu,
   SettingsBadge,
   SettingsCard,
   SettingsChip,
   SettingsEmpty,
   SettingsIconButton,
   SettingsSection,
   SettingsShell,
} from './shared';
import { useSettingsResource } from './use-settings-resource';

/**
 * Prompt templates an agent runs on a task.
 *
 * Ordered by how often each one is actually run, because a workspace
 * accumulates these and alphabetical order buries the two or three anyone
 * uses. One nobody has run in {@link STALE_AFTER_DAYS} days is flagged rather
 * than hidden: it may still be the right thing to keep, and that is the
 * author's call, not the list's.
 *
 * A prompt that uses a variable Berry cannot fill is refused here as well as
 * by the server, because here is where the author can still see what they
 * typed. Unfilled, it would not fail at run time — it would arrive at the
 * agent as two braces and a word, read as instructions.
 *
 * Archiving is reversible and the archived rows stay reachable behind a
 * toggle; deleting for good is a separate step that only an archived action
 * accepts, so the irreversible click is never the first one.
 */
export default function QuickActionsSettings() {
   const t = useTranslations('workspaceAdmin.quickActions');
   const workspaceId = useSessionStore((state) => state.workspace?.id ?? '');
   const actions = useSettingsResource<QuickAction[]>(
      () =>
         workspaceId
            ? loadQuickActions(workspaceId, true)
            : Promise.reject(new Error('No workspace is selected.')),
      [workspaceId]
   );
   const [agents, setAgents] = useState<Agent[]>([]);
   const [name, setName] = useState('');
   const [agentId, setAgentId] = useState('');
   const [prompt, setPrompt] = useState('');
   const [visibility, setVisibility] = useState<'private' | 'workspace'>('workspace');
   const [showArchived, setShowArchived] = useState(false);
   const [deleting, setDeleting] = useState<QuickAction | null>(null);

   useEffect(() => {
      void loadWorkspaceAgents()
         .then(setAgents)
         .catch(() => setAgents([]));
   }, []);

   const all = useMemo(() => actions.value ?? [], [actions.value]);
   const active = useMemo(() => all.filter((entry) => !entry.archivedAt), [all]);
   const archived = useMemo(() => all.filter((entry) => entry.archivedAt), [all]);

   const agentOptions = useMemo(
      () =>
         agents
            .map((agent) => ({ id: agent.id, label: agent.name }))
            .sort((left, right) => left.label.localeCompare(right.label)),
      [agents]
   );
   const badVariables = useMemo(() => unfillableVariables(prompt), [prompt]);
   const chosenAgent = agents.find((agent) => agent.id === agentId);
   // A shared action pointing at an agent only some people may start is a
   // button that fails for everybody else. Said before it is saved, not after.
   const restrictedAgent =
      visibility === 'workspace' &&
      chosenAgent?.access !== undefined &&
      chosenAgent.access.assign !== 'everyone';

   const replace = (next: QuickAction) => all.map((entry) => (entry.id === next.id ? next : entry));

   const create = async () => {
      try {
         const created = await createQuickAction(workspaceId, {
            name: name.trim(),
            targetAgentId: agentId,
            prompt,
            visibility,
         });
         actions.set([...all, created]);
         setName('');
         setPrompt('');
      } catch (cause) {
         toast.error(cause instanceof Error ? cause.message : t('createFailed'));
      }
   };

   const archive = (action: QuickAction) =>
      void actions.mutate(replace({ ...action, archivedAt: new Date().toISOString() }), () =>
         archiveQuickAction(workspaceId, action.id)
      );

   const restore = async (action: QuickAction) => {
      try {
         actions.set(replace(await updateQuickAction(workspaceId, action.id, { archived: false })));
      } catch (cause) {
         toast.error(cause instanceof Error ? cause.message : t('restoreFailed'));
      }
   };

   const remove = (action: QuickAction) => {
      setDeleting(null);
      void actions.mutate(
         all.filter((entry) => entry.id !== action.id),
         () => deleteQuickAction(workspaceId, action.id)
      );
   };

   const line = (action: QuickAction) => {
      const agent = agents.find((entry) => entry.id === action.targetAgentId);
      const stale = !action.archivedAt && isStale(action);
      const meta = [
         agent?.name ?? t('unknownAgent'),
         action.visibility === 'private' ? t('visibilityPrivate') : t('visibilityTeam'),
         action.useCount === undefined ? null : t('runCount', { count: action.useCount }),
         action.prompt,
      ]
         .filter(Boolean)
         .join(' · ');
      return (
         <div key={action.id} className="flex min-w-0 items-center gap-3 py-3 pr-2 pl-4">
            <Zap
               className="size-3.5 shrink-0 text-muted-foreground"
               strokeWidth={1.7}
               aria-hidden
            />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
               <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-medium">{action.name}</span>
                  {stale ? (
                     <SettingsBadge title={t('staleHint', { days: STALE_AFTER_DAYS })}>
                        {t('stale')}
                     </SettingsBadge>
                  ) : null}
               </div>
               <span data-settings-type="caption" className="truncate text-subtle-foreground">
                  {meta}
               </span>
            </div>
            {action.archivedAt ? (
               <span className="flex shrink-0 items-center gap-1">
                  <Button variant="quiet" onClick={() => void restore(action)}>
                     {t('restore')}
                  </Button>
                  <SettingsIconButton
                     label={t('delete')}
                     destructive
                     onClick={() => setDeleting(action)}
                  >
                     <Trash2 />
                  </SettingsIconButton>
               </span>
            ) : (
               <SettingsIconButton label={t('archive')} onClick={() => archive(action)}>
                  <Archive />
               </SettingsIconButton>
            )}
         </div>
      );
   };

   return (
      <SettingsShell title={t('title')} description={t('lead')}>
         <div className="-mt-5 flex flex-wrap items-center gap-1.5">
            <span data-settings-type="caption" className="text-subtle-foreground">
               {t('variables')}
            </span>
            {FILLABLE_VARIABLES.map((variable) => (
               <SettingsChip key={variable} className="text-[var(--brand-body)]">
                  {variable}
               </SettingsChip>
            ))}
         </div>

         <SettingsSection title={t('newTitle')}>
            <SettingsCard>
               <div className="flex flex-col gap-2.5 px-4 py-3.5">
                  <div className="flex flex-wrap gap-2">
                     <Input
                        variant="settings"
                        placeholder={t('namePlaceholder')}
                        aria-label={t('namePlaceholder')}
                        value={name}
                        className="min-w-[180px] flex-1"
                        onChange={(event) => setName(event.target.value)}
                     />
                     <AgentPicker
                        options={agentOptions}
                        value={agentId || null}
                        multiple={false}
                        onChange={(next) => setAgentId(typeof next === 'string' ? next : '')}
                        trigger={
                           <button
                              type="button"
                              aria-label={t('agent')}
                              className="relative inline-flex h-[30px] w-[150px] shrink-0 items-center rounded-[7px] border border-settings-field-line bg-settings-field pr-[30px] pl-2.5 text-left text-foreground outline-none focus-visible:border-settings-field-focus"
                           >
                              <span className="min-w-0 truncate">
                                 {chosenAgent?.name ?? t('agent')}
                              </span>
                              <ChevronDown
                                 strokeWidth={2.5}
                                 className="pointer-events-none absolute top-1/2 right-2.5 size-2.5 -translate-y-1/2 text-subtle-foreground"
                              />
                           </button>
                        }
                     />
                     <SelectMenu
                        className="w-[120px]"
                        aria-label={t('scopeLabel')}
                        options={['workspace', 'private']}
                        labels={{
                           workspace: t('visibilityTeam'),
                           private: t('visibilityPrivate'),
                        }}
                        value={visibility}
                        onChange={(value) => setVisibility(value as 'private' | 'workspace')}
                     />
                  </div>
                  <Textarea
                     variant="settings"
                     placeholder={t('promptPlaceholder')}
                     aria-label={t('promptPlaceholder')}
                     value={prompt}
                     onChange={(event) => setPrompt(event.target.value)}
                     rows={3}
                     aria-invalid={badVariables.length > 0}
                  />
                  {badVariables.length > 0 ? (
                     <p role="alert" data-settings-type="caption" className="text-status-danger">
                        {t('unfillable', {
                           names: badVariables.map((name) => `{{${name}}}`).join(', '),
                        })}
                     </p>
                  ) : null}
                  {restrictedAgent ? (
                     <p data-settings-type="caption" className="text-status-warning">
                        {t('restrictedAgent', { agent: chosenAgent?.name ?? '' })}
                     </p>
                  ) : null}
                  <div className="flex justify-end">
                     <Button
                        onClick={() => void create()}
                        disabled={
                           !name.trim() || !agentId || !prompt.trim() || badVariables.length > 0
                        }
                     >
                        {t('add')}
                     </Button>
                  </div>
               </div>
            </SettingsCard>
         </SettingsSection>

         <SettingsSection title={t('savedTitle')} description={actions.error ?? undefined}>
            <SettingsCard>
               {active.map(line)}
               {!actions.loading && active.length === 0 ? (
                  <SettingsEmpty title={t('empty')} />
               ) : null}
            </SettingsCard>
            {archived.length > 0 ? (
               <label className="flex w-fit cursor-pointer items-center gap-2 pt-1">
                  <Switch
                     variant="settings"
                     checked={showArchived}
                     onCheckedChange={setShowArchived}
                  />
                  <span>{t('showArchived', { count: archived.length })}</span>
               </label>
            ) : null}
            {archived.length > 0 && showArchived ? (
               <SettingsCard>{archived.map(line)}</SettingsCard>
            ) : null}
         </SettingsSection>

         <AlertDialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
            <AlertDialogContent>
               <AlertDialogHeader>
                  <AlertDialogTitle>
                     {t('deleteTitle', { name: deleting?.name ?? '' })}
                  </AlertDialogTitle>
                  <AlertDialogDescription>{t('deleteBody')}</AlertDialogDescription>
               </AlertDialogHeader>
               <AlertDialogFooter>
                  <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
                  <AlertDialogAction onClick={() => deleting && remove(deleting)}>
                     {t('delete')}
                  </AlertDialogAction>
               </AlertDialogFooter>
            </AlertDialogContent>
         </AlertDialog>
      </SettingsShell>
   );
}
