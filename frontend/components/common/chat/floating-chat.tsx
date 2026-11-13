'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { usePathname } from 'next/navigation';
import { Info, Maximize2, Minus, Minimize2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { BerryApiError } from '@/lib/api';
import { isOrchestrator, loadWorkspaceAgents, type Agent } from '@/lib/agents';
import {
   cancelSessionTask,
   listMessages,
   listSessionTasks,
   listThreads,
   markSessionRead,
   openAgentThread,
   sendMessage,
   type ChatMessage,
   type ChatTask,
   type ChatThread,
} from '@/lib/chat';
import { useShortcut } from '@/components/layout/shortcut-provider';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatCombo } from '@/lib/shortcuts';
import { useShortcutBindings } from '@/store/shortcuts-store';
import { subscribeWorkspaceEvents } from '@/lib/events';
import { useSessionStore } from '@/store/session-store';
import { useShellStore } from '@/store/shell-store';
import { useUiPrefsStore } from '@/store/ui-prefs-store';
import { toast } from 'sonner';
import { ChatComposer } from './chat-composer';
import { chatRepositoryToSend } from './chat-repository-select';
import { ChatThread as ThreadView } from './chat-thread';
import { useChatReplyStream } from '@/hooks/use-chat-reply-stream';

const SIZE_KEY = 'berry.floating-chat.size';
const MIN_WIDTH = 320;
const MIN_HEIGHT = 320;

/** The header's controls: small beside the title, a full tap target on a phone. */
const headerControl =
   'flex flex-none items-center justify-center rounded text-[var(--shell-text-dim)] transition-colors hover:text-[var(--shell-text)] focus-visible:outline-2 focus-visible:outline-[var(--ring)] max-sm:size-11 sm:p-1';

/**
 * An info mark beside minimise that names the keys opening this window from
 * anywhere. It used to be the Agents button's tooltip; here it is where the
 * window is. Nothing shows when the shortcut is switched off. The keys are
 * filled in after mount: `mod` reads differently per platform.
 */
function ShortcutInfo() {
   const t = useTranslations('shell');
   const combo = useShortcutBindings()['chat.toggleFloating'];
   const [keys, setKeys] = useState<string | null>(null);
   useEffect(() => {
      setKeys(combo ? formatCombo(combo) : null);
   }, [combo]);
   if (!keys) return null;
   const hint = t('chat.shortcutHint', { keys });
   return (
      <Tooltip>
         <TooltipTrigger asChild>
            <button type="button" aria-label={hint} className={headerControl}>
               <Info className="size-3.5" aria-hidden />
            </button>
         </TooltipTrigger>
         <TooltipContent side="bottom" className="z-[60]">
            {hint}
         </TooltipContent>
      </Tooltip>
   );
}

/**
 * Chat without leaving the page.
 *
 * The point of this window is that the conversation is *next to* the work
 * rather than instead of it, so it deliberately does not try to be the chat
 * page: no queue panel, no archive, no session management. Anything beyond
 * saying something to an agent belongs on `/chat`.
 *
 * It opens from the Agents button (`ShellChatButton`) and from mod+J; both go
 * through the shell store. Closed, it renders nothing. Opening always lands on
 * the Orchestrator thread — no agent picker, no history menu.
 */
export function FloatingChat() {
   const t = useTranslations('agentsChat.floating');
   const chat = useTranslations('agentsChat.chat');
   const common = useTranslations('agentsChat.common');
   const pathname = usePathname() ?? '';
   const workspaceId = useSessionStore((state) => state.workspace?.id);

   const state = useShellStore((store) => store.chatWindow);
   const setState = useShellStore((store) => store.setChatWindow);
   const toggleChat = useShellStore((store) => store.toggleChat);
   const [size, setSize] = useState({ width: 380, height: 520 });
   const [agents, setAgents] = useState<Agent[]>([]);
   const [agentsLoaded, setAgentsLoaded] = useState(false);
   const [active, setActive] = useState<ChatThread | null>(null);
   const [messages, setMessages] = useState<ChatMessage[]>([]);
   const [tasks, setTasks] = useState<ChatTask[]>([]);
   // The run a send just queued, followed until its reply is stored (see chat.tsx).
   const [sent, setSent] = useState<{ conversationId: string; runId: string } | null>(null);
   const [composer, setComposer] = useState('');
   const [sending, setSending] = useState(false);
   const [opening, setOpening] = useState<string | null>(null);
   // The same live reply the chat page shows, so the two surfaces agree.
   const ownTasks = tasks.filter((task) => !task.delegated);
   const sentRunId = sent !== null && sent.conversationId === active?.id ? sent.runId : null;
   const replied = sentRunId !== null && messages.some((message) => message.runId === sentRunId);
   useEffect(() => {
      if (replied) setSent(null);
   }, [replied]);
   const replyRun =
      ownTasks.find((task) => task.status === 'running')?.id ??
      ownTasks[0]?.id ??
      (replied ? null : sentRunId);
   const { text: streamingText, stage: streamStage } = useChatReplyStream({
      conversationId: active?.id ?? null,
      runId: replyRun,
      messages,
      labels: {
         running: chat('msgStageRunning'),
         writing: chat('msgStageWriting'),
         thinking: chat('msgStageThinking'),
      },
   });
   const resizing = useRef<{ x: number; y: number; width: number; height: number } | null>(null);
   const wasOpened = useRef(false);

   // The chat page is the full version of this; two of them on one screen
   // would be two places to type the same message.
   // Preferences → General turns the window off entirely; the chat page is
   // this window's full-size counterpart, so it never floats over itself.
   const floatingEnabled = useUiPrefsStore((store) => store.floatingChat);
   const hidden = pathname.includes('/chat') || !floatingEnabled;

   useEffect(() => {
      try {
         const stored = localStorage.getItem(SIZE_KEY);
         if (stored) {
            const parsed = JSON.parse(stored) as { width?: number; height?: number };
            setSize({
               width: Math.max(MIN_WIDTH, Number(parsed.width) || 380),
               height: Math.max(MIN_HEIGHT, Number(parsed.height) || 520),
            });
         }
      } catch {
         /* A size that cannot be read is simply the default size. */
      }
   }, []);

   // The shell's registry owns the combination, so it is rebindable in
   // settings and appears there with everything else. This claims the action.
   useShortcut('chat.toggleFloating', toggleChat);

   const opened = state !== 'closed' && !hidden;

   useEffect(() => {
      if (!opened || agentsLoaded) return;
      void loadWorkspaceAgents()
         .then((found) => setAgents(found.filter((agent) => !agent.archivedAt)))
         .catch(() => undefined)
         .finally(() => setAgentsLoaded(true));
   }, [opened, agentsLoaded]);

   const openThread = useCallback(async (thread: ChatThread) => {
      setActive(thread);
      setComposer(thread.draft ?? '');
      setMessages(await listMessages(thread.id).catch(() => []));
      setTasks(await listSessionTasks(thread.id).catch(() => []));
      await markSessionRead(thread.id).catch(() => undefined);
   }, []);

   const withAgent = useCallback(
      async (agent: Agent) => {
         setOpening(agent.id);
         try {
            const id = await openAgentThread(agent.id);
            const found = await listThreads();
            const thread = found.find((entry) => entry.id === id);
            if (thread) await openThread(thread);
         } catch {
            /* Reported by the page's own chat; a floating window stays quiet. */
         } finally {
            setOpening(null);
         }
      },
      [openThread]
   );

   const orchestrator = agents.find((agent) => isOrchestrator(agent));

   // Agents button / shortcut: land on Orchestrator, not a roster.
   useEffect(() => {
      if (!opened) {
         wasOpened.current = false;
         return;
      }
      if (!agentsLoaded || opening !== null) return;
      const justOpened = !wasOpened.current;
      wasOpened.current = true;
      if (!justOpened) return;
      if (!orchestrator) return;
      if (active?.agentId === orchestrator.id) return;
      void withAgent(orchestrator);
   }, [opened, agentsLoaded, opening, active, orchestrator, withAgent]);

   const activeId = active?.id ?? null;
   const activeAgent = active?.agentId
      ? agents.find((agent) => agent.id === active.agentId)
      : undefined;

   const refresh = useCallback(async (id: string) => {
      const [page, queue] = await Promise.all([
         listMessages(id).catch(() => null),
         listSessionTasks(id).catch(() => null),
      ]);
      if (page) setMessages(page);
      if (queue) setTasks(queue);
   }, []);

   useEffect(() => {
      if (!opened || !activeId) return;
      return subscribeWorkspaceEvents((event) => {
         if (!event.type.startsWith('run.') && !event.type.startsWith('conversation.')) return;
         const conversation =
            typeof event.payload === 'object' && event.payload !== null
               ? (event.payload as { conversationId?: unknown }).conversationId
               : undefined;
         if (typeof conversation === 'string' && conversation !== activeId) return;
         void refresh(activeId);
      });
   }, [opened, activeId, refresh]);

   /**
    * A net under the subscription above: a chat run has no board, so its run
    * events never reach the workspace stream, and only the stored reply
    * (`conversation.message.created`) does. The poll keeps the queue and the
    * work the agent started current while any of it is open, and stops once it
    * drains.
    */
   useEffect(() => {
      if (!opened || !activeId || (tasks.length === 0 && sent === null)) return;
      const timer = setInterval(() => void refresh(activeId), 3000);
      return () => clearInterval(timer);
   }, [opened, activeId, tasks.length, sent, refresh]);

   /**
    * The wait, said under the last message — the same rule as the chat page.
    *
    * The stream's own stage is the better answer, but it exists only once a task
    * is running and the stream is open. Before that there is the send itself and
    * then a queued task the poll above has yet to see, and those two gaps used to
    * render nothing at all, so a sent message was indistinguishable from one that
    * went nowhere. Queued or running, the word is "thinking": whether the
    * dispatcher has claimed the task yet is Berry's business, not a distinction
    * the reader is waiting on.
    *
    * Both conditions end on their own, so a send that failed stops the animation
    * rather than leaving it breathing over an unanswered message.
    */
   const stage =
      streamStage ?? (sending || ownTasks.length > 0 || replyRun ? chat('msgStageThinking') : null);

   const send = async () => {
      const text = composer.trim();
      if (!text || !activeId || sending) return;
      setSending(true);
      setComposer('');
      try {
         const prefs = useUiPrefsStore.getState();
         const queued = await sendMessage(activeId, text, prefs.chatMode, chatRepositoryToSend());
         setSent({ conversationId: activeId, runId: queued.runId });
      } catch {
         /* The reply that never comes is the report. */
      } finally {
         // Through `refresh` so a failed queue read keeps whatever was there:
         // clearing it to [] would stop the poll above before the reply landed.
         // It runs before `sending` is released, or there is one render with the
         // send finished and the task not yet back — a blink in the animation.
         await refresh(activeId);
         setSending(false);
      }
   };

   const stopReply = async (runId: string) => {
      if (!activeId) return;
      try {
         await cancelSessionTask(activeId, runId);
      } catch (cause) {
         toast.error(cause instanceof BerryApiError ? cause.message : chat('rowFailed'));
         return;
      }
      await refresh(activeId);
   };

   const onResize = (event: React.PointerEvent<HTMLButtonElement>) => {
      resizing.current = { x: event.clientX, y: event.clientY, ...size };
      const move = (moveEvent: PointerEvent) => {
         const from = resizing.current;
         if (!from) return;
         // The window grows up and to the left, because it is anchored to the
         // bottom-right corner of the viewport.
         setSize({
            width: Math.max(MIN_WIDTH, from.width + (from.x - moveEvent.clientX)),
            height: Math.max(MIN_HEIGHT, from.height + (from.y - moveEvent.clientY)),
         });
      };
      const done = () => {
         resizing.current = null;
         window.removeEventListener('pointermove', move);
         window.removeEventListener('pointerup', done);
         try {
            localStorage.setItem(SIZE_KEY, JSON.stringify(size));
         } catch {
            /* Not being able to remember the size is not a failure worth reporting. */
         }
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', done);
   };

   // Closed is nothing at all: the strip's chat button is the launcher, and a
   // page's bottom action bar gets its corner back.
   if (hidden) return null;
   if (state === 'closed') return null;

   const expanded = state === 'expanded';
   const minimised = state === 'minimised';

   // The remembered size, clamped so the window never rises over the tab
   // strip: `--shell-strip` is the strip's height, set by the shell.
   const sizeVars = {
      '--chat-w': `min(${size.width}px, calc(100vw - 2rem))`,
      '--chat-h': `min(${size.height}px, calc(100dvh - var(--shell-strip) - 5rem))`,
   } as CSSProperties;

   return (
      <div
         // Below `sm` the window fills the screen under the strip: a 380px
         // panel on a phone is the whole screen anyway, and keeping the strip
         // keeps the button that closes it.
         data-step-body="prose"
         className={[
            'fixed z-40 flex flex-col overflow-hidden border border-[var(--shell-line)] bg-[var(--shell-canvas)] text-[var(--shell-text)] shadow-lg',
            // The bottom edge clears the Agents launcher, which is what
            // opens this window: `--shell-launcher-clear` is that control's
            // corner plus its height plus a gap, so the button stays visible
            // under the panel instead of sitting on top of it.
            'inset-x-0 top-[var(--shell-strip)] bottom-0 sm:inset-auto sm:right-[calc(var(--app-inset-r)+0.75rem+4px)] sm:bottom-[var(--shell-launcher-clear)] sm:rounded-lg',
            expanded
               ? 'sm:inset-4 sm:top-[calc(var(--shell-strip)_+_1rem)] sm:bottom-[var(--shell-launcher-clear)]'
               : minimised
                 ? 'sm:w-[var(--chat-w)]'
                 : 'sm:h-[var(--chat-h)] sm:w-[var(--chat-w)]',
         ].join(' ')}
         style={sizeVars}
      >
         <header className="flex flex-none items-center gap-2 border-b border-[var(--shell-line)] px-3 py-2">
            {!expanded && !minimised ? (
               <button
                  type="button"
                  onPointerDown={onResize}
                  aria-label={t('expand')}
                  className="hidden size-4 flex-none cursor-nwse-resize text-[var(--shell-text-dim)] sm:block"
               >
                  <Minimize2 className="size-3.5 rotate-90" aria-hidden />
               </button>
            ) : null}
            <div className="ml-auto flex items-center gap-2">
               <ShortcutInfo />
               <button
                  type="button"
                  aria-label={minimised ? t('restore') : t('minimise')}
                  onClick={() => setState(minimised ? 'open' : 'minimised')}
                  className={headerControl}
               >
                  <Minus className="size-3.5" />
               </button>
               <button
                  type="button"
                  aria-label={expanded ? t('restore') : t('expand')}
                  onClick={() => setState(expanded ? 'open' : 'expanded')}
                  className={`hidden sm:flex ${headerControl}`}
               >
                  <Maximize2 className="size-3.5" />
               </button>
               <button
                  type="button"
                  aria-label={t('close')}
                  onClick={() => setState('closed')}
                  className={headerControl}
               >
                  <X className="size-3.5" />
               </button>
            </div>
         </header>

         {minimised ? null : active ? (
            <>
               <ThreadView
                  messages={messages}
                  agentName={active.agentName ?? null}
                  starters={[]}
                  suggestions={[]}
                  onUseSuggestion={setComposer}
                  hasEarlier={false}
                  loadingEarlier={false}
                  onLoadEarlier={() => undefined}
                  stage={stage}
                  streamingText={streamingText}
               />
               {/* The composer is shared with the chat page, where its send
                   button is that page's primary action. Here the window sits
                   over a page that already has one, so the button is dressed
                   as a secondary control. */}
               <ChatComposer
                  value={composer}
                  onChange={setComposer}
                  onSend={() => void send()}
                  onStop={replyRun ? () => void stopReply(replyRun) : null}
                  queueing={tasks.length > 0}
                  disabled={sending}
                  workspaceId={workspaceId}
                  sendVariant="secondary"
                  conversationId={active.id}
                  {...(activeAgent ? { agent: activeAgent } : {})}
                  answering={stage !== null}
               />
            </>
         ) : (
            <div
               className="flex min-h-0 flex-1 items-center justify-center px-3"
               aria-busy={opening !== null || !agentsLoaded}
            >
               {!agentsLoaded || opening !== null ? (
                  <p className="text-[var(--shell-text-dim)]">{common('loading')}</p>
               ) : (
                  <p className="text-[var(--shell-text-muted)]">{t('pickEmpty')}</p>
               )}
            </div>
         )}
      </div>
   );
}
