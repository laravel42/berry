'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { SparkIcon } from '@/components/ui/spark-icon';
import { formatCombo } from '@/lib/shortcuts';
import { cn } from '@/lib/utils';
import { useShellStore } from '@/store/shell-store';
import { useShortcutBindings } from '@/store/shortcuts-store';
import { useUiPrefsStore } from '@/store/ui-prefs-store';

/**
 * Flat "Agents" launcher at the bottom-left of the body frame.
 *
 * Opens the floating chat window that `FloatingChat` draws. Always rendered:
 * Preferences → General can turn the floating *panel* off, and that preference
 * is stored per browser origin. A click while the panel is off turns it back
 * on and opens. Disabled on the chat page, which is this window's full-size
 * counterpart.
 *
 * Quiet chip with the `.spark` ring: a thin rotating brand-colour border,
 * the ledger redesign's control for a secondary AI action.
 */
export function ShellChatButton() {
   const t = useTranslations('shell');
   const pathname = usePathname() ?? '';
   const chatWindow = useShellStore((state) => state.chatWindow);
   const toggleChat = useShellStore((state) => state.toggleChat);
   const unread = useShellStore((state) => state.chatUnread);
   const floatingEnabled = useUiPrefsStore((state) => state.floatingChat);
   const setFloatingChat = useUiPrefsStore((state) => state.setFloatingChat);
   const combo = useShortcutBindings()['chat.toggleFloating'];

   // The glyph for `mod` depends on the platform, which the server cannot
   // know; the hint is filled in after mount so both sides render alike.
   const [hint, setHint] = useState<string | null>(null);
   useEffect(() => {
      setHint(combo ? formatCombo(combo) : null);
   }, [combo]);

   const onChatPage = pathname.includes('/chat');
   const open = floatingEnabled && chatWindow !== 'closed';
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
      <Button
         type="button"
         variant="ai"
         size="md"
         onClick={() => {
            if (!floatingEnabled) setFloatingChat(true);
            toggleChat();
         }}
         disabled={onChatPage}
         aria-label={label}
         aria-expanded={open}
         title={title}
         data-open={open ? 'true' : undefined}
         className={cn('relative data-[open=true]:text-foreground', onChatPage && 'opacity-40')}
      >
         <SparkIcon className="size-3.5" />
         {t('nav.agents')}
         {unread > 0 && !open ? (
            <span
               aria-hidden="true"
               className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-[var(--brand-azure)]"
            />
         ) : null}
      </Button>
   );
}
