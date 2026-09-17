'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { BerryApiError } from '@/lib/api';
import { cancelSessionTask, prioritizeSessionTask, type ChatTask } from '@/lib/chat';

const failed = (error: unknown, fallback: string) =>
   toast.error(error instanceof BerryApiError ? error.message : fallback);

interface ChatQueueProps {
   conversationId: string;
   /**
    * The session's in-flight tasks in dispatch order — the server returns only
    * `queued` and `running` rows, sorted `priority DESC, created_at ASC`.
    */
   tasks: ChatTask[];
   onChanged: () => void;
}

/**
 * What this conversation still has to do *behind* the reply being written.
 *
 * One message and one reply shows nothing here. That case is already said once,
 * by the thinking animation under the last message, and a bar repeating it at the
 * foot of the page was a second voice for one fact — worse, it framed the
 * ordinary case as something to manage.
 *
 * Status is the wrong way to ask. A sent message is `queued` until the dispatcher
 * claims it, so "is anything queued" was true at the start of every single reply
 * and the bar appeared every time. Position is the right way: one task is the
 * reply being produced, running or about to be, and that is what the animation
 * upstairs is about. Only what sits behind it is waiting, and a real queue is
 * worth both stating and acting on — the count opens the per-task move-to-front
 * and drop, and the clear. Dropping a task is still the only way to take back
 * something already sent.
 */
export function ChatQueue({ conversationId, tasks, onChanged }: ChatQueueProps) {
   const t = useTranslations('agentsChat.chat');
   const [open, setOpen] = useState(false);
   const [busy, setBusy] = useState(false);

   // Running if one has been claimed, otherwise whatever sorts first — and not
   // simply `tasks[0]`, because "Run next" sets `priority = 100`, which sorts a
   // waiting task ahead of the reply already being written.
   const head = tasks.find((task) => task.status === 'running') ?? tasks[0];
   const waiting = tasks.filter((task) => task.id !== head?.id);

   if (waiting.length === 0) return null;

   const act = (work: Promise<unknown>) =>
      void work.then(onChanged, (error: unknown) => failed(error, t('rowFailed')));

   const clearAll = async () => {
      setBusy(true);
      try {
         // `waiting`, never the head: clearing the queue drops what has not been
         // answered yet, not the reply the reader is sitting there waiting for.
         // One at a time, and failures are not fatal — a task that started while
         // the queue was being cleared is simply no longer waiting.
         for (const task of waiting) {
            await cancelSessionTask(conversationId, task.id).catch(() => undefined);
         }
         onChanged();
      } finally {
         setBusy(false);
      }
   };

   return (
      <div className="flex-none border-t border-[var(--shell-line)] px-6 py-2">
         <div className="flex flex-wrap items-center gap-3">
            <button
               type="button"
               aria-expanded={open}
               onClick={() => setOpen(!open)}
               className="text-[var(--shell-text-dim)] hover:text-[var(--shell-text)]"
            >
               {t('queueTitle', { count: waiting.length })}
            </button>
            {open ? (
               <button
                  type="button"
                  disabled={busy}
                  onClick={() => void clearAll()}
                  className="text-[var(--shell-text-dim)] hover:text-[var(--shell-text)] disabled:opacity-50"
               >
                  {t('queueClear')}
               </button>
            ) : null}
         </div>

         {open ? (
            <ul className="mt-1 flex flex-col gap-1">
               {waiting.map((task, index) => (
                  <li
                     key={task.id}
                     className="flex flex-wrap items-center gap-3 text-[var(--shell-text-muted)]"
                  >
                     <span className="w-20 flex-none">{`#${index + 1}`}</span>
                     <span className="min-w-0 flex-1 truncate text-[var(--shell-text-dim)]">
                        {new Date(task.createdAt).toLocaleTimeString([], {
                           hour: '2-digit',
                           minute: '2-digit',
                        })}
                     </span>
                     <button
                        type="button"
                        className="hover:text-[var(--shell-text)]"
                        onClick={() => act(prioritizeSessionTask(conversationId, task.id))}
                     >
                        {t('queueRunNext')}
                     </button>
                     <button
                        type="button"
                        className="hover:text-[var(--shell-text)]"
                        onClick={() => act(cancelSessionTask(conversationId, task.id))}
                     >
                        {t('queueRemove')}
                     </button>
                  </li>
               ))}
            </ul>
         ) : null}
      </div>
   );
}
