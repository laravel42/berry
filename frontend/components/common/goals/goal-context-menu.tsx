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
import { Button, buttonVariants } from '@/components/ui/button';
import {
   DropdownMenu,
   DropdownMenuContent,
   DropdownMenuItem,
   DropdownMenuSeparator,
   DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useDetailDrawerClose } from '@/components/layout/detail-drawer-context';
import { WORKSPACE_SLUG } from '@/lib/config';
import { archiveGoal, describeGoalFailure, type Goal } from '@/lib/goals';
import { canEditSettings } from '@/lib/workspace-role';
import { useGoalsStore } from '@/store/goals-store';
import { useSessionStore } from '@/store/session-store';
import { ExternalLink, Link as LinkIcon, MoreHorizontal, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

/** Open, copy, and archive, from the three-dot button on the goal. */
export function GoalActionsMenu({ goal }: { goal: Goal | undefined }) {
   const t = useTranslations('goals.menu');
   const params = useParams<{ orgId?: string }>();
   const orgId = params?.orgId || WORKSPACE_SLUG;
   const pathname = usePathname();
   const router = useRouter();
   const closeDrawer = useDetailDrawerClose();
   const role = useSessionStore((state) => state.workspace?.role);
   const canRemove = canEditSettings(role);
   const removeGoal = useGoalsStore((state) => state.removeGoal);
   const [confirmOpen, setConfirmOpen] = useState(false);
   const [busy, setBusy] = useState(false);

   const href = goal ? `/${orgId}/goal/${goal.id}` : '';

   const copyLink = () => {
      const url = `${window.location.origin}${href}`;
      void navigator.clipboard.writeText(url).then(
         () => toast.success(t('copied')),
         () => toast.error(t('copyFailed'))
      );
   };

   const confirmRemove = () => {
      if (!goal) return;
      setBusy(true);
      void archiveGoal(goal.id)
         .then(() => {
            removeGoal(goal.id);
            toast.success(t('removed', { title: goal.title }));
            setConfirmOpen(false);
            if (closeDrawer) closeDrawer();
            else if (pathname?.includes('/goal/')) router.push(`/${orgId}/goals`);
         })
         .catch((error: unknown) => toast.error(describeGoalFailure(error)))
         .finally(() => setBusy(false));
   };

   return (
      <>
         <DropdownMenu>
            <DropdownMenuTrigger asChild>
               <Button
                  size="icon"
                  variant="ghost"
                  className="size-7 shrink-0"
                  aria-label={t('actions')}
                  disabled={!goal || busy}
               >
                  <MoreHorizontal className="size-4" />
               </Button>
            </DropdownMenuTrigger>
            {goal ? (
               <DropdownMenuContent align="end" className="min-w-48">
                  <DropdownMenuItem
                     onSelect={() => window.open(href, '_blank', 'noopener,noreferrer')}
                  >
                     <ExternalLink className="size-4" /> {t('openInNewTab')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={copyLink}>
                     <LinkIcon className="size-4" /> {t('copyLink')}
                  </DropdownMenuItem>
                  {canRemove ? (
                     <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                           variant="destructive"
                           className="text-destructive focus:text-destructive data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:text-destructive data-[variant=destructive]:*:[svg]:!text-destructive"
                           onSelect={() => setConfirmOpen(true)}
                        >
                           <Trash2 className="size-4" /> {t('remove')}
                        </DropdownMenuItem>
                     </>
                  ) : null}
               </DropdownMenuContent>
            ) : null}
         </DropdownMenu>
         <AlertDialog
            open={confirmOpen}
            onOpenChange={(open) => {
               if (busy) return;
               setConfirmOpen(open);
            }}
         >
            <AlertDialogContent>
               <AlertDialogHeader>
                  <AlertDialogTitle>
                     {t('removeTitle', { title: goal?.title ?? '' })}
                  </AlertDialogTitle>
                  <AlertDialogDescription>{t('removeBody')}</AlertDialogDescription>
               </AlertDialogHeader>
               <AlertDialogFooter>
                  <AlertDialogCancel disabled={busy}>{t('keep')}</AlertDialogCancel>
                  <AlertDialogAction
                     className={buttonVariants({ variant: 'destructive' })}
                     disabled={busy}
                     onClick={confirmRemove}
                  >
                     {t('confirmRemove')}
                  </AlertDialogAction>
               </AlertDialogFooter>
            </AlertDialogContent>
         </AlertDialog>
      </>
   );
}
