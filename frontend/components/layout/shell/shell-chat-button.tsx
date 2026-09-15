'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { MessageSquare } from 'lucide-react';

import { formatCombo } from '@/lib/shortcuts';
import { useShellStore } from '@/store/shell-store';
import { useShortcutBindings } from '@/store/shortcuts-store';
import { useUiPrefsStore } from '@/store/ui-prefs-store';
import { shellIconButton, shellStripHitArea } from './shell-icon';

/**
 * The chat launcher, beside the bell at the right of the tab strip.
 *
 * It opens the floating chat window that `FloatingChat` draws. The window
 * used to launch from a berry-coloured circle fixed in the page's corner,
 * which covered whatever a page put there — Approve on a review, Send on a
 * comment. Chrome belongs in the chrome, and berry red belongs to the one
 * primary action on a view, so the launcher is a strip button like the bell.
 *
 * The same rules as the window: disabled on the chat page, which is this
 * window's full-size counterpart, and absent when Preferences → General has
 * turned the window off.
 */
export function ShellChatButton() {
   const t = useTranslations('shell');
   const pathname = usePathname() ?? '';
   const chatWindow = useShellStore((state) => state.chatWindow);
   const toggleChat = useShellStore((state) => state.toggleChat);
   const unread = useShellStore((state) => state.chatUnread);
   const floatingEnabled = useUiPrefsStore((state) => state.floatingChat);
   const combo = useShortcutBindings()['chat.toggleFloating'];

   // The glyph for `mod` depends on the platform, which the server cannot
   // know; the hint is filled in after mount so both sides render alike.
   const [hint, setHint] = useState<string | null>(null);
   useEffect(() => {
      setHint(combo ? formatCombo(combo) : null);
   }, [combo]);

   if (!floatingEnabled) return null;

   const onChatPage = pathname.includes('/chat');
   const open = chatWindow !== 'closed';
   const label = open
      ? t('chat.close')
      : unread > 0
        ? t('chat.openUnread', { count: unread })
        : t('chat.open');
   const title = onChatPage
      ? t('chat.onChatPage')
      : hint
        ? t('chat.shortcutHint', { keys: hint })
        : label;

   return (
      <button
         type="button"
         onClick={toggleChat}
         disabled={onChatPage}
         aria-label={label}
         aria-expanded={open}
         title={title}
         className={`ml-1 size-[26px] self-center max-lg:mx-[9px] ${shellIconButton} ${shellStripHitArea}`}
      >
         <MessageSquare size={15} strokeWidth={1.8} aria-hidden="true" />
         {unread > 0 && !open ? (
            // A dot, not a count: the rail's Chat row carries the number. Azure,
            // the colour agents speak in, rather than the red the bell uses for
            // things addressed to you.
            <span
               aria-hidden="true"
               className="absolute -top-0.5 -right-0.5 size-2 rounded-full bg-[var(--brand-azure)] ring-2 ring-[var(--shell-rail)]"
            />
         ) : null}
      </button>
   );
}
