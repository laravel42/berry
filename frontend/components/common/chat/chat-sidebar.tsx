'use client';

import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';

import {
   DropdownMenu,
   DropdownMenuContent,
   DropdownMenuItem,
   DropdownMenuLabel,
   DropdownMenuSeparator,
   DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useAgentCoverage } from '@/hooks/use-agent-coverage';
import { isOrchestrator, type Agent, type AgentRoster } from '@/lib/agents';
import type { ChatThread } from '@/lib/chat';
import { agentHasRuntime } from '@/lib/runtimes';
import { cn } from '@/lib/utils';
import { ChatSessions } from './chat-sessions';

interface ChatSidebarProps {
   agents: Agent[];
   /** Owner and runtime per agent, for grouping and the no-runtime flag. */
   roster: Map<string, AgentRoster>;
   sessionUserId: string | undefined;
   threads: ChatThread[];
   archived: ChatThread[] | null;
   showArchived: boolean;
   onToggleArchived: () => void;
   activeId: string | null;
   /** Starts a new conversation with the agent that was chosen. */
   onNewChat: (agent: Agent) => void;
   onSelect: (thread: ChatThread) => void;
   onChanged: () => void;
   /** Shows the new title at once; the parent saves it and rolls it back on failure. */
   onRename: (id: string, title: string) => void;
   onStop: (thread: ChatThread) => void;
   /** The page sets its name and the new-chat action above the split instead. */
   headless?: boolean;
   className?: string;
}

/** Orchestrator first, then by name: the order the list is scanned in. */
function byRole(left: Agent, right: Agent): number {
   return (
      Number(isOrchestrator(right)) - Number(isOrchestrator(left)) ||
      left.name.localeCompare(right.name)
   );
}

/**
 * New chat, every agent in the workspace, and the conversations themselves.
 *
 * The list is the whole roster, grouped into the agents this person made and
 * everyone else's, because "which of these is mine" is what a long roster is
 * scanned for. Choosing one starts a conversation with that agent.
 */
export function ChatSidebar({
   agents,
   roster,
   sessionUserId,
   threads,
   archived,
   showArchived,
   onToggleArchived,
   activeId,
   onNewChat,
   onSelect,
   onChanged,
   onRename,
   onStop,
   headless = false,
   className,
}: ChatSidebarProps) {
   const t = useTranslations('agentsChat.chat');
   const coverage = useAgentCoverage();

   const mine = agents
      .filter((agent) => roster.get(agent.id)?.ownerId === sessionUserId)
      .sort(byRole);
   const others = agents
      .filter((agent) => roster.get(agent.id)?.ownerId !== sessionUserId)
      .sort(byRole);

   const agentButton = (agent: Agent) => {
      const entry = roster.get(agent.id);
      const noRuntime = entry !== undefined && !agentHasRuntime(coverage, agent.id);
      return (
         <li key={agent.id}>
            <button
               type="button"
               onClick={() => onNewChat(agent)}
               title={agent.name}
               className="flex w-full cursor-pointer items-center gap-2 rounded px-2.5 py-1.5 text-left text-[var(--shell-text-muted)] transition-colors hover:bg-[var(--shell-hover)] hover:text-[var(--shell-text)] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ring)]"
            >
               <span className="min-w-0 flex-1 truncate">{agent.name}</span>
               {noRuntime ? (
                  <span className="flex-none text-[var(--shell-text-dim)]">
                     {t('pickerNoRuntime')}
                  </span>
               ) : null}
            </button>
         </li>
      );
   };

   const menuItem = (agent: Agent) => {
      const entry = roster.get(agent.id);
      const noRuntime = entry !== undefined && !agentHasRuntime(coverage, agent.id);
      return (
         <DropdownMenuItem key={agent.id} onSelect={() => onNewChat(agent)}>
            <span className="min-w-0 flex-1 truncate">{agent.name}</span>
            {noRuntime ? (
               <span className="flex-none text-[var(--shell-text-dim)]">
                  {t('pickerNoRuntime')}
               </span>
            ) : null}
         </DropdownMenuItem>
      );
   };

   return (
      <aside
         className={cn(
            'flex w-[260px] flex-none flex-col overflow-y-auto border-r border-[var(--shell-line)] bg-[var(--shell-rail)]',
            className
         )}
      >
         {headless ? null : (
            <div className="shrink-0 px-3 pt-3 pb-2">
               <h1 className="sr-only">{t('title')}</h1>
               <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                     <button
                        type="button"
                        className="flex w-full items-center gap-2 rounded-lg border border-[var(--shell-line-strong)] px-3 py-2 text-left text-[var(--shell-text)] transition-colors hover:bg-[var(--shell-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]"
                     >
                        <Plus className="size-3.5" />
                        {t('newChat')}
                     </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="max-h-96 w-56 overflow-y-auto">
                     {agents.length === 0 ? (
                        <DropdownMenuItem disabled>{t('pickerEmpty')}</DropdownMenuItem>
                     ) : null}
                     {mine.length > 0 ? (
                        <>
                           <DropdownMenuLabel>{t('pickerMine')}</DropdownMenuLabel>
                           {mine.map(menuItem)}
                        </>
                     ) : null}
                     {others.length > 0 ? (
                        <>
                           {mine.length > 0 ? <DropdownMenuSeparator /> : null}
                           <DropdownMenuLabel>{t('pickerOthers')}</DropdownMenuLabel>
                           {others.map(menuItem)}
                        </>
                     ) : null}
                  </DropdownMenuContent>
               </DropdownMenu>
            </div>
         )}

         {agents.length > 0 ? (
            <div className="flex flex-col">
               {mine.length > 0 ? (
                  <>
                     <div
                        data-heading="label"
                        className="px-[18px] pt-2 pb-[7px] text-[var(--shell-text-dim)]"
                     >
                        {t('pickerMine')}
                     </div>
                     <ul className="flex flex-col gap-px px-2">{mine.map(agentButton)}</ul>
                  </>
               ) : null}
               {others.length > 0 ? (
                  <>
                     <div
                        data-heading="label"
                        className="px-[18px] pt-2 pb-[7px] text-[var(--shell-text-dim)]"
                     >
                        {mine.length > 0 ? t('pickerOthers') : t('agents')}
                     </div>
                     <ul className="flex flex-col gap-px px-2">{others.map(agentButton)}</ul>
                  </>
               ) : null}
            </div>
         ) : null}

         <ChatSessions
            threads={threads}
            archived={archived}
            showArchived={showArchived}
            onToggleArchived={onToggleArchived}
            activeId={activeId}
            onSelect={onSelect}
            onChanged={onChanged}
            onRename={onRename}
            onStop={onStop}
         />
      </aside>
   );
}
