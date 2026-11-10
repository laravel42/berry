'use client';

import { Clock, GitPullRequest, Hand, ListChecks, Webhook, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import {
   AddTriggerForm,
   SecretsNotice,
   TriggerRow,
   useWorkspaceProjects,
   type AddableTrigger,
} from '@/components/common/autopilots/triggers-tab';
import { SectionCard, SoonPill } from '@/components/common/loops/loop-editor-parts';
import type { AutopilotDetail, WebhookSecrets } from '@/lib/autopilots';
import { cn } from '@/lib/utils';

export type TriggerKind = AddableTrigger | 'pr' | 'manual';
type Kind = TriggerKind;

/** Each kind's glyph and the token its tile is tinted with. */
const KIND: Record<Kind, { icon: LucideIcon; tone: string }> = {
   cron: { icon: Clock, tone: 'var(--status-info)' },
   event: { icon: ListChecks, tone: 'var(--status-success)' },
   pr: { icon: GitPullRequest, tone: 'var(--status-neutral)' },
   webhook: { icon: Webhook, tone: 'var(--status-warning)' },
   manual: { icon: Hand, tone: 'var(--status-neutral)' },
};
const ORDER: Kind[] = ['cron', 'event', 'pr', 'webhook', 'manual'];

/**
 * What starts a run.
 *
 * A Loop can have several triggers, so the tiles show which kinds it uses and
 * pick a kind to add. A trigger is created, switched or removed on the server
 * at once — this card never waits for the page's Save.
 */
export default function LoopTriggerCard({
   autopilot,
   canEdit,
   onChanged,
}: {
   autopilot: AutopilotDetail;
   canEdit: boolean;
   onChanged: () => void;
}) {
   const t = useTranslations('loops.editor');
   const projects = useWorkspaceProjects();
   const [adding, setAdding] = useState<AddableTrigger | null>(null);
   const [showManual, setShowManual] = useState(false);
   const [secrets, setSecrets] = useState<WebhookSecrets | null>(null);

   const count = (kind: Kind) =>
      kind === 'manual' ? 0 : autopilot.triggers.filter((trigger) => trigger.kind === kind).length;
   const manualOnly = autopilot.triggers.length === 0;

   const pick = (kind: Kind) => {
      if (kind === 'pr') return;
      if (kind === 'manual') {
         setAdding(null);
         setShowManual(true);
         return;
      }
      setShowManual(false);
      setAdding(canEdit ? kind : null);
   };

   return (
      <SectionCard title={t('trigger')} hint={t('triggerHint')}>
         <TriggerKindTiles
            isOn={(kind) => (kind === 'manual' ? manualOnly : count(kind) > 0)}
            isPicked={(kind) => (kind === 'manual' ? showManual : adding === kind)}
            count={count}
            canEdit={canEdit}
            onPick={pick}
         />

         {secrets ? (
            <div className="border-t border-border/60 px-4 py-3.5">
               <SecretsNotice secrets={secrets} onDismiss={() => setSecrets(null)} />
            </div>
         ) : null}

         {autopilot.triggers.map((trigger) => (
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
         ))}

         {adding ? (
            <div className="border-t border-border/60 bg-background/40 px-4 py-4">
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
         ) : manualOnly || showManual ? (
            <p className="border-t border-border/60 px-4 py-3.5 text-muted-foreground">
               {manualOnly ? t('manualOnly') : t('manualAlways')}
            </p>
         ) : null}
      </SectionCard>
   );
}

/**
 * The trigger kinds as tiles: the ones in use tinted with their own colour,
 * Pull request shown but not offered yet.
 */
export function TriggerKindTiles({
   isOn,
   isPicked,
   count,
   canEdit,
   onPick,
}: {
   isOn: (kind: TriggerKind) => boolean;
   isPicked: (kind: TriggerKind) => boolean;
   count?: (kind: TriggerKind) => number;
   canEdit: boolean;
   onPick: (kind: TriggerKind) => void;
}) {
   const t = useTranslations('loops.editor');
   return (
      <div className="grid grid-cols-[repeat(auto-fit,minmax(118px,1fr))] gap-2 px-4 pb-4">
         {ORDER.map((kind) => {
            const { icon: Icon, tone } = KIND[kind];
            const soon = kind === 'pr';
            const inUse = isOn(kind);
            const picked = isPicked(kind);
            const many = count ? count(kind) : 0;
            return (
               <button
                  key={kind}
                  type="button"
                  disabled={soon || (!canEdit && kind !== 'manual')}
                  aria-pressed={picked || inUse}
                  onClick={() => onPick(kind)}
                  className={cn(
                     'flex min-w-0 flex-col gap-2 rounded-lg border bg-background p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50',
                     'enabled:hover:border-foreground/25 disabled:cursor-not-allowed',
                     soon && 'opacity-60'
                  )}
                  style={
                     inUse || picked
                        ? {
                             borderColor: tone,
                             backgroundColor: `color-mix(in oklab, ${tone} 8%, var(--background))`,
                          }
                        : undefined
                  }
               >
                  <span className="flex items-center justify-between gap-2">
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
                     {soon ? (
                        <SoonPill />
                     ) : many > 1 ? (
                        <span className="tabular-nums text-subtle-foreground">{many}</span>
                     ) : null}
                  </span>
                  <span className="flex min-w-0 flex-col gap-px">
                     <span
                        className={cn(
                           'truncate font-medium',
                           inUse || picked ? 'text-foreground' : 'text-muted-foreground'
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
   );
}
