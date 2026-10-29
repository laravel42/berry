'use client';

import { ChevronDown, Play, X } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { toast } from 'sonner';

import { BerryMark } from '@/components/brand/berry-mark';
import { AgentPicker } from '@/components/common/agents/agent-multiselect';
import { MarkdownTextarea } from '@/components/common/editor/markdown-textarea';
import { EmptyStateLoading } from '@/components/common/empty-state';
import { SegmentedControl } from '@/components/common/segmented-control';
import { SettingsGroup, SettingsRow } from '@/components/common/settings/shared';
import { useDetailDrawerClose } from '@/components/layout/detail-drawer-context';
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
import {
   Command,
   CommandEmpty,
   CommandGroup,
   CommandInput,
   CommandItem,
   CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
   Select,
   SelectContent,
   SelectItem,
   SelectTrigger,
   SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import type { Project } from '@/data/projects';
import type { User } from '@/data/users';
import { useAutopilot } from '@/hooks/use-autopilot';
import {
   addCronTrigger,
   addWebhookTrigger,
   archiveAutopilot,
   createAutopilot,
   describeAutopilotFailure,
   restoreAutopilot,
   runAutopilot,
   setAutopilotMembers,
   updateAutopilot,
   type AutopilotDetail,
   type AutopilotDraft,
   type AutopilotRun,
   type WebhookDelivery,
   type WebhookSecrets,
} from '@/lib/autopilots';
import { boardsIn, listBoards, type BoardSummary } from '@/lib/boards';
import { WORKSPACE_SLUG } from '@/lib/config';
import { localTimezone } from '@/lib/cron-schedule';
import { loadWorkspaceMembers } from '@/lib/members';
import { loadWorkspaceProjects } from '@/lib/projects';
import { agentHasRuntime, getAgentCoverage, type AgentCoverage } from '@/lib/runtimes';
import { cn } from '@/lib/utils';
import { canEditProduct } from '@/lib/workspace-role';
import { useAgentsStore } from '@/store/agents-store';
import { useIssuesStore } from '@/store/issues-store';
import { useSessionStore } from '@/store/session-store';

import { AgentMark } from './autopilot-line';
import { DeliveryRows, RunRows } from './history-tabs';
import ScheduleEditor from './schedule-editor';
import { TEMPLATE_PRESETS, type TemplateKey } from './templates';
import TriggersTab, { SecretsNotice } from './triggers-tab';

/** A 32px control inside a group: the panel colour, a hairline, one height. */
const FIELD =
   'h-8 w-full min-w-0 rounded-[7px] border border-input bg-container px-2.5 text-foreground shadow-none outline-none transition-colors placeholder:text-placeholder hover:border-settings-field-focus focus-visible:border-settings-field-focus disabled:cursor-not-allowed disabled:opacity-60';

type TriggerKind = 'cron' | 'webhook' | 'none';

interface Props {
   /** An existing autopilot; omitted to create one. */
   autopilotId?: string;
   /** A starting point chosen from the empty state. */
   template?: TemplateKey | null;
}

/**
 * One autopilot, created or edited in place: General, Trigger and Runbook on
 * the left, the run history on the right. One primary action — Create or Save
 * — in the header bar beside Run now.
 */
export default function AutopilotEditor({ autopilotId, template = null }: Props) {
   if (autopilotId) return <ExistingAutopilot autopilotId={autopilotId} />;
   return <Editor template={template} runs={[]} deliveries={[]} onChanged={() => undefined} />;
}

function ExistingAutopilot({ autopilotId }: { autopilotId: string }) {
   const t = useTranslations('areas.autopilots');
   const { orgId } = useOrg();
   const closeDrawer = useDetailDrawerClose();
   const { autopilot, runs, deliveries, error, loading, reload } = useAutopilot(autopilotId);

   if (loading) return <EmptyStateLoading label={t('detail.loading')} />;

   if (error || !autopilot) {
      return (
         <div className="flex min-h-64 flex-col items-center justify-center gap-4 px-8 py-16 text-center">
            <BerryMark size="lg" tone="neutral" state="crossed" label={t('detail.loadFailed')} />
            <p className="max-w-sm text-muted-foreground" role="alert">
               {error ?? t('detail.loadFailed')}
            </p>
            {closeDrawer ? (
               <Button variant="soft" onClick={closeDrawer}>
                  {t('detail.back')}
               </Button>
            ) : (
               <Button asChild variant="soft">
                  <Link href={`/${orgId}/autopilots`}>{t('detail.back')}</Link>
               </Button>
            )}
         </div>
      );
   }

   // Keyed on the version: a save from elsewhere starts the form over from what
   // was saved, while a reload for a new run leaves what someone is typing alone.
   return (
      <Editor
         key={`${autopilot.id}:${autopilot.version}`}
         autopilot={autopilot}
         runs={runs}
         deliveries={deliveries}
         onChanged={reload}
      />
   );
}

function useOrg() {
   const params = useParams<{ orgId?: string }>();
   return { orgId: params?.orgId || WORKSPACE_SLUG };
}

function initialDraft(autopilot?: AutopilotDetail, name = '', prompt = ''): AutopilotDraft {
   if (autopilot) {
      return {
         name: autopilot.name,
         description: autopilot.description,
         assigneeType: autopilot.assigneeType,
         assigneeId: autopilot.assigneeId,
         promptTemplate: autopilot.promptTemplate,
         executionMode: autopilot.executionMode,
         boardId: autopilot.boardId,
         projectId: autopilot.projectId,
         issueId: autopilot.issueId,
         quotaPeriod: autopilot.quotaPeriod,
         quotaMax: autopilot.quotaMax,
      };
   }
   return {
      name,
      description: null,
      assigneeType: 'agent',
      assigneeId: '',
      promptTemplate: prompt,
      executionMode: 'create_issue',
      boardId: null,
      projectId: null,
      issueId: null,
      quotaPeriod: 'none',
      quotaMax: null,
   };
}

function subscribersOf(autopilot?: AutopilotDetail): string[] {
   return (autopilot?.members ?? [])
      .filter((member) => member.role === 'subscriber')
      .map((member) => member.userId);
}

function Editor({
   autopilot,
   template = null,
   runs,
   deliveries,
   onChanged,
}: {
   autopilot?: AutopilotDetail;
   template?: TemplateKey | null;
   runs: AutopilotRun[];
   deliveries: WebhookDelivery[];
   onChanged: () => void;
}) {
   const t = useTranslations('areas.autopilots');
   const td = useTranslations('areas.autopilots.dialog');
   const te = useTranslations('areas.autopilots.editor');
   const router = useRouter();
   const { orgId } = useOrg();
   const closeDrawer = useDetailDrawerClose();
   const formId = useId();
   const canEdit = canEditProduct(useSessionStore((state) => state.workspace?.role));
   const workspaceId = useSessionStore((state) => state.workspace?.id ?? '');
   const agents = useAgentsStore((state) => state.agents);
   const issues = useIssuesStore((state) => state.getAllIssues());
   const preset = template ? TEMPLATE_PRESETS[template] : null;

   const [baseline] = useState<AutopilotDraft>(() =>
      initialDraft(
         autopilot,
         template ? t(`templates.${template}_name`) : '',
         template ? t(`templates.${template}_prompt`) : ''
      )
   );
   const [draft, setDraft] = useState<AutopilotDraft>(baseline);
   const [subscribers, setSubscribers] = useState<string[]>(() => subscribersOf(autopilot));
   const [trigger, setTrigger] = useState<TriggerKind>(preset?.trigger ?? 'cron');
   const [schedule, setSchedule] = useState({
      expression: preset?.expression ?? '0 9 * * *',
      timezone: localTimezone(),
   });
   const [eventFilters, setEventFilters] = useState('');
   const [secrets, setSecrets] = useState<WebhookSecrets | null>(null);
   const [boards, setBoards] = useState<BoardSummary[]>([]);
   const [projects, setProjects] = useState<Project[]>([]);
   const [people, setPeople] = useState<User[]>([]);
   const [coverage, setCoverage] = useState<AgentCoverage | null>(null);
   const [saving, setSaving] = useState(false);
   const [busy, setBusy] = useState(false);
   const [archiving, setArchiving] = useState(false);

   useEffect(() => {
      let cancelled = false;
      const settle = <T,>(work: Promise<T>, apply: (value: T) => void, fallback: T) =>
         void work.then(
            (value) => !cancelled && apply(value),
            () => !cancelled && apply(fallback)
         );
      // Only this workspace's boards: the list spans every workspace.
      settle(
         listBoards().then((found) => boardsIn(found, workspaceId)),
         setBoards,
         []
      );
      settle(getAgentCoverage(), setCoverage, null);
      if (workspaceId) {
         settle(loadWorkspaceProjects(workspaceId), setProjects, []);
         settle(loadWorkspaceMembers(workspaceId), setPeople, []);
      }
      return () => {
         cancelled = true;
      };
   }, [workspaceId]);

   const set = <K extends keyof AutopilotDraft>(key: K, value: AutopilotDraft[K]) =>
      setDraft((current) => ({ ...current, [key]: value }));

   const runnableAgents = useMemo(
      () => agents.filter((agent) => agentHasRuntime(coverage, agent.id)),
      [agents, coverage]
   );
   const hidden = agents.length - runnableAgents.length;
   const agentOptions = useMemo(
      () =>
         runnableAgents
            .map((agent) => ({ id: agent.id, label: agent.name }))
            .sort((left, right) => left.label.localeCompare(right.label)),
      [runnableAgents]
   );

   // A template names a role; pick that agent once the runnable ones are known.
   const presetAgent = preset?.agent;
   useEffect(() => {
      if (!presetAgent || draft.assigneeId !== '') return;
      const match = runnableAgents.find((agent) => agent.name === presetAgent);
      if (match) setDraft((current) => ({ ...current, assigneeId: match.id }));
   }, [presetAgent, runnableAgents, draft.assigneeId]);

   const assigneeName = agents.find((agent) => agent.id === draft.assigneeId)?.name ?? null;

   const dirty =
      !autopilot ||
      JSON.stringify(draft) !== JSON.stringify(baseline) ||
      JSON.stringify([...subscribers].sort()) !==
         JSON.stringify([...subscribersOf(autopilot)].sort());

   const ready =
      draft.name.trim() !== '' &&
      draft.assigneeId !== '' &&
      draft.promptTemplate.trim() !== '' &&
      (draft.executionMode === 'create_issue' ? draft.boardId !== null : draft.issueId !== null) &&
      (draft.quotaPeriod === 'none' || (draft.quotaMax !== null && draft.quotaMax >= 1));

   const backToIndex = () => {
      if (closeDrawer) closeDrawer();
      else router.push(`/${orgId}/autopilots`);
   };

   const saveMembers = async (id: string) => {
      const collaborators = (autopilot?.members ?? [])
         .filter((member) => member.role === 'collaborator')
         .map((member) => ({ userId: member.userId, role: 'collaborator' as const }));
      await setAutopilotMembers(id, [
         ...collaborators,
         ...subscribers.map((userId) => ({ userId, role: 'subscriber' as const })),
      ]);
   };

   async function submit(event?: FormEvent) {
      event?.preventDefault();
      if (!ready || saving || !dirty || !canEdit) return;
      setSaving(true);
      try {
         if (autopilot) {
            await updateAutopilot(autopilot.id, draft);
            const before = [...subscribersOf(autopilot)].sort().join();
            if ([...subscribers].sort().join() !== before) await saveMembers(autopilot.id);
            toast.success(te('saved'));
            onChanged();
            backToIndex();
            return;
         }

         const created = await createAutopilot(workspaceId, draft);
         if (subscribers.length > 0) await saveMembers(created.id);
         if (trigger === 'cron') {
            await addCronTrigger(created.id, schedule);
         } else if (trigger === 'webhook') {
            const made = await addWebhookTrigger(
               created.id,
               eventFilters
                  .split(',')
                  .map((name) => name.trim())
                  .filter((name) => name !== '')
            );
            // The secret is readable exactly once: hold the page on it rather
            // than navigating away from the only chance to copy it.
            setSecrets(made.secrets);
            return;
         }
         toast.success(td('created'));
         backToIndex();
      } catch (failure) {
         toast.error(describeAutopilotFailure(failure));
      } finally {
         setSaving(false);
      }
   }

   const act = async (work: () => Promise<unknown>, done: string) => {
      setBusy(true);
      try {
         await work();
         toast.success(done);
         onChanged();
      } catch (failure) {
         toast.error(describeAutopilotFailure(failure));
      } finally {
         setBusy(false);
      }
   };

   const status = autopilot?.status;
   const runsOn = autopilot?.assigneeType === 'agent' ? autopilot.assigneeId : undefined;
   const hasRuntime = runsOn ? agentHasRuntime(coverage, runsOn) : true;
   const blocked: 'paused' | 'noRuntime' | null = !autopilot
      ? null
      : !hasRuntime
        ? 'noRuntime'
        : status !== 'active'
          ? 'paused'
          : null;

   const runNow = () =>
      autopilot &&
      void act(async () => {
         const outcome = await runAutopilot(autopilot.id);
         if (outcome.status !== 'enqueued') {
            throw new Error(
               t('detail.notQueued', { reason: outcome.reasonCode ?? outcome.status })
            );
         }
      }, t('detail.queued'));

   const title = draft.name.trim() || autopilot?.name || td('new');

   if (secrets) {
      return (
         <div className="settings-surface flex h-full min-h-0 flex-col">
            <EditorHeader title={title} onBack={backToIndex} />
            <div className="min-h-0 flex-1 overflow-y-auto p-5">
               <div className="mx-auto flex max-w-[720px] flex-col gap-3">
                  <h2 className="font-semibold">{td('created')}</h2>
                  <SecretsNotice secrets={secrets} onDismiss={backToIndex} />
               </div>
            </div>
         </div>
      );
   }

   return (
      <div className="settings-surface flex h-full min-h-0 flex-col">
         <EditorHeader title={title} onBack={backToIndex}>
            {status ? <StatusChip status={status} /> : null}
            <span className="ml-auto" />
            {autopilot ? (
               <Button
                  type="button"
                  variant="soft"
                  className="shrink-0"
                  disabled={busy || blocked !== null || !canEdit}
                  title={blocked ? t(`detail.blocked_${blocked}`) : undefined}
                  onClick={runNow}
               >
                  <Play className="size-[11px] fill-current" aria-hidden />
                  {t('detail.runNow')}
               </Button>
            ) : null}
            {canEdit ? (
               <Button
                  type="submit"
                  form={formId}
                  className="shrink-0"
                  disabled={!ready || saving || !dirty}
               >
                  {autopilot ? te('save') : td('create')}
               </Button>
            ) : null}
         </EditorHeader>

         <div className="@container min-h-0 flex-1 overflow-y-auto p-5">
            <div className="mx-auto grid max-w-[1100px] items-start gap-5 @min-[1060px]:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
               <form id={formId} onSubmit={submit} className="flex min-w-0 flex-col gap-5">
                  {blocked === 'noRuntime' ? (
                     <p
                        className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-[10px] bg-settings-badge-warning px-4 py-3"
                        role="status"
                     >
                        <span className="text-status-warning">
                           {t('detail.noRuntimeBanner', { name: assigneeName ?? '' })}
                        </span>
                        <span className="text-muted-foreground">{t('detail.noRuntimeHint')}</span>
                        <Link
                           href={`/${orgId}/settings/runtimes`}
                           className="underline underline-offset-2"
                        >
                           {t('detail.runtimesLink')}
                        </Link>
                     </p>
                  ) : null}

                  <fieldset disabled={!canEdit} className="contents">
                     <SettingsGroup>
                        <GroupTitle title={te('general')} />
                        <FieldRow
                           label={td('name')}
                           description={te('nameHint')}
                           htmlFor={`${formId}-name`}
                        >
                           <input
                              id={`${formId}-name`}
                              className={FIELD}
                              value={draft.name}
                              maxLength={200}
                              placeholder={te('namePlaceholder')}
                              onChange={(event) => set('name', event.target.value)}
                           />
                        </FieldRow>
                        <FieldRow
                           label={te('agent')}
                           description={
                              hidden > 0
                                 ? `${te('agentHint')} ${td('noRuntimeHint', { count: hidden })}`
                                 : te('agentHint')
                           }
                        >
                           <AgentPicker
                              options={agentOptions}
                              value={draft.assigneeId || null}
                              multiple={false}
                              onChange={(next) => {
                                 if (typeof next === 'string') set('assigneeId', next);
                              }}
                              trigger={
                                 <button
                                    type="button"
                                    className={cn(FIELD, 'flex cursor-pointer items-center gap-2')}
                                 >
                                    {assigneeName ? <AgentMark /> : null}
                                    <span
                                       className={cn(
                                          'min-w-0 truncate text-left',
                                          !assigneeName && 'text-placeholder'
                                       )}
                                    >
                                       {assigneeName ?? td('chooseAssignee')}
                                    </span>
                                    <ChevronDown
                                       className="ml-auto size-3 shrink-0 text-subtle-foreground"
                                       strokeWidth={2.5}
                                       aria-hidden
                                    />
                                 </button>
                              }
                           />
                        </FieldRow>
                        <FieldRow label={td('outputMode')} description={te('modeHint')}>
                           <Select
                              value={draft.executionMode}
                              onValueChange={(value) =>
                                 setDraft((current) => ({
                                    ...current,
                                    executionMode:
                                       value === 'fixed_issue' ? 'fixed_issue' : 'create_issue',
                                    boardId: null,
                                    projectId: null,
                                    issueId: null,
                                 }))
                              }
                           >
                              <SelectTrigger className={FIELD} aria-label={td('outputMode')}>
                                 <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                 <SelectItem value="create_issue">{td('createIssue')}</SelectItem>
                                 <SelectItem value="fixed_issue">{td('fixedIssue')}</SelectItem>
                              </SelectContent>
                           </Select>
                        </FieldRow>
                        {draft.executionMode === 'create_issue' ? (
                           <>
                              <FieldRow label={td('board')} description={te('boardHint')}>
                                 <Select
                                    value={draft.boardId ?? ''}
                                    onValueChange={(value) => set('boardId', value)}
                                 >
                                    <SelectTrigger className={FIELD} aria-label={td('board')}>
                                       <SelectValue placeholder={td('chooseBoard')} />
                                    </SelectTrigger>
                                    <SelectContent>
                                       {boards.map((board) => (
                                          <SelectItem key={board.id} value={board.id}>
                                             {board.name}
                                          </SelectItem>
                                       ))}
                                    </SelectContent>
                                 </Select>
                              </FieldRow>
                              <FieldRow label={td('project')} description={te('projectHint')}>
                                 <Select
                                    value={draft.projectId ?? 'none'}
                                    onValueChange={(value) =>
                                       set('projectId', value === 'none' ? null : value)
                                    }
                                 >
                                    <SelectTrigger className={FIELD} aria-label={td('project')}>
                                       <SelectValue placeholder={td('chooseProject')} />
                                    </SelectTrigger>
                                    <SelectContent>
                                       <SelectItem value="none">{td('projectNone')}</SelectItem>
                                       {projects.map((project) => (
                                          <SelectItem key={project.id} value={project.id}>
                                             {project.name}
                                          </SelectItem>
                                       ))}
                                    </SelectContent>
                                 </Select>
                              </FieldRow>
                           </>
                        ) : (
                           <FieldRow label={td('task')} description={te('taskHint')}>
                              <Select
                                 value={draft.issueId ?? ''}
                                 onValueChange={(value) => set('issueId', value)}
                              >
                                 <SelectTrigger className={FIELD} aria-label={td('task')}>
                                    <SelectValue placeholder={td('chooseTask')} />
                                 </SelectTrigger>
                                 <SelectContent>
                                    {issues.map((issue) => (
                                       <SelectItem key={issue.id} value={issue.id}>
                                          {issue.identifier} · {issue.title}
                                       </SelectItem>
                                    ))}
                                 </SelectContent>
                              </Select>
                           </FieldRow>
                        )}
                        <FieldRow label={td('subscribers')} description={td('subscribersHint')}>
                           <Subscribers
                              people={people}
                              value={subscribers}
                              onChange={setSubscribers}
                           />
                        </FieldRow>
                     </SettingsGroup>

                     <SettingsGroup>
                        <GroupTitle title={te('trigger')} />
                        {autopilot ? (
                           <TriggersTab
                              autopilot={autopilot}
                              canEdit={canEdit}
                              onChanged={onChanged}
                           />
                        ) : (
                           <>
                              <FieldRow label={te('runs')} description={te('runsHint')}>
                                 <SegmentedControl<TriggerKind>
                                    aria-label={te('runs')}
                                    size="md"
                                    value={trigger}
                                    onValueChange={setTrigger}
                                    className="h-8 w-full border border-input bg-container [&>button]:flex-1"
                                    options={[
                                       { value: 'cron', label: te('kind_cron') },
                                       { value: 'webhook', label: te('kind_webhook') },
                                       { value: 'none', label: te('kind_none') },
                                    ]}
                                 />
                              </FieldRow>
                              {trigger === 'cron' ? (
                                 <div className="px-4 py-3.5">
                                    <ScheduleEditor
                                       expression={schedule.expression}
                                       timezone={schedule.timezone}
                                       onChange={setSchedule}
                                    />
                                 </div>
                              ) : null}
                              {trigger === 'webhook' ? (
                                 <>
                                    <FieldRow
                                       label={te('webhookUrl')}
                                       description={te('webhookUrlHint')}
                                    >
                                       <span
                                          className={cn(
                                             FIELD,
                                             'flex items-center truncate text-muted-foreground'
                                          )}
                                       >
                                          {te('webhookUrlPending')}
                                       </span>
                                    </FieldRow>
                                    <FieldRow
                                       label={te('events')}
                                       description={td('eventFiltersHint')}
                                       htmlFor={`${formId}-events`}
                                    >
                                       <input
                                          id={`${formId}-events`}
                                          className={FIELD}
                                          value={eventFilters}
                                          placeholder={te('eventsPlaceholder')}
                                          onChange={(event) => setEventFilters(event.target.value)}
                                       />
                                    </FieldRow>
                                 </>
                              ) : null}
                              {trigger === 'none' ? (
                                 <div className="px-4 py-3.5 text-muted-foreground">
                                    {te('manualBody')}
                                 </div>
                              ) : null}
                           </>
                        )}
                        <FieldRow label={te('limit')} description={te('limitHint')}>
                           <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-2">
                              <Select
                                 value={draft.quotaPeriod}
                                 onValueChange={(value) =>
                                    setDraft((current) => ({
                                       ...current,
                                       quotaPeriod:
                                          value === 'hour' || value === 'day' || value === 'week'
                                             ? value
                                             : 'none',
                                       quotaMax: value === 'none' ? null : (current.quotaMax ?? 1),
                                    }))
                                 }
                              >
                                 <SelectTrigger className={FIELD} aria-label={td('quota')}>
                                    <SelectValue />
                                 </SelectTrigger>
                                 <SelectContent>
                                    <SelectItem value="none">{td('quotaNone')}</SelectItem>
                                    <SelectItem value="hour">{td('quotaHour')}</SelectItem>
                                    <SelectItem value="day">{td('quotaDay')}</SelectItem>
                                    <SelectItem value="week">{td('quotaWeek')}</SelectItem>
                                 </SelectContent>
                              </Select>
                              <input
                                 type="number"
                                 aria-label={td('quotaMax')}
                                 className={cn(FIELD, 'text-center tabular-nums')}
                                 min={1}
                                 max={10000}
                                 disabled={draft.quotaPeriod === 'none'}
                                 value={draft.quotaPeriod === 'none' ? '' : (draft.quotaMax ?? 1)}
                                 onChange={(event) =>
                                    set('quotaMax', Math.max(1, Number(event.target.value) || 1))
                                 }
                              />
                           </div>
                        </FieldRow>
                     </SettingsGroup>

                     <SettingsGroup>
                        <div className="flex flex-col gap-3 px-4 pt-3.5 pb-4">
                           <div className="flex items-baseline gap-2.5">
                              <h2 className="font-semibold">{te('runbook')}</h2>
                              <span data-settings-type="caption" className="text-subtle-foreground">
                                 {te('runbookHint')}
                              </span>
                           </div>
                           <MarkdownTextarea
                              aria-label={te('runbook')}
                              rows={7}
                              maxLength={20000}
                              value={draft.promptTemplate}
                              placeholder={te('runbookPlaceholder')}
                              onChange={(value) => set('promptTemplate', value)}
                              className="min-h-0 resize-y rounded-[7px] border-input bg-container px-3 py-2.5 leading-[1.6] shadow-none"
                           />
                           <p data-settings-type="caption" className="text-subtle-foreground">
                              {td('runbookHint')}
                           </p>
                        </div>
                     </SettingsGroup>
                  </fieldset>

                  {autopilot && canEdit ? (
                     <SettingsGroup>
                        {status !== 'archived' ? (
                           <SettingsRow
                              title={te('active')}
                              description={te('activeHint')}
                              trailing={
                                 <Switch
                                    variant="settings"
                                    checked={status === 'active'}
                                    disabled={busy}
                                    aria-label={te('active')}
                                    onCheckedChange={(on) =>
                                       void act(
                                          () =>
                                             updateAutopilot(autopilot.id, {
                                                status: on ? 'active' : 'paused',
                                             }),
                                          on ? t('row.resumed') : t('row.paused')
                                       )
                                    }
                                 />
                              }
                           />
                        ) : null}
                        <SettingsRow
                           title={status === 'archived' ? te('restoreRow') : te('archiveRow')}
                           description={
                              status === 'archived' ? te('restoreHint') : te('archiveHint')
                           }
                           trailing={
                              <Button
                                 type="button"
                                 variant={status === 'archived' ? 'soft' : 'soft-destructive'}
                                 disabled={busy}
                                 onClick={() =>
                                    status === 'archived'
                                       ? void act(
                                            () => restoreAutopilot(autopilot.id),
                                            t('row.restored', { name: autopilot.name })
                                         )
                                       : setArchiving(true)
                                 }
                              >
                                 {status === 'archived' ? t('row.restore') : t('row.delete')}
                              </Button>
                           }
                        />
                     </SettingsGroup>
                  ) : null}
               </form>

               <aside className="flex min-w-0 flex-col gap-5">
                  <SettingsGroup>
                     <GroupTitle
                        title={te('runsTitle')}
                        caption={autopilot ? te('runsCaption') : undefined}
                     />
                     {autopilot ? (
                        <RunRows runs={runs} orgId={orgId} />
                     ) : (
                        <div className="px-4 py-3.5 text-subtle-foreground">{te('noRunsNew')}</div>
                     )}
                  </SettingsGroup>
                  {autopilot &&
                  (deliveries.length > 0 || autopilot.triggerKinds.includes('webhook')) ? (
                     <SettingsGroup>
                        <GroupTitle title={te('deliveriesTitle')} />
                        <DeliveryRows
                           autopilotId={autopilot.id}
                           deliveries={deliveries}
                           canReplay={canEdit}
                           onReplayed={onChanged}
                        />
                     </SettingsGroup>
                  ) : null}
               </aside>
            </div>
         </div>

         {autopilot ? (
            <AlertDialog open={archiving} onOpenChange={setArchiving}>
               <AlertDialogContent>
                  <AlertDialogHeader>
                     <AlertDialogTitle>
                        {t('row.confirmDeleteTitle', { name: autopilot.name })}
                     </AlertDialogTitle>
                     <AlertDialogDescription>{t('row.confirmDeleteBody')}</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                     <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
                     <AlertDialogAction
                        onClick={() =>
                           void archiveAutopilot(autopilot.id)
                              .then(() => {
                                 toast.success(t('row.deleted', { name: autopilot.name }));
                                 backToIndex();
                              })
                              .catch((failure: unknown) =>
                                 toast.error(describeAutopilotFailure(failure))
                              )
                        }
                     >
                        {t('row.delete')}
                     </AlertDialogAction>
                  </AlertDialogFooter>
               </AlertDialogContent>
            </AlertDialog>
         ) : null}
      </div>
   );
}

/** Breadcrumb bar: "Autopilots / name", then whatever the page adds on the right. */
function EditorHeader({
   title,
   onBack,
   children,
}: {
   title: string;
   onBack: () => void;
   children?: ReactNode;
}) {
   const t = useTranslations('areas.autopilots');
   return (
      <header className="flex h-[52px] min-w-0 shrink-0 items-center gap-2.5 border-b px-5">
         <h1 className="flex min-w-0 items-center gap-2.5 font-semibold tracking-[-0.01em]">
            <button
               type="button"
               onClick={onBack}
               className="cursor-pointer whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground"
            >
               {t('title')}
            </button>
            <span aria-hidden className="font-normal text-settings-field-focus">
               /
            </span>
            <span className="min-w-0 truncate">{title}</span>
         </h1>
         {children}
      </header>
   );
}

function StatusChip({ status }: { status: AutopilotDetail['status'] }) {
   const t = useTranslations('areas.autopilots');
   return (
      <span
         data-settings-type="small"
         className={cn(
            'inline-flex h-5 shrink-0 items-center gap-1.5 rounded-[5px] bg-settings-control px-[7px] whitespace-nowrap',
            status === 'active' ? 'text-status-success' : 'text-muted-foreground'
         )}
      >
         <span aria-hidden className="size-1.5 rounded-full bg-current" />
         {t(`status.${status}`)}
      </span>
   );
}

function GroupTitle({ title, caption }: { title: string; caption?: string }) {
   return (
      <div className="flex items-baseline gap-2.5 px-4 pt-3.5 pb-3">
         <h2 className="font-semibold">{title}</h2>
         {caption ? (
            <span data-settings-type="caption" className="text-subtle-foreground">
               {caption}
            </span>
         ) : null}
      </div>
   );
}

function RowLabel({
   label,
   description,
   htmlFor,
}: {
   label: string;
   description?: ReactNode;
   htmlFor?: string;
}) {
   return (
      <div className="flex min-w-0 flex-col gap-0.5">
         {htmlFor ? (
            <label htmlFor={htmlFor} className="font-medium text-foreground">
               {label}
            </label>
         ) : (
            <span className="font-medium text-foreground">{label}</span>
         )}
         {description ? (
            <span data-settings-type="caption" className="text-pretty text-subtle-foreground">
               {description}
            </span>
         ) : null}
      </div>
   );
}

/** Label and description left, the control right; stacks when the panel is narrow. */
function FieldRow({
   label,
   description,
   htmlFor,
   children,
}: {
   label: string;
   description?: ReactNode;
   htmlFor?: string;
   children: ReactNode;
}) {
   return (
      <div className="grid grid-cols-1 items-center gap-x-6 gap-y-2 px-4 py-3.5 @min-[560px]:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
         <RowLabel label={label} description={description} htmlFor={htmlFor} />
         <div className="min-w-0">{children}</div>
      </div>
   );
}

/** Who hears about every firing: chips, and a search to add one more. */
function Subscribers({
   people,
   value,
   onChange,
}: {
   people: User[];
   value: string[];
   onChange: (next: string[]) => void;
}) {
   const td = useTranslations('areas.autopilots.dialog');
   return (
      <div className="flex flex-wrap items-center gap-1.5">
         {value.map((userId) => {
            const person = people.find((entry) => entry.id === userId);
            const name = person?.name ?? userId;
            return (
               <span
                  key={userId}
                  className="inline-flex h-[26px] items-center gap-1 rounded-[6px] bg-settings-chip pr-1 pl-2 text-muted-foreground"
               >
                  {name}
                  <button
                     type="button"
                     className="inline-flex size-4 cursor-pointer items-center justify-center rounded-[4px] hover:text-foreground"
                     aria-label={td('removeSubscriber', { name })}
                     onClick={() => onChange(value.filter((entry) => entry !== userId))}
                  >
                     <X className="size-3" />
                  </button>
               </span>
            );
         })}
         <Popover>
            <PopoverTrigger asChild>
               <Button type="button" size="sm" variant="soft">
                  {td('addSubscriber')}
               </Button>
            </PopoverTrigger>
            <PopoverContent className="w-64 p-0" align="start">
               <Command>
                  <CommandInput placeholder={td('searchPeople')} />
                  <CommandList>
                     <CommandEmpty>{td('noneFound')}</CommandEmpty>
                     <CommandGroup>
                        {people
                           .filter((person) => !value.includes(person.id))
                           .map((person) => (
                              <CommandItem
                                 key={person.id}
                                 value={person.name}
                                 onSelect={() => onChange([...value, person.id])}
                              >
                                 {person.name}
                              </CommandItem>
                           ))}
                     </CommandGroup>
                  </CommandList>
               </Command>
            </PopoverContent>
         </Popover>
      </div>
   );
}
