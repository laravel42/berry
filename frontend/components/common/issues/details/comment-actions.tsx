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
   DropdownMenu,
   DropdownMenuContent,
   DropdownMenuItem,
   DropdownMenuSeparator,
   DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { BerryApiError } from '@/lib/api';
import { deleteComment, type ApiComment } from '@/lib/comments';
import { createChild } from '@/lib/issue-tracking';
import { useSessionStore } from '@/store/session-store';
import { MoreHorizontal } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

/**
 * What a reader can do with one comment.
 *
 * Delete follows the server's rule — the author, or a workspace owner/admin —
 * and the menu now says so on both sides: an admin sees it on someone else's
 * comment (including an agent's) because they really do have it, rather than
 * the menu hiding it and the server quietly allowing it.
 *
 * Deleting warns when replies go with it. A thread root takes its thread with
 * it, and "delete" that silently removes four other people's messages is the
 * kind of surprise that only happens once per team.
 */
export function CommentActions({
   comment,
   issueRef,
   replyCount,
   onDeleted,
   onReply,
}: {
   comment: ApiComment;
   issueRef: string;
   /** Replies that would go with it; only a root has any. */
   replyCount: number;
   onDeleted: (commentId: string) => void;
   onReply?: () => void;
}) {
   const t = useTranslations('issueDetail.activity');
   const user = useSessionStore((state) => state.user);
   const workspaceRole = useSessionStore((state) => state.workspace?.role);
   const [confirming, setConfirming] = useState(false);
   const [busy, setBusy] = useState(false);

   const mine = comment.author.type === 'user' && comment.author.id === user?.id;
   // Owner/admin may moderate anyone's comment, including an agent's. The
   // session user's display role is always Member, so this has to read the
   // workspace membership — the same check the server uses.
   const moderator = workspaceRole === 'owner' || workspaceRole === 'admin';
   const mayDelete = mine || moderator;

   const fail = (cause: unknown) =>
      toast.error(
         cause instanceof BerryApiError && cause.status === 403
            ? 'You cannot change this comment.'
            : t('deleteFailed')
      );

   const remove = () => {
      setBusy(true);
      void deleteComment(comment.id)
         .then(() => {
            onDeleted(comment.id);
            setConfirming(false);
         })
         .catch(fail)
         .finally(() => setBusy(false));
   };

   const copy = () => {
      void navigator.clipboard
         .writeText(comment.body)
         .then(() => toast.success(t('copied')))
         .catch(() => undefined);
   };

   const split = () =>
      void createChild(issueRef, { fromCommentId: comment.id })
         .then((child) => toast.success(t('subIssueCreated', { identifier: child.identifier })))
         .catch(() => toast.error(t('saveFailed')));

   return (
      <>
         <DropdownMenu>
            <DropdownMenuTrigger asChild>
               <Button
                  variant="ghost"
                  size="icon"
                  className="ml-auto size-6"
                  aria-label={t('title')}
               >
                  <MoreHorizontal className="size-4" />
               </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
               {onReply ? (
                  <DropdownMenuItem onClick={onReply}>{t('reply')}</DropdownMenuItem>
               ) : null}
               <DropdownMenuItem onClick={copy}>{t('copy')}</DropdownMenuItem>
               <DropdownMenuItem onClick={split}>{t('createSubIssue')}</DropdownMenuItem>
               {mayDelete ? (
                  <>
                     <DropdownMenuSeparator />
                     <DropdownMenuItem
                        variant="destructive"
                        className="text-destructive focus:text-destructive data-[variant=destructive]:text-destructive data-[variant=destructive]:*:[svg]:!text-destructive"
                        onClick={() => setConfirming(true)}
                     >
                        {t('delete')}
                     </DropdownMenuItem>
                  </>
               ) : null}
            </DropdownMenuContent>
         </DropdownMenu>

         <AlertDialog open={confirming} onOpenChange={setConfirming}>
            <AlertDialogContent>
               <AlertDialogHeader>
                  <AlertDialogTitle>{t('deleteTitle')}</AlertDialogTitle>
                  <AlertDialogDescription>
                     {replyCount > 0
                        ? `${t('deleteBody')} ${t('deleteWithReplies', { count: replyCount })}`
                        : t('deleteBody')}
                  </AlertDialogDescription>
               </AlertDialogHeader>
               <AlertDialogFooter>
                  <AlertDialogCancel disabled={busy}>{t('cancel')}</AlertDialogCancel>
                  <AlertDialogAction
                     disabled={busy}
                     onClick={(event) => {
                        event.preventDefault();
                        remove();
                     }}
                  >
                     {t('confirmDelete')}
                  </AlertDialogAction>
               </AlertDialogFooter>
            </AlertDialogContent>
         </AlertDialog>
      </>
   );
}
