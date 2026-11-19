'use client';

import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { TUCKED_CLASS, useIdleTuck } from '@/hooks/use-idle-tuck';
import { SparkIcon } from '@/components/ui/spark-icon';
import { cn } from '@/lib/utils';
import { useShellStore } from '@/store/shell-store';
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
 * Quiet chip with the `.spark` ring: a thin rotating brand-colour border,
 * the ledger redesign's control for a secondary AI action.
 *
 * Left alone for ten seconds it tucks itself off the right edge, leaving a
 * tenth showing, so it stops sitting on top of the page. Tucked, it casts a
 * wider berry bloom so the sliver still reads as something to reach for.
 * Pointing at it or focusing it brings it back, and it stays out until
 * another ten idle seconds have passed. It never tucks while the chat window
 * is open. On touch, the first tap on the tucked sliver only brings it back.
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
   const { tucked, wake, rest } = useIdleTuck(open);
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
            // A tap on the tucked sliver brings the button back; the next
            // one opens the chat. A mouse has already woken it on hover.
            if (tucked) {
               wake();
               rest();
               return;
            }
            if (!floatingEnabled) setFloatingChat(true);
            toggleChat();
         }}
         onPointerEnter={wake}
         onPointerLeave={rest}
         onFocus={wake}
         onBlur={rest}
         disabled={onChatPage}
         aria-label={label}
         aria-expanded={open}
         title={title}
         data-open={open ? 'true' : undefined}
         data-tucked={tucked ? 'true' : undefined}
         className={cn(
            'relative transition-[translate,opacity,box-shadow] duration-300 ease-out data-[open=true]:text-foreground motion-reduce:transition-none',
            TUCKED_CLASS,
            onChatPage && 'opacity-40'
         )}
      >
         <SparkIcon className="size-3.5" />
         {t('nav.agents')}
      </Button>
   );
}
