'use client';

import { useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';

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
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/lib/utils';

export interface ConfirmActionProps {
   open: boolean;
   onOpenChange: (open: boolean) => void;
   /** A question naming the thing: "Revoke this key?", "Remove Petuno?". */
   title: ReactNode;
   /**
    * The consequence, in the body: what stops, what is lost, whether it can
    * be undone. Never omitted; a confirm dialog with no consequence is a
    * speed bump rather than a decision.
    */
   description: ReactNode;
   /** The verb, not "OK": "Revoke", "Remove", "Delete forever". */
   confirmLabel: ReactNode;
   /** Defaults to the common "Cancel". */
   cancelLabel?: ReactNode;
   /** Paints the confirm button as destructive. On for anything that deletes. */
   destructive?: boolean;
   /**
    * Extra body between the description and the buttons: a typed-name field,
    * the list of things affected, an acknowledgement box.
    */
   children?: ReactNode;
   /** Holds the confirm button off until a precondition is met (a typed name). */
   confirmDisabled?: boolean;
   /**
    * Runs on confirm. While its promise is pending the dialog cannot be
    * dismissed and both buttons are held; it closes when the promise
    * resolves and stays open when it rejects, so the caller can toast the
    * failure and the reader can try again or back out.
    */
   onConfirm: () => void | Promise<void>;
   /** Shown on the confirm button while `onConfirm` is pending: "Deleting…". */
   pendingLabel?: ReactNode;
}

/**
 * The one shape every irreversible action confirms through: an alert dialog
 * (focus trapped, Escape to back out, nothing behind it clickable) with the
 * consequence in the body and the action verb on the button.
 *
 * A wrapper rather than a convention so the pending state is right once:
 * `window.confirm` has no pending state at all, and a plain `Dialog` closes
 * on Escape mid-request, leaving a half-done delete under a page that has
 * already moved on.
 */
export function ConfirmAction({
   open,
   onOpenChange,
   title,
   description,
   confirmLabel,
   cancelLabel,
   destructive = false,
   children,
   confirmDisabled = false,
   onConfirm,
   pendingLabel,
}: ConfirmActionProps) {
   const t = useTranslations('common.confirm');
   const [pending, setPending] = useState(false);

   const run = async () => {
      setPending(true);
      try {
         await onConfirm();
         onOpenChange(false);
      } catch {
         // The caller reported it; the dialog stays so the reader can decide.
      } finally {
         setPending(false);
      }
   };

   return (
      <AlertDialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
         {/* An alert dialog never dismisses on an outside click; Escape is
             the one way out, and it is held while the request is in flight. */}
         <AlertDialogContent onEscapeKeyDown={(event) => pending && event.preventDefault()}>
            <AlertDialogHeader>
               <AlertDialogTitle>{title}</AlertDialogTitle>
               <AlertDialogDescription>{description}</AlertDialogDescription>
            </AlertDialogHeader>
            {children}
            <AlertDialogFooter>
               <AlertDialogCancel disabled={pending}>
                  {cancelLabel ?? t('cancel')}
               </AlertDialogCancel>
               <AlertDialogAction
                  disabled={pending || confirmDisabled}
                  className={cn(destructive && buttonVariants({ variant: 'destructive' }))}
                  onClick={(event) => {
                     // Radix closes on click by default; the promise decides here.
                     event.preventDefault();
                     void run();
                  }}
               >
                  {pending && pendingLabel ? pendingLabel : confirmLabel}
               </AlertDialogAction>
            </AlertDialogFooter>
         </AlertDialogContent>
      </AlertDialog>
   );
}
