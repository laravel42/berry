'use client';

import { BerryMark } from '@/components/brand/berry-mark';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import type { Issue } from '@/data/issues';
import type { User } from '@/data/users';
import { colorForAgent } from '@/lib/agent-color';
import { isTerminalRunStatus, type RunRecord } from '@/lib/runs';
import { cn } from '@/lib/utils';
import { useAgentsStore } from '@/store/agents-store';
import { useRunsStore } from '@/store/runs-store';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';

/**
 * Who did it, at a glance.
 *
 * A task's assignee is a person or an agent, and the design system gives each
 * a colour so the difference reads without a label: amber for a person, azure
 * for an agent. Every surface in the issues area that shows an actor — a list
 * row, a board card, a comment, an event line — draws it through here, so a
 * forty-row feed does not become a column of identical azure brackets with a
 * photo here and there.
 *
 * The bracket glyph itself is the brand mark and is not redrawn. An agent's
 * two-letter monogram sits beside it where rows are dense, with the full name
 * in the tooltip and in the accessible label.
 */

export function isAgentUser(user: Pick<User, 'role'>): boolean {
   return user.role === 'Application';
}

/** Words that start with a letter or digit; "&" in "Data & Analytics" is not one. */
function monogramWords(name: string): string[] {
   return name
      .trim()
      .split(/[\s_\-/]+/)
      .filter((word) => /^[\p{L}\p{N}]/u.test(word));
}

/** "Frontend Engineer" → "FE"; "Orchestrator" → "OR". */
export function agentMonogram(name: string): string {
   const words = monogramWords(name);
   const first = words[0] ?? '';
   const second = words[1];
   if (!first) return '··';
   if (!second) return first.slice(0, 2).toUpperCase();
   return `${first.charAt(0)}${second.charAt(0)}`.toUpperCase();
}

/**
 * The three-letter form, for when two letters are not enough to tell two
 * roles apart: the first letter of each of the first three words, or — with
 * only two words — the first two letters of the first word and the first of
 * the second. "DevOps Engineer" → "DEE", "Database Engineer" → "DAE".
 */
function longAgentMonogram(name: string): string {
   const words = monogramWords(name);
   const [first = '', second, third] = words;
   if (!first) return '···';
   if (!second) return first.slice(0, 3).toUpperCase();
   if (third) return `${first.charAt(0)}${second.charAt(0)}${third.charAt(0)}`.toUpperCase();
   return `${first.slice(0, 2)}${second.charAt(0)}`.toUpperCase();
}

/**
 * A monogram per name, unique within the roster.
 *
 * Two letters is the default. Names whose two letters collide with another
 * name's — "DevOps Engineer" and "Database Engineer" are both "DE" — take the
 * three-letter form instead, and the choice is made against the whole list so
 * an agent's monogram is the same in every row rather than depending on which
 * other agents happen to be on screen.
 */
export function agentMonograms(names: string[]): Map<string, string> {
   const short = new Map<string, string>();
   const seen = new Map<string, number>();
   for (const name of names) {
      const mark = agentMonogram(name);
      short.set(name, mark);
      seen.set(mark, (seen.get(mark) ?? 0) + 1);
   }
   const result = new Map<string, string>();
   for (const [name, mark] of short) {
      result.set(name, (seen.get(mark) ?? 0) > 1 ? longAgentMonogram(name) : mark);
   }
   return result;
}

/** The agent's monogram, disambiguated against the workspace's loaded roster. */
export function useAgentMonogram(name: string): string {
   const agents = useAgentsStore((state) => state.agents);
   const monograms = useMemo(() => agentMonograms(agents.map((agent) => agent.name)), [agents]);
   return monograms.get(name) ?? agentMonogram(name);
}

function initials(name: string): string {
   const words = name.trim().split(/\s+/).filter(Boolean);
   const first = words[0]?.charAt(0) ?? '';
   const last = words.length > 1 ? (words[words.length - 1]?.charAt(0) ?? '') : '';
   return `${first}${last}`.toUpperCase() || '?';
}

const BOX = {
   sm: 'size-5',
   md: 'size-6',
} as const;

interface ActorAvatarProps {
   user: User;
   size?: keyof typeof BOX;
   /** Show the agent's monogram beside the bracket. */
   monogram?: boolean;
   className?: string;
}

export function ActorAvatar({ user, size = 'md', monogram = false, className }: ActorAvatarProps) {
   const t = useTranslations('issueLists.actor');
   const mark = useAgentMonogram(user.name);

   if (isAgentUser(user)) {
      const dotColor = colorForAgent(user.id);
      return (
         <span
            className={cn('inline-flex shrink-0 items-center gap-1 text-actor-agent', className)}
            title={user.name}
         >
            <span
               className={cn(
                  'inline-flex shrink-0 items-center justify-center rounded-full',
                  BOX[size]
               )}
               style={{ backgroundColor: `color-mix(in oklab, ${dotColor} 12%, transparent)` }}
            >
               <BerryMark
                  size="sm"
                  tone="working"
                  dotColor={dotColor}
                  bracketClassName="text-actor-agent"
                  label={`${user.name}, ${t('agent')}`}
               />
            </span>
            {monogram ? (
               <span aria-hidden className="font-medium tracking-wide">
                  {mark}
               </span>
            ) : null}
         </span>
      );
   }

   return (
      <Avatar
         className={cn(BOX[size], 'shrink-0 ring-1 ring-actor-human/60', className)}
         title={user.name}
      >
         <AvatarImage src={user.avatarUrl || undefined} alt="" />
         <AvatarFallback className="bg-actor-human/10 font-medium text-actor-human" aria-hidden>
            {initials(user.name)}
         </AvatarFallback>
         <span className="sr-only">
            {user.name}, {t('person')}
         </span>
      </Avatar>
   );
}

/** The actor's name in its actor tone, with the role spoken for screen readers. */
export function ActorName({ user, className }: { user: User; className?: string }) {
   const t = useTranslations('issueLists.actor');
   const agent = isAgentUser(user);
   return (
      <span
         className={cn('font-medium', agent ? 'text-actor-agent' : 'text-actor-human', className)}
      >
         {user.name}
         <span className="sr-only"> ({agent ? t('agent') : t('person')})</span>
      </span>
   );
}

/**
 * The run an agent has open on a task, or null.
 *
 * `activeRunId` on the task names it; the runs store says whether it is still
 * going. Both are needed: the id alone would keep a row marked live after the
 * run ended and before the task was re-read, and a run that is not in the
 * store is one this page has not seen start.
 */
export function useIssueLiveRun(issue: Pick<Issue, 'activeRunId'>): RunRecord | null {
   const runId = issue.activeRunId ?? null;
   const run = useRunsStore((state) =>
      runId ? state.runs.find((entry) => entry.id === runId) : undefined
   );
   return run && !isTerminalRunStatus(run.status) ? run : null;
}

/**
 * The mark a row carries while an agent is working on it: the bracket in the
 * agent tone, pulsing. Still for readers who asked for reduced motion; named
 * for everyone else through the tooltip and the screen-reader text.
 */
export function ActorLiveMark({
   run,
   fallbackName,
   className,
}: {
   run: RunRecord;
   /** Used when the run's agent is not in the store — the task's assignee, usually. */
   fallbackName?: string | null;
   className?: string;
}) {
   const t = useTranslations('issueLists.actor');
   const agent = useAgentsStore((state) => state.getAgentById(run.agentId));
   const name = agent?.name ?? fallbackName ?? t('agent');
   const label = run.status === 'queued' ? t('queuedBy', { name }) : t('workingBy', { name });
   const dotColor = colorForAgent(run.agentId);

   return (
      <span
         className={cn('inline-flex shrink-0 items-center', className)}
         title={label}
         data-live-run
      >
         <BerryMark
            size="sm"
            tone="working"
            dotColor={dotColor}
            bracketClassName="text-actor-agent"
            className="[animation:berrypulse_1.4s_ease-in-out_infinite] motion-reduce:animate-none"
         />
         <span className="sr-only">{t('working')}</span>
      </span>
   );
}
