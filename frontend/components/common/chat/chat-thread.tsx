'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Check, Copy, RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';

import type { ChatMessage, ChatSuggestion } from '@/lib/chat';
import { ChatMarkdown } from './chat-markdown';

interface ChatThreadProps {
   messages: ChatMessage[];
   agentName: string | null;
   /** The agent's own openers, offered only while the thread is empty. */
   starters: string[];
   suggestions: ChatSuggestion[];
   onUseSuggestion: (prompt: string) => void;
   onRegenerate: () => void;
   regenerating: boolean;
   hasEarlier: boolean;
   loadingEarlier: boolean;
   onLoadEarlier: () => void;
   /** What the running reply is doing right now; null when nothing is running. */
   stage: string | null;
}

function clockTime(iso: string): string {
   const at = new Date(iso);
   return Number.isNaN(at.getTime())
      ? ''
      : at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function dayLabel(iso: string): string {
   const at = new Date(iso);
   if (Number.isNaN(at.getTime())) return '';
   const today = new Date();
   return at.toDateString() === today.toDateString()
      ? 'today'
      : at.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/**
 * The messages of one conversation.
 *
 * Two scroll behaviours, which are easy to confuse: a new turn pins the view
 * to the bottom, and loading older messages must not move the view at all.
 * Both are handled here rather than by the parent, because only this component
 * knows where the scroll container actually is.
 */
export function ChatThread({
   messages,
   agentName,
   starters,
   suggestions,
   onUseSuggestion,
   onRegenerate,
   regenerating,
   hasEarlier,
   loadingEarlier,
   onLoadEarlier,
   stage,
}: ChatThreadProps) {
   const t = useTranslations('agentsChat.chat');
   const scroller = useRef<HTMLDivElement>(null);
   const endRef = useRef<HTMLDivElement>(null);
   const [copied, setCopied] = useState<string | null>(null);
   const lastId = messages.at(-1)?.id;

   // Kept across a prepend so the view can be restored to the same message.
   const anchor = useRef<{ height: number; top: number } | null>(null);
   const oldestId = messages[0]?.id;

   useEffect(() => {
      endRef.current?.scrollIntoView({ block: 'end' });
   }, [lastId]);

   useLayoutEffect(() => {
      const element = scroller.current;
      if (!element || !anchor.current) return;
      // Older messages were added above: put the reader back where they were,
      // which is the whole point of loading them without moving the page.
      element.scrollTop = element.scrollHeight - anchor.current.height + anchor.current.top;
      anchor.current = null;
   }, [oldestId]);

   const onScroll = () => {
      const element = scroller.current;
      if (!element || !hasEarlier || loadingEarlier) return;
      if (element.scrollTop > 48) return;
      anchor.current = { height: element.scrollHeight, top: element.scrollTop };
      onLoadEarlier();
   };

   const copy = async (message: ChatMessage) => {
      try {
         await navigator.clipboard.writeText(message.body);
         setCopied(message.id);
         setTimeout(() => setCopied(null), 1500);
      } catch {
         /* A clipboard the browser refuses is not worth an error toast. */
      }
   };

   let lastDay = '';

   return (
      <div
         ref={scroller}
         onScroll={onScroll}
         className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5"
      >
         {hasEarlier ? (
            <button
               type="button"
               onClick={onLoadEarlier}
               className="self-center text-[var(--shell-text-dim)] hover:text-[var(--shell-text)]"
            >
               {t('loadEarlier')}
            </button>
         ) : null}

         {messages.length === 0 ? (
            <div className="flex flex-col gap-3">
               <h2 className="text-[var(--shell-text)]">
                  {agentName ? t('emptyTitle', { name: agentName }) : t('emptyNoAgentTitle')}
               </h2>
               <p className="max-w-prose leading-relaxed text-[var(--shell-text-dim)]">
                  {agentName ? t('emptyBody') : t('emptyNoAgentBody')}
               </p>
               {starters.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                     {starters.map((starter) => (
                        <button
                           key={starter}
                           type="button"
                           onClick={() => onUseSuggestion(starter)}
                           className="rounded-[5px] bg-[var(--shell-line)] px-2.5 py-1 text-[var(--shell-text-muted)] hover:text-[var(--shell-text)]"
                        >
                           {starter}
                        </button>
                     ))}
                  </div>
               ) : null}
            </div>
         ) : null}

         {messages.map((message) => {
            const day = dayLabel(message.createdAt);
            const divider = day && day !== lastDay ? day : null;
            lastDay = day || lastDay;
            const isAgent = message.authorType === 'agent';

            return (
               <div key={message.id} className="flex flex-col gap-4">
                  {divider ? (
                     <div className="flex items-center gap-3 text-[var(--shell-text-dim)]">
                        <span className="h-px flex-1 bg-[var(--shell-line)]" />
                        {divider}
                        <span className="h-px flex-1 bg-[var(--shell-line)]" />
                     </div>
                  ) : null}

                  <article className="group flex gap-3">
                     <span
                        className={[
                           'mt-0.5 flex size-6 flex-none items-center justify-center rounded',
                           isAgent
                              ? 'bg-[color-mix(in_srgb,var(--shell-accent)_28%,transparent)] text-[var(--shell-text)]'
                              : 'bg-[var(--shell-line)] text-[var(--shell-text-muted)]',
                        ].join(' ')}
                        aria-hidden="true"
                     >
                        {(message.authorName.trim()[0] ?? '?').toUpperCase()}
                     </span>
                     <div className="flex min-w-0 flex-1 flex-col gap-1">
                        <div className="flex items-baseline gap-2">
                           <span className="text-[var(--shell-text)]">{message.authorName}</span>
                           <span className="tabular-nums text-[var(--shell-text-dim)]">
                              {clockTime(message.createdAt)}
                           </span>
                           <button
                              type="button"
                              onClick={() => void copy(message)}
                              aria-label={t('msgCopy')}
                              className="ml-auto text-[var(--shell-text-dim)] opacity-0 hover:text-[var(--shell-text)] focus-visible:opacity-100 group-hover:opacity-100"
                           >
                              {copied === message.id ? (
                                 <Check className="size-3.5" />
                              ) : (
                                 <Copy className="size-3.5" />
                              )}
                           </button>
                        </div>

                        <div className="text-[var(--shell-text-muted)]">
                           <ChatMarkdown body={message.body} />
                        </div>
                     </div>
                  </article>
               </div>
            );
         })}

         {stage ? (
            <p className="flex items-center gap-2 text-[var(--shell-text-dim)]" role="status">
               <span className="size-1.5 rounded-full bg-[var(--shell-accent)] [animation:berrypulse_1.4s_ease-in-out_infinite] motion-reduce:animate-none" />
               {stage}
            </p>
         ) : null}

         {messages.length > 0 && suggestions.length > 0 && !stage ? (
            <div className="flex flex-wrap items-center gap-2">
               <span className="text-[var(--shell-text-dim)]">{t('followUps')}</span>
               {suggestions.map((suggestion) => (
                  <button
                     key={suggestion.label}
                     type="button"
                     onClick={() => onUseSuggestion(suggestion.prompt)}
                     className="rounded-[5px] bg-[var(--shell-line)] px-2.5 py-1 text-[var(--shell-text-muted)] hover:text-[var(--shell-text)]"
                  >
                     {suggestion.label}
                  </button>
               ))}
               <button
                  type="button"
                  onClick={onRegenerate}
                  disabled={regenerating}
                  className="inline-flex items-center gap-1 text-[var(--shell-text-dim)] hover:text-[var(--shell-text)] disabled:opacity-50"
               >
                  <RefreshCw className={regenerating ? 'size-3.5 animate-spin' : 'size-3.5'} />
                  {t('regenerate')}
               </button>
            </div>
         ) : null}

         <div ref={endRef} />
      </div>
   );
}
