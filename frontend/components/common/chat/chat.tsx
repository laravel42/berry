'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { MoreHorizontal, Pin } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { toast } from 'sonner';

import { ConfirmAction } from '@/components/common/confirm-action';
import {
   DropdownMenu,
   DropdownMenuContent,
   DropdownMenuItem,
   DropdownMenuSeparator,
   DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { BerryApiError } from '@/lib/api';
import { isOrchestrator, loadWorkspaceAgents, type Agent } from '@/lib/agents';
import {
   cancelSessionTask,
   deleteSession,
   listMessages,
   listSessionTasks,
   listConversationSuggestions,
   listThreads,
   markSessionRead,
   unreadAcrossThreads,
   openAgentThread,
   renameSession,
   saveDraft,
   sendMessage,
   setSessionArchived,
   type ChatMessage,
   type ChatSuggestion,
   type ChatTask,
   type ChatThread,
} from '@/lib/chat';
import { subscribeWorkspaceEvents } from '@/lib/events';
import { useChatReplyStream } from '@/hooks/use-chat-reply-stream';
import { useSessionStore } from '@/store/session-store';
import { useShellStore } from '@/store/shell-store';
import { useUiPrefsStore } from '@/store/ui-prefs-store';
import { ChatComposer } from './chat-composer';
import { chatRepositoryToSend } from './chat-repository-select';
import { ChatDelegatedWork, ChatQueue } from './chat-tasks-panel';
import { ChatThread as ThreadView } from './chat-thread';

const PAGE = 50;

/** A rename the screen already shows, until the server agrees or a newer one replaces it. */
type PendingRename = { topic: string; baseline: string };

/** Keeps a title that is still being saved when a list refresh returns the old one. */
function withPendingTopics(
   threads: ChatThread[],
   pending: Map<string, PendingRename>
): ChatThread[] {
   if (pending.size === 0) return threads;
   return threads.map((thread) => {
      const next = pending.get(thread.id);
      return next === undefined ? thread : { ...thread, topic: next.topic };
   });
}

/**
 * Conversations with an agent, and the tasks they become.
 *
 * Sending never blocks: a message is queued as a task on the conversation's
 * agent, and the reply is appended when that task ends. The open conversation
 * lives in the URL, so a conversation can be linked to and comes back on a
 * reload — including from the agent pages, which link here with `?agent=`.
 */
export function Chat() {
   const t = useTranslations('agentsChat.chat');
   const router = useRouter();
   const pathname = usePathname();
   const searchParams = useSearchParams();
   const workspaceId = useSessionStore((state) => state.workspace?.id);

   const [agents, setAgents] = useState<Agent[]>([]);
   const [threads, setThreads] = useState<ChatThread[]>([]);
   const [loaded, setLoaded] = useState(false);
   const [active, setActive] = useState<ChatThread | null>(null);
   const [messages, setMessages] = useState<ChatMessage[]>([]);
   const [hasEarlier, setHasEarlier] = useState(false);
   const [loadingEarlier, setLoadingEarlier] = useState(false);
   const [tasks, setTasks] = useState<ChatTask[]>([]);
   // The run a send just queued, until its reply is stored: the stream attaches
   // to it at once instead of waiting for a poll to catch it running, which on
   // a first message (a cold session) it often never did.
   const [sent, setSent] = useState<{ conversationId: string; runId: string } | null>(null);
   const [suggestions, setSuggestions] = useState<ChatSuggestion[]>([]);

   const [composer, setComposer] = useState('');
   const [sending, setSending] = useState(false);
   const [error, setError] = useState<string | null>(null);
   const [forbidden, setForbidden] = useState(false);
   const [offline, setOffline] = useState(false);
   const [renaming, setRenaming] = useState(false);
   const [title, setTitle] = useState('');
   const [deleting, setDeleting] = useState(false);

   const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
   const pendingRenames = useRef(new Map<string, PendingRename>());
   // A list response that started earlier must not paint over a newer one.
   const threadsEpoch = useRef(0);
   const activeId = active?.id ?? null;
   const activeAgent = active?.agentId ? agents.find((a) => a.id === active.agentId) : undefined;

   const setChatUnread = useShellStore((state) => state.setChatUnread);
   const refreshThreads = useCallback(async () => {
      const epoch = ++threadsEpoch.current;
      const found = withPendingTopics(await listThreads(), pendingRenames.current);
      if (epoch === threadsEpoch.current) {
         setThreads(found);
         setChatUnread(unreadAcrossThreads(found));
      }
      return found;
   }, [setChatUnread]);

   /** Writes one conversation's title into the open pane and the list. */
   const writeTopic = useCallback((id: string, topic: string) => {
      const withTopic = (list: ChatThread[]) =>
         list.map((thread) => (thread.id === id ? { ...thread, topic } : thread));
      setThreads(withTopic);
      setActive((current) => (current?.id === id ? { ...current, topic } : current));
   }, []);

   /**
    * Shows the new title at once and puts the previous one back if the server
    * refuses it. A second rename of the same conversation replaces the first;
    * a refresh while either is in flight keeps the title on screen.
    */
   const commitRename = useCallback(
      (id: string, raw: string) => {
         const topic = raw.trim();
         if (!topic) return;
         const pending = pendingRenames.current.get(id);
         const shown =
            pending?.topic ??
            (active?.id === id ? active.topic : undefined) ??
            threads.find((thread) => thread.id === id)?.topic;
         if (shown === undefined || shown === topic) return;
         pendingRenames.current.set(id, { topic, baseline: pending?.baseline ?? shown });
         writeTopic(id, topic);
         void renameSession(id, topic).then(
            () => {
               const current = pendingRenames.current.get(id);
               if (!current) return;
               if (current.topic !== topic) {
                  pendingRenames.current.set(id, { topic: current.topic, baseline: topic });
                  return;
               }
               // Drop the pending title only after this refresh has been applied,
               // so an older response still in flight cannot restore the old name.
               const settle = () => {
                  const still = pendingRenames.current.get(id);
                  if (still?.topic === topic) pendingRenames.current.delete(id);
               };
               void refreshThreads().then(settle, settle);
            },
            (cause: unknown) => {
               const current = pendingRenames.current.get(id);
               if (!current || current.topic !== topic) return;
               pendingRenames.current.delete(id);
               writeTopic(id, current.baseline);
               toast.error(cause instanceof BerryApiError ? cause.message : t('rowFailed'));
            }
         );
      },
      [active, refreshThreads, t, threads, writeTopic]
   );

   /** Re-reads the open conversation's newest page and its queue. */
   const refreshSession = useCallback(async (id: string) => {
      const [page, queue] = await Promise.all([
         listMessages(id),
         listSessionTasks(id).catch(() => [] as ChatTask[]),
      ]);
      setMessages((current) => {
         const oldestNew = page[0]?.createdAt;
         const kept = oldestNew ? current.filter((message) => message.createdAt < oldestNew) : [];
         return [...kept, ...page];
      });
      setTasks(queue);
   }, []);

   const select = useCallback(
      async (thread: ChatThread) => {
         setActive(thread);
         setTitle(thread.topic);
         setError(null);
         setForbidden(false);
         setMessages([]);
         setTasks([]);
         setSuggestions([]);
         setComposer(thread.draft ?? '');
         try {
            const page = await listMessages(thread.id);
            setMessages(page);
            setHasEarlier(page.length === PAGE);
            setTasks(await listSessionTasks(thread.id).catch(() => []));
            await markSessionRead(thread.id).catch(() => undefined);
            void refreshThreads().catch(() => undefined);
         } catch (cause) {
            setError(cause instanceof Error ? cause.message : t('rowFailed'));
         }
      },
      [refreshThreads, t]
   );

   /** Puts the open conversation (and its agent) in the URL. */
   const show = useCallback(
      (thread: ChatThread | null) => {
         const params = new URLSearchParams(searchParams?.toString() ?? '');
         if (thread) {
            params.set('session', thread.id);
            if (thread.agentId) params.set('agent', thread.agentId);
            else params.delete('agent');
         } else {
            params.delete('session');
            params.delete('agent');
         }
         const next = params.toString();
         if (next !== (searchParams?.toString() ?? '')) {
            router.replace(next ? `${pathname}?${next}` : pathname, { scroll: false });
         }
      },
      [pathname, router, searchParams]
   );

   // Suggestions follow the conversation: asked for when it opens and after
   // each agent reply, never on the person's own message, which the agent has
   // not answered yet. The server caches them per latest message.
   const suggestIn = active?.agentId ? active.id : null;
   const lastMessage = messages.at(-1);
   const suggestFor = !suggestIn
      ? null
      : !lastMessage
        ? `${suggestIn}:`
        : lastMessage.authorType === 'agent' || messages.length === 1
          ? `${suggestIn}:${lastMessage.id}`
          : null;
   useEffect(() => {
      if (!suggestIn || !suggestFor) {
         setSuggestions([]);
         return;
      }
      let cancelled = false;
      void listConversationSuggestions(suggestIn).then(
         (next) => {
            if (!cancelled) setSuggestions(next);
         },
         () => undefined
      );
      return () => {
         cancelled = true;
      };
   }, [suggestIn, suggestFor]);

   useEffect(() => {
      let cancelled = false;
      void (async () => {
         try {
            const [loadedAgents, loadedThreads] = await Promise.all([
               loadWorkspaceAgents(),
               listThreads(),
            ]);
            if (cancelled) return;
            setAgents(loadedAgents.filter((agent) => !agent.archivedAt));
            setThreads(withPendingTopics(loadedThreads, pendingRenames.current));
         } catch (cause) {
            if (!cancelled) setError(cause instanceof Error ? cause.message : t('rowFailed'));
         } finally {
            if (!cancelled) setLoaded(true);
         }
      })();
      return () => {
         cancelled = true;
      };
   }, [t]);

   // The URL is the source of truth for which conversation is open: a link
   // with `?session=`, and `?agent=` from anywhere that knows an agent but not
   // a conversation, both land here. With neither, this page talks to the
   // Orchestrator — the person does not pick an agent first.
   const requestedSession = searchParams?.get('session') ?? null;
   const requestedAgent = searchParams?.get('agent') ?? null;
   useEffect(() => {
      if (requestedSession && requestedSession !== activeId) {
         let cancelled = false;
         void refreshThreads()
            .then(async (found) => {
               if (cancelled) return;
               const thread =
                  found.find((entry) => entry.id === requestedSession) ??
                  (await listThreads({ archived: true }).catch(() => []))?.find(
                     (entry) => entry.id === requestedSession
                  );
               if (thread) await select(thread);
            })
            .catch(() => undefined);
         return () => {
            cancelled = true;
         };
      }
      if (!requestedSession && requestedAgent && active?.agentId !== requestedAgent) {
         let cancelled = false;
         void openAgentThread(requestedAgent)
            .then(async (id) => {
               if (cancelled) return;
               const found = await refreshThreads();
               const thread = found.find((entry) => entry.id === id);
               if (thread) {
                  await select(thread);
                  show(thread);
               }
            })
            .catch((cause: unknown) => {
               if (!cancelled) {
                  setError(cause instanceof Error ? cause.message : t('rowFailed'));
               }
            });
         return () => {
            cancelled = true;
         };
      }
      if (loaded && !requestedSession && !requestedAgent && !activeId) {
         const home = agents.find((agent) => isOrchestrator(agent)) ?? agents[0];
         if (!home) return;
         let cancelled = false;
         void openAgentThread(home.id)
            .then(async (id) => {
               if (cancelled) return;
               const found = await refreshThreads();
               const thread = found.find((entry) => entry.id === id);
               if (thread) {
                  await select(thread);
                  show(thread);
               }
            })
            .catch((cause: unknown) => {
               if (!cancelled) {
                  setError(cause instanceof Error ? cause.message : t('rowFailed'));
               }
            });
         return () => {
            cancelled = true;
         };
      }
   }, [
      loaded,
      agents,
      requestedSession,
      requestedAgent,
      activeId,
      active?.agentId,
      refreshThreads,
      select,
      show,
      t,
   ]);

   // Replies land when a task ends: re-read on run events, and poll while work
   // is waiting in case the event relay is not delivering.
   useEffect(() => {
      if (!activeId) return;
      return subscribeWorkspaceEvents((event) => {
         // Another conversation's reply is not this one's news.
         const conversation =
            typeof event.payload === 'object' && event.payload !== null
               ? (event.payload as { conversationId?: unknown }).conversationId
               : undefined;
         if (typeof conversation === 'string' && conversation !== activeId) return;
         if (event.type.startsWith('run.') || event.type.startsWith('conversation.')) {
            void refreshSession(activeId).catch(() => undefined);
            void refreshThreads().catch(() => undefined);
         }
      });
   }, [activeId, refreshSession, refreshThreads]);

   useEffect(() => {
      if (!activeId || (tasks.length === 0 && sent === null)) return;
      const timer = setInterval(() => {
         void refreshSession(activeId).catch(() => undefined);
      }, 5000);
      return () => clearInterval(timer);
   }, [activeId, tasks.length, sent, refreshSession]);

   useEffect(() => {
      const sync = () => setOffline(!navigator.onLine);
      sync();
      window.addEventListener('online', sync);
      window.addEventListener('offline', sync);
      return () => {
         window.removeEventListener('online', sync);
         window.removeEventListener('offline', sync);
      };
   }, []);

   // The running reply, streamed as it is written rather than waiting for the
   // run to end and the stored message to be refetched.
   // The chat's own replies, and the work its agent started from them.
   const ownTasks = tasks.filter((task) => !task.delegated);
   const delegatedTasks = tasks.filter((task) => task.delegated);
   // The reply being written: the running one, else the next queued one, else
   // the run just sent — so the stream is open from the first event, and the
   // reader sees the agent working rather than only its final answer.
   const sentRunId = sent !== null && sent.conversationId === activeId ? sent.runId : null;
   const replied = sentRunId !== null && messages.some((message) => message.runId === sentRunId);
   useEffect(() => {
      if (replied) setSent(null);
   }, [replied]);
   const replyRun =
      ownTasks.find((task) => task.status === 'running')?.id ??
      ownTasks[0]?.id ??
      (replied ? null : sentRunId);
   const { text: streamingText, stage: streamStage } = useChatReplyStream({
      conversationId: activeId,
      runId: replyRun,
      messages,
      labels: {
         running: t('msgStageRunning'),
         writing: t('msgStageWriting'),
         thinking: t('msgStageThinking'),
      },
   });

   /**
    * The wait, said once, under the last message.
    *
    * The stream's own stage is the better answer, but it exists only once a task
    * is running and the stream is open. Before that there is the send itself and
    * then a queued task the 5s poll has yet to see, and those two gaps are
    * exactly when a reader most needs to be told something is happening — so
    * they say "thinking" too. Whether the dispatcher has claimed the task yet is
    * Berry's business, not a distinction the reader is waiting on.
    *
    * Both conditions end on their own, so a send that failed stops the animation
    * instead of leaving it breathing over an unanswered message.
    */
   const stage =
      streamStage ?? (sending || ownTasks.length > 0 || replyRun ? t('msgStageThinking') : null);

   const changeComposer = (value: string) => {
      setComposer(value);
      if (!activeId) return;
      if (draftTimer.current) clearTimeout(draftTimer.current);
      const id = activeId;
      draftTimer.current = setTimeout(() => {
         void saveDraft(id, value).catch(() => undefined);
      }, 600);
   };

   const loadEarlier = async () => {
      if (!activeId || messages.length === 0 || loadingEarlier) return;
      setLoadingEarlier(true);
      try {
         const older = await listMessages(activeId, messages[0]?.id);
         setHasEarlier(older.length === PAGE);
         setMessages((current) => [...older, ...current]);
      } finally {
         setLoadingEarlier(false);
      }
   };

   const send = async () => {
      const text = composer.trim();
      if (!text || !activeId || sending) return;
      if (draftTimer.current) clearTimeout(draftTimer.current);
      setSending(true);
      setError(null);
      setComposer('');
      try {
         const prefs = useUiPrefsStore.getState();
         const queued = await sendMessage(activeId, text, prefs.chatMode, chatRepositoryToSend());
         setSent({ conversationId: activeId, runId: queued.runId });
      } catch (cause) {
         if (cause instanceof BerryApiError && cause.status === 403) setForbidden(true);
         setError(
            cause instanceof BerryApiError && cause.code === 'AGENT_TASKS_UNAVAILABLE'
               ? t('bannerNoRuntime')
               : cause instanceof Error
                 ? cause.message
                 : t('rowFailed')
         );
      } finally {
         // Refresh first, then release `sending`. The other way round leaves one
         // render where the send is over and the queued task is not back yet,
         // which blinks the thinking animation off and on again.
         await refreshSession(activeId).catch(() => undefined);
         setSending(false);
         void refreshThreads().catch(() => undefined);
      }
   };

   /** Stops the reply being written, without a confirmation. */
   const stopReply = async (runId: string) => {
      if (!activeId) return;
      try {
         await cancelSessionTask(activeId, runId);
      } catch (cause) {
         toast.error(cause instanceof BerryApiError ? cause.message : t('rowFailed'));
         return;
      }
      await refreshThreads().catch(() => undefined);
      await refreshSession(activeId).catch(() => undefined);
   };

   /** Runs once the delete is confirmed; a failure keeps the dialog open. */
   const confirmDelete = async () => {
      if (!active) return;
      try {
         await deleteSession(active.id);
      } catch (cause) {
         toast.error(cause instanceof BerryApiError ? cause.message : t('rowFailed'));
         throw cause;
      }
      setActive(null);
      show(null);
      await refreshThreads().catch(() => undefined);
   };

   const agentName = active?.agentName ?? null;
   // A conversation that is still called after its agent has no second name
   // to show; the header would read "Frontend Engineer Frontend Engineer".
   const topicIsAgentName =
      agentName !== null &&
      active !== null &&
      active.topic.trim().toLowerCase() === agentName.trim().toLowerCase();

   const banner = offline
      ? t('bannerOffline')
      : agents.length === 0
        ? t('bannerNoAgents')
        : forbidden
          ? t('bannerNoPermission')
          : active?.archived
            ? t('bannerArchived')
            : null;

   return (
      <div className="flex h-full min-h-0 flex-col bg-[var(--shell-canvas)] text-[var(--shell-text)]">
         <h1 className="sr-only">{t('title')}</h1>
         <section className="flex min-h-0 min-w-0 flex-1 flex-col">
            {/* The rail already says Agent; a renamed topic is the only title. */}
            {active ? (
               <header className="flex flex-none items-center gap-3 px-6 py-3">
                  {renaming ? (
                     <input
                        autoFocus
                        value={title}
                        aria-label={t('rename')}
                        onChange={(event) => setTitle(event.target.value)}
                        onBlur={() => setRenaming(false)}
                        onKeyDown={(event) => {
                           if (event.key === 'Escape') {
                              setRenaming(false);
                              setTitle(active.topic);
                           }
                           if (event.key === 'Enter' && title.trim()) {
                              setRenaming(false);
                              commitRename(active.id, title);
                           }
                        }}
                        className="min-w-0 flex-1 rounded border border-transparent bg-[var(--shell-surface)] px-2 py-1 text-[var(--shell-text)] outline-none focus-visible:border-ring"
                     />
                  ) : agentName && !topicIsAgentName ? (
                     // The conversation's own name, one step back from the
                     // agent's; the click is how it is renamed in place.
                     <button
                        type="button"
                        onClick={() => {
                           setTitle(active.topic);
                           setRenaming(true);
                        }}
                        title={t('rename')}
                        className="min-w-0 flex-1 truncate rounded text-left text-[var(--shell-text-dim)] transition-colors hover:text-[var(--shell-text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
                     >
                        {active.topic}
                     </button>
                  ) : (
                     <span className="min-w-0 flex-1" aria-hidden />
                  )}

                  {active.pinned ? (
                     <Pin
                        className="size-3.5 flex-none fill-current text-[var(--shell-text-dim)]"
                        aria-label={t('pin')}
                     />
                  ) : null}

                  <DropdownMenu>
                     <DropdownMenuTrigger asChild>
                        <button
                           type="button"
                           aria-label={t('headerMenu')}
                           className="flex size-8 flex-none items-center justify-center rounded text-[var(--shell-text-dim)] transition-colors hover:bg-[var(--shell-hover)] hover:text-[var(--shell-text)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ring)] max-lg:size-11"
                        >
                           <MoreHorizontal className="size-4" />
                        </button>
                     </DropdownMenuTrigger>
                     <DropdownMenuContent align="end">
                        <DropdownMenuItem
                           onSelect={() => {
                              setTitle(active.topic);
                              setRenaming(true);
                           }}
                        >
                           {t('rename')}
                        </DropdownMenuItem>
                        <DropdownMenuItem
                           onSelect={() =>
                              void setSessionArchived(active.id, !active.archived)
                                 .then(() => {
                                    setActive(null);
                                    show(null);
                                    return refreshThreads();
                                 })
                                 .catch(() => undefined)
                           }
                        >
                           {active.archived ? t('unarchive') : t('archive')}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                           className="text-destructive focus:text-destructive"
                           onSelect={() => setDeleting(true)}
                        >
                           {t('delete')}
                        </DropdownMenuItem>
                     </DropdownMenuContent>
                  </DropdownMenu>
               </header>
            ) : null}

            {active ? (
               <ConfirmAction
                  open={deleting}
                  onOpenChange={setDeleting}
                  title={t('deleteTitle', { name: active.topic })}
                  description={t('deleteBody')}
                  confirmLabel={t('delete')}
                  pendingLabel={t('deleting')}
                  destructive
                  onConfirm={confirmDelete}
               />
            ) : null}

            {banner ? (
               <p className="flex-none border-b border-[var(--shell-line)] bg-[var(--shell-surface)] px-6 py-2 text-[var(--shell-text-muted)]">
                  {banner}
               </p>
            ) : null}

            <ThreadView
               messages={messages}
               agentName={agentName}
               starters={activeAgent?.conversationStarters ?? []}
               suggestions={suggestions}
               onUseSuggestion={changeComposer}
               hasEarlier={hasEarlier}
               loadingEarlier={loadingEarlier}
               onLoadEarlier={() => void loadEarlier()}
               stage={stage}
               streamingText={streamingText}
            />

            {error ? (
               <p
                  role="alert"
                  className="mx-auto w-full max-w-3xl flex-none px-6 pb-2 text-primary"
               >
                  {error}
               </p>
            ) : null}

            {activeId ? (
               <div className="mx-auto w-full max-w-3xl">
                  <ChatDelegatedWork tasks={delegatedTasks} />
                  <ChatQueue
                     conversationId={activeId}
                     tasks={ownTasks}
                     onChanged={() => void refreshSession(activeId).catch(() => undefined)}
                  />
               </div>
            ) : null}

            <ChatComposer
               value={composer}
               onChange={changeComposer}
               onSend={() => void send()}
               onStop={active && replyRun ? () => void stopReply(replyRun) : null}
               queueing={ownTasks.length > 0}
               disabled={!activeId || sending}
               workspaceId={workspaceId}
               chatOpen={Boolean(activeId)}
               {...(activeId ? { conversationId: activeId } : {})}
               {...(activeAgent ? { agent: activeAgent } : {})}
               answering={stage !== null}
            />
         </section>
      </div>
   );
}
