'use client';

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
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { describePatchFailure } from '@/lib/issues';
import {
   decideReview,
   stoppedWithoutDelivering,
   type ReviewDecision,
   type ReviewItem,
} from '@/lib/reviews';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

/** What a decision did, for the surface around the bar to announce and move on from. */
export interface ReviewOutcome {
   reviewId: string;
   identifier: string;
   decision: ReviewDecision;
}

/**
 * The decision on a task at the gate: a note, Approve and Send back.
 *
 * Which of the two leads follows what the run left behind. A delivery — a
 * commit or a pull request — is there to be approved, so Approve is primary.
 * A run that stopped with neither has nothing to approve; Send back leads and
 * Approve steps aside. Either way Approve asks first and names what marking
 * this task done means: a pull request stays open on GitHub, nothing
 * committed means the task simply leaves the queue. Send back needs a note,
 * because the agent reads it on its next run and without one it would try
 * the same thing again.
 *
 * Reviews' right pane and the task page both mount this, so the two surfaces
 * cannot disagree about the rules.
 */
export function ReviewDecisionBar({
   item,
   onDecided,
   aside,
   className,
}: {
   item: ReviewItem;
   onDecided?: (outcome: ReviewOutcome) => void | Promise<void>;
   /** Rendered after the buttons — the task page puts its link to Reviews here. */
   aside?: ReactNode;
   className?: string;
}) {
   const t = useTranslations('reviews');
   const [note, setNote] = useState('');
   const [noteMissing, setNoteMissing] = useState(false);
   const [pending, setPending] = useState<ReviewDecision | null>(null);
   const [failure, setFailure] = useState<{ decision: ReviewDecision; reason: string } | null>(
      null
   );
   const [confirming, setConfirming] = useState(false);
   // Same on the server and the first client paint; the Mac glyph lands after
   // hydration, so the two never disagree.
   const [keys, setKeys] = useState(() => t('decision.keysOther'));
   const noteRef = useRef<HTMLTextAreaElement>(null);
   const noteId = useId();
   const helpId = useId();
   const errorId = useId();

   useEffect(() => {
      if (/Mac|iPhone|iPad/.test(navigator.platform)) setKeys(t('decision.keysMac'));
   }, [t]);

   const stopped = stoppedWithoutDelivering(item);
   const primary: ReviewDecision = stopped ? 'send-back' : 'approve';

   const commit = (decision: ReviewDecision) => {
      setFailure(null);
      setPending(decision);
      void decideReview(item, decision, note)
         .then(async () => {
            setNote('');
            await onDecided?.({
               reviewId: item.id,
               identifier: item.issue.identifier,
               decision,
            });
         })
         .catch((error: unknown) => {
            setFailure({ decision, reason: describePatchFailure(error) });
         })
         .finally(() => setPending(null));
   };

   /** A button's job: check the note, or ask first; the commit comes after. */
   const request = (decision: ReviewDecision) => {
      if (pending !== null || confirming) return;
      if (decision === 'approve') {
         setConfirming(true);
         return;
      }
      if (note.trim() === '') {
         // The button stays live so a keyboard user finds it; the field says
         // what is missing, and takes focus so the fix is one keystroke away.
         setNoteMissing(true);
         noteRef.current?.focus();
         return;
      }
      setNoteMissing(false);
      commit('send-back');
   };

   // Cmd/Ctrl+Enter from anywhere in the bar — the note field included, where
   // a plain Enter is a newline — takes the primary action.
   const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      request(primary);
   };

   const consequence = item.pullRequest
      ? t('decision.confirmPullRequest')
      : item.delivery.committed
        ? t('decision.confirmCommitted')
        : t('decision.confirmNothingCommitted');

   const describedBy = noteMissing ? `${helpId} ${errorId}` : helpId;

   const approve = (
      <Button
         size="sm"
         variant={primary === 'approve' ? 'default' : 'secondary'}
         disabled={pending !== null}
         aria-busy={pending === 'approve' || undefined}
         onClick={() => request('approve')}
      >
         {pending === 'approve' ? t('decision.approving') : t('decision.approve')}
      </Button>
   );
   const sendBack = (
      <Button
         size="sm"
         variant={primary === 'send-back' ? 'default' : 'secondary'}
         disabled={pending !== null}
         aria-busy={pending === 'send-back' || undefined}
         onClick={() => request('send-back')}
      >
         {pending === 'send-back' ? t('decision.sendingBack') : t('decision.sendBack')}
      </Button>
   );

   return (
      <div className={className} onKeyDown={onKeyDown}>
         <label htmlFor={noteId} className="sr-only">
            {t('decision.noteLabel')}
         </label>
         <Textarea
            id={noteId}
            ref={noteRef}
            value={note}
            onChange={(event) => {
               setNote(event.target.value);
               if (noteMissing && event.target.value.trim() !== '') setNoteMissing(false);
            }}
            placeholder={t('decision.notePlaceholder')}
            aria-describedby={describedBy}
            aria-invalid={noteMissing || undefined}
            disabled={pending !== null}
            className="min-h-16 max-w-[75ch]"
         />
         {noteMissing && (
            <p id={errorId} role="alert" className="mt-1.5 text-status-danger">
               {t('decision.noteRequired')}
            </p>
         )}
         {failure && (
            <div
               role="alert"
               className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-status-danger"
            >
               <span>{t('decision.failed', { reason: failure.reason })}</span>
               <Button
                  size="xs"
                  variant="outline"
                  disabled={pending !== null}
                  onClick={() => commit(failure.decision)}
               >
                  {t('decision.retry')}
               </Button>
            </div>
         )}
         <div className="mt-2 flex flex-wrap items-center gap-2">
            {primary === 'approve' ? (
               <>
                  {approve}
                  {sendBack}
               </>
            ) : (
               <>
                  {sendBack}
                  {approve}
               </>
            )}
            {aside && <span className="ml-auto">{aside}</span>}
         </div>
         <p id={helpId} className="mt-2 max-w-[75ch] text-muted-foreground">
            {stopped ? t('decision.explainStopped') : t('decision.explain')}{' '}
            {t('decision.noteHelp')}{' '}
            {t(primary === 'approve' ? 'decision.shortcutApprove' : 'decision.shortcutSendBack', {
               keys,
            })}
         </p>

         <AlertDialog
            open={confirming}
            onOpenChange={(open) => {
               if (!open) setConfirming(false);
            }}
         >
            <AlertDialogContent>
               <AlertDialogHeader>
                  <AlertDialogTitle>
                     {t('decision.confirmTitle', { identifier: item.issue.identifier })}
                  </AlertDialogTitle>
                  <AlertDialogDescription>{consequence}</AlertDialogDescription>
               </AlertDialogHeader>
               <AlertDialogFooter>
                  <AlertDialogCancel>{t('decision.keepInReview')}</AlertDialogCancel>
                  <AlertDialogAction onClick={() => commit('approve')}>
                     {t('decision.markDone')}
                  </AlertDialogAction>
               </AlertDialogFooter>
            </AlertDialogContent>
         </AlertDialog>
      </div>
   );
}
