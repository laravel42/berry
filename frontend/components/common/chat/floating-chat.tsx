'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import Link from 'next/link';
import { usePathname, useParams } from 'next/navigation';
import { ChevronDown, Maximize2, Minus, Minimize2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { BerryMark } from '@/components/brand/berry-mark';
import { colorForAgent } from '@/lib/agent-color';
import {
   DropdownMenu,
   DropdownMenuContent,
   DropdownMenuItem,
   DropdownMenuLabel,
   DropdownMenuSeparator,
   DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { loadWorkspaceAgents, useAgentAvatarSrc, type Agent } from '@/lib/agents';
import {
   getPinnedAgents,
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
import { subscribeWorkspaceEvents } from '@/lib/events';
import { useSessionStore } from '@/store/session-store';
import { useShellStore } from '@/store/shell-store';
import { useUiPrefsStore } from '@/store/ui-prefs-store';
import { ChatComposer } from './chat-composer';
import { ChatThread as ThreadView } from './chat-thread';
import { useChatReplyStream } from '@/hooks/use-chat-reply-stream';

const SIZE_KEY = 'berry.floating-chat.size';
const MIN_WIDTH = 320;
const MIN_HEIGHT = 320;
/** Recent agents shown before the rest of the roster. */
const MAX_RECENT = 6;

/** The header's controls: small beside the title, a full tap target on a phone. */
const headerControl =
   'flex flex-none items-center justify-center rounded text-[var(--shell-text-dim)] transition-colors hover:text-[var(--shell-text)] focus-visible:outline-2 focus-visible:outline-[var(--ring)] max-sm:size-11 sm:p-1';

/** The one agent whose job is to hand work to the others. */
const isOrchestrator = (agent: Agent) =>
   agent.capabilities.includes('orchestrate') || agent.roleKey === 'orchestrator';

/**
 * One agent to start a conversation with: who it is, what it is for, and the
 * action. The whole row is the button, so on a phone the target is the row.
 */
function AgentPickRow({ agent, onPick }: { agent: Agent; onPick: (agent: Agent) => void }) {
   const t = useTranslations('agentsChat.floating');
   const avatarSrc = useAgentAvatarSrc(agent.avatarUrl);
   const description = agent.description?.trim() || null;

   return (
      <li>
         <button
            type="button"
            onClick={() => onPick(agent)}
            aria-label={t('startChatWith', { name: agent.name })}
            className="group flex min-h-11 w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-[var(--shell-hover)] focus-visible:bg-[var(--shell-hover)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ring)]"
         >
            <span className="flex size-8 flex-none items-center justify-center overflow-hidden rounded-md bg-[var(--shell-surface)]">
               {avatarSrc ? (
                  // eslint-disable-next-line @next/next/no-img-element -- a blob or external URL, not an optimisable asset
                  <img src={avatarSrc} alt="" className="size-full object-cover" />
               ) : (
                  <BerryMark
                     size="sm"
                     tone="working"
                     dotColor={colorForAgent(agent.id)}
                     bracketClassName="text-[var(--shell-text)]"
                  />
               )}
            </span>
            <span className="min-w-0 flex-1">
               <span className="block truncate font-medium text-[var(--shell-text)]">
                  {agent.name}
               </span>
               {description ? (
                  <span
                     className="block truncate text-[var(--shell-text-muted)]"
                     title={description}
                  >
                     {description}
                  </span>
               ) : null}
            </span>
            <span
               aria-hidden
               className="flex-none rounded-md bg-[var(--shell-line)] px-2 py-1 text-[var(--shell-text-muted)] transition-colors group-hover:bg-[var(--shell-line-strong)] group-hover:text-[var(--shell-text)] group-focus-visible:bg-[var(--shell-line-strong)] group-focus-visible:text-[var(--shell-text)]"
            >
               {t('startChat')}
            </span>
         </button>
      </li>
   );
}

/**
 * Chat without leaving the page.
 *
 * The point of this window is that the conversation is *next to* the work
 * rather than instead of it, so it deliberately does not try to be the chat
 * page: no queue panel, no archive, no session management. Anything beyond
 * saying something to an agent sends the reader to `/chat`, which is one click
 * away in the header.
 *
 * It opens from the chat button in the tab strip (`ShellChatButton`) and from
 * mod+J; both go through the shell store, so the button reflects the window
 * and the window follows the button. Closed, it renders nothing: no corner
 * launcher sits over a page's own controls.
 *
 * Until a conversation is open there is no one to type to, so the window
 * opens on the question it has to answer first — who — and shows the
 * composer only once that is settled.
 */
export function FloatingChat() {
   const t = useTranslations('agentsChat.floating');
   const chat = useTranslations('agentsChat.chat');
   const common = useTranslations('agentsChat.common');
   const pathname = usePathname() ?? '';
   const { orgId } = useParams<{ orgId?: string }>();
   const workspaceId = useSessionStore((state) => state.workspace?.id);

   const state = useShellStore((store) => store.chatWindow);
   const setState = useShellStore((store) => store.setChatWindow);
   const toggleChat = useShellStore((store) => store.toggleChat);
   const [size, setSize] = useState({ width: 380, height: 520 });
   const [agents, setAgents] = useState<Agent[]>([]);
   const [agentsLoaded, setAgentsLoaded] = useState(false);
   const [pinnedIds, setPinnedIds] = useState<string[]>([]);
   const [threads, setThreads] = useState<ChatThread[]>([]);
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
      void getPinnedAgents()
         .then(setPinnedIds)
         .catch(() => undefined);
      void listThreads()
         .then(setThreads)
         .catch(() => undefined);
   }, [opened, agentsLoaded]);

   const openThread = useCallback(async (thread: ChatThread) => {
      setActive(thread);
      setComposer(thread.draft ?? '');
      setMessages(await listMessages(thread.id).catch(() => []));
      setTasks(await listSessionTasks(thread.id).catch(() => []));
      await markSessionRead(thread.id).catch(() => undefined);
   }, []);

   const withAgent = async (agent: Agent) => {
      setOpening(agent.id);
      try {
         const id = await openAgentThread(agent.id);
         const found = await listThreads();
         setThreads(found);
         const thread = found.find((entry) => entry.id === id);
         if (thread) await openThread(thread);
      } catch {
         /* Reported by the page's own chat; a floating window stays quiet. */
      } finally {
         setOpening(null);
      }
   };

   // Pinned first, then whoever was talked to most recently, then the rest of
   // the roster with the Orchestrator at the top -- the same order a person
   // would look for them in.
   const picker = useMemo(() => {
      const byId = new Map(agents.map((agent) => [agent.id, agent]));
      const taken = new Set<string>();
      const pinned = pinnedIds
         .map((id) => byId.get(id))
         .filter((agent): agent is Agent => agent !== undefined);
      for (const agent of pinned) taken.add(agent.id);
      const recent: Agent[] = [];
      for (const thread of threads
         .slice()
         .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))) {
         const agent = thread.agentId ? byId.get(thread.agentId) : undefined;
         if (!agent || taken.has(agent.id) || recent.length >= MAX_RECENT) continue;
         taken.add(agent.id);
         recent.push(agent);
      }
      const rest = agents
         .filter((agent) => !taken.has(agent.id))
         .sort(
            (left, right) =>
               Number(isOrchestrator(right)) - Number(isOrchestrator(left)) ||
               left.name.localeCompare(right.name)
         );
      return { pinned, recent, rest };
   }, [agents, pinnedIds, threads]);

   const activeId = active?.id ?? null;

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
         const queued = await sendMessage(activeId, text);
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
   if (hidden || state === 'closed') return null;

   const expanded = state === 'expanded';
   const minimised = state === 'minimised';

   // The remembered size, clamped so the window never rises over the tab
   // strip: `--shell-strip` is the strip's height, set by the shell.
   const sizeVars = {
      '--chat-w': `min(${size.width}px, calc(100vw - 2rem))`,
      '--chat-h': `min(${size.height}px, calc(100dvh - var(--shell-strip) - 5rem))`,
   } as CSSProperties;

   const group = (label: string, list: Agent[]) =>
      list.length === 0 ? null : (
         <li>
            <p
               data-heading="label"
               className="px-3 pt-3 pb-1 text-[var(--shell-text-dim)]"
               aria-hidden
            >
               {label}
            </p>
            <ul aria-label={label}>
               {list.map((agent) => (
                  <AgentPickRow
                     key={agent.id}
                     agent={agent}
                     onPick={(pick) => void withAgent(pick)}
                  />
               ))}
            </ul>
         </li>
      );

   return (
      <div
         // Below `sm` the window fills the screen under the strip: a 380px
         // panel on a phone is the whole screen anyway, and keeping the strip
         // keeps the button that closes it.
         className={[
            'fixed z-40 flex flex-col overflow-hidden border border-[var(--shell-line)] bg-[var(--shell-canvas)] text-[var(--shell-text)] shadow-lg',
            // Bottom 4rem, not 1rem: the corner buttons live under it.
            'inset-x-0 top-[var(--shell-strip)] bottom-0 sm:inset-auto sm:right-4 sm:bottom-16 sm:rounded-lg',
            expanded
               ? 'sm:inset-4 sm:top-[calc(var(--shell-strip)_+_1rem)] sm:bottom-16'
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

            <DropdownMenu>
               <DropdownMenuTrigger asChild>
                  <button
                     type="button"
                     className="flex min-h-11 min-w-0 flex-1 items-center gap-1 truncate rounded text-left text-[var(--shell-text)] focus-visible:outline-2 focus-visible:outline-[var(--ring)] sm:min-h-0"
                  >
                     <span className="truncate">{active ? active.topic : t('title')}</span>
                     <ChevronDown className="size-3.5 flex-none text-[var(--shell-text-dim)]" />
                  </button>
               </DropdownMenuTrigger>
               <DropdownMenuContent align="start" className="max-h-80 w-72 overflow-y-auto">
                  {active ? (
                     <>
                        <DropdownMenuItem onSelect={() => setActive(null)}>
                           {t('newChat')}
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                     </>
                  ) : null}
                  <DropdownMenuLabel>{t('history')}</DropdownMenuLabel>
                  {threads.length === 0 ? (
                     <DropdownMenuItem disabled>{chat('noSessions')}</DropdownMenuItem>
                  ) : (
                     threads.slice(0, 8).map((thread) => (
                        <DropdownMenuItem key={thread.id} onSelect={() => void openThread(thread)}>
                           <span className="truncate">{thread.topic}</span>
                        </DropdownMenuItem>
                     ))
                  )}
                  <DropdownMenuLabel>{t('pickAgent')}</DropdownMenuLabel>
                  {agents.length === 0 ? (
                     <DropdownMenuItem disabled>{chat('pickerEmpty')}</DropdownMenuItem>
                  ) : (
                     agents.slice(0, 12).map((agent) => (
                        <DropdownMenuItem key={agent.id} onSelect={() => void withAgent(agent)}>
                           <span className="truncate">{agent.name}</span>
                        </DropdownMenuItem>
                     ))
                  )}
               </DropdownMenuContent>
            </DropdownMenu>

            {orgId ? (
               <Link
                  href={`/${orgId}/chat${active ? `?session=${active.id}` : ''}`}
                  className="flex min-h-11 flex-none items-center rounded text-[var(--shell-text-dim)] hover:text-[var(--shell-text)] focus-visible:outline-2 focus-visible:outline-[var(--ring)] sm:min-h-0"
               >
                  {t('openFull')}
               </Link>
            ) : null}

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
         </header>

         {minimised ? null : active ? (
            <>
               <ThreadView
                  messages={messages}
                  agentName={active.agentName ?? null}
                  starters={[]}
                  suggestions={[]}
                  onUseSuggestion={setComposer}
                  onRegenerate={() => undefined}
                  regenerating={false}
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
                  onStop={null}
                  queueing={tasks.length > 0}
                  disabled={sending}
                  placeholder={
                     active.agentName
                        ? chat('composerPlaceholder', { name: active.agentName })
                        : chat('composerIdle')
                  }
                  workspaceId={workspaceId}
                  sendVariant="secondary"
               />
            </>
         ) : (
            <div
               className="min-h-0 flex-1 overflow-y-auto"
               aria-busy={opening !== null || !agentsLoaded}
            >
               <div className="px-3 pt-3">
                  <h2 className="text-[var(--shell-text)]">{t('pickTitle')}</h2>
                  <p className="mt-0.5 text-[var(--shell-text-muted)]">{t('pickHint')}</p>
               </div>
               {!agentsLoaded ? (
                  <p className="px-3 py-4 text-[var(--shell-text-dim)]">{common('loading')}</p>
               ) : agents.length === 0 ? (
                  <p className="px-3 py-4 text-[var(--shell-text-muted)]">{t('pickEmpty')}</p>
               ) : (
                  <ul className="pb-2">
                     {group(t('pinnedGroup'), picker.pinned)}
                     {group(t('recentGroup'), picker.recent)}
                     {group(t('allGroup'), picker.rest)}
                  </ul>
               )}
            </div>
         )}
      </div>
   );
}
