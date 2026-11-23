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
import { cn } from '@/lib/utils';
import { useIssuesStore } from '@/store/issues-store';
import { hasUnsavedEdits, useUnsavedEditsStore } from '@/store/unsaved-edits-store';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type MouseEvent } from 'react';

/**
 * Previous / next task controls and list position (`4 / 1950`).
 *
 * Shared between the desktop header bar (`compact`) and the mobile inline
 * action bar beside the description copy button (`comfortable`), so stepping
 * through tasks keeps the exact same replace-in-place history and unsaved-edit
 * guard everywhere.
 */
export function IssueStepControls({
   issueRef,
   orgId,
   comfortable = false,
}: {
   issueRef: string;
   orgId: string;
   /** Larger 36px touch targets for the mobile inline action bar. */
   comfortable?: boolean;
}) {
   const t = useTranslations('issueDetail.header');
   const router = useRouter();
   const issues = useIssuesStore((state) => state.issues);

   const index = issues.findIndex(
      (candidate) => candidate.identifier === issueRef || candidate.id === issueRef
   );
   const previousIssue = index > 0 ? issues[index - 1] : undefined;
   const nextIssue = index >= 0 && index < issues.length - 1 ? issues[index + 1] : undefined;

   // Previous / next swap the task in place: replacing the history entry means
   // Back leaves the task view instead of stepping through every task passed.
   // Edits that would be lost ask first.
   const [pendingHref, setPendingHref] = useState<string | null>(null);
   const clearUnsaved = useUnsavedEditsStore((state) => state.clear);
   const step = (event: MouseEvent<HTMLAnchorElement>, href: string) => {
      if (!hasUnsavedEdits()) return;
      event.preventDefault();
      setPendingHref(href);
   };

   const buttonClass = comfortable
      ? 'size-9 text-muted-foreground hover:text-foreground'
      : 'size-6';
   const iconClass = comfortable ? 'size-[18px]' : 'size-4';

   return (
      <>
         {index >= 0 && (
            <span
               data-issue-step-counter
               className={cn(
                  'tabular-nums text-muted-foreground',
                  comfortable ? 'mr-1.5 font-medium' : 'mr-1'
               )}
            >
               {index + 1} / {issues.length}
            </span>
         )}
         <Button
            variant="ghost"
            size="icon"
            className={buttonClass}
            disabled={!previousIssue}
            asChild={!!previousIssue}
         >
            {previousIssue ? (
               <Link
                  href={`/${orgId}/issue/${previousIssue.identifier}`}
                  replace
                  onClick={(event) => step(event, `/${orgId}/issue/${previousIssue.identifier}`)}
                  aria-label={t('previousTask')}
               >
                  <ChevronUp className={iconClass} />
               </Link>
            ) : (
               <ChevronUp className={iconClass} />
            )}
         </Button>
         <Button
            variant="ghost"
            size="icon"
            className={buttonClass}
            disabled={!nextIssue}
            asChild={!!nextIssue}
         >
            {nextIssue ? (
               <Link
                  href={`/${orgId}/issue/${nextIssue.identifier}`}
                  replace
                  onClick={(event) => step(event, `/${orgId}/issue/${nextIssue.identifier}`)}
                  aria-label={t('nextTask')}
               >
                  <ChevronDown className={iconClass} />
               </Link>
            ) : (
               <ChevronDown className={iconClass} />
            )}
         </Button>

         <AlertDialog
            open={pendingHref !== null}
            onOpenChange={(open) => (open ? null : setPendingHref(null))}
         >
            <AlertDialogContent>
               <AlertDialogHeader>
                  <AlertDialogTitle>{t('unsavedTitle')}</AlertDialogTitle>
                  <AlertDialogDescription>{t('unsavedBody')}</AlertDialogDescription>
               </AlertDialogHeader>
               {/* Staying is the safe choice, so it carries the emphasis and sits last. */}
               <AlertDialogFooter>
                  <AlertDialogAction
                     variant="outline"
                     onClick={() => {
                        const href = pendingHref;
                        setPendingHref(null);
                        clearUnsaved();
                        if (href) router.replace(href);
                     }}
                  >
                     {t('unsavedLeave')}
                  </AlertDialogAction>
                  <AlertDialogCancel variant="default">{t('unsavedStay')}</AlertDialogCancel>
               </AlertDialogFooter>
            </AlertDialogContent>
         </AlertDialog>
      </>
   );
}
