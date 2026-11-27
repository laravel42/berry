'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { selectOpenReviewCount, useReviewsStore } from '@/store/reviews-store';
import { useSidebarPrefsStore } from '@/store/sidebar-prefs-store';
import { ShellBadge, badgeText } from './shell-badge';
import { ShellIcon, ShellNavIcon, shellNavRow } from './shell-icon';
import { ShellSectionFold } from './shell-section-fold';
import { useInboxUnread } from './use-inbox-unread';
import { isMyTasks, isReviews, MY_TASKS_HREF } from './shell-routes';

const INBOX_ICON =
   '<path d="M22 12h-6l-2 3h-4l-2-3H2M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />';
const TASKS_ICON = '<path d="M9 6h12M9 12h12M9 18h12M4 6h.01M4 12h.01M4 18h.01" />';
const REVIEWS_ICON =
   '<path d="M13 6h3a2 2 0 0 1 2 2v7M6 9v12M21 18a3 3 0 1 1-6 0a3 3 0 1 1 6 0M9 6a3 3 0 1 1-6 0a3 3 0 1 1 6 0" />';

/**
 * The rail's "personal" section: the places that are about you rather than
 * about the workspace.
 *
 * Inbox is the notifications page. Unread counts on the rail row are how you
 * know something arrived without a floating drawer. Inbox follows the
 * workspace event stream, so a task assigned to you while you are reading
 * something else shows up without a refresh. Reviews sit here: they are
 * waiting on you, not on the workspace. Agent chat is not on the rail.
 */
export function ShellPersonal({ orgId }: { orgId: string }) {
   const t = useTranslations('navigation.sidebar');
   const personalOpen = useSidebarPrefsStore((state) => state.personalOpen);
   const setPersonalOpen = useSidebarPrefsStore((state) => state.setPersonalOpen);
   // The stored fold is unknown during the server render, so Personal stays
   // open until mount and then follows the person's choice.
   const [mounted, setMounted] = useState(false);
   useEffect(() => setMounted(true), []);
   const pathname = usePathname() ?? '';
   const openReviews = useReviewsStore(selectOpenReviewCount) ?? 0;

   const inboxUnread = useInboxUnread();

   // Personal's entry is the assigned tab of the tasks page; the page with
   // every task is Work's Tasks, and only one of the two lights at a time.
   const search = useSearchParams()?.toString() ?? '';
   const onInbox = pathname.startsWith(`/${orgId}/inbox`);
   const onIssues = pathname.startsWith(`/${orgId}/tasks`) && isMyTasks(pathname, search);
   const onReviews = isReviews(pathname, orgId);

   return (
      <ShellSectionFold
         heading={t('personal')}
         open={mounted ? (personalOpen ?? true) : true}
         onOpenChange={setPersonalOpen}
      >
         <ul className="flex flex-col gap-0 px-3 md:gap-1">
            <li>
               <Link
                  prefetch={false}
                  data-shell-nav
                  href={`/${orgId}/inbox`}
                  aria-current={onInbox ? 'page' : undefined}
                  className={shellNavRow(onInbox)}
               >
                  <ShellNavIcon on={onInbox}>
                     <ShellIcon path={INBOX_ICON} size={13} />
                  </ShellNavIcon>
                  {t('inbox')}
                  <ShellBadge
                     count={inboxUnread}
                     label={t('inboxUnread', { count: badgeText(inboxUnread) })}
                     hot
                  />
               </Link>
            </li>
            <li>
               <Link
                  prefetch={false}
                  data-shell-nav
                  href={`/${orgId}${MY_TASKS_HREF}`}
                  aria-current={onIssues ? 'page' : undefined}
                  className={shellNavRow(onIssues)}
               >
                  <ShellNavIcon on={onIssues}>
                     <ShellIcon path={TASKS_ICON} size={13} />
                  </ShellNavIcon>
                  {t('myIssues')}
               </Link>
            </li>
            <li>
               <Link
                  prefetch={false}
                  data-shell-nav
                  href={`/${orgId}/reviews`}
                  aria-current={onReviews ? 'page' : undefined}
                  className={shellNavRow(onReviews)}
               >
                  <ShellNavIcon on={onReviews}>
                     <ShellIcon path={REVIEWS_ICON} size={13} />
                  </ShellNavIcon>
                  {t('reviews')}
                  <ShellBadge
                     count={openReviews}
                     label={t('reviewsWaiting', { count: openReviews })}
                     hot
                  />
               </Link>
            </li>
         </ul>
      </ShellSectionFold>
   );
}
