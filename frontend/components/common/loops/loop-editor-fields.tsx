'use client';

import { ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, type ReactNode } from 'react';

import { BerryMark } from '@/components/brand/berry-mark';
import { AgentPicker } from '@/components/common/agents/agent-multiselect';
import { useWorkspaceProjects } from '@/components/common/autopilots/triggers-tab';
import { MarkdownTextarea } from '@/components/common/editor/markdown-textarea';
import {
   InsetSegments,
   SectionCard,
   SettingRow,
   SwitchRow,
   insetFieldClass,
} from '@/components/common/loops/loop-editor-parts';
import {
   Select,
   SelectContent,
   SelectItem,
   SelectTrigger,
   SelectValue,
} from '@/components/ui/select';
import type { AutopilotDraft } from '@/lib/autopilots';
import type { BoardSummary } from '@/lib/boards';
import { agentHasRuntime, type AgentCoverage } from '@/lib/runtimes';
import { cn } from '@/lib/utils';
import { useAgentsStore } from '@/store/agents-store';
import { useIssuesStore } from '@/store/issues-store';

/** The server's hard limit on Loop chains (`MAX_CHAIN_DEPTH`). */
const MAX_CHAIN_DEPTH = 3;

/** Every field a save needs, filled; the server checks the rest. */
export function draftReady(draft: AutopilotDraft): boolean {
   return (
      draft.name.trim() !== '' &&
      draft.assigneeId !== '' &&
      draft.promptTemplate.trim() !== '' &&
      (draft.executionMode === 'create_issue' ? draft.boardId !== null : draft.issueId !== null) &&
      (draft.quotaPeriod === 'none' || (draft.quotaMax !== null && draft.quotaMax >= 1))
   );
}

/**
 * A Loop's own fields, as the sections of its page: General, Instructions,
 * then whatever trigger card the page brings, then Limits. Only what Berry
 * honours is shown; "Ask before acting" (the access mode) leads Limits. The
 * same for a Loop being created and one being edited, so the two cannot
 * drift apart.
 */
export function LoopEditorFields({
   draft,
   onPatch,
   editable,
   boards,
   coverage,
   listensForEvents,
   trigger,
}: {
   draft: AutopilotDraft;
   onPatch: (patch: Partial<AutopilotDraft>) => void;
   editable: boolean;
   boards: BoardSummary[];
   coverage: AgentCoverage | null;
   listensForEvents: boolean;
   trigger: ReactNode;
}) {
   const te = useTranslations('loops.editor');
   const td = useTranslations('loops.dialog');
   const tp = useTranslations('loops.policy');
   const agents = useAgentsStore((state) => state.agents);
   const issues = useIssuesStore((state) => state.getAllIssues());
   const projects = useWorkspaceProjects();

   const set = <K extends keyof AutopilotDraft>(key: K, value: AutopilotDraft[K]) =>
      onPatch({ [key]: value } as Partial<AutopilotDraft>);
   const patch = onPatch;

   // Only agents that can run are offered, plus whoever already runs it.
   const agentOptions = agents
      .filter((agent) => agentHasRuntime(coverage, agent.id) || agent.id === draft.assigneeId)
      .map((agent) => ({ id: agent.id, label: agent.name }))
      .sort((left, right) => left.label.localeCompare(right.label));
   const hiddenAgents = agents.length - agentOptions.length;

   // Each run opens its task on the workspace's board; there is no choice to
   // make, so none is shown. A Loop that somehow has none is given it.
   const firstBoard = boards[0]?.id ?? null;
   useEffect(() => {
      if (
         editable &&
         draft.executionMode === 'create_issue' &&
         draft.boardId === null &&
         firstBoard
      ) {
         onPatch({ boardId: firstBoard });
      }
   }, [editable, draft.executionMode, draft.boardId, firstBoard, onPatch]);
   const draftAgentName =
      agents.find((agent) => agent.id === draft.assigneeId)?.name ?? td('chooseAssignee');

   return (
      <>
         <SectionCard title={te('general')}>
            <SettingRow label={td('name')} hint={te('nameHint')} htmlFor="loop-name">
               <input
                  id="loop-name"
                  className={insetFieldClass}
                  value={draft.name}
                  maxLength={200}
                  disabled={!editable}
                  placeholder={te('namePlaceholder')}
                  onChange={(event) => set('name', event.target.value)}
               />
            </SettingRow>
            <SettingRow
               label={te('description')}
               hint={te('descriptionHint')}
               htmlFor="loop-description"
            >
               <input
                  id="loop-description"
                  className={insetFieldClass}
                  value={draft.description ?? ''}
                  maxLength={500}
                  disabled={!editable}
                  placeholder={te('optional')}
                  onChange={(event) => set('description', event.target.value || null)}
               />
            </SettingRow>
            <SettingRow
               label={te('agent')}
               hint={
                  hiddenAgents > 0 ? td('noRuntimeHint', { count: hiddenAgents }) : te('agentHint')
               }
            >
               <AgentPicker
                  options={agentOptions}
                  value={draft.assigneeId || null}
                  multiple={false}
                  disabled={!editable}
                  onChange={(next) => {
                     if (typeof next === 'string') set('assigneeId', next);
                  }}
                  trigger={
                     <button
                        type="button"
                        disabled={!editable}
                        className={cn(insetFieldClass, 'flex items-center gap-2 text-left')}
                     >
                        <BerryMark size="sm" tone="working" label="" />
                        <span className="min-w-0 flex-1 truncate">{draftAgentName}</span>
                        <ChevronDown className="size-3.5 shrink-0 text-subtle-foreground" />
                     </button>
                  }
               />
            </SettingRow>
            {draft.executionMode === 'create_issue' ? (
               <SettingRow label={td('project')} hint={td('projectHint')}>
                  <InsetSelect
                     value={draft.projectId ?? 'none'}
                     disabled={!editable}
                     onChange={(value) => set('projectId', value === 'none' ? null : value)}
                     options={[
                        { value: 'none', label: td('projectNone') },
                        ...projects.map((project) => ({
                           value: project.id,
                           label: project.name,
                        })),
                     ]}
                  />
               </SettingRow>
            ) : (
               // A Loop set up earlier to work on one standing task keeps it here.
               <SettingRow label={td('task')} hint={te('taskHint')}>
                  <InsetSelect
                     value={draft.issueId ?? ''}
                     placeholder={td('chooseTask')}
                     disabled={!editable}
                     onChange={(value) => set('issueId', value)}
                     options={issues.map((issue) => ({
                        value: issue.id,
                        label: `${issue.identifier} · ${issue.title}`,
                     }))}
                  />
               </SettingRow>
            )}
         </SectionCard>

         <SectionCard title={td('runbook')} hint={te('instructionsHint')}>
            <div className="px-4 pb-4">
               <MarkdownTextarea
                  id="loop-instructions"
                  aria-label={td('runbook')}
                  rows={9}
                  maxLength={20000}
                  disabled={!editable}
                  value={draft.promptTemplate}
                  onChange={(value) => set('promptTemplate', value)}
                  className="min-h-40 w-full resize-y rounded-[7px] border border-border/70 bg-background px-3 py-2.5 leading-relaxed"
               />
               <p className="mt-2 text-pretty text-subtle-foreground">{te('instructionsNote')}</p>
            </div>
         </SectionCard>

         {trigger}

         <SectionCard title={tp('limits')} hint={te('limitsHint')}>
            <SwitchRow
               label={te('askFirst')}
               hint={
                  draft.accessMode === 'act' ? (
                     <span className="text-status-warning">{tp('act.warning')}</span>
                  ) : (
                     tp('recommend.body')
                  )
               }
               checked={draft.accessMode !== 'act'}
               disabled={!editable}
               onCheckedChange={(on) => set('accessMode', on ? 'recommend' : 'act')}
            />
            <SwitchRow
               label={tp('concurrencyLabel')}
               hint={tp('concurrencyHint')}
               checked={draft.concurrencyPolicy === 'skip_if_running'}
               disabled={!editable}
               onCheckedChange={(on) => set('concurrencyPolicy', on ? 'skip_if_running' : 'allow')}
            />
            <SettingRow label={tp('maxTurns')} hint={tp('maxTurnsHint')} htmlFor="loop-turns">
               <NumberInput
                  id="loop-turns"
                  value={draft.maxTurns ?? null}
                  min={1}
                  max={500}
                  disabled={!editable}
                  onChange={(next) => set('maxTurns', next)}
               />
            </SettingRow>
            <SettingRow
               label={tp('maxDuration')}
               hint={tp('maxDurationHint')}
               htmlFor="loop-minutes"
            >
               <NumberInput
                  id="loop-minutes"
                  value={draft.maxDurationMinutes ?? null}
                  min={1}
                  max={1440}
                  disabled={!editable}
                  onChange={(next) => set('maxDurationMinutes', next)}
               />
            </SettingRow>
            <SettingRow label={td('quota')} hint={te('quotaHint')}>
               <div className="flex flex-col gap-2">
                  <InsetSegments
                     label={td('quota')}
                     value={draft.quotaPeriod}
                     disabled={!editable}
                     options={[
                        { value: 'none', label: td('quotaNone') },
                        { value: 'hour', label: te('quota_hour') },
                        { value: 'day', label: te('quota_day') },
                        { value: 'week', label: te('quota_week') },
                     ]}
                     onChange={(period) =>
                        patch({
                           quotaPeriod: period,
                           quotaMax: period === 'none' ? null : (draft.quotaMax ?? 1),
                        })
                     }
                  />
                  {draft.quotaPeriod !== 'none' ? (
                     <label className="flex items-center gap-2 text-muted-foreground">
                        {td('quotaMax')}
                        <NumberInput
                           value={draft.quotaMax ?? 1}
                           min={1}
                           max={10000}
                           disabled={!editable}
                           className="w-24"
                           onChange={(next) => set('quotaMax', next ?? 1)}
                        />
                     </label>
                  ) : null}
               </div>
            </SettingRow>
            {listensForEvents ? (
               <>
                  <SwitchRow
                     label={tp('agentEvents')}
                     hint={tp('agentEventsHint')}
                     checked={draft.allowAgentEvents ?? false}
                     disabled={!editable}
                     onCheckedChange={(on) => set('allowAgentEvents', on)}
                  />
                  <SettingRow
                     label={tp('chainDepth')}
                     hint={tp('chainDepthHint', { max: MAX_CHAIN_DEPTH })}
                     htmlFor="loop-depth"
                  >
                     <NumberInput
                        id="loop-depth"
                        value={draft.maxChainDepth ?? 0}
                        min={0}
                        max={MAX_CHAIN_DEPTH}
                        disabled={!editable}
                        className="w-24"
                        onChange={(next) => set('maxChainDepth', next ?? 0)}
                     />
                  </SettingRow>
               </>
            ) : null}
         </SectionCard>
      </>
   );
}

/** A select in the Loop page's inset look. */
function InsetSelect({
   value,
   options,
   placeholder,
   disabled,
   onChange,
}: {
   value: string;
   options: { value: string; label: string }[];
   placeholder?: string;
   disabled?: boolean;
   onChange: (value: string) => void;
}) {
   return (
      <Select value={value} onValueChange={onChange} disabled={disabled}>
         <SelectTrigger className={cn(insetFieldClass, 'justify-between')}>
            <SelectValue placeholder={placeholder} />
         </SelectTrigger>
         <SelectContent>
            {options.map((option) => (
               <SelectItem key={option.value} value={option.value}>
                  {option.label}
               </SelectItem>
            ))}
         </SelectContent>
      </Select>
   );
}

/** A whole number within bounds; empty means "no limit" (null). */
function NumberInput({
   id,
   value,
   min,
   max,
   disabled,
   className,
   onChange,
}: {
   id?: string;
   value: number | null;
   min: number;
   max: number;
   disabled?: boolean;
   className?: string;
   onChange: (next: number | null) => void;
}) {
   return (
      <input
         id={id}
         type="number"
         inputMode="numeric"
         min={min}
         max={max}
         value={value ?? ''}
         placeholder="—"
         disabled={disabled}
         className={cn(insetFieldClass, 'tabular-nums', className ?? 'w-32')}
         onChange={(event) => {
            const raw = event.target.value.trim();
            if (raw === '') return onChange(null);
            const parsed = Math.round(Number(raw));
            if (Number.isFinite(parsed)) onChange(Math.max(min, Math.min(max, parsed)));
         }}
      />
   );
}
