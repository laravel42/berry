'use client';

import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { SparkIcon } from '@/components/ui/spark-icon';
import { cn } from '@/lib/utils';
import { useShellStore } from '@/store/shell-store';
import { useUiPrefsStore } from '@/store/ui-prefs-store';

/**
 * Flat "Agent" launcher at the bottom-right of the body frame.
 *
 * Opens the floating chat window that `FloatingChat` draws. Always rendered:
 * Preferences → General can turn the floating *panel* off, and that preference
 * is stored per browser origin. A click while the panel is off turns it back
 * on and opens. Disabled on the chat page, which is this window's full-size
 * counterpart.
 *
 * Quiet chip with the `.spark` ring: a thin rotating brand-colour border,
 * the ledger redesign's control for a secondary AI action. Stays visible in
 * the corner rather than auto-hiding after idle time.
 *
 * No corner dot: unread replies are still in its accessible name, and the
 * shortcut hint lives in the chat window's header.
 */
export function ShellChatButton() {
   const t = useTranslations('shell');
   const pathname = usePathname() ?? '';
   const chatWindow = useShellStore((state) => state.chatWindow);
   const toggleChat = useShellStore((state) => state.toggleChat);
   const unread = useShellStore((state) => state.chatUnread);
   const floatingEnabled = useUiPrefsStore((state) => state.floatingChat);
   const setFloatingChat = useUiPrefsStore((state) => state.setFloatingChat);
   const onChatPage = pathname.includes('/chat');
   const open = floatingEnabled && chatWindow !== 'closed';
   const label = open
      ? t('chat.close')
      : unread > 0
        ? t('chat.openUnread', { count: unread })
        : t('chat.open');
   // The shortcut is named by the info mark in the chat window's header.
   const title = onChatPage ? t('chat.onChatPage') : label;

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
         className={cn(
            'relative transition-[opacity,box-shadow] duration-200 ease-out data-[open=true]:text-foreground motion-reduce:transition-none',
            onChatPage && 'opacity-40'
         )}
      >
         <SparkIcon className="size-3.5" />
         {t('chat.label')}
      </Button>
   );
}
