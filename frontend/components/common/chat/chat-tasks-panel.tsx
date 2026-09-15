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
   tasks: ChatTask[];
   onChanged: () => void;
}

/**
 * Three dots, breathing in turn: the agent is working.
 *
 * Reuses the `berrypulse` keyframe the thread's stage line uses, staggered so
 * the row reads as motion rather than as one blinking dot. Decorative, so it is
 * hidden from assistive technology — the text beside it is the announcement.
 */
function ThinkingDots() {
   return (
      <span className="flex items-center gap-1" aria-hidden="true">
         {[0, 180, 360].map((delay) => (
            <span
               key={delay}
               style={{ animationDelay: `${delay}ms` }}
               className="size-1 rounded-full bg-[var(--shell-accent)] [animation:berrypulse_1.4s_ease-in-out_infinite] motion-reduce:animate-none"
            />
         ))}
      </span>
   );
}

/**
 * What this conversation still has to do.
 *
 * Collapsed, this is a thinking animation and nothing else: while one reply is
 * being written there is no decision to make, and a table of one row with a
 * timestamp and two buttons was noise over the top of the reply itself.
 *
 * The controls are not gone, because a queue is exactly when they matter.
 * Messages sent while a reply is running become tasks behind it, so the count
 * is the honest answer to "did my message go anywhere" — and opening it gives
 * back the per-task move-to-front and drop, and the clear. Dropping a task is
 * still the only way to take back something already sent.
 */
export function ChatQueue({ conversationId, tasks, onChanged }: ChatQueueProps) {
   const t = useTranslations('agentsChat.chat');
   // Shut by default now that the collapsed state says something on its own.
   const [open, setOpen] = useState(false);
   const [busy, setBusy] = useState(false);

   if (tasks.length === 0) return null;

   const queued = tasks.filter((task) => task.status === 'queued');

   const act = (work: Promise<unknown>) =>
      void work.then(onChanged, (error: unknown) => failed(error, t('rowFailed')));

   const clearAll = async () => {
      setBusy(true);
      try {
         // One at a time, and failures are not fatal: a task that started
         // while the queue was being cleared is simply no longer queued.
         for (const task of queued) {
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
            {queued.length === 0 ? (
               // Nothing waiting: the agent is simply working, so the row is the
               // animation and its word. There is nothing here to decide.
               <span
                  role="status"
                  className="flex items-center gap-2 text-[var(--shell-text-dim)]"
               >
                  <ThinkingDots />
                  {t('msgStageThinking')}
               </span>
            ) : (
               // Something is waiting behind the reply, which is a fact worth
               // stating and acting on — so the count opens the queue.
               <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => setOpen(!open)}
                  className="flex items-center gap-2 text-[var(--shell-text-dim)] hover:text-[var(--shell-text)]"
               >
                  <ThinkingDots />
                  {t('queueTitle', { count: queued.length })}
               </button>
            )}
            {open && queued.length > 0 ? (
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
               {tasks.map((task, index) => (
                  <li
                     key={task.id}
                     className="flex flex-wrap items-center gap-3 text-[var(--shell-text-muted)]"
                  >
                     <span className="w-20 flex-none">
                        {task.status === 'running' ? t('rowWorking') : `#${index + 1}`}
                     </span>
                     <span className="min-w-0 flex-1 truncate text-[var(--shell-text-dim)]">
                        {new Date(task.createdAt).toLocaleTimeString([], {
                           hour: '2-digit',
                           minute: '2-digit',
                        })}
                     </span>
                     {task.status === 'queued' ? (
                        <button
                           type="button"
                           className="hover:text-[var(--shell-text)]"
                           onClick={() => act(prioritizeSessionTask(conversationId, task.id))}
                        >
                           {t('queueRunNext')}
                        </button>
                     ) : null}
                     <button
                        type="button"
                        className="hover:text-[var(--shell-text)]"
                        onClick={() => act(cancelSessionTask(conversationId, task.id))}
                     >
                        {task.status === 'running' ? t('stop') : t('queueRemove')}
                     </button>
                  </li>
               ))}
            </ul>
         ) : null}
      </div>
   );
}
