'use client';

import { Copy, Eye, EyeOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

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
import { ConfirmAction } from '@/components/common/confirm-action';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import EventTriggerEditor, {
   ConditionsSummary,
   conditionsComplete,
} from '@/components/common/loops/event-trigger-editor';
import type { Project } from '@/data/projects';
import { absoluteApiUrl } from '@/lib/api';
import {
   addCronTrigger,
   addEventTrigger,
   addWebhookTrigger,
   EMPTY_CONDITIONS,
   type Conditions,
   type LoopEventType,
   deleteTrigger,
   describeAutopilotFailure,
   rotateWebhook,
   updateTrigger,
   type AutopilotDetail,
   type AutopilotTrigger,
   type WebhookSecrets,
} from '@/lib/autopilots';
import { localTimezone } from '@/lib/cron-schedule';
import { loadWorkspaceProjects } from '@/lib/projects';
import { useSessionStore } from '@/store/session-store';

import ScheduleEditor from './schedule-editor';

interface Props {
   autopilot: AutopilotDetail;
   canEdit: boolean;
   onChanged: () => void;
}

export function copyToClipboard(value: string, done: string): void {
   void navigator.clipboard.writeText(value).then(
      () => toast.success(done),
      () => toast.error(done)
   );
}

/**
 * Shown once, straight after a webhook is made or rotated.
 *
 * The server keeps only a hash of the token and a sealed secret, so this is the
 * single moment either can be read. Everything here can be revealed and copied
 * deliberately; nothing is shown by accident.
 */
export function SecretsNotice({
   secrets,
   onDismiss,
}: {
   secrets: WebhookSecrets;
   onDismiss: () => void;
}) {
   const t = useTranslations('loops.triggers');
   const [shown, setShown] = useState(false);
   const endpoint = absoluteApiUrl(secrets.ingressPath);
   const mask = (value: string) => (shown ? value : '•'.repeat(Math.min(32, value.length)));

   return (
      <div className="rounded-md border border-dashed p-4" role="status">
         <p className="font-medium">{t('secretsTitle')}</p>
         <p className="text-muted-foreground">{t('secretsBody')}</p>
         <div className="mt-3 grid gap-2">
            <Label>{t('endpoint')}</Label>
            <div className="flex gap-2">
               <Input readOnly value={mask(endpoint)} className="font-mono" />
               <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  aria-label={shown ? t('hide') : t('show')}
                  onClick={() => setShown(!shown)}
               >
                  {shown ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
               </Button>
               <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  aria-label={t('copy')}
                  onClick={() => copyToClipboard(endpoint, t('copied'))}
               >
                  <Copy className="size-4" />
               </Button>
            </div>
            <Label>{t('signingSecret')}</Label>
            <div className="flex gap-2">
               <Input readOnly value={mask(secrets.signingSecret)} className="font-mono" />
               <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  aria-label={t('copy')}
                  onClick={() => copyToClipboard(secrets.signingSecret, t('copied'))}
               >
                  <Copy className="size-4" />
               </Button>
            </div>
            <p className="text-muted-foreground">{t('signingHint')}</p>
         </div>
         <Button type="button" className="mt-3" size="xs" variant="ghost" onClick={onDismiss}>
            {t('dismiss')}
         </Button>
      </div>
   );
}

export function TriggerRow({
   autopilotId,
   trigger,
   canEdit,
   onChanged,
   onSecrets,
   projects,
}: {
   autopilotId: string;
   trigger: AutopilotTrigger;
   canEdit: boolean;
   onChanged: () => void;
   onSecrets: (secrets: WebhookSecrets) => void;
   projects: Project[];
}) {
   const t = useTranslations('loops.triggers');
   const tEvent = useTranslations('loops.eventTrigger');
   const tc = useTranslations('common.confirm');
   const [rotating, setRotating] = useState(false);
   const [removing, setRemoving] = useState(false);
   const [editing, setEditing] = useState<{
      eventType: LoopEventType;
      conditions: Conditions;
   } | null>(null);

   const remove = async () => {
      try {
         await deleteTrigger(autopilotId, trigger.id);
         onChanged();
      } catch (failure) {
         toast.error(describeAutopilotFailure(failure));
         throw failure;
      }
   };

   const act = async (work: () => Promise<unknown>) => {
      try {
         await work();
         onChanged();
      } catch (failure) {
         toast.error(describeAutopilotFailure(failure));
      }
   };

   return (
      <div className="flex flex-wrap items-center gap-3 border-t border-border/60 px-4 py-3">
         <Switch
            checked={trigger.enabled}
            disabled={!canEdit}
            onCheckedChange={(enabled) =>
               void act(() => updateTrigger(autopilotId, trigger.id, { enabled }))
            }
            aria-label={t('enabled')}
         />
         <div className="min-w-0 flex-1">
            {trigger.kind === 'cron' ? (
               <>
                  <div className="font-medium">
                     <code>{trigger.cronExpression}</code> · {trigger.timezone}
                  </div>
                  <div className="text-muted-foreground">
                     {trigger.nextFireAt
                        ? t('next', { when: new Date(trigger.nextFireAt).toLocaleString() })
                        : t('notScheduled')}
                  </div>
               </>
            ) : trigger.kind === 'event' && trigger.eventType ? (
               editing ? (
                  <div className="grid max-w-2xl gap-3 rounded-md border p-3">
                     <EventTriggerEditor
                        eventType={editing.eventType}
                        conditions={editing.conditions}
                        projects={projects}
                        onChange={setEditing}
                     />
                     <div className="flex gap-2">
                        <Button
                           type="button"
                           size="xs"
                           disabled={!conditionsComplete(editing.conditions)}
                           onClick={() =>
                              void act(async () => {
                                 await updateTrigger(autopilotId, trigger.id, editing);
                                 setEditing(null);
                              })
                           }
                        >
                           {t('save')}
                        </Button>
                        <Button
                           type="button"
                           size="xs"
                           variant="ghost"
                           onClick={() => setEditing(null)}
                        >
                           {t('cancel')}
                        </Button>
                     </div>
                  </div>
               ) : (
                  <>
                     <div className="font-medium">{tEvent(`events.${trigger.eventType}`)}</div>
                     <div className="text-muted-foreground">
                        <ConditionsSummary conditions={trigger.conditions} projects={projects} />
                     </div>
                  </>
               )
            ) : (
               <>
                  <div className="font-medium">
                     {t('webhookName', { hint: trigger.tokenHint ?? '' })}
                  </div>
                  <div className="text-muted-foreground">
                     {trigger.eventFilters.length > 0
                        ? trigger.eventFilters.join(', ')
                        : t('everyEvent')}
                  </div>
                  <div className="text-muted-foreground">{t('urlHiddenHint')}</div>
               </>
            )}
         </div>
         {canEdit && trigger.kind === 'event' && trigger.eventType && !editing ? (
            <Button
               type="button"
               size="xs"
               variant="outline"
               onClick={() =>
                  setEditing({
                     eventType: trigger.eventType ?? 'issue.created',
                     conditions: trigger.conditions,
                  })
               }
            >
               {t('edit')}
            </Button>
         ) : null}
         {canEdit && trigger.kind === 'webhook' ? (
            <Button type="button" size="xs" variant="outline" onClick={() => setRotating(true)}>
               {t('rotate')}
            </Button>
         ) : null}
         {canEdit ? (
            <Button type="button" size="xs" variant="ghost" onClick={() => setRemoving(true)}>
               {t('remove')}
            </Button>
         ) : null}

         <AlertDialog open={rotating} onOpenChange={setRotating}>
            <AlertDialogContent>
               <AlertDialogHeader>
                  <AlertDialogTitle>{t('rotateTitle')}</AlertDialogTitle>
                  <AlertDialogDescription>{t('rotateBody')}</AlertDialogDescription>
               </AlertDialogHeader>
               <AlertDialogFooter>
                  <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
                  <AlertDialogAction
                     onClick={() =>
                        void act(async () => {
                           const { secrets } = await rotateWebhook(autopilotId, trigger.id);
                           onSecrets(secrets);
                           toast.success(t('rotated'));
                        })
                     }
                  >
                     {t('rotate')}
                  </AlertDialogAction>
               </AlertDialogFooter>
            </AlertDialogContent>
         </AlertDialog>

         <ConfirmAction
            open={removing}
            onOpenChange={setRemoving}
            title={tc('removeTriggerTitle')}
            description={tc('removeTriggerBody')}
            confirmLabel={tc('remove')}
            cancelLabel={t('cancel')}
            destructive
            onConfirm={remove}
         />
      </div>
   );
}

export type AddableTrigger = 'cron' | 'event' | 'webhook';

/**
 * Adding one trigger of a kind: its own fields and its own button, because a
 * trigger is created on the server the moment it is added — it does not wait
 * for the Loop's Save.
 */
export function AddTriggerForm({
   autopilotId,
   kind,
   projects,
   onAdded,
   onCancel,
   onSecrets,
}: {
   autopilotId: string;
   kind: AddableTrigger;
   projects: Project[];
   onAdded: () => void;
   onCancel: () => void;
   onSecrets: (secrets: WebhookSecrets) => void;
}) {
   const t = useTranslations('loops.triggers');
   const [eventDraft, setEventDraft] = useState<{
      eventType: LoopEventType;
      conditions: Conditions;
   }>({ eventType: 'issue.created', conditions: EMPTY_CONDITIONS });
   const [schedule, setSchedule] = useState({
      expression: '0 9 * * 1-5',
      timezone: localTimezone(),
   });
   const [filters, setFilters] = useState('');
   const [busy, setBusy] = useState(false);

   const add = async () => {
      setBusy(true);
      try {
         if (kind === 'cron') {
            await addCronTrigger(autopilotId, schedule);
         } else if (kind === 'event') {
            await addEventTrigger(autopilotId, eventDraft);
         } else {
            const made = await addWebhookTrigger(
               autopilotId,
               filters
                  .split(',')
                  .map((name) => name.trim())
                  .filter((name) => name !== '')
            );
            onSecrets(made.secrets);
         }
         onAdded();
      } catch (failure) {
         toast.error(describeAutopilotFailure(failure));
      } finally {
         setBusy(false);
      }
   };

   const label =
      kind === 'cron' ? t('addSchedule') : kind === 'event' ? t('addEvent') : t('addWebhook');

   return (
      <div className="grid gap-3">
         {kind === 'event' ? (
            <EventTriggerEditor
               eventType={eventDraft.eventType}
               conditions={eventDraft.conditions}
               projects={projects}
               onChange={setEventDraft}
            />
         ) : kind === 'cron' ? (
            <ScheduleEditor
               expression={schedule.expression}
               timezone={schedule.timezone}
               onChange={setSchedule}
            />
         ) : (
            <div className="grid gap-2">
               <Label htmlFor="webhook-filters">{t('filters')}</Label>
               <Input
                  id="webhook-filters"
                  value={filters}
                  onChange={(event) => setFilters(event.target.value)}
               />
               <p className="text-muted-foreground">{t('filtersHint')}</p>
            </div>
         )}
         <div className="flex gap-2">
            <Button
               type="button"
               size="xs"
               disabled={busy || (kind === 'event' && !conditionsComplete(eventDraft.conditions))}
               onClick={() => void add()}
            >
               {label}
            </Button>
            <Button type="button" size="xs" variant="ghost" onClick={onCancel}>
               {t('cancel')}
            </Button>
         </div>
      </div>
   );
}

/** Projects of this workspace, for event conditions; empty until they load. */
export function useWorkspaceProjects(): Project[] {
   const [projects, setProjects] = useState<Project[]>([]);
   const workspaceId = useSessionStore((state) => state.workspace?.id ?? '');
   useEffect(() => {
      if (!workspaceId) return;
      let cancelled = false;
      void loadWorkspaceProjects(workspaceId).then(
         (found) => {
            if (!cancelled) setProjects(found);
         },
         () => undefined
      );
      return () => {
         cancelled = true;
      };
   }, [workspaceId]);
   return projects;
}

/** What makes this autopilot run, and what it would take to change that. */
export default function TriggersTab({ autopilot, canEdit, onChanged }: Props) {
   const t = useTranslations('loops.triggers');
   const [secrets, setSecrets] = useState<WebhookSecrets | null>(null);
   const [adding, setAdding] = useState<AddableTrigger | null>(null);
   const projects = useWorkspaceProjects();

   return (
      <div className="grid gap-4 px-6 py-4">
         {secrets ? <SecretsNotice secrets={secrets} onDismiss={() => setSecrets(null)} /> : null}

         <div>
            {autopilot.triggers.length === 0 ? (
               <p className="text-muted-foreground">{t('none')}</p>
            ) : (
               autopilot.triggers.map((trigger) => (
                  <TriggerRow
                     key={trigger.id}
                     autopilotId={autopilot.id}
                     trigger={trigger}
                     canEdit={canEdit}
                     onChanged={onChanged}
                     onSecrets={(next) => {
                        setSecrets(next);
                        onChanged();
                     }}
                     projects={projects}
                  />
               ))
            )}
         </div>

         {canEdit ? (
            adding === null ? (
               <div className="flex flex-wrap gap-2">
                  <Button
                     type="button"
                     size="xs"
                     variant="secondary"
                     onClick={() => setAdding('cron')}
                  >
                     {t('addSchedule')}
                  </Button>
                  <Button
                     type="button"
                     size="xs"
                     variant="secondary"
                     onClick={() => setAdding('event')}
                  >
                     {t('addEvent')}
                  </Button>
                  <Button
                     type="button"
                     size="xs"
                     variant="secondary"
                     onClick={() => setAdding('webhook')}
                  >
                     {t('addWebhook')}
                  </Button>
               </div>
            ) : (
               <div className="max-w-2xl rounded-md border p-4">
                  <AddTriggerForm
                     autopilotId={autopilot.id}
                     kind={adding}
                     projects={projects}
                     onAdded={() => {
                        setAdding(null);
                        onChanged();
                     }}
                     onCancel={() => setAdding(null)}
                     onSecrets={setSecrets}
                  />
               </div>
            )
         ) : null}
      </div>
   );
}
