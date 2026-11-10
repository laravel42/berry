'use client';

import { useTranslations } from 'next-intl';
import { useParams, useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
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
import {
   EmptyState,
   EmptyStateLoading,
   EmptyStateMark,
   EmptyStateText,
   EmptyStateTitle,
} from '@/components/common/empty-state';
import LoopCard from '@/components/common/loops/loop-card';
import { TemplateCard } from '@/components/common/loops/template-card';
import {
   archiveAutopilot,
   describeAutopilotFailure,
   duplicateAutopilot,
   restoreAutopilot,
   updateAutopilot,
   type Autopilot,
   type LoopTemplate,
} from '@/lib/autopilots';
import { WORKSPACE_SLUG } from '@/lib/config';

export { FALLBACK_TEMPLATE_ICON, TEMPLATE_ICON } from '@/components/common/loops/template-card';

interface Props {
   autopilots: Autopilot[];
   loaded: boolean;
   error: string | null;
   /** Names for assignee ids. */
   assigneeName: (autopilot: Autopilot) => string;
   canEdit: boolean;
   onChanged: () => void;
   narrowed: boolean;
   /** The server's template catalogue, for the empty state. */
   templates: LoopTemplate[];
   onUseTemplate: (template: LoopTemplate) => void;
   archived?: boolean;
}

/**
 * The order a person scans in: what is on before what is off, and within
 * each, what ran most recently first. There is no sort control; a short list
 * in a sensible order needs none.
 */
export function orderLoops(list: Autopilot[]): Autopilot[] {
   const rank = (loop: Autopilot) => (loop.status === 'active' ? 0 : 1);
   return [...list].sort(
      (left, right) =>
         rank(left) - rank(right) ||
         (right.activity.lastRun?.createdAt ?? '').localeCompare(
            left.activity.lastRun?.createdAt ?? ''
         ) ||
         left.name.localeCompare(right.name)
   );
}

/**
 * The workspace's Loops, as cards. Each card switches its Loop on and off in
 * place; archiving asks first, duplicating opens the paused copy.
 */
export default function Autopilots({
   autopilots,
   loaded,
   error,
   assigneeName,
   canEdit,
   onChanged,
   narrowed,
   templates,
   onUseTemplate,
   archived = false,
}: Props) {
   const t = useTranslations('loops');
   const router = useRouter();
   const params = useParams<{ orgId?: string }>();
   const orgId = params?.orgId || WORKSPACE_SLUG;
   const [confirming, setConfirming] = useState<Autopilot | null>(null);
   const [busyId, setBusyId] = useState<string | null>(null);

   const loops = useMemo(() => orderLoops(autopilots), [autopilots]);

   /** One request at a time per card; the list is re-read after each. */
   const act = async (loop: Autopilot, work: () => Promise<unknown>, done: string) => {
      setBusyId(loop.id);
      try {
         await work();
         toast.success(done);
         onChanged();
      } catch (failure) {
         toast.error(describeAutopilotFailure(failure));
      } finally {
         setBusyId(null);
      }
   };

   if (!loaded && !error) {
      return <EmptyStateLoading label={t('loading')} />;
   }
   if (error) {
      return (
         <div className="px-6 py-10 text-muted-foreground" role="alert">
            {error}
         </div>
      );
   }

   if (loops.length === 0) {
      if (narrowed || archived) {
         const text = narrowed ? t('noMatch') : t('empty.archived');
         return (
            <EmptyState icon={<EmptyStateMark label={text} />}>
               <EmptyStateText>{text}</EmptyStateText>
            </EmptyState>
         );
      }
      return (
         <div className="flex w-full flex-col items-center px-5 py-12">
            <div className="flex w-full max-w-2xl flex-col items-center text-center">
               <EmptyStateMark label={t('empty.mark')} />
               <EmptyStateTitle>{t('empty.title')}</EmptyStateTitle>
               <EmptyStateText>{t('empty.body')}</EmptyStateText>
            </div>
            {canEdit && templates.length > 0 ? (
               <div className="mt-12 grid w-full max-w-5xl grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {templates.map((template) => (
                     <TemplateCard
                        key={template.key}
                        template={template}
                        onChoose={onUseTemplate}
                     />
                  ))}
               </div>
            ) : null}
         </div>
      );
   }

   return (
      <>
         <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
            {loops.map((loop) => (
               <LoopCard
                  key={loop.id}
                  loop={loop}
                  href={`/${orgId}/loop/${loop.id}`}
                  runHref={(runId) => `/${orgId}/loop/${loop.id}/runs/${runId}`}
                  assigneeName={assigneeName(loop)}
                  canEdit={canEdit}
                  busy={busyId === loop.id}
                  onToggle={(target, on) =>
                     void act(
                        target,
                        () => updateAutopilot(target.id, { status: on ? 'active' : 'paused' }),
                        on ? t('row.resumed') : t('row.paused')
                     )
                  }
                  onDuplicate={(target) =>
                     void act(
                        target,
                        async () => {
                           const copy = await duplicateAutopilot(target.id);
                           router.push(`/${orgId}/loop/${copy.id}`);
                        },
                        t('row.duplicated', { name: target.name })
                     )
                  }
                  onArchive={setConfirming}
                  onRestore={(target) =>
                     void act(
                        target,
                        () => restoreAutopilot(target.id),
                        t('row.restored', { name: target.name })
                     )
                  }
               />
            ))}
         </div>

         <AlertDialog
            open={confirming !== null}
            onOpenChange={(open) => !open && setConfirming(null)}
         >
            <AlertDialogContent>
               <AlertDialogHeader>
                  <AlertDialogTitle>
                     {t('row.confirmDeleteTitle', { name: confirming?.name ?? '' })}
                  </AlertDialogTitle>
                  <AlertDialogDescription>{t('row.confirmDeleteBody')}</AlertDialogDescription>
               </AlertDialogHeader>
               <AlertDialogFooter>
                  <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
                  <AlertDialogAction
                     onClick={() => {
                        const target = confirming;
                        setConfirming(null);
                        if (target)
                           void act(
                              target,
                              () => archiveAutopilot(target.id),
                              t('row.deleted', { name: target.name })
                           );
                     }}
                  >
                     {t('row.delete')}
                  </AlertDialogAction>
               </AlertDialogFooter>
            </AlertDialogContent>
         </AlertDialog>
      </>
   );
}
