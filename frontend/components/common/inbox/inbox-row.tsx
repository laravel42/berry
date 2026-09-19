'use client';

import {
   ContextMenu,
   ContextMenuContent,
   ContextMenuItem,
   ContextMenuSeparator,
   ContextMenuTrigger,
} from '@/components/ui/context-menu';
import type { InboxItem } from '@/data/inbox';
import { getNotificationIcon } from '@/lib/notification-utils';
import { cn } from '@/lib/utils';
import { Archive, ArchiveRestore, ExternalLink, Mail, MailOpen } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { relativeTime } from './inbox-format';

export interface InboxRowActions {
   onSelect: () => void;
   onToggleRead: () => void;
   onArchive: () => void;
   onUnarchive: () => void;
}

interface InboxRowProps extends InboxRowActions {
   item: InboxItem;
   selected: boolean;
   /** The archive shows "move back" where the inbox shows "archive". */
   archived: boolean;
   /** Where the row opens in its own tab, when it points at a record. */
   href: string | null;
}

/**
 * One notification in the list.
 *
 * Click opens it. Right-click (and the keyboard, from the page) marks read
 * or archives; the row itself is only the notification.
 */
export function InboxRow({
   item,
   selected,
   archived,
   href,
   onSelect,
   onToggleRead,
   onArchive,
   onUnarchive,
}: InboxRowProps) {
   const t = useTranslations('inbox');
   const readLabel = item.read ? t('actions.markUnread') : t('actions.markRead');
   const archiveLabel = archived ? t('actions.unarchive') : t('actions.archive');
   const onArchiveAction = archived ? onUnarchive : onArchive;

   return (
      <ContextMenu>
         <ContextMenuTrigger asChild>
            <button
               type="button"
               data-inbox-row={item.id}
               onClick={onSelect}
               aria-current={selected ? 'true' : undefined}
               className={cn(
                  'flex w-full cursor-pointer items-start gap-3 border-b border-border/50 px-4 py-3 text-left',
                  selected ? 'bg-accent' : 'hover:bg-sidebar/50'
               )}
            >
               <span className="mt-0.5 shrink-0">{getNotificationIcon(item.type, 'size-4')}</span>
               <span className="min-w-0 flex-1">
                  <span className={cn('break-words', item.read ? 'font-normal' : 'font-medium')}>
                     {item.identifier ? (
                        <span className="text-muted-foreground">{item.identifier} </span>
                     ) : null}
                     {item.title}
                  </span>
                  <span className="mt-1 block text-right text-muted-foreground">
                     {relativeTime(item.timestamp)}
                  </span>
               </span>
               {item.read ? null : (
                  <span
                     aria-label={t('list.unread')}
                     className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary"
                  />
               )}
            </button>
         </ContextMenuTrigger>
         <ContextMenuContent className="w-52">
            <ContextMenuItem onSelect={onToggleRead}>
               {item.read ? <Mail /> : <MailOpen />}
               {readLabel}
            </ContextMenuItem>
            <ContextMenuItem onSelect={onArchiveAction}>
               {archived ? <ArchiveRestore /> : <Archive />}
               {archiveLabel}
            </ContextMenuItem>
            {href ? (
               <>
                  <ContextMenuSeparator />
                  <ContextMenuItem asChild>
                     <a href={href} target="_blank" rel="noreferrer">
                        <ExternalLink />
                        {t('actions.openInNewTab')}
                     </a>
                  </ContextMenuItem>
               </>
            ) : null}
         </ContextMenuContent>
      </ContextMenu>
   );
}
