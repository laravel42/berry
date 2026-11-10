'use client';

import { Plus, X } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import {
   InsetSegments,
   SettingRow,
   insetFieldClass,
} from '@/components/common/loops/loop-editor-parts';
import {
   Select,
   SelectContent,
   SelectGroup,
   SelectItem,
   SelectLabel,
   SelectTrigger,
   SelectValue,
} from '@/components/ui/select';
import type { Project } from '@/data/projects';
import type { ConditionField, ConditionRule, Conditions, LoopEventType } from '@/lib/autopilots';
import { cn } from '@/lib/utils';

/** Event types by what they are about, in the order the picker lists them. */
const GROUPS: Array<{
   key: 'tasks' | 'comments' | 'projects' | 'runs' | 'approvals' | 'github';
   events: LoopEventType[];
}> = [
   {
      key: 'tasks',
      events: [
         'issue.created',
         'issue.status_changed',
         'issue.assigned',
         'issue.started',
         'issue.completed',
         'issue.updated',
      ],
   },
   { key: 'comments', events: ['comment.created'] },
   { key: 'projects', events: ['project.created', 'project.updated'] },
   { key: 'runs', events: ['run.failed', 'run.completed'] },
   { key: 'approvals', events: ['approval.requested'] },
   { key: 'github', events: ['github.pull_request.updated'] },
];

export const MAX_RULES = 8;

const STATUSES = [
   'backlog',
   'todo',
   'inProgress',
   'inReview',
   'blocked',
   'done',
   'cancelled',
] as const;
const PRIORITIES = ['urgent', 'high', 'medium', 'low', 'none'] as const;
const CHANGED = [
   'status',
   'priority',
   'assignee',
   'project',
   'title',
   'description',
   'dueDate',
   'cycle',
] as const;

/** Fields a filter offers. `assignee` and `actor` (by id) stay available through the API. */
type EditableField = Exclude<ConditionField, 'assignee' | 'actor'>;

/**
 * The fields an event type can state — the same rule the server applies
 * (`parseConditions`), so the editor never offers a filter it would refuse.
 */
export function fieldsFor(eventType: LoopEventType): EditableField[] {
   if (eventType === 'project.created' || eventType === 'project.updated')
      return ['project', 'actorType'];
   const fields: EditableField[] = [
      'project',
      'status',
      'priority',
      'label',
      'assigneeType',
      'actorType',
   ];
   if (
      ['issue.updated', 'issue.status_changed', 'issue.started', 'issue.completed'].includes(
         eventType
      )
   ) {
      fields.splice(2, 0, 'previousStatus');
   }
   if (eventType === 'issue.updated') fields.push('changed');
   if (eventType === 'github.pull_request.updated') fields.push('pullRequestState');
   return fields;
}

/** A fixed vocabulary, or null where the values are typed (labels). */
function vocabulary(field: EditableField): readonly string[] | null {
   switch (field) {
      case 'status':
      case 'previousStatus':
         return STATUSES;
      case 'priority':
         return PRIORITIES;
      case 'assigneeType':
         return ['user', 'agent', 'none'];
      case 'actorType':
         return ['user', 'agent', 'system'];
      case 'changed':
         return CHANGED;
      case 'pullRequestState':
         return ['open', 'draft', 'merged', 'closed'];
      case 'project':
      case 'label':
         return null;
   }
}

interface Props {
   eventType: LoopEventType;
   conditions: Conditions;
   projects: Project[];
   onChange: (next: { eventType: LoopEventType; conditions: Conditions }) => void;
   /** Events this picker leaves out (the Pull request kind has its own card). */
   exclude?: readonly LoopEventType[];
   disabled?: boolean;
}

/**
 * What a Loop listens for, and the few filters that narrow it, as rows of the
 * Loop page's Trigger section: When, then Only if.
 *
 * Deliberately small: at most eight filters, all or any, each a field "is"
 * or "is not" one of some values. Judgement belongs in the instructions.
 */
export default function EventTriggerEditor({
   eventType,
   conditions,
   projects,
   onChange,
   exclude = [],
   disabled = false,
}: Props) {
   const t = useTranslations('loops.eventTrigger');
   const te = useTranslations('loops.editor');
   const fields = fieldsFor(eventType);
   const rules = conditions.rules;

   const setRules = (next: ConditionRule[]) =>
      onChange({ eventType, conditions: { ...conditions, rules: next } });
   const setRule = (index: number, patch: Partial<ConditionRule>) =>
      setRules(rules.map((rule, at) => (at === index ? { ...rule, ...patch } : rule)));

   const changeEvent = (next: LoopEventType) => {
      // Filters the new event cannot state are dropped, not kept to never match.
      const allowed = new Set<string>(fieldsFor(next));
      onChange({
         eventType: next,
         conditions: { ...conditions, rules: rules.filter((rule) => allowed.has(rule.field)) },
      });
   };

   const groups = GROUPS.map((group) => ({
      ...group,
      events: group.events.filter((event) => !exclude.includes(event)),
   })).filter((group) => group.events.length > 0);

   return (
      <>
         <SettingRow label={te('when')} hint={t(`hints.${eventType}`)}>
            <Select
               value={eventType}
               disabled={disabled}
               onValueChange={(value) => changeEvent(value as LoopEventType)}
            >
               <SelectTrigger
                  className={cn(insetFieldClass, 'justify-between')}
                  aria-label={te('when')}
               >
                  <SelectValue />
               </SelectTrigger>
               <SelectContent>
                  {groups.map((group) => (
                     <SelectGroup key={group.key}>
                        <SelectLabel>{t(`groups.${group.key}`)}</SelectLabel>
                        {group.events.map((event) => (
                           <SelectItem key={event} value={event}>
                              {t(`events.${event}`)}
                           </SelectItem>
                        ))}
                     </SelectGroup>
                  ))}
               </SelectContent>
            </Select>
         </SettingRow>

         <div className="flex flex-col gap-2.5 border-t border-border/60 px-4 py-3.5">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
               <span className="font-medium">{te('onlyIf')}</span>
               <span className="text-subtle-foreground">
                  {rules.length === 0 ? t('noFilters') : te('onlyIfHint', { max: MAX_RULES })}
               </span>
               {rules.length > 1 ? (
                  <div className="ml-auto w-44">
                     <InsetSegments
                        label={t('matchLabel')}
                        value={conditions.match}
                        disabled={disabled}
                        options={[
                           { value: 'all', label: t('matchAll') },
                           { value: 'any', label: t('matchAny') },
                        ]}
                        onChange={(match) =>
                           onChange({ eventType, conditions: { ...conditions, match } })
                        }
                     />
                  </div>
               ) : null}
            </div>
            {rules.map((rule, index) => (
               <RuleRow
                  key={index}
                  rule={rule}
                  fields={fields}
                  projects={projects}
                  disabled={disabled}
                  onChange={(patch) => setRule(index, patch)}
                  onRemove={() => setRules(rules.filter((_rule, at) => at !== index))}
               />
            ))}
            {disabled ? null : rules.length < MAX_RULES ? (
               <Button
                  type="button"
                  size="xs"
                  variant="secondary"
                  className="w-fit"
                  onClick={() => {
                     const field =
                        fields.find(
                           (candidate) => !rules.some((rule) => rule.field === candidate)
                        ) ??
                        fields[0] ??
                        'status';
                     setRules([...rules, { field, op: 'in', values: [] }]);
                  }}
               >
                  <Plus className="size-3.5" aria-hidden />
                  {te('addCondition')}
               </Button>
            ) : (
               <p className="text-subtle-foreground">{t('maxFilters', { count: MAX_RULES })}</p>
            )}
         </div>
      </>
   );
}

/** One condition: field, is or is not, its values, and a way to drop it. */
function RuleRow({
   rule,
   fields,
   projects,
   disabled,
   onChange,
   onRemove,
}: {
   rule: ConditionRule;
   fields: EditableField[];
   projects: Project[];
   disabled: boolean;
   onChange: (patch: Partial<ConditionRule>) => void;
   onRemove: () => void;
}) {
   const t = useTranslations('loops.eventTrigger');
   const field = (fields as string[]).includes(rule.field)
      ? (rule.field as EditableField)
      : fields[0];
   if (!field) return null;
   const words = vocabulary(field);
   const toggle = (value: string) =>
      onChange({
         values: rule.values.includes(value)
            ? rule.values.filter((entry) => entry !== value)
            : [...rule.values, value],
      });
   const pill = (on: boolean) =>
      cn(
         'h-[26px] max-w-48 truncate rounded-[7px] border px-2.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed',
         on
            ? 'border-foreground/25 bg-segment-selected text-foreground'
            : 'border-border/70 bg-background text-muted-foreground enabled:hover:text-foreground'
      );

   return (
      <div className="flex flex-col gap-2">
         <div className="grid grid-cols-[minmax(0,1fr)_5.5rem_auto] items-center gap-2">
            <Select
               value={field}
               disabled={disabled}
               onValueChange={(value) => onChange({ field: value as ConditionField, values: [] })}
            >
               <SelectTrigger
                  className={cn(insetFieldClass, 'justify-between')}
                  aria-label={t('field')}
               >
                  <SelectValue />
               </SelectTrigger>
               <SelectContent>
                  {fields.map((candidate) => (
                     <SelectItem key={candidate} value={candidate}>
                        {t(`fields.${candidate}`)}
                     </SelectItem>
                  ))}
               </SelectContent>
            </Select>
            <Select
               value={rule.op}
               disabled={disabled}
               onValueChange={(value) => onChange({ op: value === 'not_in' ? 'not_in' : 'in' })}
            >
               <SelectTrigger
                  className={cn(insetFieldClass, 'justify-between')}
                  aria-label={t('operator')}
               >
                  <SelectValue />
               </SelectTrigger>
               <SelectContent>
                  <SelectItem value="in">{t('is')}</SelectItem>
                  <SelectItem value="not_in">{t('isNot')}</SelectItem>
               </SelectContent>
            </Select>
            <Button
               type="button"
               size="icon"
               variant="ghost"
               className="size-8 text-subtle-foreground hover:text-foreground"
               disabled={disabled}
               onClick={onRemove}
               aria-label={t('removeFilter')}
            >
               <X className="size-3.5" aria-hidden />
            </Button>
         </div>
         {words ? (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label={t(`fields.${field}`)}>
               {words.map((word) => (
                  <button
                     key={word}
                     type="button"
                     aria-pressed={rule.values.includes(word)}
                     disabled={disabled}
                     onClick={() => toggle(word)}
                     className={pill(rule.values.includes(word))}
                  >
                     {t(`values.${field}.${word}` as never)}
                  </button>
               ))}
            </div>
         ) : field === 'project' ? (
            <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('fields.project')}>
               {projects.length === 0 ? (
                  <span className="text-subtle-foreground">{t('noProjects')}</span>
               ) : null}
               {projects.map((project) => (
                  <button
                     key={project.id}
                     type="button"
                     aria-pressed={rule.values.includes(project.id)}
                     disabled={disabled}
                     onClick={() => toggle(project.id)}
                     className={pill(rule.values.includes(project.id))}
                  >
                     {project.name}
                  </button>
               ))}
            </div>
         ) : (
            <input
               className={insetFieldClass}
               value={rule.values.join(', ')}
               placeholder={t('labelsPlaceholder')}
               aria-label={t('fields.label')}
               disabled={disabled}
               onChange={(event) =>
                  onChange({
                     values: event.target.value
                        .split(',')
                        .map((value) => value.trim())
                        .filter((value, index, all) => value !== '' && all.indexOf(value) === index)
                        .slice(0, 20),
                  })
               }
            />
         )}
         {rule.values.length === 0 ? (
            <p className="text-status-warning">{t('chooseValue')}</p>
         ) : null}
      </div>
   );
}

/** Whether every filter has a value — a filter with none would be refused. */
export function conditionsComplete(conditions: Conditions): boolean {
   return conditions.rules.every((rule) => rule.values.length > 0);
}

/** "Label is bug · Status is not Done", or "Every event" with no filters. */
export function ConditionsSummary({
   conditions,
   projects,
}: {
   conditions: Conditions;
   projects: Project[];
}) {
   const t = useTranslations('loops.eventTrigger');
   if (conditions.rules.length === 0) return <>{t('everyEvent')}</>;
   const valueLabel = (field: ConditionField, value: string): string => {
      if (field === 'project')
         return projects.find((project) => project.id === value)?.name ?? value;
      const editable = field as EditableField;
      return vocabulary(editable) && t.has(`values.${field}.${value}` as never)
         ? t(`values.${field}.${value}` as never)
         : value;
   };
   const parts = conditions.rules.map((rule) => {
      const field = t(`fields.${rule.field}`);
      const values = rule.values.map((value) => valueLabel(rule.field, value)).join(t('or'));
      return `${field} ${rule.op === 'in' ? t('isLower') : t('isNotLower')} ${values}`;
   });
   return <>{parts.join(conditions.match === 'all' ? ' · ' : t('anyJoin'))}</>;
}
