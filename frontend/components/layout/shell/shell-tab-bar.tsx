'use client';

import { forwardRef } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Menu } from 'lucide-react';

import { SparkIcon } from '@/components/ui/spark-icon';
import { cn } from '@/lib/utils';
import { useShellStore } from '@/store/shell-store';
import { useUiPrefsStore } from '@/store/ui-prefs-store';
import { badgeText } from './shell-badge';
import { ShellIcon } from './shell-icon';
import { shellRoute, type ShellRoute } from './shell-routes';
import { useInboxUnread } from './use-inbox-unread';

// Inbox is drawn here and in shell-personal.tsx; the other tabs read the
// route table, so the bar and the menu show the same glyphs.
const INBOX_ICON = '<path d="M4 13h4l1.5 3h5L16 13h4M4 13l2.5-7h11L20 13v5H4z" />';
const iconOf = (id: ShellRoute) => shellRoute(id)?.icon ?? '';

const tab = [
   'relative flex min-h-11 min-w-0 flex-1 cursor-pointer flex-col items-center justify-center gap-0.5 px-1 pt-1.5 pb-1',
   'transition-colors',
   'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ring)]',
   'disabled:cursor-not-allowed disabled:opacity-40',
].join(' ');
const tone = (on: boolean) =>
   on
      ? 'text-[var(--shell-accent)]'
      : 'text-[var(--shell-text-muted)] hover:text-[var(--shell-text)]';
// No gap and leading-none: the label sits directly under the icon. Its size
// comes from [data-tab-bar] in globals.css (components may not set text-*).
const inner = 'flex flex-col items-center leading-none';

/**
 * The phone's primary navigation: five tabs fixed to the bottom edge, below
 * `md`. It stands in for the floating menu button and the Agents pill, so
 * the three places people go most are one tap away and the rest of the rail
 * is behind More.
 *
 * Inbox, Tasks and Projects are links. Agents toggles the floating chat
 * window the way the launcher did; More opens the rail as an overlay and
 * takes focus back when it closes (the ref is the shell's).
 *
 * The selected tab is marked in Berry red on its icon and label without a
 * button container behind it.
 */
export const ShellTabBar = forwardRef<
   HTMLButtonElement,
   {
      orgId: string;
      active: ShellRoute | null;
      menuOpen: boolean;
      onOpenMenu: () => void;
   }
>(function ShellTabBar({ orgId, active, menuOpen, onOpenMenu }, moreRef) {
   const t = useTranslations('shell');
   const tNav = useTranslations('navigation.sidebar');
   const pathname = usePathname() ?? '';
   const inboxUnread = useInboxUnread();
   const chatWindow = useShellStore((state) => state.chatWindow);
   const toggleChat = useShellStore((state) => state.toggleChat);
   const chatUnread = useShellStore((state) => state.chatUnread);
   const floatingEnabled = useUiPrefsStore((state) => state.floatingChat);
   const setFloatingChat = useUiPrefsStore((state) => state.setFloatingChat);
   const onChatPage = pathname.includes('/chat');
   const chatOpen = floatingEnabled && (chatWindow === 'open' || chatWindow === 'expanded');
   const chatLabel = chatOpen
      ? t('chat.close')
      : chatUnread > 0
        ? t('chat.openUnread', { count: chatUnread })
        : t('chat.open');
   const onInbox = pathname.startsWith(`/${orgId}/inbox`);
   // One tab is active: More, then Agents, then the route; -1 is none.
   const selected = menuOpen
      ? 4
      : chatOpen
        ? 3
        : onInbox
          ? 0
          : active === 'issues'
            ? 1
            : active === 'projects'
              ? 2
              : -1;

   return (
      <nav
         data-shell-chrome
         data-tab-bar
         aria-label={t('tabs.label')}
         className="fixed inset-x-0 bottom-0 z-30 flex h-[calc(var(--shell-tabbar-h)+env(safe-area-inset-bottom))] items-stretch border-t border-[var(--shell-line)] bg-[var(--shell-rail)] pb-[env(safe-area-inset-bottom)] md:hidden"
      >
         <Link
            prefetch={false}
            href={`/${orgId}/inbox`}
            aria-current={onInbox ? 'page' : undefined}
            className={cn(tab, tone(selected === 0))}
         >
            <span className={inner}>
               <span className="flex">
                  <ShellIcon path={INBOX_ICON} size={20} />
               </span>
               {t('nav.inbox')}
            </span>
            {inboxUnread > 0 ? (
               <span
                  data-figure
                  data-tab-badge
                  className="absolute top-2 left-1/2 ml-2 text-[var(--shell-accent)]"
               >
                  <span aria-hidden="true">{badgeText(inboxUnread)}</span>
                  <span className="sr-only">
                     {tNav('inboxUnread', { count: badgeText(inboxUnread) })}
                  </span>
               </span>
            ) : null}
         </Link>
         <Link
            prefetch={false}
            href={`/${orgId}/tasks`}
            aria-current={active === 'issues' ? 'page' : undefined}
            className={cn(tab, tone(selected === 1))}
         >
            <span className={inner}>
               <span className="flex">
                  <ShellIcon path={iconOf('issues')} size={20} />
               </span>
               {t('nav.tasks')}
            </span>
         </Link>
         <Link
            prefetch={false}
            href={`/${orgId}/projects`}
            aria-current={active === 'projects' ? 'page' : undefined}
            className={cn(tab, tone(selected === 2))}
         >
            <span className={inner}>
               <span className="flex">
                  <ShellIcon path={iconOf('projects')} size={20} />
               </span>
               {t('nav.projects')}
            </span>
         </Link>
         <button
            type="button"
            onClick={() => {
               if (!floatingEnabled) setFloatingChat(true);
               toggleChat();
            }}
            disabled={onChatPage}
            aria-label={chatLabel}
            aria-expanded={chatOpen}
            className={cn(tab, tone(selected === 3))}
         >
            <span className={inner}>
               <span className="relative flex">
                  <SparkIcon className="size-5" />
                  {chatUnread > 0 && !chatOpen ? (
                     <span
                        aria-hidden="true"
                        className="absolute -top-0.5 -right-1 size-2 rounded-full bg-[var(--shell-accent)]"
                     />
                  ) : null}
               </span>
               {t('nav.agents')}
            </span>
         </button>
         <button
            ref={moreRef}
            type="button"
            onClick={onOpenMenu}
            aria-expanded={menuOpen}
            aria-controls="shell-rail"
            className={cn(tab, tone(selected === 4))}
         >
            <span className={inner}>
               <span className="flex">
                  <Menu size={20} strokeWidth={1.6} aria-hidden="true" />
               </span>
               {t('tabs.more')}
            </span>
         </button>
      </nav>
   );
});
