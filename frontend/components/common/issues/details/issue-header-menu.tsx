'use client';

import { DeleteIssueDialog, useIssueDeletion } from '@/components/common/issues/delete-issue';
import { Button } from '@/components/ui/button';
import {
   DropdownMenu,
   DropdownMenuContent,
   DropdownMenuItem,
   DropdownMenuSeparator,
   DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { status as STATUSES } from '@/data/status';
import type { Issue } from '@/data/issues';
import { loadSubscribers, setSubscription } from '@/lib/subscribers';
import { pinTarget, unpinTarget } from '@/lib/pins';
import { useIssuesStore } from '@/store/issues-store';
import { usePinsStore } from '@/store/pins-store';
import { useSessionStore } from '@/store/session-store';
import {
   Bell,
   BellOff,
   Check,
   MoreHorizontal,
   Pin,
   PinOff,
   RotateCcw,
   Trash2,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

/**
 * Subscribe, finish, pin and delete — the header actions that used to sit as
 * separate buttons and now share one overflow menu.
 */
export function IssueHeaderMenu({
   issue,
   onDeleted,
}: {
   issue: Issue;
   onDeleted?: () => void;
}) {
   const t = useTranslations('issueDetail.header');
   const tSub = useTranslations('issueDetail.subscription');
   const updateIssueStatus = useIssuesStore((state) => state.updateIssueStatus);
   const workspaceId = useSessionStore((state) => state.workspace?.id ?? '');
   const { pins, add, remove } = usePinsStore();
   const deletion = useIssueDeletion(onDeleted);

   const [subscribed, setSubscribed] = useState(false);
   const [busy, setBusy] = useState(false);

   const pin = pins.find((entry) => entry.targetType === 'issue' && entry.targetId === issue.id);
   const done = issue.status.id === 'done';

   const reloadSubscription = useCallback(() => {
      void loadSubscribers(issue.identifier)
         .then((state) => setSubscribed(state.subscribed))
         .catch(() => undefined);
   }, [issue.identifier]);
   useEffect(reloadSubscription, [reloadSubscription]);

   const toggleSubscription = () => {
      setBusy(true);
      void setSubscription(issue.identifier, !subscribed, false)
         .then(reloadSubscription)
         .catch(() => toast.error(tSub('changeFailed')))
         .finally(() => setBusy(false));
   };

   const markDone = () => {
      const target = STATUSES.find((entry) => entry.id === (done ? 'in-progress' : 'done'));
      if (target) updateIssueStatus(issue.id, target);
   };

   const togglePin = () => {
      const write = pin
         ? unpinTarget(workspaceId, pin.id).then(() => remove(pin.id))
         : pinTarget(workspaceId, 'issue', issue.id).then(add);
      void write.catch(() => toast.error(t('pinFailed')));
   };

   return (
      <>
         <DropdownMenu>
            <DropdownMenuTrigger asChild>
               <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-muted-foreground"
                  aria-label={t('actions')}
               >
                  <MoreHorizontal className="size-4" />
               </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
               <DropdownMenuItem disabled={busy} onClick={toggleSubscription}>
                  {subscribed ? (
                     <BellOff className="size-4" />
                  ) : (
                     <Bell className="size-4" />
                  )}
                  {subscribed ? tSub('unsubscribe') : tSub('subscribe')}
               </DropdownMenuItem>
               <DropdownMenuItem onClick={markDone}>
                  {done ? <RotateCcw className="size-4" /> : <Check className="size-4" />}
                  {done ? t('markNotDone') : t('markDone')}
               </DropdownMenuItem>
               <DropdownMenuItem onClick={togglePin}>
                  {pin ? <PinOff className="size-4" /> : <Pin className="size-4" />}
                  {pin ? t('unpin') : t('pin')}
               </DropdownMenuItem>
               <DropdownMenuSeparator />
               <DropdownMenuItem
                  variant="destructive"
                  className="text-destructive focus:text-destructive data-[variant=destructive]:text-destructive data-[variant=destructive]:*:[svg]:!text-destructive"
                  onSelect={(event) => {
                     event.preventDefault();
                     deletion.request(issue);
                  }}
               >
                  <Trash2 className="size-4" />
                  {t('delete')}
               </DropdownMenuItem>
            </DropdownMenuContent>
         </DropdownMenu>

         <DeleteIssueDialog deletion={deletion} />
      </>
   );
}
