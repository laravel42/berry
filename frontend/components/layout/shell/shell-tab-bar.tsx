'use client';

import { forwardRef, useState } from 'react';
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
   'transition-colors hover:text-[var(--shell-text)]',
   'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ring)]',
   'disabled:cursor-not-allowed disabled:opacity-40',
].join(' ');
const tone = (on: boolean) => (on ? 'text-[var(--shell-text)]' : 'text-[var(--shell-text-muted)]');
// The selected tab's content rises 3px with the pill. Berry on the pill is
// about 4.1:1 (light) and 3.3:1 (dark), under the 4.5:1 text needs, so only
// the icon takes Berry; the label keeps the shell text colour.
const rise = (on: boolean) =>
   cn(
      'transition-transform duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none',
      on && '-translate-y-[3px]'
   );
const glyph = (on: boolean) => cn('flex', on && 'text-[var(--shell-accent)]');
const inner = 'flex flex-col items-center gap-0.5';

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
 * The selected tab is raised: its content lifts 3px on a rounded, Berry-tinted
 * pill that glides from tab to tab and fades out when no tab is selected.
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
   const setChatWindow = useShellStore((state) => state.setChatWindow);
   const chatUnread = useShellStore((state) => state.chatUnread);
   const floatingEnabled = useUiPrefsStore((state) => state.floatingChat);
   const setFloatingChat = useUiPrefsStore((state) => state.setFloatingChat);
   const onChatPage = pathname.includes('/chat');
   const minimised = floatingEnabled && chatWindow === 'minimised';
   const chatOpen = floatingEnabled && (chatWindow === 'open' || chatWindow === 'expanded');
   const chatLabel = chatOpen
      ? t('chat.close')
      : chatUnread > 0
        ? t('chat.openUnread', { count: chatUnread })
        : t('chat.open');
   const onInbox = pathname.startsWith(`/${orgId}/inbox`);
   // One tab is raised: More, then Agents, then the route; -1 is none.
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
   // With nothing selected the pill fades where it was instead of sliding home.
   const [shown, setShown] = useState(Math.max(selected, 0));
   if (selected >= 0 && selected !== shown) setShown(selected);

   return (
      <nav
         data-shell-chrome
         aria-label={t('tabs.label')}
         className="fixed inset-x-0 bottom-0 z-30 flex h-[calc(var(--shell-tabbar-h)+env(safe-area-inset-bottom))] items-stretch border-t border-[var(--shell-line)] bg-[var(--shell-rail)] pb-[env(safe-area-inset-bottom)] md:hidden"
      >
         <div
            aria-hidden="true"
            data-tab-pill
            className={cn(
               'pointer-events-none absolute inset-x-0 top-0 h-[var(--shell-tabbar-h)] transition-opacity duration-150',
               selected < 0 && 'opacity-0'
            )}
         >
            <div
               className="h-full w-1/5 transition-transform duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] motion-reduce:transition-none"
               style={{ transform: `translateX(${shown * 100}%)` }}
            >
               <div
                  className="absolute inset-x-1.5 inset-y-1 -translate-y-[3px] rounded-xl"
                  style={{
                     background: 'color-mix(in oklab, var(--shell-accent) 12%, var(--shell-rail))',
                     boxShadow:
                        '0 6px 14px -6px color-mix(in oklab, var(--shell-accent) 55%, transparent)',
                  }}
               />
            </div>
         </div>
         <Link
            prefetch={false}
            href={`/${orgId}/inbox`}
            aria-current={onInbox ? 'page' : undefined}
            className={cn(tab, tone(selected === 0))}
         >
            <span className={cn(inner, rise(selected === 0))}>
               <span className={glyph(selected === 0)}>
                  <ShellIcon path={INBOX_ICON} size={20} />
               </span>
               {t('nav.inbox')}
            </span>
            {inboxUnread > 0 ? (
               <span
                  data-figure
                  className={cn(
                     'absolute top-1 left-1/2 ml-2 text-[var(--shell-accent)]',
                     rise(selected === 0)
                  )}
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
            <span className={cn(inner, rise(selected === 1))}>
               <span className={glyph(selected === 1)}>
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
            <span className={cn(inner, rise(selected === 2))}>
               <span className={glyph(selected === 2)}>
                  <ShellIcon path={iconOf('projects')} size={20} />
               </span>
               {t('nav.projects')}
            </span>
         </Link>
         <button
            type="button"
            onClick={() => {
               if (!floatingEnabled) setFloatingChat(true);
               if (chatWindow === 'minimised') setChatWindow('open');
               else toggleChat();
            }}
            disabled={onChatPage}
            aria-label={chatLabel}
            aria-expanded={chatOpen}
            className={cn(tab, tone(selected === 3))}
         >
            <span className={cn(inner, rise(selected === 3))}>
               <span className={cn('relative', glyph(selected === 3))}>
                  <SparkIcon className="size-5" />
                  {(chatUnread > 0 || minimised) && !chatOpen ? (
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
            <span className={cn(inner, rise(selected === 4))}>
               <span className={glyph(selected === 4)}>
                  <Menu size={20} strokeWidth={1.6} aria-hidden="true" />
               </span>
               {t('tabs.more')}
            </span>
         </button>
      </nav>
   );
});
