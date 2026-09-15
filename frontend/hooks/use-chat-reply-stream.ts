'use client';

import { useEffect, useState } from 'react';
import {
   isTerminalTaskEvent,
   replyTextFromTaskEvent,
   streamTaskEvents,
   type ChatMessage,
} from '@/lib/chat';

/**
 * The reply a running chat task is writing, as it is written.
 *
 * Chat is an agent run, and the stored reply is only appended when that run
 * ends — so without this the thread sits silent for however long the agent
 * works. The text already exists as `run.output.delta` on the run's ledger;
 * this follows it and hands back the prose.
 *
 * The accumulated text is deliberately *not* a `ChatMessage`: it has no id, and
 * the chat views rebuild `messages` from the server on every refresh, which
 * would discard an injected row. It is returned separately and dropped as soon
 * as the stored reply (which carries the run that wrote it) arrives.
 */
export function useChatReplyStream(input: {
   conversationId: string | null;
   /** The running task's run id, or null when nothing is running. */
   runId: string | null;
   messages: ChatMessage[];
   /** Names the phase, so a caller can label a run that has produced no text yet. */
   labels: { running: string; writing: string; thinking: string };
}): { text: string | null; stage: string | null } {
   const { conversationId, runId, messages, labels } = input;
   const [stage, setStage] = useState<string | null>(null);
   const [streaming, setStreaming] = useState<{ runId: string; text: string } | null>(null);
   const { running, writing, thinking } = labels;

   useEffect(() => {
      if (!conversationId || !runId) {
         setStage(null);
         setStreaming(null);
         return;
      }
      const controller = new AbortController();
      // Mirrored locally so an append never reads stale state, and flushed on a
      // timer so a fast run does not re-render (and re-parse markdown) per token.
      let text = '';
      let pending = false;
      let flush: ReturnType<typeof setTimeout> | null = null;
      const show = () => {
         pending = false;
         setStreaming({ runId, text });
      };

      void (async () => {
         try {
            for await (const event of streamTaskEvents(conversationId, runId, {
               signal: controller.signal,
            })) {
               setStage(
                  /tool|command|exec/i.test(event.type)
                     ? running
                     : /output|message|write/i.test(event.type)
                       ? writing
                       : thinking
               );
               const chunk = replyTextFromTaskEvent(event);
               if (chunk) {
                  text += chunk;
                  if (!pending) {
                     pending = true;
                     flush = setTimeout(show, 60);
                  }
               }
               if (isTerminalTaskEvent(event.type)) break;
            }
            // Whatever arrived stays on screen until the stored reply lands.
            if (pending) show();
         } catch {
            // A dropped stream leaves what arrived; the refetch reconciles.
         }
      })();

      return () => {
         controller.abort();
         if (flush) clearTimeout(flush);
      };
      // Keyed on the run id, not the task object: the queue is re-read every
      // few seconds and returns fresh objects, which would tear the stream down
      // and reopen it on every refresh.
   }, [conversationId, runId, running, writing, thinking]);

   // The stored reply carries the run that wrote it, so the provisional text is
   // dropped the moment the real message lands — no flicker of both, and no
   // duplicate if the stream outlived the run.
   useEffect(() => {
      if (!streaming) return;
      if (messages.some((message) => message.runId === streaming.runId)) setStreaming(null);
   }, [messages, streaming]);

   return { text: streaming?.text ?? null, stage };
}
