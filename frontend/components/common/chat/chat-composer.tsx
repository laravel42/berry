'use client';

import { useEffect, useRef } from 'react';
import { ArrowUp, Square } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { useComposerPalette } from '@/components/common/composer-palette';

interface ChatComposerProps {
   value: string;
   onChange: (value: string) => void;
   onSend: () => void;
   /** Stop the reply that is running; absent when nothing is. */
   onStop: (() => void) | null;
   /** True while a reply is running: a send then queues behind it. */
   queueing: boolean;
   disabled: boolean;
   placeholder: string;
   workspaceId: string | undefined;
   /**
    * How the send button is dressed. On the chat page it is the page's
    * primary action; in the floating window it sits over a page that
    * already has one, so there it is a secondary control.
    */
   sendVariant?: 'primary' | 'secondary';
}

const SEND_VARIANT = {
   primary: 'bg-berry text-chalk hover:brightness-110',
   secondary: 'bg-[var(--shell-line)] text-[var(--shell-text)] hover:bg-[var(--shell-line-strong)]',
} as const;

/**
 * The message box.
 *
 * Enter sends and Shift+Enter breaks the line. `@` lists the workspace's
 * people and agents so one can be tagged into the message. `/` lists every
 * skill in the workspace, and the commands. Choosing a skill writes its name
 * into the message; the run then carries that skill and the agent follows it.
 */
export function ChatComposer({
   value,
   onChange,
   onSend,
   onStop,
   queueing,
   disabled,
   placeholder,
   workspaceId,
   sendVariant = 'primary',
}: ChatComposerProps) {
   const t = useTranslations('agentsChat.chat');
   const input = useRef<HTMLTextAreaElement>(null);
   const palette = useComposerPalette({
      textareaRef: input,
      value,
      onChange,
      workspaceId,
      listClassName: 'left-6 right-6 w-auto',
   });

   // Grow with the message, up to the same max the className allows.
   useEffect(() => {
      const element = input.current;
      if (!element) return;
      element.style.height = '0px';
      element.style.height = `${Math.min(element.scrollHeight, 160)}px`;
   }, [value]);
   const canSend = !disabled && value.trim() !== '';
   const sendLabel = queueing ? t('queue') : t('send');

   return (
      <div className="relative mx-auto w-full max-w-3xl flex-none">
         {palette.list}

         <form
            className="flex items-end gap-2 px-6 pt-2 pb-5"
            onSubmit={(event) => {
               event.preventDefault();
               if (canSend) onSend();
            }}
         >
            <div className="flex min-w-0 flex-1 items-end gap-2 rounded-2xl border border-[var(--shell-line-strong)] bg-[var(--shell-surface)] px-4 py-2 shadow-lg shadow-black/20 focus-within:border-[var(--shell-text-dim)]">
               <textarea
                  ref={input}
                  rows={1}
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
                  className="max-h-48 min-h-8 min-w-0 flex-1 resize-none overflow-y-auto bg-transparent py-1.5 leading-6 text-[var(--shell-text)] outline-none placeholder:text-[var(--shell-text-dim)] disabled:cursor-not-allowed"
               />

               {/* Stop stands where Send was while a reply runs; a send then
                   queues, so both stay reachable without a second button. */}
               {onStop ? (
                  <button
                     type="button"
                     onClick={onStop}
                     aria-label={t('stopReply')}
                     title={t('stopReply')}
                     className="mb-0.5 flex size-8 flex-none cursor-pointer items-center justify-center rounded-full bg-[var(--shell-text)] text-[var(--shell-canvas)] transition-colors hover:opacity-90"
                  >
                     <Square className="size-3" aria-hidden />
                  </button>
               ) : null}
               <button
                  type="submit"
                  disabled={!canSend}
                  aria-label={sendLabel}
                  title={sendLabel}
                  className={[
                     'mb-0.5 flex size-8 flex-none cursor-pointer items-center justify-center rounded-full transition-[opacity,transform,background-color] disabled:cursor-not-allowed disabled:opacity-40',
                     SEND_VARIANT[sendVariant],
                  ].join(' ')}
               >
                  <ArrowUp className="size-4" aria-hidden />
               </button>
            </div>
         </form>
      </div>
   );
}
