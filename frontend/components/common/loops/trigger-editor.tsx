'use client';

import {
   Clock,
   Copy,
   Eye,
   EyeOff,
   GitPullRequest,
   Hand,
   ListChecks,
   Webhook,
   type LucideIcon,
} from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';

import { copyToClipboard, useWorkspaceProjects } from '@/components/common/autopilots/triggers-tab';
import EventTriggerEditor, {
   conditionsComplete,
} from '@/components/common/loops/event-trigger-editor';
import {
   InsetSegments,
   SectionCard,
   SettingRow,
   insetFieldClass,
} from '@/components/common/loops/loop-editor-parts';
import { Button } from '@/components/ui/button';
import {
   Select,
   SelectContent,
   SelectItem,
   SelectTrigger,
   SelectValue,
} from '@/components/ui/select';
import { absoluteApiUrl } from '@/lib/api';
import {
   addCronTrigger,
   addEventTrigger,
   addWebhookTrigger,
   deleteTrigger,
   describeAutopilotFailure,
   EMPTY_CONDITIONS,
   previewCron,
   rotateWebhook,
   updateTrigger,
   type AutopilotTrigger,
   type Conditions,
   type LoopEventType,
   type WebhookSecrets,
} from '@/lib/autopilots';
import { knownTimezones, localTimezone } from '@/lib/cron-schedule';
import { cn } from '@/lib/utils';

const PR_EVENT: LoopEventType = 'github.pull_request.updated';
const PR_STATES = ['open', 'draft', 'merged', 'closed'] as const;

/**
 * What starts a Loop's runs, as the Loop page edits it: one kind and its
 * settings. The server keeps triggers as their own records; `applyTrigger`
 * turns a draft into the calls that make them match.
 */
export type TriggerDraft =
   | { kind: 'manual' }
   | { kind: 'cron'; expression: string; timezone: string }
   | { kind: 'event'; eventType: LoopEventType; conditions: Conditions }
   /** The linked-pull-request event, narrowed to the states it is in afterwards. */
   | { kind: 'pr'; states: string[]; conditions: Conditions }
   | { kind: 'webhook'; eventFilters: string };

export type TriggerKind = TriggerDraft['kind'];

export const DEFAULT_SCHEDULE_DRAFT = (): TriggerDraft => ({
   kind: 'cron',
   expression: '0 9 * * 1-5',
   timezone: localTimezone(),
});

/** A fresh draft of a kind, keeping what can carry over from the one before. */
export function draftOfKind(kind: TriggerKind, previous?: TriggerDraft): TriggerDraft {
   if (previous?.kind === kind) return previous;
   switch (kind) {
      case 'manual':
         return { kind: 'manual' };
      case 'cron':
         return DEFAULT_SCHEDULE_DRAFT();
      case 'event':
         return { kind: 'event', eventType: 'issue.created', conditions: EMPTY_CONDITIONS };
      case 'pr':
         return { kind: 'pr', states: ['open'], conditions: EMPTY_CONDITIONS };
      case 'webhook':
         return { kind: 'webhook', eventFilters: '' };
   }
}

/** The draft a stored trigger reads as. */
export function draftFromTrigger(trigger: AutopilotTrigger | undefined): TriggerDraft {
   if (!trigger) return { kind: 'manual' };
   if (trigger.kind === 'cron') {
      return {
         kind: 'cron',
         expression: trigger.cronExpression ?? '0 9 * * 1-5',
         timezone: trigger.timezone ?? localTimezone(),
      };
   }
   if (trigger.kind === 'webhook') {
      return { kind: 'webhook', eventFilters: trigger.eventFilters.join(', ') };
   }
   return draftFromEvent(trigger.eventType ?? 'issue.created', trigger.conditions);
}

/** An event trigger as a draft: the linked-pull-request event reads as the Pull request kind. */
export function draftFromEvent(eventType: LoopEventType, conditions: Conditions): TriggerDraft {
   if (eventType === PR_EVENT) {
      const state = conditions.rules.find(
         (rule) => rule.field === 'pullRequestState' && rule.op === 'in'
      );
      return {
         kind: 'pr',
         states: state ? [...state.values] : [],
         conditions: { ...conditions, rules: conditions.rules.filter((rule) => rule !== state) },
      };
   }
   return { kind: 'event', eventType, conditions };
}

/** The event and filters a pull-request draft stands for. */
function prEvent(draft: Extract<TriggerDraft, { kind: 'pr' }>): {
   eventType: LoopEventType;
   conditions: Conditions;
} {
   const rules =
      draft.states.length > 0
         ? [
              { field: 'pullRequestState' as const, op: 'in' as const, values: draft.states },
              ...draft.conditions.rules,
           ]
         : draft.conditions.rules;
   return { eventType: PR_EVENT, conditions: { ...draft.conditions, rules } };
}

function filters(value: string): string[] {
   return value
      .split(',')
      .map((name) => name.trim())
      .filter((name) => name !== '');
}

/** Whether the draft can be saved: every filter has a value. */
export function triggerComplete(draft: TriggerDraft): boolean {
   if (draft.kind === 'event') return conditionsComplete(draft.conditions);
   if (draft.kind === 'pr') return conditionsComplete(prEvent(draft).conditions);
   return true;
}

export function sameTrigger(left: TriggerDraft, right: TriggerDraft): boolean {
   return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Makes the Loop's first trigger match the draft: the same record updated
 * when the kind is unchanged, otherwise the old one removed and a new one
 * added. Other triggers a Loop has are left alone. A new webhook's secrets
 * come back, to be shown once.
 */
export async function applyTrigger(
   autopilotId: string,
   current: AutopilotTrigger | undefined,
   draft: TriggerDraft
): Promise<WebhookSecrets | null> {
   const currentKind = draftFromTrigger(current).kind;
   if (current && currentKind === draft.kind) {
      if (draft.kind === 'cron') {
         await updateTrigger(autopilotId, current.id, {
            expression: draft.expression,
            timezone: draft.timezone,
         });
      } else if (draft.kind === 'event') {
         await updateTrigger(autopilotId, current.id, {
            eventType: draft.eventType,
            conditions: draft.conditions,
         });
      } else if (draft.kind === 'pr') {
         await updateTrigger(autopilotId, current.id, prEvent(draft));
      } else if (draft.kind === 'webhook') {
         await updateTrigger(autopilotId, current.id, {
            eventFilters: filters(draft.eventFilters),
         });
      }
      return null;
   }
   if (current) await deleteTrigger(autopilotId, current.id);
   return addTrigger(autopilotId, draft);
}

/** Adds the trigger a draft describes to a Loop that has none of that kind. */
export async function addTrigger(
   autopilotId: string,
   draft: TriggerDraft
): Promise<WebhookSecrets | null> {
   if (draft.kind === 'cron')
      await addCronTrigger(autopilotId, { expression: draft.expression, timezone: draft.timezone });
   else if (draft.kind === 'event')
      await addEventTrigger(autopilotId, {
         eventType: draft.eventType,
         conditions: draft.conditions,
      });
   else if (draft.kind === 'pr') await addEventTrigger(autopilotId, prEvent(draft));
   else if (draft.kind === 'webhook')
      return (await addWebhookTrigger(autopilotId, filters(draft.eventFilters))).secrets;
   return null;
}

// ── Schedule ────────────────────────────────────────────────────────────────

type Repeat = 'hourly' | 'daily' | 'weekly' | 'monthly';

interface Cadence {
   repeat: Repeat;
   hour: number;
   minute: number;
   /** Cron weekdays, 0 = Sunday. */
   days: number[];
   dayOfMonth: number;
}

const NUMBER = /^\d{1,2}$/;

/** The four cadences the Repeat control draws, or null for anything else. */
function readCadence(expression: string): Cadence | null {
   const fields = expression.trim().split(/\s+/);
   if (fields.length !== 5) return null;
   const [minute, hour, dayOfMonth, month, weekday] = fields as [
      string,
      string,
      string,
      string,
      string,
   ];
   if (!NUMBER.test(minute) || month !== '*') return null;
   const base = { minute: Number(minute), hour: 9, days: [1, 2, 3, 4, 5], dayOfMonth: 1 };
   if (hour === '*' && dayOfMonth === '*' && weekday === '*') return { ...base, repeat: 'hourly' };
   if (!NUMBER.test(hour)) return null;
   const at = { ...base, hour: Number(hour) };
   if (dayOfMonth === '*' && weekday === '*') return { ...at, repeat: 'daily' };
   if (dayOfMonth !== '*' && NUMBER.test(dayOfMonth) && weekday === '*') {
      return { ...at, repeat: 'monthly', dayOfMonth: Number(dayOfMonth) };
   }
   if (dayOfMonth === '*') {
      const days = new Set<number>();
      for (const part of weekday.split(',')) {
         const range = /^(\d)-(\d)$/.exec(part);
         if (range) {
            for (let day = Number(range[1]); day <= Number(range[2]); day += 1) days.add(day % 7);
         } else if (/^\d$/.test(part)) days.add(Number(part) % 7);
         else return null;
      }
      return { ...at, repeat: 'weekly', days: [...days].sort((a, b) => a - b) };
   }
   return null;
}

function writeCadence(cadence: Cadence): string {
   const { minute, hour } = cadence;
   switch (cadence.repeat) {
      case 'hourly':
         return `${minute} * * * *`;
      case 'daily':
         return `${minute} ${hour} * * *`;
      case 'weekly':
         return `${minute} ${hour} * * ${cadence.days.length > 0 ? cadence.days.join(',') : '1'}`;
      case 'monthly':
         return `${minute} ${hour} ${cadence.dayOfMonth} * *`;
   }
}

const pad = (value: number) => String(value).padStart(2, '0');

/** Monday first, as people read a week; the values stay cron's. */
const WEEK = [1, 2, 3, 4, 5, 6, 0];

function ScheduleRows({
   draft,
   disabled,
   onChange,
}: {
   draft: Extract<TriggerDraft, { kind: 'cron' }>;
   disabled: boolean;
   onChange: (next: TriggerDraft) => void;
}) {
   const t = useTranslations('loops.editor');
   const locale = useLocale();
   const cadence = readCadence(draft.expression);
   const [next, setNext] = useState<string | null>(null);
   const zones = useMemo(() => {
      const all = knownTimezones();
      return all.includes(draft.timezone) ? all : [draft.timezone, ...all];
   }, [draft.timezone]);
   const dayNames = useMemo(() => {
      const format = new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' });
      return WEEK.map((day) => ({
         day,
         name: format.format(new Date(Date.UTC(2024, 0, 7 + day))),
      }));
   }, [locale]);

   // The next time, as the server's scheduler will compute it.
   useEffect(() => {
      let cancelled = false;
      setNext(null);
      const timer = setTimeout(() => {
         void previewCron(draft.expression, draft.timezone, 1).then(
            (times) => {
               if (!cancelled) setNext(times[0] ?? null);
            },
            () => undefined
         );
      }, 300);
      return () => {
         cancelled = true;
         clearTimeout(timer);
      };
   }, [draft.expression, draft.timezone]);

   const set = (patch: Partial<Cadence>) => {
      if (!cadence) return;
      onChange({ ...draft, expression: writeCadence({ ...cadence, ...patch }) });
   };
   const nextLabel = next
      ? t('nextRun', {
           when: new Intl.DateTimeFormat(locale, {
              weekday: 'short',
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
              timeZone: draft.timezone,
           }).format(new Date(next)),
        })
      : t('nextRunPending');

   return (
      <>
         {cadence ? (
            <SettingRow label={t('repeat')} hint={t('repeatHint')}>
               <InsetSegments
                  label={t('repeat')}
                  value={cadence.repeat}
                  disabled={disabled}
                  options={[
                     { value: 'hourly', label: t('repeat_hourly') },
                     { value: 'daily', label: t('repeat_daily') },
                     { value: 'weekly', label: t('repeat_weekly') },
                     { value: 'monthly', label: t('repeat_monthly') },
                  ]}
                  onChange={(repeat) => set({ repeat })}
               />
            </SettingRow>
         ) : (
            <SettingRow label={t('cron')} hint={t('cronHint')} htmlFor="loop-cron">
               <input
                  id="loop-cron"
                  className={cn(insetFieldClass, 'font-mono')}
                  value={draft.expression}
                  disabled={disabled}
                  onChange={(event) => onChange({ ...draft, expression: event.target.value })}
               />
            </SettingRow>
         )}

         {cadence?.repeat === 'weekly' ? (
            <SettingRow label={t('on')} hint={t('onHint')}>
               <div className="grid grid-cols-7 gap-1" role="group" aria-label={t('on')}>
                  {dayNames.map(({ day, name }) => {
                     const on = cadence.days.includes(day);
                     return (
                        <button
                           key={day}
                           type="button"
                           aria-pressed={on}
                           disabled={disabled || (on && cadence.days.length === 1)}
                           onClick={() =>
                              set({
                                 days: on
                                    ? cadence.days.filter((entry) => entry !== day)
                                    : [...cadence.days, day].sort((a, b) => a - b),
                              })
                           }
                           className={cn(
                              'h-[30px] min-w-0 truncate rounded-[7px] border font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed',
                              on
                                 ? 'border-foreground/25 bg-segment-selected text-foreground'
                                 : 'border-border/70 bg-background text-subtle-foreground enabled:hover:text-foreground'
                           )}
                        >
                           {name.slice(0, 2)}
                        </button>
                     );
                  })}
               </div>
            </SettingRow>
         ) : null}

         {cadence?.repeat === 'monthly' ? (
            <SettingRow label={t('dayOfMonth')} hint={t('dayOfMonthHint')} htmlFor="loop-month-day">
               <input
                  id="loop-month-day"
                  type="number"
                  min={1}
                  max={28}
                  className={cn(insetFieldClass, 'w-24 tabular-nums')}
                  value={cadence.dayOfMonth}
                  disabled={disabled}
                  onChange={(event) => {
                     const day = Math.round(Number(event.target.value));
                     if (Number.isFinite(day)) set({ dayOfMonth: Math.max(1, Math.min(28, day)) });
                  }}
               />
            </SettingRow>
         ) : null}

         <SettingRow
            label={cadence?.repeat === 'hourly' ? t('minute') : t('time')}
            hint={nextLabel}
            htmlFor="loop-time"
         >
            <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-2">
               {cadence?.repeat === 'hourly' ? (
                  <input
                     id="loop-time"
                     type="number"
                     min={0}
                     max={59}
                     className={cn(insetFieldClass, 'text-center tabular-nums')}
                     value={cadence.minute}
                     disabled={disabled}
                     onChange={(event) => {
                        const minute = Math.round(Number(event.target.value));
                        if (Number.isFinite(minute))
                           set({ minute: Math.max(0, Math.min(59, minute)) });
                     }}
                  />
               ) : cadence ? (
                  <input
                     id="loop-time"
                     type="time"
                     className={cn(insetFieldClass, 'text-center tabular-nums')}
                     value={`${pad(cadence.hour)}:${pad(cadence.minute)}`}
                     disabled={disabled}
                     onChange={(event) => {
                        const match = /^(\d{2}):(\d{2})$/.exec(event.target.value);
                        if (match) set({ hour: Number(match[1]), minute: Number(match[2]) });
                     }}
                  />
               ) : (
                  <span />
               )}
               <select
                  className={insetFieldClass}
                  value={draft.timezone}
                  disabled={disabled}
                  aria-label={t('timezone')}
                  onChange={(event) => onChange({ ...draft, timezone: event.target.value })}
               >
                  {zones.map((zone) => (
                     <option key={zone} value={zone}>
                        {zone}
                     </option>
                  ))}
               </select>
            </div>
         </SettingRow>
      </>
   );
}

// ── Pull request, webhook ──────────────────────────────────────────────────

function PullRequestRows({
   draft,
   disabled,
   onChange,
}: {
   draft: Extract<TriggerDraft, { kind: 'pr' }>;
   disabled: boolean;
   onChange: (next: TriggerDraft) => void;
}) {
   const t = useTranslations('loops.editor');
   // One state, as the Event picker draws it. A Loop saved with several keeps
   // them, and says so, until someone picks one.
   const value =
      draft.states.length === 0 ? 'any' : draft.states.length === 1 ? draft.states[0]! : 'several';
   const options = [
      { value: 'any', label: t('prEvent_any') },
      ...PR_STATES.map((state) => ({ value: state, label: t(`prEvent_${state}`) })),
      ...(value === 'several' ? [{ value: 'several', label: t('prEvent_several') }] : []),
   ];
   return (
      <SettingRow label={t('prWhen')} hint={t('prEventHint')}>
         <Select
            value={value}
            disabled={disabled}
            onValueChange={(next) => {
               if (next === 'several') return;
               onChange({ ...draft, states: next === 'any' ? [] : [next] });
            }}
         >
            <SelectTrigger
               className={cn(insetFieldClass, 'justify-between')}
               aria-label={t('prWhen')}
            >
               <SelectValue />
            </SelectTrigger>
            <SelectContent>
               {options.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                     {option.label}
                  </SelectItem>
               ))}
            </SelectContent>
         </Select>
      </SettingRow>
   );
}

/** A value that can be shown once: masked until asked, and copyable. */
function SecretField({ value, label, mask }: { value: string; label: string; mask: boolean }) {
   const t = useTranslations('loops.editor');
   const tt = useTranslations('loops.triggers');
   const [shown, setShown] = useState(!mask);
   return (
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2">
         <span
            className={cn(
               insetFieldClass,
               'flex items-center truncate font-mono text-muted-foreground'
            )}
         >
            {shown ? value : '•'.repeat(Math.min(28, value.length))}
         </span>
         {mask ? (
            <Button
               type="button"
               variant="secondary"
               onClick={() => setShown(!shown)}
               aria-label={shown ? tt('hide') : tt('show')}
            >
               {shown ? (
                  <EyeOff className="size-3.5" aria-hidden />
               ) : (
                  <Eye className="size-3.5" aria-hidden />
               )}
               {shown ? t('hide') : t('reveal')}
            </Button>
         ) : (
            <span />
         )}
         <Button
            type="button"
            variant="secondary"
            onClick={() => copyToClipboard(value, tt('copied'))}
            aria-label={`${tt('copy')} ${label}`}
         >
            <Copy className="size-3.5" aria-hidden />
            {tt('copy')}
         </Button>
      </div>
   );
}

function WebhookRows({
   draft,
   disabled,
   autopilotId,
   current,
   secrets,
   onSecrets,
   onChange,
}: {
   draft: Extract<TriggerDraft, { kind: 'webhook' }>;
   disabled: boolean;
   autopilotId: string | null;
   current: AutopilotTrigger | undefined;
   secrets: WebhookSecrets | null;
   onSecrets: (secrets: WebhookSecrets) => void;
   onChange: (next: TriggerDraft) => void;
}) {
   const t = useTranslations('loops.editor');
   const [rotating, setRotating] = useState(false);
   const saved = current?.kind === 'webhook' ? current : undefined;
   const endpoint = secrets ? absoluteApiUrl(secrets.ingressPath) : null;

   const rotate = async () => {
      if (!autopilotId || !saved) return;
      setRotating(true);
      try {
         const { secrets: fresh } = await rotateWebhook(autopilotId, saved.id);
         onSecrets(fresh);
      } catch (failure) {
         toast.error(describeAutopilotFailure(failure));
      } finally {
         setRotating(false);
      }
   };

   return (
      <>
         <SettingRow label={t('webhookUrl')} hint={t('webhookUrlHint')}>
            {endpoint ? (
               <SecretField value={endpoint} label={t('webhookUrl')} mask={false} />
            ) : (
               <span className="flex min-h-8 items-center text-pretty text-subtle-foreground">
                  {saved
                     ? t('webhookHidden', { hint: saved.tokenHint ?? '' })
                     : t('webhookAfterCreate')}
               </span>
            )}
         </SettingRow>
         <SettingRow label={t('webhookSecret')} hint={t('webhookSecretHint')}>
            {secrets ? (
               <SecretField value={secrets.signingSecret} label={t('webhookSecret')} mask />
            ) : saved ? (
               <Button
                  type="button"
                  variant="secondary"
                  className="text-status-danger"
                  disabled={disabled || rotating}
                  onClick={() => void rotate()}
               >
                  {t('rotate')}
               </Button>
            ) : (
               <span className="flex min-h-8 items-center text-subtle-foreground">
                  {t('webhookAfterCreate')}
               </span>
            )}
         </SettingRow>
         <SettingRow
            label={t('webhookEvents')}
            hint={t('webhookEventsHint')}
            htmlFor="loop-webhook-events"
         >
            <input
               id="loop-webhook-events"
               className={insetFieldClass}
               value={draft.eventFilters}
               placeholder={t('webhookEventsPlaceholder')}
               disabled={disabled}
               onChange={(event) => onChange({ ...draft, eventFilters: event.target.value })}
            />
         </SettingRow>
         <div className="px-4 pb-4">
            <pre className="overflow-x-auto rounded-lg border border-border/70 bg-background px-3.5 py-3 leading-relaxed text-muted-foreground">
               {`body='{"event":"alert.fired","service":"api"}'
curl -X POST ${endpoint ?? '<url>'} \\
  -H "Content-Type: application/json" \\
  -H "X-Berry-Event: alert.fired" \\
  -H "X-Berry-Signature: sha256=$(printf '%s' "$body" | openssl dgst -sha256 -hmac "$SECRET" | sed 's/^.* //')" \\
  -d "$body"`}
            </pre>
         </div>
      </>
   );
}

// ── The section ─────────────────────────────────────────────────────────────

const KIND: Record<TriggerKind, { icon: LucideIcon; tone: string }> = {
   cron: { icon: Clock, tone: 'var(--status-info)' },
   event: { icon: ListChecks, tone: 'var(--status-success)' },
   pr: { icon: GitPullRequest, tone: 'var(--actor-agent)' },
   webhook: { icon: Webhook, tone: 'var(--status-warning)' },
   manual: { icon: Hand, tone: 'var(--status-neutral)' },
};
const ORDER: TriggerKind[] = ['cron', 'event', 'pr', 'webhook', 'manual'];

/**
 * The Trigger section of a Loop page: the kind, chosen from five cards, and
 * that kind's settings as rows. Controlled: the page holds the draft and
 * applies it with the rest of the Loop.
 */
export default function TriggerEditor({
   draft,
   onChange,
   disabled = false,
   autopilotId = null,
   current,
   others = 0,
   secrets = null,
   onSecrets,
}: {
   draft: TriggerDraft;
   onChange: (next: TriggerDraft) => void;
   disabled?: boolean;
   /** The saved Loop, when there is one: a webhook can then be rotated. */
   autopilotId?: string | null;
   /** The saved trigger this draft edits. */
   current?: AutopilotTrigger;
   /** Further triggers the Loop has, which this section leaves alone. */
   others?: number;
   /** A webhook's URL and secret, in the one moment they can be read. */
   secrets?: WebhookSecrets | null;
   onSecrets?: (secrets: WebhookSecrets) => void;
}) {
   const t = useTranslations('loops.editor');
   const projects = useWorkspaceProjects();

   return (
      <SectionCard title={t('trigger')} hint={t('triggerHint')}>
         <div
            className="grid grid-cols-[repeat(auto-fit,minmax(118px,1fr))] gap-2 px-4 pb-4"
            role="radiogroup"
            aria-label={t('trigger')}
         >
            {ORDER.map((kind) => {
               const { icon: Icon, tone } = KIND[kind];
               const on = draft.kind === kind;
               return (
                  <button
                     key={kind}
                     type="button"
                     role="radio"
                     aria-checked={on}
                     disabled={disabled}
                     onClick={() => onChange(draftOfKind(kind, draft))}
                     className={cn(
                        'flex min-w-0 flex-col gap-2 rounded-lg border bg-background p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                        'enabled:hover:border-foreground/25 disabled:cursor-not-allowed'
                     )}
                     style={
                        on
                           ? {
                                borderColor: tone,
                                backgroundColor: `color-mix(in oklab, ${tone} 10%, var(--background))`,
                             }
                           : undefined
                     }
                  >
                     <span
                        className="flex size-[26px] items-center justify-center rounded-[7px]"
                        style={{
                           color: tone,
                           backgroundColor: `color-mix(in oklab, ${tone} 16%, var(--background))`,
                        }}
                        aria-hidden
                     >
                        <Icon className="size-3.5" />
                     </span>
                     <span className="flex min-w-0 flex-col gap-px">
                        <span
                           className={cn(
                              'truncate font-medium',
                              on ? 'text-foreground' : 'text-muted-foreground'
                           )}
                        >
                           {t(`kind_${kind}`)}
                        </span>
                        <span className="truncate text-subtle-foreground">
                           {t(`kind_${kind}_sub`)}
                        </span>
                     </span>
                  </button>
               );
            })}
         </div>

         {draft.kind === 'cron' ? (
            <ScheduleRows draft={draft} disabled={disabled} onChange={onChange} />
         ) : null}
         {draft.kind === 'event' ? (
            <EventTriggerEditor
               eventType={draft.eventType}
               conditions={draft.conditions}
               projects={projects}
               exclude={[PR_EVENT]}
               disabled={disabled}
               onChange={(next) => onChange({ kind: 'event', ...next })}
            />
         ) : null}
         {draft.kind === 'pr' ? (
            <PullRequestRows draft={draft} disabled={disabled} onChange={onChange} />
         ) : null}
         {draft.kind === 'webhook' ? (
            <WebhookRows
               draft={draft}
               disabled={disabled}
               autopilotId={autopilotId}
               current={current}
               secrets={secrets}
               onSecrets={(next) => onSecrets?.(next)}
               onChange={onChange}
            />
         ) : null}
         {draft.kind === 'manual' ? (
            <p className="border-t border-border/60 px-4 py-3.5 text-muted-foreground">
               {t('manualOnly')}
            </p>
         ) : null}

         {others > 0 ? (
            <p className="border-t border-border/60 px-4 py-3 text-subtle-foreground">
               {t('otherTriggers', { count: others })}
            </p>
         ) : null}
      </SectionCard>
   );
}
