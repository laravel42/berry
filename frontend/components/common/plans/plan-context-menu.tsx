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
import {
   ContextMenu,
   ContextMenuContent,
   ContextMenuItem,
   ContextMenuSeparator,
   ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
   archivePlan,
   deletePlan,
   planSubscription,
   setPlanSubscription,
   type PlanSummary,
} from '@/lib/plans';
import { pinTarget, unpinTarget } from '@/lib/pins';
import { usePinsStore } from '@/store/pins-store';
import { useSessionStore } from '@/store/session-store';
import { Archive, Bell, BellOff, Pin, PinOff, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState, type ReactNode } from 'react';
import { toast } from 'sonner';

/**
 * Right-click menu on a plan in the list: follow it, pin it in the rail, or
 * take it off the open list.
 */
export function PlanContextMenu({
   plan,
   children,
   onChanged,
}: {
   plan: PlanSummary;
   children: ReactNode;
   onChanged: () => void;
}) {
   const t = useTranslations('goals.plans.menu');
   const workspaceId = useSessionStore((state) => state.workspace?.id ?? '');
   const pins = usePinsStore((state) => state.pins);
   const addPin = usePinsStore((state) => state.add);
   const removePin = usePinsStore((state) => state.remove);
   const pin = pins.find((entry) => entry.targetType === 'plan' && entry.targetId === plan.id);

   const [subscribed, setSubscribed] = useState(false);
   const [busy, setBusy] = useState(false);
   const [confirmingDelete, setConfirmingDelete] = useState(false);

   const fail = () => toast.error(t('failed'));

   const loadSubscription = (open: boolean) => {
      if (!open) return;
      void planSubscription(plan.id)
         .then(setSubscribed)
         .catch(() => undefined);
   };

   const toggleSubscription = () => {
      const next = !subscribed;
      setBusy(true);
      setSubscribed(next);
      void setPlanSubscription(plan.id, next)
         .then(setSubscribed)
         .catch(() => {
            setSubscribed(!next);
            fail();
         })
         .finally(() => setBusy(false));
   };

   const togglePin = () => {
      const write = pin
         ? unpinTarget(workspaceId, pin.id).then(() => removePin(pin.id))
         : pinTarget(workspaceId, 'plan', plan.id).then(addPin);
      void write.catch(fail);
   };

   const archive = () => {
      setBusy(true);
      void archivePlan(plan.id)
         .then(onChanged)
         .catch(fail)
         .finally(() => setBusy(false));
   };

   const remove = () => {
      setConfirmingDelete(false);
      setBusy(true);
      const pinned = pin;
      void deletePlan(plan.id)
         .then(() => {
            if (pinned) removePin(pinned.id);
            onChanged();
         })
         .catch(fail)
         .finally(() => setBusy(false));
   };

   return (
      <>
         <ContextMenu onOpenChange={loadSubscription}>
            <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
            <ContextMenuContent className="w-48">
               <ContextMenuItem disabled={busy} onClick={toggleSubscription}>
                  {subscribed ? <BellOff className="size-4" /> : <Bell className="size-4" />}
                  {subscribed ? t('unsubscribe') : t('subscribe')}
               </ContextMenuItem>
               <ContextMenuItem disabled={!workspaceId} onClick={togglePin}>
                  {pin ? <PinOff className="size-4" /> : <Pin className="size-4" />}
                  {pin ? t('unpin') : t('pin')}
               </ContextMenuItem>
               <ContextMenuSeparator />
               <ContextMenuItem disabled={busy || plan.archived} onClick={archive}>
                  <Archive className="size-4" />
                  {plan.archived ? t('archived') : t('archive')}
               </ContextMenuItem>
               <ContextMenuItem
                  variant="destructive"
                  disabled={busy}
                  onSelect={(event) => {
                     event.preventDefault();
                     setConfirmingDelete(true);
                  }}
               >
                  <Trash2 className="size-4" />
                  {t('delete')}
               </ContextMenuItem>
            </ContextMenuContent>
         </ContextMenu>
         <AlertDialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
            <AlertDialogContent>
               <AlertDialogHeader>
                  <AlertDialogTitle>{t('deleteTitle')}</AlertDialogTitle>
                  <AlertDialogDescription>{t('deleteBody')}</AlertDialogDescription>
               </AlertDialogHeader>
               <AlertDialogFooter>
                  <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
                  <AlertDialogAction onClick={remove}>{t('confirmDelete')}</AlertDialogAction>
               </AlertDialogFooter>
            </AlertDialogContent>
         </AlertDialog>
      </>
   );
}
