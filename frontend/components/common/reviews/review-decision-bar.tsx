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
import { describePatchFailure } from '@/lib/issues';
import {
   decideReview,
   loadReviewPullRequestState,
   sentBackForConflict,
   stoppedWithoutDelivering,
   type ReviewDecision,
   type ReviewItem,
   type ReviewPullRequestState,
} from '@/lib/reviews';
import { Check, GitMerge, Loader2, TriangleAlert, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

/** What a decision did, for the surface around the bar to announce and move on from. */
export interface ReviewOutcome {
   reviewId: string;
   identifier: string;
   decision: ReviewDecision;
   /**
    * Approve found the pull request in conflict with its base, and the server
    * sent the task back to its author to bring it up to date instead.
    */
   conflict?: boolean;
}

/**
 * The decision on a task at the gate: Approve and Send back.
 *
 * Approve is always the filled action; Send back is secondary. Which of the
 * two comes first follows what the run left behind: a delivery — a commit or
 * a pull request — leads with Approve; a run that stopped with neither leads
 * with Send back. Approve asks first and names what marking this task done
 * means. Send back opens a note dialog — the agent reads the note on its next
 * run, so it cannot go without one.
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
   const noteRef = useRef<HTMLTextAreaElement>(null);
   const noteId = useId();
   const errorId = useId();
   // Where the pull request stands on GitHub, asked once per run: a conflict
   // with the base, or a merge somebody already made there, is said before
   // Approve rather than learned from it.
   const [pullRequest, setPullRequest] = useState<ReviewPullRequestState | null>(null);
   const runId = item.run.id;
   const hasPullRequest = item.pullRequest !== null;

   useEffect(() => {
      setPullRequest(null);
      if (!hasPullRequest) return;
      let cancelled = false;
      void loadReviewPullRequestState(runId)
         .then((state) => {
            if (!cancelled) setPullRequest(state);
         })
         .catch(() => undefined);
      return () => {
         cancelled = true;
      };
   }, [runId, hasPullRequest]);

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
         .catch(async (error: unknown) => {
            // Not a failure to retry: the merge conflicted and the server
            // already returned the task to its author to bring up to date.
            if (decision === 'approve' && sentBackForConflict(error)) {
               await onDecided?.({
                  reviewId: item.id,
                  identifier: item.issue.identifier,
                  decision: 'send-back',
                  conflict: true,
               });
               return;
            }
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

   const base = pullRequest?.base ?? t('decision.defaultBranch');
   const agent = item.author?.name ?? t('facts.noAuthor');
   const consequence = item.pullRequest
      ? pullRequest?.state === 'merged'
         ? t('decision.confirmMerged')
         : pullRequest?.conflicts
           ? t('decision.confirmConflict', { base, agent })
           : t('decision.confirmPullRequest')
      : item.delivery.committed
        ? t('decision.confirmCommitted')
        : t('decision.confirmNothingCommitted');

   const approve = (
      <Button
         size="xs"
         variant="default"
         className="h-9 w-[42px] px-0"
         disabled={pending !== null}
         aria-busy={pending === 'approve' || undefined}
         aria-label={t('decision.approve')}
         title={t('decision.approve')}
         onClick={() => request('approve')}
      >
         {pending === 'approve' ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
         ) : (
            <Check className="size-3.5" aria-hidden />
         )}
      </Button>
   );
   const sendBack = (
      <Button
         size="xs"
         variant="secondary"
         className="h-9 w-[42px] px-0"
         disabled={pending !== null}
         aria-busy={pending === 'send-back' || undefined}
         aria-label={t('decision.sendBack')}
         title={t('decision.sendBack')}
         onClick={() => request('send-back')}
      >
         {pending === 'send-back' ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
         ) : (
            <X className="size-3.5" aria-hidden />
         )}
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
         {pullRequest?.conflicts && pullRequest.state === 'open' ? (
            <p className="mb-2 flex items-start gap-1.5 text-sm text-status-warning">
               <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
               <span>{t('decision.conflicts', { base, agent })}</span>
            </p>
         ) : pullRequest?.state === 'merged' ? (
            <p className="mb-2 flex items-start gap-1.5 text-status-success">
               <GitMerge className="mt-0.5 size-3.5 shrink-0" aria-hidden />
               <span>{t('decision.mergedOnGitHub')}</span>
            </p>
         ) : null}
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
            {aside && <span className="ml-auto">{aside}</span>}
         </div>

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
