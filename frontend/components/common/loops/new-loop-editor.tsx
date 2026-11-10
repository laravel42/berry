'use client';

import { Info, Wand2 } from 'lucide-react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

import { draftFromSeed, type LoopSeed } from '@/components/common/autopilots/autopilot-dialog';
import ScheduleEditor from '@/components/common/autopilots/schedule-editor';
import { SecretsNotice, useWorkspaceProjects } from '@/components/common/autopilots/triggers-tab';
import EventTriggerEditor, {
   conditionsComplete,
} from '@/components/common/loops/event-trigger-editor';
import { SectionCard } from '@/components/common/loops/loop-editor-parts';
import { LoopEditorFields, draftReady } from '@/components/common/loops/loop-editor-fields';
import { TriggerKindTiles, type TriggerKind } from '@/components/common/loops/loop-trigger-card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
   addCronTrigger,
   addEventTrigger,
   addWebhookTrigger,
   createAutopilot,
   describeAutopilotFailure,
   EMPTY_CONDITIONS,
   type AutopilotDraft,
   type Conditions,
   type LoopEventType,
   type WebhookSecrets,
} from '@/lib/autopilots';
import { boardsIn, listBoards, type BoardSummary } from '@/lib/boards';
import { WORKSPACE_SLUG } from '@/lib/config';
import { localTimezone } from '@/lib/cron-schedule';
import { getAgentCoverage, type AgentCoverage } from '@/lib/runtimes';
import { useSessionStore } from '@/store/session-store';

type FirstTrigger = 'none' | 'cron' | 'event' | 'webhook';

/**
 * A new Loop, reviewed on the same page an existing one is edited on.
 *
 * Nothing exists on the server until Create. The Loop is made first, then its
 * first trigger; if adding the trigger fails, the Loop already exists and can
 * be finished on its own page. A webhook's secret is shown once, here, before
 * moving on — it cannot be read again.
 */
export default function NewLoopEditor({
   seed,
   sourceNote,
   notes,
   onBack,
}: {
   seed: LoopSeed;
   /** How this draft came to be: a template, a sentence, or nothing. */
   sourceNote: string;
   /** What the person should check before creating it. */
   notes: string[];
   onBack: () => void;
}) {
   const t = useTranslations('loops');
   const te = useTranslations('loops.editor');
   const tt = useTranslations('loops.triggers');
   const router = useRouter();
   const params = useParams<{ orgId?: string }>();
   const orgId = params?.orgId || WORKSPACE_SLUG;
   const workspaceId = useSessionStore((state) => state.workspace?.id ?? '');
   const projects = useWorkspaceProjects();

   const [draft, setDraft] = useState<AutopilotDraft>(() => draftFromSeed(seed));
   const [boards, setBoards] = useState<BoardSummary[]>([]);
   const [coverage, setCoverage] = useState<AgentCoverage | null>(null);
   const [trigger, setTrigger] = useState<FirstTrigger>(() => seed.trigger?.kind ?? 'none');
   const [schedule, setSchedule] = useState({
      expression: seed.trigger?.kind === 'cron' ? seed.trigger.expression : '0 9 * * 1-5',
      timezone: localTimezone(),
   });
   const [eventTrigger, setEventTrigger] = useState<{
      eventType: LoopEventType;
      conditions: Conditions;
   }>(() =>
      seed.trigger?.kind === 'event'
         ? { eventType: seed.trigger.eventType, conditions: seed.trigger.conditions }
         : { eventType: 'issue.created', conditions: EMPTY_CONDITIONS }
   );
   const [eventFilters, setEventFilters] = useState('');
   const [createPaused, setCreatePaused] = useState(false);
   const [saving, setSaving] = useState(false);
   const [secrets, setSecrets] = useState<{ id: string; secrets: WebhookSecrets } | null>(null);

   useEffect(() => {
      let cancelled = false;
      void listBoards().then(
         (found) => {
            if (cancelled) return;
            const mine = boardsIn(found, workspaceId);
            setBoards(mine);
            // One board is the common case: file runs there without asking.
            setDraft((current) =>
               current.executionMode === 'create_issue' && current.boardId === null && mine[0]
                  ? { ...current, boardId: mine[0].id }
                  : current
            );
         },
         () => undefined
      );
      void getAgentCoverage().then(
         (found) => {
            if (!cancelled) setCoverage(found);
         },
         () => undefined
      );
      return () => {
         cancelled = true;
      };
   }, [workspaceId]);

   const ready =
      draftReady(draft) && (trigger !== 'event' || conditionsComplete(eventTrigger.conditions));

   const create = async () => {
      if (!ready || saving || !workspaceId) return;
      setSaving(true);
      try {
         const created = await createAutopilot(workspaceId, draft, {
            status: createPaused ? 'paused' : 'active',
         });
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
            toast.success(t('dialog.created'));
            setSecrets({ id: created.id, secrets: made.secrets });
            return;
         }
         toast.success(t('dialog.created'));
         router.push(`/${orgId}/loop/${created.id}`);
      } catch (failure) {
         toast.error(describeAutopilotFailure(failure));
      } finally {
         setSaving(false);
      }
   };

   const pickKind = (kind: TriggerKind) => {
      if (kind === 'pr') return;
      setTrigger(kind === 'manual' ? 'none' : kind);
   };
   const isOn = (kind: TriggerKind) => (kind === 'manual' ? trigger === 'none' : kind === trigger);

   return (
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
         <header className="flex h-[52px] shrink-0 items-center gap-2.5 border-b px-5">
            <nav aria-label={t('title')} className="flex min-w-0 items-center gap-2.5">
               <Link
                  href={`/${orgId}/loops`}
                  data-heading="h1"
                  className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
               >
                  {t('title')}
               </Link>
               <span data-heading="h1" className="text-subtle-foreground" aria-hidden>
                  /
               </span>
               <h1 className="m-0 truncate">{draft.name.trim() || te('newLoop')}</h1>
            </nav>
            <span className="inline-flex h-5 shrink-0 items-center gap-1.5 rounded-[5px] bg-accent px-1.5 leading-none text-status-warning">
               <span className="size-1.5 rounded-full bg-status-warning" aria-hidden />
               {te('draft')}
            </span>

            <div className="ml-auto flex shrink-0 items-center gap-3">
               {secrets ? null : (
                  <>
                     <label className="hidden cursor-pointer items-center gap-2 text-muted-foreground sm:flex">
                        <Switch checked={createPaused} onCheckedChange={setCreatePaused} />
                        {te('createPaused')}
                     </label>
                     <Button type="button" variant="ghost" disabled={saving} onClick={onBack}>
                        {te('back')}
                     </Button>
                     <Button
                        type="button"
                        disabled={!ready || saving}
                        title={ready ? undefined : te('incomplete')}
                        onClick={() => void create()}
                     >
                        {saving ? te('creating') : te('create')}
                     </Button>
                  </>
               )}
            </div>
         </header>

         <div className="min-h-0 flex-1 overflow-y-auto p-5">
            <div className="mx-auto flex w-full max-w-[1160px] flex-col gap-5">
               {secrets ? (
                  <div className="mx-auto w-full max-w-2xl">
                     <SecretsNotice
                        secrets={secrets.secrets}
                        onDismiss={() => router.push(`/${orgId}/loop/${secrets.id}`)}
                     />
                  </div>
               ) : (
                  <div className="grid items-start gap-5 lg:grid-cols-3">
                     <div className="flex min-w-0 flex-col gap-5 lg:col-span-2">
                        <LoopEditorFields
                           draft={draft}
                           onPatch={(next) => setDraft((current) => ({ ...current, ...next }))}
                           editable
                           boards={boards}
                           coverage={coverage}
                           listensForEvents={trigger === 'event'}
                           trigger={
                              <SectionCard title={te('trigger')} hint={te('triggerHintNew')}>
                                 <TriggerKindTiles
                                    isOn={isOn}
                                    isPicked={isOn}
                                    canEdit
                                    onPick={pickKind}
                                 />
                                 <div className="border-t border-border/60 px-4 py-4">
                                    {trigger === 'cron' ? (
                                       <ScheduleEditor
                                          expression={schedule.expression}
                                          timezone={schedule.timezone}
                                          onChange={setSchedule}
                                       />
                                    ) : trigger === 'event' ? (
                                       <EventTriggerEditor
                                          eventType={eventTrigger.eventType}
                                          conditions={eventTrigger.conditions}
                                          projects={projects}
                                          onChange={setEventTrigger}
                                       />
                                    ) : trigger === 'webhook' ? (
                                       <div className="grid gap-2">
                                          <Label htmlFor="new-loop-webhook-filters">
                                             {tt('filters')}
                                          </Label>
                                          <Input
                                             id="new-loop-webhook-filters"
                                             value={eventFilters}
                                             onChange={(event) =>
                                                setEventFilters(event.target.value)
                                             }
                                          />
                                          <p className="text-subtle-foreground">
                                             {tt('filtersHint')}
                                          </p>
                                       </div>
                                    ) : (
                                       <p className="text-muted-foreground">{te('manualOnly')}</p>
                                    )}
                                 </div>
                              </SectionCard>
                           }
                        />
                     </div>

                     <div className="flex min-w-0 flex-col gap-5">
                        <section
                           className="overflow-hidden rounded-[10px] border border-border/70 bg-background/60"
                           aria-label={te('setup')}
                        >
                           <div className="flex items-center gap-2 border-b border-border/60 px-3.5 py-3">
                              <Wand2 className="size-3.5 text-status-info" aria-hidden />
                              <span className="font-medium">{te('setup')}</span>
                           </div>
                           <div className="flex flex-col gap-2.5 p-3.5">
                              <p className="text-pretty text-muted-foreground">{sourceNote}</p>
                              {notes.map((note) => (
                                 <p
                                    key={note}
                                    className="flex items-start gap-2 rounded-lg bg-status-warning/10 px-3 py-2 text-pretty"
                                 >
                                    <Info
                                       className="mt-px size-4 shrink-0 text-status-warning"
                                       aria-hidden
                                    />
                                    {note}
                                 </p>
                              ))}
                              <p className="text-pretty text-subtle-foreground">
                                 {te('setupNext')}
                              </p>
                           </div>
                        </section>

                        <SectionCard title={te('runHistory')}>
                           <p className="border-t border-border/60 px-4 py-3.5 text-subtle-foreground">
                              {te('noRunsNew')}
                           </p>
                        </SectionCard>
                     </div>
                  </div>
               )}
            </div>
         </div>
      </div>
   );
}
