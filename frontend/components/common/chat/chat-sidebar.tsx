'use client';

import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { ChatThread } from '@/lib/chat';
import { ChatSessions } from './chat-sessions';

interface ChatSidebarProps {
   threads: ChatThread[];
   archived: ChatThread[] | null;
   showArchived: boolean;
   onToggleArchived: () => void;
   activeId: string | null;
   /** Starts a conversation with the Orchestrator; there is nobody else to pick. */
   onNewChat: () => void;
   onSelect: (thread: ChatThread) => void;
   onChanged: () => void;
   onStop: (thread: ChatThread) => void;
   /** The page sets its name and the new-chat action above the split instead. */
   headless?: boolean;
}

/**
 * A New chat button and the conversations themselves.
 *
 * There is no agent to choose: every conversation starts with the
 * Orchestrator, which reads the request and brings in the right role. The
 * picker this used to hold made the person do that routing by hand.
 */
export function ChatSidebar({
   threads,
   archived,
   showArchived,
   onToggleArchived,
   activeId,
   onNewChat,
   onSelect,
   onChanged,
   onStop,
   headless = false,
}: ChatSidebarProps) {
   const t = useTranslations('agentsChat.chat');

   return (
      <aside className="flex w-[260px] flex-none flex-col overflow-y-auto border-r border-[var(--shell-line)] bg-[var(--shell-rail)]">
         {headless ? null : (
            <div className="shrink-0 px-3 pt-3 pb-2">
               <h1 className="sr-only">{t('title')}</h1>
               <button
                  type="button"
                  onClick={onNewChat}
                  className="flex w-full items-center gap-2 rounded-lg border border-[var(--shell-line-strong)] px-3 py-2 text-left text-[var(--shell-text)] transition-colors hover:bg-[var(--shell-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
               >
                  <Plus className="size-3.5" />
                  {t('newChat')}
               </button>
            </div>
         )}

         <ChatSessions
            threads={threads}
            archived={archived}
            showArchived={showArchived}
            onToggleArchived={onToggleArchived}
            activeId={activeId}
            onSelect={onSelect}
            onChanged={onChanged}
            onStop={onStop}
         />
      </aside>
   );
}
