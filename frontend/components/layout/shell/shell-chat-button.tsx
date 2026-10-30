'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Sparkles } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { formatCombo } from '@/lib/shortcuts';
import { cn } from '@/lib/utils';
import { useShellStore } from '@/store/shell-store';
import { useShortcutBindings } from '@/store/shortcuts-store';
import { useUiPrefsStore } from '@/store/ui-prefs-store';

/**
 * Flat "Agents" launcher at the bottom-right of the body frame.
 *
 * Opens the floating chat window that `FloatingChat` draws. Always rendered:
 * Preferences → General can turn the floating *panel* off, and that preference
 * is stored per browser origin. A click while the panel is off turns it back
 * on and opens. Disabled on the chat page, which is this window's full-size
 * counterpart.
 *
 * Quiet `bg-container` chip with a thin rotating brand-colour border
 * (same motion as `.ai-animated-border`).
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
      <span className={cn('ai-animated-border h-6', onChatPage && 'opacity-40')}>
         <Button
            type="button"
            variant="outline"
            size="xxs"
            onClick={() => {
               if (!floatingEnabled) setFloatingChat(true);
               toggleChat();
            }}
            disabled={onChatPage}
            aria-label={label}
            aria-expanded={open}
            title={title}
            data-open={open ? 'true' : undefined}
            className="relative h-full min-h-0 border-0 bg-container shadow-none hover:bg-container hover:text-foreground data-[open=true]:bg-container data-[open=true]:text-foreground"
         >
            <Sparkles className="size-3.5" aria-hidden="true" />
            {t('nav.agents')}
            {unread > 0 && !open ? (
               <span
                  aria-hidden="true"
                  className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-[var(--brand-azure)]"
               />
            ) : null}
         </Button>
      </span>
   );
}
