'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { useNotificationsStore } from '@/store/notifications-store';
import { useShellStore } from '@/store/shell-store';
import { ShellBadge, badgeText } from './shell-badge';
import { ShellIcon, shellNavRow } from './shell-icon';
import { isMyTasks, MY_TASKS_HREF } from './shell-routes';

const INBOX_ICON = '<path d="M4 13h4l1.5 3h5L16 13h4M4 13l2.5-7h11L20 13v5H4z" />';
const TASKS_ICON =
   '<path d="M5 7l2 2 4-4" /><path d="M5 16l2 2 4-4" /><path d="M13 7h6M13 17h6" />';
const CHAT_ICON = '<path d="M4 5h16v11H9l-5 4z" />';

/**
 * The rail's "personal" section: the three places that are about you rather
 * than about the workspace.
 *
 * Inbox is the notifications page. The bell in the tab strip still opens the
 * drawer beside whatever you were already doing. The unread counts on inbox
 * and chat follow the workspace event stream, so a task assigned to you while
 * you are reading something else shows up without a refresh. Chat's figure
 * is kept by `useChatUnreadSync` in the shell, which the strip's chat button
 * reads too.
 */
export function ShellPersonal({ orgId }: { orgId: string }) {
   const t = useTranslations('navigation.sidebar');
   const pathname = usePathname() ?? '';
   const notifications = useNotificationsStore((state) => state.notifications);
   const serverUnreadCount = useNotificationsStore((state) => state.serverUnreadCount);
   const chatUnread = useShellStore((state) => state.chatUnread);

   // The loaded list is what the drawer will show, so it is what the badge
   // counts; the server figure stands in until the first load arrives.
   const local = notifications.filter((item) => !item.read).length;
   const inboxUnread = notifications.length > 0 ? local : (serverUnreadCount ?? 0);

   // Personal's entry is the assigned tab of the tasks page; the page with
   // every task is Work's Tasks, and only one of the two lights at a time.
   const search = useSearchParams()?.toString() ?? '';
   const onInbox = pathname.startsWith(`/${orgId}/inbox`);
   const onIssues = pathname.startsWith(`/${orgId}/tasks`) && isMyTasks(pathname, search);
   const onChat = pathname.startsWith(`/${orgId}/chat`);

   return (
      <div>
         <div className="px-6 pt-3 pb-1 uppercase tracking-[0.14em] text-[var(--shell-text-dim)] lg:pt-[18px] lg:pb-[7px]">
            {t('personal')}
         </div>
         <ul className="flex flex-col gap-0 px-3 lg:gap-1">
            <li>
               <Link
                  data-shell-nav
                  href={`/${orgId}/inbox`}
                  aria-current={onInbox ? 'page' : undefined}
                  className={shellNavRow(onInbox)}
               >
                  <ShellIcon path={INBOX_ICON} />
                  {t('inbox')}
                  <ShellBadge
                     count={inboxUnread}
                     label={t('inboxUnread', { count: badgeText(inboxUnread) })}
                  />
               </Link>
            </li>
            <li>
               <Link
                  data-shell-nav
                  href={`/${orgId}${MY_TASKS_HREF}`}
                  aria-current={onIssues ? 'page' : undefined}
                  className={shellNavRow(onIssues)}
               >
                  <ShellIcon path={TASKS_ICON} />
                  {t('myIssues')}
               </Link>
            </li>
            <li>
               <Link
                  data-shell-nav
                  href={`/${orgId}/chat`}
                  aria-current={onChat ? 'page' : undefined}
                  className={shellNavRow(onChat)}
               >
                  <ShellIcon path={CHAT_ICON} />
                  {t('chat')}
                  <ShellBadge
                     count={chatUnread}
                     label={t('chatUnread', { count: badgeText(chatUnread) })}
                  />
               </Link>
            </li>
         </ul>
      </div>
   );
}
