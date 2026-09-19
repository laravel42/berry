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
import {
   Dialog,
   DialogContent,
   DialogDescription,
   DialogFooter,
   DialogHeader,
   DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { describePatchFailure } from '@/lib/issues';
import {
   decideReview,
   stoppedWithoutDelivering,
   type ReviewDecision,
   type ReviewItem,
} from '@/lib/reviews';
import { CircleHelp } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

/** What a decision did, for the surface around the bar to announce and move on from. */
export interface ReviewOutcome {
   reviewId: string;
   identifier: string;
   decision: ReviewDecision;
}

/**
 * The decision on a task at the gate: Approve and Send back.
 *
 * Which of the two leads follows what the run left behind. A delivery — a
 * commit or a pull request — is there to be approved, so Approve is primary.
 * A run that stopped with neither has nothing to approve; Send back leads and
 * Approve steps aside. Approve asks first and names what marking this task
 * done means. Send back opens a note dialog — the agent reads the note on its
 * next run, so it cannot go without one.
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
   const [noting, setNoting] = useState(false);
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

   // The note field lives in a dialog; take focus when it opens so typing
   // starts immediately.
   useEffect(() => {
      if (!noting) return;
      const id = window.setTimeout(() => noteRef.current?.focus(), 0);
      return () => window.clearTimeout(id);
   }, [noting]);

   const stopped = stoppedWithoutDelivering(item);
   const primary: ReviewDecision = stopped ? 'send-back' : 'approve';

   const commit = (decision: ReviewDecision) => {
      setFailure(null);
      setPending(decision);
      void decideReview(item, decision, note)
         .then(async () => {
            setNote('');
            setNoting(false);
            setNoteMissing(false);
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

   /** A button's job: open the note dialog, or ask before approve. */
   const request = (decision: ReviewDecision) => {
      if (pending !== null || confirming || noting) return;
      if (decision === 'approve') {
         setConfirming(true);
         return;
      }
      setNoteMissing(false);
      setNoting(true);
   };

   const sendBackWithNote = () => {
      if (pending !== null) return;
      if (note.trim() === '') {
         setNoteMissing(true);
         noteRef.current?.focus();
         return;
      }
      setNoteMissing(false);
      commit('send-back');
   };

   // Cmd/Ctrl+Enter from the bar takes the primary action; inside the note
   // dialog it submits the note.
   const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
      if (event.key !== 'Enter' || !(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      if (noting) sendBackWithNote();
      else request(primary);
   };

   const consequence = item.pullRequest
      ? t('decision.confirmPullRequest')
      : item.delivery.committed
        ? t('decision.confirmCommitted')
        : t('decision.confirmNothingCommitted');

   const helpText = [
      stopped ? t('decision.explainStopped') : t('decision.explain'),
      t('decision.noteHelp'),
      t(primary === 'approve' ? 'decision.shortcutApprove' : 'decision.shortcutSendBack', {
         keys,
      }),
   ].join(' ');

   const approve = (
      <Button
         size="xs"
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
         size="xs"
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
         {failure && (
            <div
               role="alert"
               className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-status-danger"
            >
               <span>{t('decision.failed', { reason: failure.reason })}</span>
               <Button
                  size="xs"
                  variant="outline"
                  disabled={pending !== null}
                  onClick={() => {
                     if (failure.decision === 'send-back') setNoting(true);
                     else commit(failure.decision);
                  }}
               >
                  {t('decision.retry')}
               </Button>
            </div>
         )}
         <div className="flex flex-wrap items-center gap-2">
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
            <Tooltip>
               <TooltipTrigger asChild>
                  <button
                     type="button"
                     className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                     aria-label={t('decision.help')}
                  >
                     <CircleHelp className="size-4" aria-hidden />
                  </button>
               </TooltipTrigger>
               <TooltipContent side="top" className="max-w-[75ch]">
                  {helpText}
               </TooltipContent>
            </Tooltip>
            {aside && <span className="ml-auto">{aside}</span>}
         </div>
         <p id={helpId} className="sr-only">
            {helpText}
         </p>

         <Dialog
            open={noting}
            onOpenChange={(open) => {
               if (pending !== null) return;
               setNoting(open);
               if (!open) setNoteMissing(false);
            }}
         >
            <DialogContent className="sm:max-w-lg" onKeyDown={onKeyDown}>
               <DialogHeader>
                  <DialogTitle>{t('decision.sendBackTitle')}</DialogTitle>
                  <DialogDescription>{t('decision.sendBackBody')}</DialogDescription>
               </DialogHeader>
               <div className="flex flex-col gap-1.5">
                  <label htmlFor={noteId} className="text-sm font-medium">
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
                     aria-describedby={noteMissing ? errorId : undefined}
                     aria-invalid={noteMissing || undefined}
                     disabled={pending !== null}
                     className="min-h-24"
                  />
                  {noteMissing && (
                     <p id={errorId} role="alert" className="text-status-danger">
                        {t('decision.noteRequired')}
                     </p>
                  )}
               </div>
               <DialogFooter>
                  <Button
                     variant="outline"
                     disabled={pending !== null}
                     onClick={() => setNoting(false)}
                  >
                     {t('decision.cancelSendBack')}
                  </Button>
                  <Button
                     disabled={pending !== null}
                     aria-busy={pending === 'send-back' || undefined}
                     onClick={sendBackWithNote}
                  >
                     {pending === 'send-back' ? t('decision.sendingBack') : t('decision.sendBack')}
                  </Button>
               </DialogFooter>
            </DialogContent>
         </Dialog>

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
