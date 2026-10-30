'use client';

import { useEffect, useRef } from 'react';
import { ArrowUp, Mic, Square } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { useComposerPalette } from '@/components/common/composer-palette';
import type { Agent } from '@/lib/agents';
import { useUiPrefsStore } from '@/store/ui-prefs-store';
import { MODE_COPY, ChatModeSelect } from './chat-mode-select';
import { ChatRepositorySelect } from './chat-repository-select';
import { ChatTierModelSelect } from './chat-tier-model-select';

interface ChatComposerProps {
   value: string;
   onChange: (value: string) => void;
   onSend: () => void;
   /** Stop the reply that is running; absent when nothing is. */
   onStop: (() => void) | null;
   /** True while a reply is running: a send then queues behind it. */
   queueing: boolean;
   disabled: boolean;
   workspaceId: string | undefined;
   /** A conversation is open. The mode and repository choices apply to that chat. */
   chatOpen?: boolean;
   /** The open conversation, so its model can sit with the mode. */
   conversationId?: string;
   agent?: Agent;
   /** A reply is being written. Mode, model and repository wait until it finishes. */
   answering?: boolean;
   /**
    * How the send button is dressed. On the chat page it is the page's
    * primary action; in the floating window it sits over a page that
    * already has one, so there it is a secondary control.
    */
   sendVariant?: 'primary' | 'secondary';
   /** Open a LiveKit voice room with this conversation's agent. */
   onVoice?: (() => void) | null;
}

const SEND_VARIANT = {
   primary: 'bg-berry text-chalk hover:brightness-110',
   secondary: 'bg-[var(--shell-line)] text-[var(--shell-text)] hover:bg-[var(--shell-line-strong)]',
} as const;

/** Empty box is three lines of `leading-6`; it grows to `max-h-48`. */
const INPUT_MIN = 72;
const INPUT_MAX = 192;

/**
 * The message box.
 *
 * Enter sends and Shift+Enter breaks the line. The mode under the text says
 * how the agent should take the message, and the repository beside it is the
 * codebase that message is about. `@` lists the workspace's people and
 * agents so one can be tagged into the message. `/` lists every skill in the
 * workspace, and the commands. Choosing a skill writes its name into the
 * message; the run then carries that skill and the agent follows it.
 */
export function ChatComposer({
   value,
   onChange,
   onSend,
   onStop,
   queueing,
   disabled,
   workspaceId,
   chatOpen = true,
   conversationId,
   agent,
   answering = false,
   sendVariant = 'primary',
   onVoice = null,
}: ChatComposerProps) {
   const t = useTranslations('agentsChat.chat');
   const mode = useUiPrefsStore((state) => state.chatMode);
   const placeholder = t(MODE_COPY[mode].hint);
   const input = useRef<HTMLTextAreaElement>(null);
   const palette = useComposerPalette({
      textareaRef: input,
      value,
      onChange,
      workspaceId,
      listClassName: 'left-6 right-6 w-auto',
   });

   // Grow with the message, between the empty three-line floor and max-h-48.
   useEffect(() => {
      const element = input.current;
      if (!element) return;
      element.style.height = '0px';
      element.style.height = `${Math.min(Math.max(element.scrollHeight, INPUT_MIN), INPUT_MAX)}px`;
   }, [value]);
   const canSend = !disabled && value.trim() !== '';
   const sendLabel = queueing ? t('queue') : t('send');

   return (
      <div className="relative mx-auto w-full max-w-3xl flex-none">
         {palette.list}

         <form
            className="flex items-end gap-2 px-3 pt-2 pb-5"
            onSubmit={(event) => {
               event.preventDefault();
               if (canSend) onSend();
            }}
         >
            <div className="flex min-w-0 flex-1 flex-col rounded-2xl border border-[var(--shell-line-strong)] bg-[var(--shell-surface)] px-3 py-2 shadow-lg shadow-black/20 focus-within:border-[var(--shell-text-dim)]">
               <textarea
                  ref={input}
                  rows={3}
                  value={value}
                  disabled={disabled}
                  placeholder={placeholder}
                  aria-label={placeholder}
                  aria-autocomplete="list"
                  onChange={(event) => {
                     onChange(event.target.value);
                     palette.sync(event.target.value, event.target.selectionStart ?? 0);
                  }}
                  onClick={(event) =>
                     palette.sync(
                        event.currentTarget.value,
                        event.currentTarget.selectionStart ?? 0
                     )
                  }
                  onKeyUp={(event) => {
                     if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                        palette.sync(
                           event.currentTarget.value,
                           event.currentTarget.selectionStart ?? 0
                        );
                     }
                  }}
                  onKeyDown={(event) => {
                     if (palette.onKeyDown(event)) return;
                     if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        if (canSend) onSend();
                     }
                  }}
                  className="max-h-48 min-h-[4.5rem] min-w-0 flex-1 resize-none overflow-y-auto bg-transparent px-1 py-1.5 leading-6 text-[var(--shell-text)] outline-none placeholder:text-[var(--shell-text-dim)] disabled:cursor-not-allowed"
               />

               {/* Mode, model and repository sit under the text. While a reply
                   is being written, Stop takes Send's place. A follow-up
                   typed during that reply queues, so both stay reachable. */}
               <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-1">
                     <ChatModeSelect disabled={!chatOpen || answering} />
                     {conversationId ? (
                        <ChatTierModelSelect
                           conversationId={conversationId}
                           agent={agent}
                           disabled={!chatOpen || answering}
                           compact
                        />
                     ) : null}
                     <ChatRepositorySelect
                        workspaceId={workspaceId}
                        disabled={!chatOpen || answering}
                     />
                  </div>
                  <div className="flex items-center gap-2">
                     {false && onVoice ? (
                        <button
                           type="button"
                           onClick={onVoice}
                           aria-label={t('voiceOpen')}
                           title={t('voiceOpen')}
                           className="flex size-8 flex-none cursor-pointer items-center justify-center rounded-full text-[var(--shell-text)] transition-colors hover:bg-[var(--shell-line)]"
                        >
                           <Mic className="size-4" aria-hidden />
                        </button>
                     ) : null}
                     {onStop ? (
                        <button
                           type="button"
                           onClick={onStop}
                           aria-label={t('stopReply')}
                           title={t('stopReply')}
                           className="flex size-8 flex-none cursor-pointer items-center justify-center rounded-full bg-[var(--shell-text)] text-[var(--shell-canvas)] transition-colors hover:opacity-90"
                        >
                           <Square className="size-3 fill-current" aria-hidden />
                        </button>
                     ) : null}
                     {onStop && !canSend ? null : (
                        <button
                           type="submit"
                           disabled={!canSend}
                           aria-label={sendLabel}
                           title={sendLabel}
                           className={[
                              'flex size-8 flex-none cursor-pointer items-center justify-center rounded-full transition-[opacity,transform,background-color] disabled:cursor-not-allowed disabled:opacity-40',
                              SEND_VARIANT[sendVariant],
                           ].join(' ')}
                        >
                           <ArrowUp className="size-4" aria-hidden />
                        </button>
                     )}
                  </div>
               </div>
            </div>
         </form>
      </div>
   );
}
