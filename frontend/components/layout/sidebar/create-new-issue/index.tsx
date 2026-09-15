'use client';

import { BerryMark } from '@/components/brand/berry-mark';
import { MarkdownTextarea } from '@/components/common/editor/markdown-textarea';
import { useRunConfirm } from '@/components/common/issues/run-confirm-dialog';
import { ProjectDateSelector } from '@/components/common/projects/create-project/date-selector';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
   Dialog,
   DialogContent,
   DialogDescription,
   DialogHeader,
   DialogTitle,
   DialogTrigger,
} from '@/components/ui/dialog';
import {
   DropdownMenu,
   DropdownMenuContent,
   DropdownMenuItem,
   DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Issue } from '@/data/issues';
import type { LabelInterface } from '@/data/labels';
import { priorities } from '@/data/priorities';
import { status } from '@/data/status';
import { BerryApiError } from '@/lib/api';
import { uploadIssueAttachment } from '@/lib/attachments';
import { toUiUser } from '@/lib/catalog';
import { WORKSPACE_NAME, WORKSPACE_SLUG } from '@/lib/config';
import { setIssueLabels } from '@/lib/issue-labels';
import { setParent } from '@/lib/issue-tracking';
import { createBoardIssue, rankFromSortOrder } from '@/lib/issues';
import { loadWorkspaceLabels } from '@/lib/labels';
import { loadProperties, setIssueProperty, type PropertyDefinition } from '@/lib/properties';
import { useAgentsStore } from '@/store/agents-store';
import { useCreateIssueStore, type CreateIssueMode } from '@/store/create-issue-store';
import { useIssuesStore } from '@/store/issues-store';
import { useSessionStore } from '@/store/session-store';
import { useUiPrefsStore } from '@/store/ui-prefs-store';
import { RiEditLine } from '@remixicon/react';
import { format } from 'date-fns';
import { CheckIcon, ChevronRight, Paperclip, PenLine, Plus, TagIcon, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { v4 as uuidv4 } from 'uuid';
import { AssigneeSelector, isOrchestrator } from './assignee-selector';
import { PrioritySelector } from './priority-selector';
import { ProjectSelector } from './project-selector';
import { StatusSelector } from './status-selector';

/**
 * Creating a task.
 *
 * Two ways in. *Write it* is the form: title, description, and whichever
 * properties are worth setting up front. *Hand it to an agent* is one box —
 * say what you want, choose who does it — and the task is written from that:
 * the first line becomes the title, the whole prompt the description, the
 * agent the assignee. From there the two paths are the same path, including
 * the question of whether the agent starts now.
 *
 * Everything that cannot be set at creation time — labels, custom fields, a
 * parent — is applied immediately afterwards, in that order, and a failure in
 * any of them is reported without pretending the task was not created. It was.
 */

/** Titles longer than this are cut at a word; the full text is the description. */
const TITLE_LIMIT = 120;

function parseDraftDate(value: string): Date | undefined {
   if (!value) return undefined;
   const parsed = new Date(`${value}T00:00:00`);
   return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

function toDraftDate(date?: Date): string {
   return date ? format(date, 'yyyy-MM-dd') : '';
}

/** The first line of the prompt, as a title: trimmed, unmarked, cut at a word. */
export function titleFromPrompt(prompt: string): string {
   const line =
      prompt
         .split('\n')
         .map((entry) => entry.trim())
         .find(Boolean) ?? '';
   const bare = line.replace(/^(#{1,6}\s+|[-*]\s+|\d+[.)]\s+)/, '').trim();
   if (bare.length <= TITLE_LIMIT) return bare;
   const cut = bare.slice(0, TITLE_LIMIT);
   const atWord = cut.lastIndexOf(' ');
   return `${(atWord > TITLE_LIMIT / 2 ? cut.slice(0, atWord) : cut).trimEnd()}…`;
}

export function CreateNewIssue() {
   const t = useTranslations('issueDetail.create');
   const tp = useTranslations('issueDetail.properties');
   const ta = useTranslations('issueLists.assignee');
   const {
      isOpen,
      context,
      draft,
      createAnother,
      mode,
      openModal,
      closeModal,
      setDraft,
      resetDraft,
      setCreateAnother,
      setMode,
   } = useCreateIssueStore();
   const { addIssue, getAllIssues } = useIssuesStore();
   const agents = useAgentsStore((state) => state.agents);
   const boardId = useSessionStore((state) => state.boardId);
   const workspaceId = useSessionStore((state) => state.workspace?.id ?? '');
   const workspaceName = useSessionStore((state) => state.workspace?.name) ?? WORKSPACE_NAME;
   const runConfirm = useRunConfirm();
   const promptId = useId();

   // Preferences → Tasks decides which of these selectors are worth the
   // room. A hidden one is not a missing value: the form still carries its
   // default and still sends it, so the task is created exactly as before.
   const createFields = useUiPrefsStore((state) => state.createFields);
   const [pending, setPending] = useState(false);
   const [labels, setLabels] = useState<LabelInterface[]>([]);
   const [definitions, setDefinitions] = useState<PropertyDefinition[]>([]);
   const [revealedFields, setRevealedFields] = useState<string[]>([]);
   const [files, setFiles] = useState<File[]>([]);
   const picker = useRef<HTMLInputElement>(null);

   const agentMode = mode === 'agent';
   const orchestrator = useMemo(
      () => agents.find((agent) => !agent.archivedAt && isOrchestrator(agent)) ?? null,
      [agents]
   );
   const chosenAgent = useMemo(
      () => (draft.agent ? (agents.find((agent) => agent.id === draft.agent?.id) ?? null) : null),
      [agents, draft.agent]
   );

   // Handing over starts from the Orchestrator: its whole job is to send a
   // task to the role that fits, so a person who has not learned the roster
   // yet does not have to. Picking someone else is one click on the picker.
   useEffect(() => {
      if (!isOpen || !agentMode || draft.agent || !orchestrator) return;
      setDraft({ agent: { id: orchestrator.id, name: orchestrator.name } });
   }, [isOpen, agentMode, draft.agent, orchestrator, setDraft]);

   const uiStatus =
      status.find((entry) => entry.id === draft.statusId) ??
      context.defaultStatus ??
      status.find((entry) => entry.id === 'to-do')!;
   const uiPriority =
      priorities.find((entry) => entry.id === draft.priorityId) ??
      priorities.find((entry) => entry.id === 'no-priority')!;

   useEffect(() => {
      if (!isOpen || !workspaceId) return;
      void loadWorkspaceLabels(workspaceId).then(setLabels);
      void loadProperties(workspaceId)
         .then((loaded) => setDefinitions(loaded.filter((entry) => entry.archivedAt === null)))
         .catch(() => setDefinitions([]));
      // Each open is a new attempt for custom fields; title/description may stay.
      setRevealedFields([]);
      setDraft({ properties: {} });
   }, [isOpen, workspaceId, setDraft]);

   const shownFields = useMemo(
      () =>
         definitions.filter(
            (definition) =>
               revealedFields.includes(definition.id) ||
               (draft.properties[definition.id] !== undefined &&
                  draft.properties[definition.id] !== null &&
                  draft.properties[definition.id] !== '')
         ),
      [definitions, revealedFields, draft.properties]
   );

   const addableFields = useMemo(
      () =>
         definitions.filter(
            (definition) => !shownFields.some((entry) => entry.id === definition.id)
         ),
      [definitions, shownFields]
   );

   // The agent picker wants a User; the draft keeps only what it needs to
   // remember across a reload.
   const agentUser = useMemo(
      () =>
         draft.agent
            ? toUiUser({ id: draft.agent.id, name: draft.agent.name, type: 'agent' })
            : null,
      [draft.agent]
   );
   const promptTitle = agentMode ? titleFromPrompt(draft.prompt) : '';

   const localIssue = useCallback(
      (created: Issue): Issue => {
         const sortOrder = (getAllIssues().length + 1) * 1000;
         return {
            ...created,
            id: created.id || uuidv4(),
            rank: created.rank || rankFromSortOrder(sortOrder),
         };
      },
      [getAllIssues]
   );

   /** Everything that can only be done once the task has an id. */
   const applyExtras = async (created: Issue) => {
      // Labels and custom fields are set in the form; the hand-over has no
      // controls for them, so a selection left over from the form is not sent.
      if (!agentMode && draft.labelIds.length > 0) {
         await setIssueLabels(created.identifier, draft.labelIds).catch(() =>
            toast.error(t('failed'))
         );
      }
      if (!agentMode) {
         for (const [propertyId, value] of Object.entries(draft.properties)) {
            if (value === null || value === '' || value === undefined) continue;
            await setIssueProperty(created.identifier, propertyId, value).catch(() => undefined);
         }
      }
      if (context.parentRef) {
         await setParent(created.identifier, context.parentRef, null).catch(() =>
            toast.error(t('failed'))
         );
      }
      for (const file of files) {
         await uploadIssueAttachment(created.identifier, file).catch(() => undefined);
      }
   };

   const finish = () => {
      setFiles([]);
      setRevealedFields([]);
      if (createAnother) {
         // Keep the context — the column, the parent — and clear what was typed.
         resetDraft();
         return;
      }
      resetDraft();
      closeModal();
   };

   const duplicateToast = (error: BerryApiError) => {
      const details = (error.details ?? {}) as { identifier?: unknown; issueId?: unknown };
      const identifier =
         typeof details.identifier === 'string'
            ? details.identifier
            : typeof details.issueId === 'string'
              ? details.issueId
              : null;
      toast.error(t('duplicate'), {
         action: identifier
            ? {
                 label: t('viewExisting'),
                 onClick: () => {
                    window.location.href = `/${WORKSPACE_SLUG}/issue/${identifier}`;
                 },
              }
            : undefined,
      });
   };

   const create = async () => {
      // What the task will say, from whichever mode is open.
      let title: string;
      let description: string | undefined;
      let assignee: { type: 'user' | 'agent'; id: string; name: string } | null;
      if (agentMode) {
         const prompt = draft.prompt.trim();
         if (!prompt) {
            toast.error(t('promptRequired'));
            return;
         }
         if (!draft.agent) {
            toast.error(t('agentRequired'));
            return;
         }
         title = titleFromPrompt(prompt);
         description = prompt;
         assignee = { type: 'agent', id: draft.agent.id, name: draft.agent.name };
      } else {
         title = draft.title.trim();
         if (!title) {
            toast.error(t('titleRequired'));
            return;
         }
         description = draft.description || undefined;
         assignee = draft.assignee;
      }
      if (!boardId) {
         toast.error('Board is not ready');
         return;
      }
      const projectId = agentMode
         ? (context.projectId ?? undefined)
         : (draft.projectId ?? context.projectId ?? undefined);
      const willStart = assignee?.type === 'agent';

      // Handing work to an agent is two decisions: assign, and start. Asked
      // once, here, rather than assumed.
      let startNow = true;
      if (willStart) {
         const answer = await runConfirm.ask({
            target: {
               kind: 'agent',
               name: assignee?.name ?? '',
            },
         });
         if (answer === null) return;
         startNow = answer;
      }

      setPending(true);
      try {
         const created = await createBoardIssue({
            boardId,
            title,
            description,
            // Not starting means the task waits in the backlog, which is the
            // one state an assigned agent is never dispatched from. Starting
            // means the opposite: an agent-assigned task outside the backlog
            // is picked up by dispatch as soon as it exists.
            statusId: willStart && !startNow ? 'backlog' : uiStatus.id,
            priorityId: uiPriority.id,
            assignee: assignee ? { type: assignee.type, id: assignee.id } : undefined,
            projectId,
            dueDate: agentMode ? undefined : draft.targetDate || undefined,
         });

         addIssue(localIssue(created));
         await applyExtras(created);
         if (agentMode && assignee) {
            toast.success(
               startNow
                  ? t('agentCreated', { name: assignee.name })
                  : t('agentAssigned', { name: assignee.name })
            );
         } else {
            toast.success(t('created'));
         }
         finish();
      } catch (error) {
         if (error instanceof BerryApiError && error.status === 409) duplicateToast(error);
         else toast.error(error instanceof BerryApiError ? error.message : t('failed'));
      } finally {
         setPending(false);
      }
   };

   const toggleLabel = (labelId: string) =>
      setDraft({
         labelIds: draft.labelIds.includes(labelId)
            ? draft.labelIds.filter((id) => id !== labelId)
            : [...draft.labelIds, labelId],
      });

   return (
      <Dialog open={isOpen} onOpenChange={(value) => (value ? openModal() : closeModal())}>
         <DialogTrigger asChild>
            <Button
               className="size-8 shrink-0"
               variant="secondary"
               size="icon"
               aria-label={t('title')}
            >
               <RiEditLine />
            </Button>
         </DialogTrigger>
         <DialogContent
            showCloseButton={false}
            className="top-[10vh] w-full translate-y-0 p-0 shadow-xl sm:max-w-[750px]"
         >
            <DialogHeader className="px-4 pt-4 pb-0">
               <DialogTitle className="sr-only">{t('title')}</DialogTitle>
               <DialogDescription className="sr-only">
                  {agentMode ? t('promptPlaceholder') : t('descriptionPlaceholder')}
               </DialogDescription>
               <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-1.5 text-muted-foreground">
                     <BerryMark size="sm" />
                     <span className="truncate font-medium text-foreground">{workspaceName}</span>
                     <ChevronRight className="size-3.5 shrink-0" aria-hidden />
                     <span className="truncate">{t('title')}</span>
                     {context.parentRef ? (
                        <span className="ml-1 shrink-0 rounded bg-accent px-1.5">
                           {t('parentLocked', { identifier: context.parentRef })}
                        </span>
                     ) : null}
                  </div>
                  <Button
                     type="button"
                     variant="ghost"
                     size="icon"
                     className="size-8 shrink-0"
                     aria-label="Close"
                     onClick={closeModal}
                  >
                     <X className="size-4" />
                  </Button>
               </div>
            </DialogHeader>

            <Tabs
               value={mode}
               onValueChange={(value) => setMode(value as CreateIssueMode)}
               className="min-w-0 gap-2"
            >
               <div className="px-4">
                  <TabsList aria-label={t('mode')} className="h-8">
                     <TabsTrigger value="manual">
                        <PenLine className="size-3.5" aria-hidden />
                        {t('manual')}
                     </TabsTrigger>
                     <TabsTrigger value="agent">
                        <BerryMark
                           size="sm"
                           tone="working"
                           bracketClassName="text-actor-agent"
                           className="[&_circle]:text-actor-agent"
                        />
                        {t('agent')}
                     </TabsTrigger>
                  </TabsList>
               </div>

               <TabsContent
                  value="manual"
                  className="max-h-[52vh] w-full space-y-1 overflow-y-auto px-4 pb-0"
               >
                  <Input
                     data-heading="h1"
                     className="h-auto border-none bg-transparent px-0 font-medium text-foreground shadow-none outline-none placeholder:font-normal placeholder:text-foreground/40"
                     placeholder={t('titlePlaceholder')}
                     value={draft.title}
                     onChange={(event) => setDraft({ title: event.target.value })}
                  />

                  <MarkdownTextarea
                     data-heading="h3"
                     className="min-h-56 resize-none border-none bg-transparent px-0 text-foreground shadow-none outline-none placeholder:text-foreground/40"
                     placeholder={t('descriptionPlaceholder')}
                     value={draft.description}
                     onChange={(description) => setDraft({ description })}
                  />

                  <div className="flex w-full flex-wrap items-center justify-start gap-1.5">
                     {createFields.status ? (
                        <StatusSelector
                           status={uiStatus}
                           onChange={(next) => setDraft({ statusId: next.id })}
                        />
                     ) : null}
                     {createFields.priority ? (
                        <PrioritySelector
                           priority={uiPriority}
                           onChange={(next) => setDraft({ priorityId: next.id })}
                        />
                     ) : null}
                     {createFields.assignee ? (
                        <AssigneeSelector
                           assignee={null}
                           onChange={(next) =>
                              setDraft({
                                 assignee: next
                                    ? {
                                         type: next.role === 'Application' ? 'agent' : 'user',
                                         id: next.id,
                                         name: next.name,
                                      }
                                    : null,
                              })
                           }
                        />
                     ) : null}
                     {createFields.project ? (
                        <ProjectSelector
                           project={undefined}
                           onChange={(next) => setDraft({ projectId: next?.id ?? null })}
                        />
                     ) : null}

                     <ProjectDateSelector
                        label={t('dueDate')}
                        date={parseDraftDate(draft.targetDate)}
                        onChange={(targetDate) => setDraft({ targetDate: toDraftDate(targetDate) })}
                     />
                     <Popover>
                        <PopoverTrigger asChild>
                           <Button variant="secondary" size="xs">
                              <TagIcon className="size-3.5" />
                              {draft.labelIds.length > 0
                                 ? `${t('labels')} · ${draft.labelIds.length}`
                                 : t('labels')}
                           </Button>
                        </PopoverTrigger>
                        <PopoverContent align="start" className="max-h-56 w-56 overflow-y-auto p-1">
                           {labels.map((label) => (
                              <button
                                 key={label.id}
                                 type="button"
                                 onClick={() => toggleLabel(label.id)}
                                 className="flex w-full min-w-0 items-center gap-2 rounded px-2 py-1 text-left hover:bg-accent"
                              >
                                 <span
                                    className="size-2 shrink-0 rounded-full"
                                    style={{ backgroundColor: label.color }}
                                 />
                                 <span className="min-w-0 truncate">{label.name}</span>
                                 {draft.labelIds.includes(label.id) ? (
                                    <CheckIcon className="ml-auto size-3.5" />
                                 ) : null}
                              </button>
                           ))}
                        </PopoverContent>
                     </Popover>

                     {shownFields.map((definition) => {
                        const raw = draft.properties[definition.id];
                        const filled = raw !== undefined && raw !== null && raw !== '';
                        return (
                           <Popover key={definition.id}>
                              <PopoverTrigger asChild>
                                 <Button variant="secondary" size="xs">
                                    <span className="truncate">
                                       {filled
                                          ? `${definition.name} · ${String(raw)}`
                                          : definition.name}
                                    </span>
                                 </Button>
                              </PopoverTrigger>
                              <PopoverContent align="start" className="w-56 p-2">
                                 <Input
                                    autoFocus
                                    aria-label={definition.name}
                                    className="h-7"
                                    type={
                                       definition.kind === 'number'
                                          ? 'number'
                                          : definition.kind === 'date'
                                            ? 'date'
                                            : 'text'
                                    }
                                    placeholder={definition.name}
                                    value={String(raw ?? '')}
                                    onChange={(event) =>
                                       setDraft({
                                          properties: {
                                             ...draft.properties,
                                             [definition.id]:
                                                definition.kind === 'number'
                                                   ? event.target.value === ''
                                                      ? ''
                                                      : Number(event.target.value)
                                                   : event.target.value,
                                          },
                                       })
                                    }
                                 />
                              </PopoverContent>
                           </Popover>
                        );
                     })}

                     {definitions.length > 0 ? (
                        <DropdownMenu>
                           <DropdownMenuTrigger asChild>
                              <Button
                                 variant="secondary"
                                 size="xs"
                                 aria-label={tp('addProperty')}
                                 title={tp('addProperty')}
                              >
                                 <Plus className="size-3.5" />
                                 {t('properties')}
                              </Button>
                           </DropdownMenuTrigger>
                           <DropdownMenuContent align="start" className="max-h-72 overflow-y-auto">
                              {addableFields.length === 0 ? (
                                 <DropdownMenuItem disabled>{tp('noProperties')}</DropdownMenuItem>
                              ) : (
                                 addableFields.map((definition) => (
                                    <DropdownMenuItem
                                       key={definition.id}
                                       onClick={() =>
                                          setRevealedFields((current) => [
                                             ...current,
                                             definition.id,
                                          ])
                                       }
                                    >
                                       {definition.name}
                                    </DropdownMenuItem>
                                 ))
                              )}
                           </DropdownMenuContent>
                        </DropdownMenu>
                     ) : null}
                  </div>
               </TabsContent>

               <TabsContent
                  value="agent"
                  className="max-h-[52vh] w-full min-w-0 space-y-3 overflow-y-auto px-4 pb-0"
               >
                  <label htmlFor={promptId} className="sr-only">
                     {t('promptLabel')}
                  </label>
                  <Textarea
                     id={promptId}
                     data-heading="h3"
                     autoFocus
                     rows={6}
                     className="min-h-40 w-full min-w-0 max-w-full resize-none border-none bg-transparent px-0 text-foreground shadow-none focus-visible:ring-0"
                     placeholder={t('promptPlaceholder')}
                     value={draft.prompt}
                     onChange={(event) => setDraft({ prompt: event.target.value })}
                  />
                  <div className="flex w-full min-w-0 flex-col gap-1.5">
                     <div className="flex w-full min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5">
                        <AssigneeSelector
                           scope="agents"
                           placeholder={t('pickAgent')}
                           assignee={agentUser}
                           onChange={(next) =>
                              setDraft({ agent: next ? { id: next.id, name: next.name } : null })
                           }
                        />
                        {promptTitle ? (
                           <p className="min-w-0 flex-1 truncate text-muted-foreground">
                              {t('titlePreview', { title: promptTitle })}
                           </p>
                        ) : null}
                     </div>
                     {chosenAgent && isOrchestrator(chosenAgent) ? (
                        <p className="text-muted-foreground">{ta('orchestratorHint')}</p>
                     ) : chosenAgent?.description ? (
                        <p
                           className="truncate text-muted-foreground"
                           title={chosenAgent.description}
                        >
                           {chosenAgent.description}
                        </p>
                     ) : null}
                  </div>
               </TabsContent>
            </Tabs>

            <div className="flex flex-wrap items-center gap-2 px-4">
               <Button variant="ghost" size="xs" onClick={() => picker.current?.click()}>
                  <Paperclip className="mr-1 size-3.5" />
                  {t('attachments')}
                  {files.length > 0 ? ` · ${files.length}` : ''}
               </Button>
               <input
                  ref={picker}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
               />
            </div>

            <div className="flex w-full items-center justify-between gap-3 border-t px-4 py-2.5">
               <label className="flex items-center gap-2 text-muted-foreground">
                  <Checkbox
                     checked={createAnother}
                     onCheckedChange={(checked) => setCreateAnother(checked === true)}
                  />
                  {t('createAnother')}
               </label>
               <Button size="sm" disabled={pending} onClick={() => void create()}>
                  {pending ? t('creating') : t('create')}
               </Button>
            </div>
         </DialogContent>
         {runConfirm.dialog}
      </Dialog>
   );
}
