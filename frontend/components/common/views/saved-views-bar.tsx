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
   Dialog,
   DialogContent,
   DialogDescription,
   DialogHeader,
   DialogTitle,
} from '@/components/ui/dialog';
import {
   DropdownMenu,
   DropdownMenuContent,
   DropdownMenuItem,
   DropdownMenuSeparator,
   DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import type { View } from '@/data/views';
import { deleteSavedView, loadViewPreferences, saveViewPreferences } from '@/lib/views';
import { pinTarget, unpinTarget } from '@/lib/pins';
import { cn } from '@/lib/utils';
import { usePinsStore } from '@/store/pins-store';
import { useSessionStore } from '@/store/session-store';
import { useViewsStore } from '@/store/views-store';
import { ChevronDown, GripVertical, ListChecks, MoreHorizontal, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { SaveViewDialog } from './save-view-dialog';

/** Tabs shown inline; the rest live in the overflow menu. */
const INLINE_TABS = 6;
/** Below `sm` only one tab fits next to the actions, so the rest go to the menu. */
const PHONE_INLINE_TABS = 1;

interface ViewPreferences {
   order: string[];
   hidden: string[];
}

const preferenceListeners = new Set<(workspaceId: string, next: ViewPreferences) => void>();

function readPreferences(value: unknown): ViewPreferences {
   const record = value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
   const nested =
      record.views && typeof record.views === 'object'
         ? (record.views as Record<string, unknown>)
         : record;
   return {
      order: Array.isArray(nested.order) ? (nested.order as string[]) : [],
      hidden: Array.isArray(nested.hidden) ? (nested.hidden as string[]) : [],
   };
}

/** Shared order/visibility preferences for saved view tabs on the current workspace. */
function useSavedViewPreferences() {
   const t = useTranslations('issueLists');
   const { viewId } = useParams<{ orgId: string; viewId?: string }>();
   const workspaceId = useSessionStore((state) => state.workspace?.id ?? '');
   const views = useViewsStore((state) => state.views);
   const [preferences, setPreferences] = useState<ViewPreferences>({ order: [], hidden: [] });

   useEffect(() => {
      const sync = (targetWorkspace: string, next: ViewPreferences) => {
         if (targetWorkspace === workspaceId) setPreferences(next);
      };
      preferenceListeners.add(sync);
      return () => {
         preferenceListeners.delete(sync);
      };
   }, [workspaceId]);

   useEffect(() => {
      if (!workspaceId) return;
      let cancelled = false;
      void loadViewPreferences(workspaceId)
         .then((loaded) => {
            if (!cancelled) setPreferences(readPreferences(loaded.preferences));
         })
         .catch(() => undefined);
      return () => {
         cancelled = true;
      };
   }, [workspaceId]);

   const persist = (next: ViewPreferences) => {
      setPreferences(next);
      for (const listener of preferenceListeners) listener(workspaceId, next);
      void saveViewPreferences(workspaceId, viewId ?? null, { views: next }).catch(() =>
         toast.error(t('states.loadFailed'))
      );
   };

   const issueViews = useMemo(() => views.filter((view) => view.type === 'issue'), [views]);

   const ordered = useMemo(() => {
      const rank = (view: View) => {
         const index = preferences.order.indexOf(view.id);
         return index === -1 ? Number.MAX_SAFE_INTEGER : index;
      };
      return [...issueViews].sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
   }, [issueViews, preferences.order]);

   const reorder = (draggedId: string, overId: string) => {
      const ids = ordered.map((view) => view.id);
      const next = ids.filter((id) => id !== draggedId);
      next.splice(next.indexOf(overId), 0, draggedId);
      persist({ ...preferences, order: next });
   };

   const toggleHidden = (id: string) =>
      persist({
         ...preferences,
         hidden: preferences.hidden.includes(id)
            ? preferences.hidden.filter((entry) => entry !== id)
            : [...preferences.hidden, id],
      });

   return { preferences, ordered, reorder, toggleHidden };
}

function ManageViewsDialog({
   open,
   onOpenChange,
   ordered,
   hidden,
   onReorder,
   onToggleHidden,
}: {
   open: boolean;
   onOpenChange: (open: boolean) => void;
   ordered: View[];
   hidden: string[];
   onReorder: (draggedId: string, overId: string) => void;
   onToggleHidden: (id: string) => void;
}) {
   const t = useTranslations('issueLists');
   const [dragging, setDragging] = useState<string | null>(null);

   return (
      <Dialog open={open} onOpenChange={onOpenChange}>
         <DialogContent>
            <DialogHeader>
               <DialogTitle>{t('views.manageTitle')}</DialogTitle>
               <DialogDescription>{t('views.manageHint')}</DialogDescription>
            </DialogHeader>
            <div className="flex flex-col">
               {ordered.map((view) => (
                  <div
                     key={view.id}
                     draggable
                     onDragStart={() => setDragging(view.id)}
                     onDragOver={(event) => event.preventDefault()}
                     onDrop={() => {
                        if (dragging && dragging !== view.id) onReorder(dragging, view.id);
                        setDragging(null);
                     }}
                     className={cn(
                        'flex items-center gap-2 border-b border-border/50 py-2',
                        dragging === view.id && 'opacity-50'
                     )}
                  >
                     <GripVertical className="size-3.5 cursor-grab text-muted-foreground" />
                     <span aria-hidden>{view.icon}</span>
                     <span className="flex-1 truncate">{view.name}</span>
                     <Switch
                        checked={!hidden.includes(view.id)}
                        onCheckedChange={() => onToggleHidden(view.id)}
                        aria-label={view.name}
                     />
                  </div>
               ))}
               {ordered.length === 0 ? (
                  <p className="py-6 text-center text-muted-foreground">{t('states.empty')}</p>
               ) : null}
            </div>
         </DialogContent>
      </Dialog>
   );
}

/**
 * Standalone trigger for the "Order and visibility" dialog so list toolbars
 * (such as the Views page) can place it inline beside Display options.
 */
export function ManageViewsButton({ iconOnly = false }: { iconOnly?: boolean }) {
   const t = useTranslations('issueLists');
   const { preferences, ordered, reorder, toggleHidden } = useSavedViewPreferences();
   const [managing, setManaging] = useState(false);

   return (
      <>
         <Button
            size={iconOnly ? 'icon-sm' : 'xs'}
            variant="ghost"
            aria-label={t('views.manage')}
            title={t('views.manage')}
            onClick={() => setManaging(true)}
         >
            <ListChecks className={cn(iconOnly ? 'size-4' : 'size-3.5 sm:mr-1')} aria-hidden />
            {iconOnly ? null : <span className="max-sm:sr-only">{t('views.manage')}</span>}
         </Button>

         <ManageViewsDialog
            open={managing}
            onOpenChange={setManaging}
            ordered={ordered}
            hidden={preferences.hidden}
            onReorder={reorder}
            onToggleHidden={toggleHidden}
         />
      </>
   );
}

/**
 * The saved views, as tabs above a list.
 *
 * Order and visibility are one person's, not the workspace's — the same shared
 * view sits in a different place for each reader — so both live in that
 * person's view preferences on the server rather than on the view itself.
 */
export function SavedViewsBar({
   showCreate = true,
   showManage = true,
}: {
   /** False where the page already offers New view as its primary action. */
   showCreate?: boolean;
   /** False where the toolbar below already places the Order and visibility trigger inline. */
   showManage?: boolean;
} = {}) {
   const t = useTranslations('issueLists');
   const { orgId, viewId } = useParams<{ orgId: string; viewId?: string }>();
   const workspaceId = useSessionStore((state) => state.workspace?.id ?? '');
   const views = useViewsStore((state) => state.views);
   const hydrateViews = useViewsStore((state) => state.hydrateViews);
   const { pins, add: addPin, remove: removePin } = usePinsStore();
   const { preferences, ordered, reorder, toggleHidden } = useSavedViewPreferences();
   const [editing, setEditing] = useState<View | undefined>();
   const [creating, setCreating] = useState(false);
   const [managing, setManaging] = useState(false);
   const [deleting, setDeleting] = useState<View | undefined>();
   const [dragging, setDragging] = useState<string | null>(null);
   const [phone, setPhone] = useState(false);

   useEffect(() => {
      const query = window.matchMedia('(max-width: 639px)');
      const sync = () => setPhone(query.matches);
      sync();
      query.addEventListener('change', sync);
      return () => query.removeEventListener('change', sync);
   }, []);

   const visible = ordered.filter((view) => !preferences.hidden.includes(view.id));
   const inlineTabs = phone ? PHONE_INLINE_TABS : INLINE_TABS;
   const activeIndex = phone && viewId ? visible.findIndex((view) => view.id === viewId) : -1;
   // On a phone the one inline tab is the active view, not always the first.
   const shown =
      activeIndex > 0
         ? [visible[activeIndex]!, ...visible.filter((_, index) => index !== activeIndex)]
         : visible;
   const inline = shown.slice(0, inlineTabs);
   const overflow = shown.slice(inlineTabs);

   if (inline.length === 0 && overflow.length === 0 && !showCreate && !showManage) {
      return null;
   }

   const togglePin = (view: View) => {
      const pin = pins.find((entry) => entry.targetType === 'view' && entry.targetId === view.id);
      const write = pin
         ? unpinTarget(workspaceId, pin.id).then(() => removePin(pin.id))
         : pinTarget(workspaceId, 'view', view.id).then(addPin);
      void write.catch(() => toast.error('The pin could not be changed.'));
   };

   const remove = (view: View) => {
      setDeleting(undefined);
      void deleteSavedView(view.id)
         .then(() => hydrateViews(views.filter((entry) => entry.id !== view.id)))
         .catch(() => toast.error('You cannot delete this view.'));
   };

   const tabMenu = (view: View) => {
      const pinned = pins.some(
         (entry) => entry.targetType === 'view' && entry.targetId === view.id
      );
      return (
         <DropdownMenuContent align="start" className="w-52">
            <DropdownMenuItem onClick={() => setEditing(view)}>{t('views.edit')}</DropdownMenuItem>
            <DropdownMenuItem onClick={() => togglePin(view)}>
               {pinned ? t('views.unpin') : t('views.pin')}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => toggleHidden(view.id)}>
               {preferences.hidden.includes(view.id) ? t('views.show') : t('views.hide')}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
               variant="destructive"
               onSelect={(event) => {
                  event.preventDefault();
                  setDeleting(view);
               }}
            >
               {t('views.delete')}
            </DropdownMenuItem>
         </DropdownMenuContent>
      );
   };

   return (
      <>
         <div className="flex w-full items-center gap-1 border-b px-6 py-1.5">
            <div className="no-scrollbar flex min-w-0 flex-1 items-center gap-1 overflow-x-auto after:w-6 after:shrink-0 max-sm:after:hidden sm:[mask-image:linear-gradient(to_right,black_calc(100%-24px),transparent)]">
               {inline.map((view) => (
                  <div
                     key={view.id}
                     draggable
                     onDragStart={() => setDragging(view.id)}
                     onDragOver={(event) => event.preventDefault()}
                     onDrop={() => {
                        if (dragging && dragging !== view.id) reorder(dragging, view.id);
                        setDragging(null);
                     }}
                     className={cn(
                        'group flex shrink-0 items-center rounded-md border transition-colors',
                        viewId === view.id
                           ? 'border-border/70 bg-accent'
                           : 'border-transparent hover:bg-accent/50',
                        dragging === view.id && 'opacity-50'
                     )}
                  >
                     <Link
                        href={`/${orgId}/view/${view.id}`}
                        className="flex items-center gap-1.5 px-2.5 py-1"
                     >
                        <span aria-hidden>{view.icon}</span>
                        <span className="max-w-40 truncate">{view.name}</span>
                     </Link>
                     <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                           <Button
                              size="icon"
                              variant="ghost"
                              className="size-6 transition-opacity [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100"
                              aria-label={`${view.name} menu`}
                           >
                              <MoreHorizontal className="size-3.5" />
                           </Button>
                        </DropdownMenuTrigger>
                        {tabMenu(view)}
                     </DropdownMenu>
                  </div>
               ))}

               {overflow.length > 0 ? (
                  <Popover>
                     <PopoverTrigger asChild>
                        <Button
                           size="xs"
                           variant="ghost"
                           className="shrink-0"
                           aria-label={t('views.more')}
                        >
                           <span className="max-sm:sr-only">{t('views.more')}</span>
                           <ChevronDown className="size-3.5 sm:ml-1" />
                        </Button>
                     </PopoverTrigger>
                     <PopoverContent align="start" className="flex w-56 flex-col p-1">
                        {overflow.map((view) => (
                           <Link
                              key={view.id}
                              href={`/${orgId}/view/${view.id}`}
                              className="flex items-center gap-1.5 rounded-md px-2 py-1.5 hover:bg-accent"
                           >
                              <span aria-hidden>{view.icon}</span>
                              <span className="truncate">{view.name}</span>
                           </Link>
                        ))}
                     </PopoverContent>
                  </Popover>
               ) : null}
            </div>

            {showManage || showCreate ? (
               <div className="ml-auto flex shrink-0 items-center gap-1">
                  {showManage ? (
                     <Button
                        size="xs"
                        variant="ghost"
                        aria-label={t('views.manage')}
                        title={t('views.manage')}
                        onClick={() => setManaging(true)}
                     >
                        <ListChecks className="size-3.5 sm:mr-1" aria-hidden />
                        <span className="max-sm:sr-only">{t('views.manage')}</span>
                     </Button>
                  ) : null}
                  {showCreate ? (
                     <Button
                        size="xs"
                        variant="ghost"
                        aria-label={t('views.newView')}
                        title={t('views.newView')}
                        onClick={() => setCreating(true)}
                     >
                        <Plus className="size-3.5 sm:mr-1" aria-hidden />
                        <span className="max-sm:sr-only">{t('views.newView')}</span>
                     </Button>
                  ) : null}
               </div>
            ) : null}
         </div>

         <SaveViewDialog open={creating} onOpenChange={setCreating} />
         <SaveViewDialog
            open={editing !== undefined}
            onOpenChange={(open) => {
               if (!open) setEditing(undefined);
            }}
            view={editing}
         />

         <ManageViewsDialog
            open={managing}
            onOpenChange={setManaging}
            ordered={ordered}
            hidden={preferences.hidden}
            onReorder={reorder}
            onToggleHidden={toggleHidden}
         />

         <AlertDialog
            open={deleting !== undefined}
            onOpenChange={(open) => {
               if (!open) setDeleting(undefined);
            }}
         >
            <AlertDialogContent>
               <AlertDialogHeader>
                  <AlertDialogTitle>
                     {t('views.deleteTitle', { name: deleting?.name ?? '' })}
                  </AlertDialogTitle>
                  <AlertDialogDescription>{t('views.deleteBody')}</AlertDialogDescription>
               </AlertDialogHeader>
               <AlertDialogFooter>
                  <AlertDialogCancel>{t('selection.cancel')}</AlertDialogCancel>
                  <AlertDialogAction
                     className={buttonVariants({ variant: 'danger' })}
                     onClick={(event) => {
                        event.preventDefault();
                        if (deleting) remove(deleting);
                     }}
                  >
                     {t('views.delete')}
                  </AlertDialogAction>
               </AlertDialogFooter>
            </AlertDialogContent>
         </AlertDialog>
      </>
   );
}
