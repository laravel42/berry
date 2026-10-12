'use client';

import { Bug, Check, ChevronDown, Infinity, Layers, ListTodo, MessageCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { CHAT_MODES, type ChatMode } from '@/data/chat-mode';
import {
   DropdownMenu,
   DropdownMenuContent,
   DropdownMenuRadioGroup,
   DropdownMenuRadioItem,
   DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useUiPrefsStore } from '@/store/ui-prefs-store';

const MODE_ICON: Record<ChatMode, typeof Infinity> = {
   agent: Infinity,
   plan: ListTodo,
   debug: Bug,
   multitask: Layers,
   ask: MessageCircle,
};

export const MODE_COPY = {
   agent: { name: 'modeAgent', hint: 'modeAgentHint' },
   plan: { name: 'modePlan', hint: 'modePlanHint' },
   debug: { name: 'modeDebug', hint: 'modeDebugHint' },
   multitask: { name: 'modeMultitask', hint: 'modeMultitaskHint' },
   ask: { name: 'modeAsk', hint: 'modeAskHint' },
} as const;

/**
 * The mode the next message asks for, kept on this machine.
 *
 * The menu sits on the composer the way a mode picker does: the current mode
 * is the button, and each choice names what the agent will do with it.
 */
export function ChatModeSelect({ disabled = false }: { disabled?: boolean }) {
   const t = useTranslations('agentsChat.chat');
   const mode = useUiPrefsStore((state) => state.chatMode);
   const setChatMode = useUiPrefsStore((state) => state.setChatMode);
   const Current = MODE_ICON[mode];
   const currentName = t(MODE_COPY[mode].name);

   return (
      <DropdownMenu>
         <DropdownMenuTrigger asChild disabled={disabled}>
            <button
               type="button"
               disabled={disabled}
               aria-label={t('modeCurrent', { mode: currentName })}
               className="flex h-6 min-w-0 items-center gap-1 rounded-[5px] bg-[var(--shell-line)] px-2.5 text-[var(--shell-text-muted)] transition-colors hover:text-[var(--shell-text)] outline-none disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:text-[var(--shell-text-muted)]"
            >
               <Current className="size-3.5 flex-none" aria-hidden />
               <span className="truncate">{currentName}</span>
               <ChevronDown className="size-3 flex-none opacity-70" aria-hidden />
            </button>
         </DropdownMenuTrigger>
         <DropdownMenuContent side="top" align="start" className="w-72">
            <DropdownMenuRadioGroup
               value={mode}
               onValueChange={(value) => {
                  const next = CHAT_MODES.find((entry) => entry === value);
                  if (next) setChatMode(next);
               }}
            >
               {CHAT_MODES.map((entry) => {
                  const Icon = MODE_ICON[entry];
                  const name = t(MODE_COPY[entry].name);
                  return (
                     <DropdownMenuRadioItem
                        key={entry}
                        value={entry}
                        className="items-start gap-2.5 py-2 pr-2 pl-2 [&>span:first-child]:hidden"
                     >
                        <Icon
                           className="mt-0.5 size-4 flex-none text-muted-foreground"
                           aria-hidden
                        />
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                           <span className="flex items-baseline gap-2">
                              <span className="font-medium">{name}</span>
                              {entry === 'agent' ? (
                                 <span className="text-muted-foreground">
                                    {t('modeRecommended')}
                                 </span>
                              ) : null}
                           </span>
                           <span data-caption className="text-muted-foreground">
                              {t(MODE_COPY[entry].hint)}
                           </span>
                        </span>
                        {entry === mode ? (
                           <Check className="mt-0.5 size-4 flex-none" aria-hidden />
                        ) : (
                           <span className="size-4 flex-none" aria-hidden />
                        )}
                     </DropdownMenuRadioItem>
                  );
               })}
            </DropdownMenuRadioGroup>
         </DropdownMenuContent>
      </DropdownMenu>
   );
}
