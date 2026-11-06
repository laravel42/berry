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
import { archiveMilestone, describeMilestoneFailure, type Milestone } from '@/lib/milestones';
import { canEditSettings } from '@/lib/workspace-role';
import { useMilestonesStore } from '@/store/milestones-store';
import { useSessionStore } from '@/store/session-store';
import { ExternalLink, Link as LinkIcon, MoreHorizontal, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useParams, usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';

/** Open, copy, and archive, from the three-dot button on the goal. */
export function GoalActionsMenu({ goal }: { goal: Milestone | undefined }) {
   const t = useTranslations('milestones.menu');
   const params = useParams<{ orgId?: string }>();
   const orgId = params?.orgId || WORKSPACE_SLUG;
   const pathname = usePathname();
   const router = useRouter();
   const closeDrawer = useDetailDrawerClose();
   const role = useSessionStore((state) => state.workspace?.role);
   const canRemove = canEditSettings(role);
   const removeMilestone = useMilestonesStore((state) => state.removeMilestone);
   const [confirmOpen, setConfirmOpen] = useState(false);
   const [busy, setBusy] = useState(false);

   const href = goal?.projectId
      ? `/${orgId}/project/${goal.projectId}/overview?milestone=${goal.id}`
      : goal
        ? `/${orgId}/projects`
        : '';

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
      void archiveMilestone(goal.id)
         .then(() => {
            removeMilestone(goal.id);
            toast.success(t('removed', { title: goal.title }));
            setConfirmOpen(false);
            if (closeDrawer) closeDrawer();
            else if (pathname?.includes('/milestone/') || pathname?.includes('/project/')) {
               router.push(
                  goal.projectId
                     ? `/${orgId}/project/${goal.projectId}/overview`
                     : `/${orgId}/projects`
               );
            }
         })
         .catch((error: unknown) => toast.error(describeMilestoneFailure(error)))
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
