'use client';

import { Clock, Copy, Eye, EyeOff, Link2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
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
import { absoluteApiUrl } from '@/lib/api';
import {
   addCronTrigger,
   addWebhookTrigger,
   deleteTrigger,
   describeAutopilotFailure,
   rotateWebhook,
   updateTrigger,
   type AutopilotDetail,
   type AutopilotTrigger,
   type WebhookSecrets,
} from '@/lib/autopilots';
import { localTimezone } from '@/lib/cron-schedule';

import ScheduleEditor, { useDescribeCron } from './schedule-editor';

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
   const t = useTranslations('areas.autopilots.triggers');
   const [shown, setShown] = useState(false);
   const endpoint = absoluteApiUrl(secrets.ingressPath);
   const mask = (value: string) => (shown ? value : '•'.repeat(Math.min(32, value.length)));

   return (
      <div className="rounded-[7px] border border-dashed border-input p-4" role="status">
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

function TriggerRow({
   autopilotId,
   trigger,
   canEdit,
   onChanged,
   onSecrets,
}: {
   autopilotId: string;
   trigger: AutopilotTrigger;
   canEdit: boolean;
   onChanged: () => void;
   onSecrets: (secrets: WebhookSecrets) => void;
}) {
   const t = useTranslations('areas.autopilots.triggers');
   const tc = useTranslations('common.confirm');
   const describeCron = useDescribeCron();
   const [rotating, setRotating] = useState(false);
   const [removing, setRemoving] = useState(false);

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
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3.5">
         <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            {trigger.kind === 'cron' ? (
               <>
                  <span className="flex min-w-0 items-center gap-1.5 font-medium text-foreground">
                     <Clock className="size-3 shrink-0 text-subtle-foreground" aria-hidden />
                     <span className="truncate">
                        {trigger.cronExpression ? describeCron(trigger.cronExpression) : '—'}
                     </span>
                  </span>
                  <span data-settings-type="caption" className="text-subtle-foreground">
                     {trigger.timezone}
                     {' · '}
                     {trigger.nextFireAt
                        ? t('next', { when: new Date(trigger.nextFireAt).toLocaleString() })
                        : t('notScheduled')}
                  </span>
               </>
            ) : (
               <>
                  <span className="flex min-w-0 items-center gap-1.5 font-medium text-foreground">
                     <Link2 className="size-3 shrink-0 text-subtle-foreground" aria-hidden />
                     <span className="truncate">
                        {t('webhookName', { hint: trigger.tokenHint ?? '' })}
                     </span>
                  </span>
                  <span data-settings-type="caption" className="text-subtle-foreground">
                     {trigger.eventFilters.length > 0
                        ? trigger.eventFilters.join(', ')
                        : t('everyEvent')}
                     {' · '}
                     {t('urlHiddenHint')}
                  </span>
               </>
            )}
         </div>
         {canEdit && trigger.kind === 'webhook' ? (
            <Button type="button" variant="soft" onClick={() => setRotating(true)}>
               {t('rotate')}
            </Button>
         ) : null}
         {canEdit ? (
            <Button type="button" variant="quiet" onClick={() => setRemoving(true)}>
               {t('remove')}
            </Button>
         ) : null}
         <Switch
            variant="settings"
            checked={trigger.enabled}
            disabled={!canEdit}
            onCheckedChange={(enabled) =>
               void act(() => updateTrigger(autopilotId, trigger.id, { enabled }))
            }
            aria-label={t('enabled')}
         />

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

/**
 * What makes this autopilot run, and what it would take to change that: one
 * row per trigger, then the add actions. Rendered inside the editor's Trigger
 * group, which draws the card and the dividers.
 */
export default function TriggersTab({ autopilot, canEdit, onChanged }: Props) {
   const t = useTranslations('areas.autopilots.triggers');
   const [secrets, setSecrets] = useState<WebhookSecrets | null>(null);
   const [adding, setAdding] = useState<'cron' | 'webhook' | null>(null);
   const [schedule, setSchedule] = useState({
      expression: '0 9 * * 1-5',
      timezone: localTimezone(),
   });
   const [filters, setFilters] = useState('');
   const [busy, setBusy] = useState(false);

   const addSchedule = async () => {
      setBusy(true);
      try {
         await addCronTrigger(autopilot.id, schedule);
         setAdding(null);
         onChanged();
      } catch (failure) {
         toast.error(describeAutopilotFailure(failure));
      } finally {
         setBusy(false);
      }
   };

   const addWebhook = async () => {
      setBusy(true);
      try {
         const made = await addWebhookTrigger(
            autopilot.id,
            filters
               .split(',')
               .map((name) => name.trim())
               .filter((name) => name !== '')
         );
         setFilters('');
         setAdding(null);
         setSecrets(made.secrets);
         onChanged();
      } catch (failure) {
         toast.error(describeAutopilotFailure(failure));
      } finally {
         setBusy(false);
      }
   };

   // Rows only: the caller's group draws the card and divides them.
   return (
      <>
         {secrets ? (
            <div className="px-4 py-3.5">
               <SecretsNotice secrets={secrets} onDismiss={() => setSecrets(null)} />
            </div>
         ) : null}

         {autopilot.triggers.length === 0 ? (
            <div className="px-4 py-3.5 text-muted-foreground">{t('none')}</div>
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
               />
            ))
         )}

         {canEdit ? (
            adding === null ? (
               <div className="flex flex-wrap gap-2 px-4 py-3">
                  <Button type="button" variant="soft" onClick={() => setAdding('cron')}>
                     <Clock className="size-[13px]" aria-hidden />
                     {t('addSchedule')}
                  </Button>
                  <Button type="button" variant="soft" onClick={() => setAdding('webhook')}>
                     <Link2 className="size-[13px]" aria-hidden />
                     {t('addWebhook')}
                  </Button>
               </div>
            ) : adding === 'cron' ? (
               <div className="flex flex-col gap-3 px-4 py-3.5">
                  <ScheduleEditor
                     expression={schedule.expression}
                     timezone={schedule.timezone}
                     onChange={setSchedule}
                  />
                  <div className="flex gap-2">
                     <Button type="button" disabled={busy} onClick={() => void addSchedule()}>
                        {t('addSchedule')}
                     </Button>
                     <Button type="button" variant="quiet" onClick={() => setAdding(null)}>
                        {t('cancel')}
                     </Button>
                  </div>
               </div>
            ) : (
               <div className="flex flex-col gap-2 px-4 py-3.5">
                  <Label htmlFor="webhook-filters">{t('filters')}</Label>
                  <Input
                     id="webhook-filters"
                     value={filters}
                     onChange={(event) => setFilters(event.target.value)}
                  />
                  <p data-settings-type="caption" className="text-subtle-foreground">
                     {t('filtersHint')}
                  </p>
                  <div className="flex gap-2">
                     <Button type="button" disabled={busy} onClick={() => void addWebhook()}>
                        {t('addWebhook')}
                     </Button>
                     <Button type="button" variant="quiet" onClick={() => setAdding(null)}>
                        {t('cancel')}
                     </Button>
                  </div>
               </div>
            )
         ) : null}
      </>
   );
}
