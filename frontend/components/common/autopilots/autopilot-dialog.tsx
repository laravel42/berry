'use client';

import { ChevronDown, X } from 'lucide-react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';

import { AgentPicker } from '@/components/common/agents/agent-multiselect';
import { MarkdownTextarea } from '@/components/common/editor/markdown-textarea';
import DetailDrawerShell from '@/components/layout/detail-drawer-shell';
import { PageTitleBar } from '@/components/layout/headers/page-title-bar';
import { Button } from '@/components/ui/button';
import {
   Command,
   CommandEmpty,
   CommandGroup,
   CommandInput,
   CommandItem,
   CommandList,
} from '@/components/ui/command';
import {
   Dialog,
   DialogContent,
   DialogDescription,
   DialogFooter,
   DialogHeader,
   DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
   Select,
   SelectContent,
   SelectItem,
   SelectTrigger,
   SelectValue,
} from '@/components/ui/select';
import type { User } from '@/data/users';
import EventTriggerEditor, {
   conditionsComplete,
} from '@/components/common/loops/event-trigger-editor';
import LoopPolicyFields, {
   DEFAULT_LOOP_POLICY,
   type LoopPolicy,
} from '@/components/common/loops/loop-policy-fields';
import {
   addCronTrigger,
   addEventTrigger,
   addWebhookTrigger,
   createAutopilot,
   describeAutopilotFailure,
   EMPTY_CONDITIONS,
   setAutopilotMembers,
   updateAutopilot,
   type AccessMode,
   type Autopilot,
   type AutopilotDraft,
   type Conditions,
   type LoopEventType,
   type TemplateTrigger,
   type WebhookSecrets,
} from '@/lib/autopilots';
import { boardsIn, listBoards, type BoardSummary } from '@/lib/boards';
import { WORKSPACE_SLUG } from '@/lib/config';
import { localTimezone } from '@/lib/cron-schedule';
import { loadWorkspaceMembers } from '@/lib/members';
import { loadWorkspaceProjects } from '@/lib/projects';
import type { Project } from '@/data/projects';
import { agentHasRuntime, getAgentCoverage, type AgentCoverage } from '@/lib/runtimes';
import { useAgentsStore } from '@/store/agents-store';
import { useIssuesStore } from '@/store/issues-store';
import { useSessionStore } from '@/store/session-store';

import ScheduleEditor from './schedule-editor';
import { SecretsNotice } from './triggers-tab';

/**
 * Where a new Loop starts from: a template, a drafted sentence, or nothing.
 * Every field stays the person's to change before anything is created.
 */
export interface LoopSeed {
   name: string;
   instructions: string;
   description?: string | null;
   trigger: TemplateTrigger | null;
   assigneeId?: string | null;
   accessMode?: AccessMode;
   allowAgentEvents?: boolean;
   templateKey?: string | null;
   projectId?: string | null;
}

interface Props {
   open: boolean;
   onOpenChange: (open: boolean) => void;
   autopilot?: Autopilot;
   /** A starting point: a template, or a draft from a sentence. */
   seed?: LoopSeed | null;
   onSaved?: () => void;
   /**
    * Editing is a dialog; `inline` is the form on the New loop page, where
    * the page already names it.
    */
   presentation?: 'dialog' | 'drawer' | 'inline';
}

function AutopilotFrame({
   presentation,
   open,
   onOpenChange,
   title,
   description,
   footer,
   children,
}: {
   presentation: 'dialog' | 'drawer' | 'inline';
   open: boolean;
   onOpenChange: (open: boolean) => void;
   title: string;
   description?: string;
   /** Actions kept outside the scrolling fields when the form is a drawer. */
   footer?: ReactNode;
   children: ReactNode;
}) {
   if (presentation === 'inline') {
      return (
         <div className="flex flex-col gap-5">
            {children}
            {footer ? (
               <div className="sticky bottom-0 -mx-1 border-t bg-container px-1 py-3">{footer}</div>
            ) : null}
         </div>
      );
   }
   if (presentation === 'drawer') {
      if (!open) return null;
      return (
         <DetailDrawerShell
            header={<PageTitleBar title={title} />}
            onClose={() => onOpenChange(false)}
         >
            <div className="flex min-h-0 flex-1 flex-col">
               <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                  {description ? <p className="mb-4 text-muted-foreground">{description}</p> : null}
                  {children}
               </div>
               {footer ? (
                  <div className="shrink-0 border-t bg-container px-5 py-3">{footer}</div>
               ) : null}
            </div>
         </DetailDrawerShell>
      );
   }

   return (
      <Dialog open={open} onOpenChange={onOpenChange}>
         <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
            <DialogHeader>
               <DialogTitle>{title}</DialogTitle>
               {description ? <DialogDescription>{description}</DialogDescription> : null}
            </DialogHeader>
            {children}
            {footer}
         </DialogContent>
      </Dialog>
   );
}

/** An existing Loop's editable fields, in one fixed shape so two drafts compare. */
export function draftFromAutopilot(autopilot: Autopilot): AutopilotDraft {
   const { name, description, assigneeType, assigneeId, promptTemplate, executionMode } = autopilot;
   return {
      name,
      description,
      assigneeType,
      assigneeId,
      promptTemplate,
      executionMode,
      boardId: autopilot.boardId,
      projectId: autopilot.projectId,
      issueId: autopilot.issueId,
      quotaPeriod: autopilot.quotaPeriod,
      quotaMax: autopilot.quotaMax,
      accessMode: autopilot.accessMode,
      concurrencyPolicy: autopilot.concurrencyPolicy,
      maxTurns: autopilot.maxTurns,
      maxDurationMinutes: autopilot.maxDurationMinutes,
      maxChainDepth: autopilot.maxChainDepth,
      allowAgentEvents: autopilot.allowAgentEvents,
      templateKey: autopilot.templateKey,
   } satisfies AutopilotDraft;
}

function initialDraft(autopilot?: Autopilot, seed?: LoopSeed | null): AutopilotDraft {
   if (autopilot) return draftFromAutopilot(autopilot);
   return draftFromSeed(seed);
}

/** A new Loop's fields, from a template, a drafted sentence, or nothing. */
export function draftFromSeed(seed?: LoopSeed | null): AutopilotDraft {
   return {
      name: seed?.name ?? '',
      description: seed?.description ?? null,
      assigneeType: 'agent',
      assigneeId: seed?.assigneeId ?? '',
      promptTemplate: seed?.instructions ?? '',
      executionMode: 'create_issue',
      boardId: null,
      projectId: seed?.projectId ?? null,
      issueId: null,
      quotaPeriod: 'none',
      quotaMax: null,
      ...DEFAULT_LOOP_POLICY,
      accessMode: seed?.accessMode ?? DEFAULT_LOOP_POLICY.accessMode,
      allowAgentEvents: seed?.allowAgentEvents ?? DEFAULT_LOOP_POLICY.allowAgentEvents,
      templateKey: seed?.templateKey ?? null,
   } satisfies AutopilotDraft;
}

type FirstTrigger = 'none' | 'cron' | 'event' | 'webhook';

function seedTrigger(seed?: LoopSeed | null): FirstTrigger {
   return seed?.trigger?.kind ?? (seed ? 'none' : 'cron');
}

function policyOf(draft: AutopilotDraft): LoopPolicy {
   return {
      accessMode: draft.accessMode ?? DEFAULT_LOOP_POLICY.accessMode,
      concurrencyPolicy: draft.concurrencyPolicy ?? DEFAULT_LOOP_POLICY.concurrencyPolicy,
      maxTurns: draft.maxTurns ?? null,
      maxDurationMinutes: draft.maxDurationMinutes ?? null,
      maxChainDepth: draft.maxChainDepth ?? 0,
      allowAgentEvents: draft.allowAgentEvents ?? false,
   };
}

/**
 * An autopilot: who runs it, what they are told to do, what each run produces,
 * who hears about it, and — when it is new — what will set it off.
 *
 * An agent with nowhere to run is not offered: an autopilot assigned to one
 * would be a standing instruction that silently never fires.
 */
export default function AutopilotDialog({
   open,
   onOpenChange,
   autopilot,
   seed,
   onSaved,
   presentation = 'dialog',
}: Props) {
   const t = useTranslations('loops.dialog');
   const router = useRouter();
   const params = useParams<{ orgId?: string }>();
   const orgId = params?.orgId || WORKSPACE_SLUG;
   const workspaceId = useSessionStore((state) => state.workspace?.id ?? '');
   const agents = useAgentsStore((state) => state.agents);
   const issues = useIssuesStore((state) => state.getAllIssues());

   const [boards, setBoards] = useState<BoardSummary[]>([]);
   const [projects, setProjects] = useState<Project[]>([]);
   const [people, setPeople] = useState<User[]>([]);
   const [coverage, setCoverage] = useState<AgentCoverage | null>(null);
   const [draft, setDraft] = useState<AutopilotDraft>(() => initialDraft(autopilot, seed));
   const [subscribers, setSubscribers] = useState<string[]>([]);
   const [trigger, setTrigger] = useState<FirstTrigger>(() => seedTrigger(seed));
   const [schedule, setSchedule] = useState({
      expression: seed?.trigger?.kind === 'cron' ? seed.trigger.expression : '0 9 * * 1-5',
      timezone: localTimezone(),
   });
   const [eventTrigger, setEventTrigger] = useState<{
      eventType: LoopEventType;
      conditions: Conditions;
   }>(() =>
      seed?.trigger?.kind === 'event'
         ? { eventType: seed.trigger.eventType, conditions: seed.trigger.conditions }
         : { eventType: 'issue.created', conditions: EMPTY_CONDITIONS }
   );
   const [createPaused, setCreatePaused] = useState(false);
   const [eventFilters, setEventFilters] = useState('');
   const [secrets, setSecrets] = useState<{ id: string; secrets: WebhookSecrets } | null>(null);
   const [error, setError] = useState<string | null>(null);
   const [saving, setSaving] = useState(false);

   // Keyed on the id, not the object: the detail page re-reads the autopilot
   // whenever a frame about it arrives, and depending on the object would wipe
   // what someone is typing mid-edit.
   const autopilotKey = autopilot?.id ?? null;
   const seedKey = seed
      ? `${seed.templateKey ?? ''}:${seed.name}:${seed.instructions.length}`
      : null;
   useEffect(() => {
      if (!open) return;
      setDraft(initialDraft(autopilot, seed));
      setSubscribers([]);
      setTrigger(autopilot ? 'none' : seedTrigger(seed));
      if (seed?.trigger?.kind === 'cron')
         setSchedule((current) => ({
            ...current,
            expression:
               seed.trigger?.kind === 'cron' ? seed.trigger.expression : current.expression,
         }));
      if (seed?.trigger?.kind === 'event')
         setEventTrigger({
            eventType: seed.trigger.eventType,
            conditions: seed.trigger.conditions,
         });
      setSecrets(null);
      setError(null);
      void listBoards()
         // Only this workspace's: the list spans every workspace.
         .then((found) => setBoards(boardsIn(found, workspaceId)))
         .catch(() => setBoards([]));
      if (workspaceId) {
         void loadWorkspaceProjects(workspaceId)
            .then(setProjects)
            .catch(() => setProjects([]));
      } else {
         setProjects([]);
      }
      void getAgentCoverage()
         .then(setCoverage)
         .catch(() => setCoverage(null));
      if (workspaceId) {
         void loadWorkspaceMembers(workspaceId)
            .then(setPeople)
            .catch(() => setPeople([]));
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [open, autopilotKey, seedKey, workspaceId]);

   // A new Loop files its tasks on the workspace's board when there is only
   // the one to choose — the common case, and one field fewer to fill.
   useEffect(() => {
      if (autopilot || boards.length === 0) return;
      setDraft((current) =>
         current.executionMode === 'create_issue' && current.boardId === null && boards[0]
            ? { ...current, boardId: boards[0].id }
            : current
      );
   }, [autopilot, boards]);

   const set = <K extends keyof AutopilotDraft>(key: K, value: AutopilotDraft[K]) =>
      setDraft((current) => ({ ...current, [key]: value }));

   const runnableAgents = agents.filter((agent) => agentHasRuntime(coverage, agent.id));
   const hidden = agents.length - runnableAgents.length;
   const agentOptions = useMemo(
      () =>
         runnableAgents
            .map((agent) => ({ id: agent.id, label: agent.name }))
            .sort((left, right) => left.label.localeCompare(right.label)),
      [runnableAgents]
   );
   const assigneeName =
      runnableAgents.find((agent) => agent.id === draft.assigneeId)?.name ??
      agents.find((agent) => agent.id === draft.assigneeId)?.name;

   const listensForEvents = autopilot
      ? autopilot.triggerKinds.includes('event')
      : trigger === 'event';
   const ready =
      draft.name.trim() !== '' &&
      draft.assigneeId !== '' &&
      draft.promptTemplate.trim() !== '' &&
      (draft.executionMode === 'create_issue' ? draft.boardId !== null : draft.issueId !== null) &&
      (draft.quotaPeriod === 'none' || (draft.quotaMax !== null && draft.quotaMax >= 1)) &&
      (autopilot || trigger !== 'event' || conditionsComplete(eventTrigger.conditions));

   async function submit(event: FormEvent) {
      event.preventDefault();
      if (!ready || saving) return;
      setSaving(true);
      setError(null);
      try {
         if (autopilot) {
            await updateAutopilot(autopilot.id, draft);
            if (subscribers.length > 0) {
               await setAutopilotMembers(
                  autopilot.id,
                  subscribers.map((userId) => ({ userId, role: 'subscriber' as const }))
               );
            }
            onSaved?.();
            onOpenChange(false);
            return;
         }

         const created = await createAutopilot(workspaceId, draft, {
            status: createPaused ? 'paused' : 'active',
         });
         if (subscribers.length > 0) {
            await setAutopilotMembers(
               created.id,
               subscribers.map((userId) => ({ userId, role: 'subscriber' as const }))
            );
         }
         if (trigger === 'cron') {
            await addCronTrigger(created.id, schedule);
         } else if (trigger === 'event') {
            await addEventTrigger(created.id, eventTrigger);
         } else if (trigger === 'webhook') {
            const made = await addWebhookTrigger(
               created.id,
               eventFilters
                  .split(',')
                  .map((name) => name.trim())
                  .filter((name) => name !== '')
            );
            // The secret is readable exactly once: hold the dialog open on it
            // rather than navigating away from the only chance to copy it.
            setSecrets({ id: created.id, secrets: made.secrets });
            onSaved?.();
            return;
         }
         onSaved?.();
         onOpenChange(false);
         router.push(`/${orgId}/loop/${created.id}`);
      } catch (failure) {
         setError(describeAutopilotFailure(failure));
      } finally {
         setSaving(false);
      }
   }

   if (secrets) {
      return (
         <AutopilotFrame
            presentation={presentation}
            open={open}
            onOpenChange={onOpenChange}
            title={t('created')}
         >
            <SecretsNotice
               secrets={secrets.secrets}
               onDismiss={() => {
                  const id = secrets.id;
                  setSecrets(null);
                  onOpenChange(false);
                  router.push(`/${orgId}/loop/${id}`);
               }}
            />
         </AutopilotFrame>
      );
   }

   return (
      <AutopilotFrame
         presentation={presentation}
         open={open}
         onOpenChange={onOpenChange}
         title={autopilot ? t('edit') : t('new')}
         description={t('description')}
         footer={
            <DialogFooter className="items-center">
               {!autopilot ? (
                  <label className="mr-auto flex items-center gap-2 text-muted-foreground">
                     <input
                        type="checkbox"
                        checked={createPaused}
                        onChange={(event) => setCreatePaused(event.target.checked)}
                        className="accent-[var(--primary)]"
                     />
                     {t('createPaused')}
                  </label>
               ) : null}
               <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                  {t('cancel')}
               </Button>
               <Button type="submit" form="autopilot-form" disabled={!ready || saving}>
                  {autopilot ? t('save') : t('create')}
               </Button>
            </DialogFooter>
         }
      >
         <form id="autopilot-form" onSubmit={submit} className="flex flex-col gap-4">
            <div className="grid gap-2">
               <Label htmlFor="autopilot-name">{t('name')}</Label>
               <Input
                  id="autopilot-name"
                  value={draft.name}
                  maxLength={200}
                  onChange={(event) => set('name', event.target.value)}
               />
            </div>

            <div className="grid gap-2">
               <Label>{t('assignee')}</Label>
               <AgentPicker
                  options={agentOptions}
                  value={draft.assigneeId || null}
                  multiple={false}
                  onChange={(next) => {
                     if (typeof next === 'string') set('assigneeId', next);
                  }}
                  trigger={
                     <Button
                        type="button"
                        variant="outline"
                        className="w-full justify-between font-normal"
                     >
                        <span className="truncate">{assigneeName ?? t('chooseAssignee')}</span>
                        <ChevronDown className="size-4 shrink-0 opacity-60" />
                     </Button>
                  }
               />
               {draft.assigneeType === 'agent' && hidden > 0 ? (
                  <p className="text-muted-foreground">{t('noRuntimeHint', { count: hidden })}</p>
               ) : null}
            </div>

            <div className="grid gap-2">
               <Label htmlFor="autopilot-prompt">{t('runbook')}</Label>
               <MarkdownTextarea
                  id="autopilot-prompt"
                  rows={8}
                  maxLength={20000}
                  value={draft.promptTemplate}
                  onChange={(value) => set('promptTemplate', value)}
               />
               <p className="text-muted-foreground">{t('runbookHint')}</p>
            </div>

            {!autopilot ? (
               <div className="grid gap-2">
                  <Label>{t('firstTrigger')}</Label>
                  <div className="flex flex-wrap items-center gap-1">
                     {(['cron', 'event', 'webhook', 'none'] as const).map((kind) => (
                        <Button
                           key={kind}
                           type="button"
                           size="xs"
                           variant={trigger === kind ? 'secondary' : 'ghost'}
                           onClick={() => setTrigger(kind)}
                        >
                           {t(`trigger_${kind}`)}
                        </Button>
                     ))}
                  </div>
                  {trigger === 'cron' ? (
                     <div className="rounded-md border p-3">
                        <ScheduleEditor
                           expression={schedule.expression}
                           timezone={schedule.timezone}
                           onChange={setSchedule}
                        />
                     </div>
                  ) : null}
                  {trigger === 'event' ? (
                     <div className="rounded-md border p-3">
                        <EventTriggerEditor
                           eventType={eventTrigger.eventType}
                           conditions={eventTrigger.conditions}
                           projects={projects}
                           onChange={setEventTrigger}
                        />
                     </div>
                  ) : null}
                  {trigger === 'webhook' ? (
                     <div className="grid gap-1.5">
                        <Label htmlFor="autopilot-events">{t('eventFilters')}</Label>
                        <Input
                           id="autopilot-events"
                           value={eventFilters}
                           onChange={(event) => setEventFilters(event.target.value)}
                        />
                        <p className="text-muted-foreground">{t('eventFiltersHint')}</p>
                     </div>
                  ) : null}
               </div>
            ) : null}

            <div className="grid gap-2">
               <Label>{t('outputMode')}</Label>
               <Select
                  value={draft.executionMode}
                  onValueChange={(value) =>
                     setDraft((current) => ({
                        ...current,
                        executionMode: value === 'fixed_issue' ? 'fixed_issue' : 'create_issue',
                        boardId: null,
                        projectId: null,
                        issueId: null,
                     }))
                  }
               >
                  <SelectTrigger>
                     <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                     <SelectItem value="create_issue">{t('createIssue')}</SelectItem>
                     <SelectItem value="fixed_issue">{t('fixedIssue')}</SelectItem>
                  </SelectContent>
               </Select>
            </div>

            {draft.executionMode === 'create_issue' ? (
               <>
                  <div className="grid gap-2">
                     <Label>{t('board')}</Label>
                     <Select
                        value={draft.boardId ?? ''}
                        onValueChange={(value) => set('boardId', value)}
                     >
                        <SelectTrigger>
                           <SelectValue placeholder={t('chooseBoard')} />
                        </SelectTrigger>
                        <SelectContent>
                           {boards.map((board) => (
                              <SelectItem key={board.id} value={board.id}>
                                 {board.name}
                              </SelectItem>
                           ))}
                        </SelectContent>
                     </Select>
                  </div>
                  <div className="grid gap-2">
                     <Label>{t('project')}</Label>
                     <Select
                        value={draft.projectId ?? 'none'}
                        onValueChange={(value) => set('projectId', value === 'none' ? null : value)}
                     >
                        <SelectTrigger>
                           <SelectValue placeholder={t('chooseProject')} />
                        </SelectTrigger>
                        <SelectContent>
                           <SelectItem value="none">{t('projectNone')}</SelectItem>
                           {projects.map((project) => (
                              <SelectItem key={project.id} value={project.id}>
                                 {project.name}
                              </SelectItem>
                           ))}
                        </SelectContent>
                     </Select>
                     <p className="text-muted-foreground">{t('projectHint')}</p>
                  </div>
               </>
            ) : (
               <div className="grid gap-2">
                  <Label>{t('task')}</Label>
                  <Select
                     value={draft.issueId ?? ''}
                     onValueChange={(value) => set('issueId', value)}
                  >
                     <SelectTrigger>
                        <SelectValue placeholder={t('chooseTask')} />
                     </SelectTrigger>
                     <SelectContent>
                        {issues.map((issue) => (
                           <SelectItem key={issue.id} value={issue.id}>
                              {issue.identifier} · {issue.title}
                           </SelectItem>
                        ))}
                     </SelectContent>
                  </Select>
               </div>
            )}

            <div className="grid grid-cols-2 gap-3">
               <div className="grid gap-2">
                  <Label>{t('quota')}</Label>
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
                     <SelectTrigger>
                        <SelectValue />
                     </SelectTrigger>
                     <SelectContent>
                        <SelectItem value="none">{t('quotaNone')}</SelectItem>
                        <SelectItem value="hour">{t('quotaHour')}</SelectItem>
                        <SelectItem value="day">{t('quotaDay')}</SelectItem>
                        <SelectItem value="week">{t('quotaWeek')}</SelectItem>
                     </SelectContent>
                  </Select>
               </div>
               {draft.quotaPeriod !== 'none' ? (
                  <div className="grid gap-2">
                     <Label htmlFor="autopilot-quota">{t('quotaMax')}</Label>
                     <Input
                        id="autopilot-quota"
                        type="number"
                        min={1}
                        max={10000}
                        value={draft.quotaMax ?? 1}
                        onChange={(event) =>
                           set('quotaMax', Math.max(1, Number(event.target.value) || 1))
                        }
                     />
                  </div>
               ) : null}
            </div>

            <div className="grid gap-2">
               <Label>{t('subscribers')}</Label>
               {subscribers.length > 0 ? (
                  <ul className="flex flex-wrap gap-2">
                     {subscribers.map((userId) => {
                        const person = people.find((entry) => entry.id === userId);
                        return (
                           <li
                              key={userId}
                              className="flex items-center gap-1 rounded border px-2 py-0.5"
                           >
                              {person?.name ?? userId}
                              <button
                                 type="button"
                                 className="cursor-pointer"
                                 aria-label={t('removeSubscriber', {
                                    name: person?.name ?? userId,
                                 })}
                                 onClick={() =>
                                    setSubscribers((current) =>
                                       current.filter((entry) => entry !== userId)
                                    )
                                 }
                              >
                                 <X className="size-3" />
                              </button>
                           </li>
                        );
                     })}
                  </ul>
               ) : null}
               <Popover>
                  <PopoverTrigger asChild>
                     <Button type="button" size="xs" variant="secondary" className="w-fit">
                        {t('addSubscriber')}
                     </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-64 p-0" align="start">
                     <Command>
                        <CommandInput placeholder={t('searchPeople')} />
                        <CommandList>
                           <CommandEmpty>{t('noneFound')}</CommandEmpty>
                           <CommandGroup>
                              {people
                                 .filter((person) => !subscribers.includes(person.id))
                                 .map((person) => (
                                    <CommandItem
                                       key={person.id}
                                       value={person.name}
                                       onSelect={() =>
                                          setSubscribers((current) => [...current, person.id])
                                       }
                                    >
                                       {person.name}
                                    </CommandItem>
                                 ))}
                           </CommandGroup>
                        </CommandList>
                     </Command>
                  </PopoverContent>
               </Popover>
               <p className="text-muted-foreground">{t('subscribersHint')}</p>
            </div>

            <div className="grid gap-2 border-t pt-4">
               <LoopPolicyFields
                  value={policyOf(draft)}
                  onChange={(next) => setDraft((current) => ({ ...current, ...next }))}
                  listensForEvents={listensForEvents}
               />
            </div>

            {error ? (
               <p className="text-destructive" role="alert">
                  {error}
               </p>
            ) : null}
         </form>
      </AutopilotFrame>
   );
}
