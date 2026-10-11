'use client';

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type RefObject } from 'react';
import { useTranslations } from 'next-intl';

import { loadWorkspaceAgents, type Agent } from '@/lib/agents';
import { loadQuickActions, type QuickAction } from '@/lib/quick-actions';
import { loadWorkspaceMembers } from '@/lib/members';
import { listSkills, type Skill } from '@/lib/skills';
import type { User } from '@/data/users';
import { cn } from '@/lib/utils';

/** `@` or `/` immediately before the caret, with whatever has been typed since. */
const TRIGGER = /(?:^|\s)([@/])([\w-]{0,64})$/;

type TriggerKind = 'mention' | 'slash';

interface ActiveTrigger {
   kind: TriggerKind;
   query: string;
   start: number;
}

interface PaletteItem {
   key: string;
   group: string;
   name: string;
   detail: string | null;
   /** Written in place of the trigger. Empty when choosing runs `onChoose` only. */
   insert: string;
   onChoose?: () => void;
}

export interface SlashExtra {
   key: string;
   name: string;
   detail: string | null;
   /** Runs after the `/` token is removed. */
   onChoose: () => void;
}

function triggerAt(value: string, caret: number): ActiveTrigger | null {
   const before = value.slice(0, caret);
   const match = TRIGGER.exec(before);
   if (!match) return null;
   const query = match[2] ?? '';
   return {
      kind: match[1] === '@' ? 'mention' : 'slash',
      query,
      start: before.length - query.length - 1,
   };
}

function byName(left: { name: string }, right: { name: string }): number {
   return left.name.localeCompare(right.name);
}

function matches(name: string, query: string): boolean {
   return name.toLowerCase().includes(query.toLowerCase());
}

function plainName(name: string, sigil: '@' | '/'): string {
   return `${sigil}${name.replace(/[\n\r]/g, ' ').trim()} `;
}

const NO_EXTRAS: SlashExtra[] = [];

/**
 * The chat message selector: `@` lists people and agents, `/` lists every
 * workspace skill and the commands. Arrow keys move, Enter and Tab choose,
 * Escape dismisses that token.
 *
 * A task comment passes `agentMention` so choosing an agent writes the token
 * the server starts a run from. Everywhere else the name is plain text.
 */
export function useComposerPalette({
   textareaRef,
   value,
   onChange,
   workspaceId,
   agentMention,
   slashExtras = NO_EXTRAS,
   listClassName,
}: {
   textareaRef: RefObject<HTMLTextAreaElement | null>;
   value: string;
   onChange: (value: string) => void;
   workspaceId: string | undefined;
   agentMention?: (agent: Agent) => string;
   slashExtras?: SlashExtra[];
   listClassName?: string;
}) {
   const t = useTranslations('agentsChat.chat');
   const dismissed = useRef<string | null>(null);
   const [active, setActive] = useState<ActiveTrigger | null>(null);
   const [highlighted, setHighlighted] = useState(0);
   const [people, setPeople] = useState<User[] | null>(null);
   const [agents, setAgents] = useState<Agent[] | null>(null);
   const [skills, setSkills] = useState<Skill[] | null>(null);
   const [commands, setCommands] = useState<QuickAction[] | null>(null);

   useEffect(() => {
      if (active?.kind !== 'mention' || people !== null) return;
      let cancelled = false;
      void Promise.all([
         workspaceId ? loadWorkspaceMembers(workspaceId).catch(() => []) : Promise.resolve([]),
         loadWorkspaceAgents().catch(() => []),
      ]).then(([members, found]) => {
         if (cancelled) return;
         setPeople(members);
         setAgents(found.filter((agent) => !agent.archivedAt));
      });
      return () => {
         cancelled = true;
      };
   }, [active?.kind, people, workspaceId]);

   useEffect(() => {
      if (active?.kind !== 'slash' || skills !== null) return;
      let cancelled = false;
      void Promise.all([
         listSkills().catch(() => []),
         workspaceId ? loadQuickActions(workspaceId).catch(() => []) : Promise.resolve([]),
      ]).then(([foundSkills, foundCommands]) => {
         if (cancelled) return;
         setSkills(foundSkills);
         setCommands(foundCommands.filter((command) => !command.archivedAt));
      });
      return () => {
         cancelled = true;
      };
   }, [active?.kind, skills, workspaceId]);

   useEffect(() => {
      setHighlighted(0);
   }, [active?.kind, active?.query]);

   const items = useMemo((): PaletteItem[] => {
      if (!active) return [];
      const query = active.query;
      if (active.kind === 'mention') {
         return [
            ...(people ?? [])
               .filter((person) => matches(person.name, query))
               .sort(byName)
               .slice(0, 8)
               .map((person) => ({
                  key: `person:${person.id}`,
                  group: t('mentionPeople'),
                  name: person.name,
                  detail: null,
                  insert: plainName(person.name, '@'),
               })),
            ...(agents ?? [])
               .filter((agent) => matches(agent.name, query))
               .sort(byName)
               .slice(0, 8)
               .map((agent) => ({
                  key: `agent:${agent.id}`,
                  group: t('mentionAgents'),
                  name: agent.name,
                  detail: null,
                  insert: agentMention ? `${agentMention(agent)} ` : plainName(agent.name, '@'),
               })),
         ];
      }
      const extras = slashExtras
         .filter((extra) => matches(extra.name, query) || matches(extra.detail ?? '', query))
         .map((extra) => ({
            key: extra.key,
            group: t('slashCommands'),
            name: extra.name,
            detail: extra.detail,
            insert: '',
            onChoose: extra.onChoose,
         }));
      return [
         ...(skills ?? [])
            .filter((skill) => matches(skill.name, query) || matches(skill.description, query))
            .sort(byName)
            .map((skill) => ({
               key: `skill:${skill.id}`,
               group: t('slashSkills'),
               name: skill.name,
               detail: skill.description.trim() || null,
               insert: plainName(skill.name, '/'),
            })),
         ...extras,
         ...(commands ?? [])
            .filter((command) => matches(command.name, query))
            .sort(byName)
            .slice(0, 8)
            .map((command) => ({
               key: `command:${command.id}`,
               group: t('slashCommands'),
               name: command.name,
               detail: command.description?.trim() || null,
               insert: plainName(command.name, '/'),
            })),
      ];
   }, [active, agentMention, agents, commands, people, skills, slashExtras, t]);

   const sync = (text: string, caret: number) => {
      const token = triggerAt(text, caret);
      if (!token) {
         dismissed.current = null;
         setActive(null);
         return;
      }
      const key = `${token.kind}:${token.start}:${token.query}`;
      if (dismissed.current === key) {
         setActive(null);
         return;
      }
      dismissed.current = null;
      setActive(token);
   };

   const insert = (item: PaletteItem) => {
      const element = textareaRef.current;
      const caret = element?.selectionStart ?? value.length;
      const token = triggerAt(value, caret);
      if (!token) return;
      const written = item.onChoose ? '' : item.insert;
      const next = `${value.slice(0, token.start)}${written}${value.slice(caret)}`;
      onChange(next);
      item.onChoose?.();
      setActive(null);
      dismissed.current = null;
      requestAnimationFrame(() => {
         element?.focus();
         const at = token.start + written.length;
         element?.setSelectionRange(at, at);
      });
   };

   const open = active !== null && items.length > 0;

   const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (!open) return false;
      if (event.key === 'ArrowDown') {
         event.preventDefault();
         setHighlighted((current) => (current + 1) % items.length);
         return true;
      }
      if (event.key === 'ArrowUp') {
         event.preventDefault();
         setHighlighted((current) => (current - 1 + items.length) % items.length);
         return true;
      }
      if ((event.key === 'Enter' && !event.shiftKey) || event.key === 'Tab') {
         event.preventDefault();
         const picked = items[highlighted];
         if (picked) insert(picked);
         return true;
      }
      if (event.key === 'Escape' && active) {
         event.preventDefault();
         dismissed.current = `${active.kind}:${active.start}:${active.query}`;
         setActive(null);
         return true;
      }
      return false;
   };

   const list = open ? (
      <ul
         role="listbox"
         aria-label={active?.kind === 'slash' ? t('slashList') : t('mentionList')}
         className={cn(
            'absolute bottom-full left-0 z-20 mb-2 max-h-80 w-full max-w-80 overflow-y-auto rounded-md border border-[var(--shell-line)] bg-[var(--shell-surface)] shadow-lg',
            listClassName
         )}
      >
         {items.map((item, index) => {
            const heading = index === 0 || items[index - 1]?.group !== item.group;
            return (
               <li key={item.key}>
                  {heading ? (
                     <div className="px-3 pt-2 pb-0.5 text-[var(--shell-text-dim)]">
                        {item.group}
                     </div>
                  ) : null}
                  <button
                     type="button"
                     role="option"
                     aria-selected={index === highlighted}
                     onMouseDown={(event) => {
                        // Mouse-down, not click: the textarea must not lose
                        // focus before the insertion happens.
                        event.preventDefault();
                        insert(item);
                     }}
                     onMouseEnter={() => setHighlighted(index)}
                     className={cn(
                        'flex w-full min-w-0 flex-col px-3 py-1.5 text-left',
                        index === highlighted
                           ? 'bg-[var(--shell-hover)] text-[var(--shell-text)]'
                           : 'text-[var(--shell-text-muted)]'
                     )}
                  >
                     <span className="truncate">{item.name}</span>
                     {item.detail ? (
                        <span className="truncate text-[var(--shell-text-dim)]">{item.detail}</span>
                     ) : null}
                  </button>
               </li>
            );
         })}
      </ul>
   ) : null;

   return { list, open, onKeyDown, sync };
}
