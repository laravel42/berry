'use client';

import {
   priorityFilterOptions,
   taskStatusFilterOptions,
} from '@/components/common/filters/filter-options';
import { applyListFilters, type ListFilterColumns } from '@/components/common/filters/list-filters';
import { createColumnConfigHelper } from '@/components/data-table-filter/core/filters';
import type { FiltersState } from '@/components/data-table-filter/core/types';
import { useShortcut } from '@/components/layout/shortcut-provider';
import type { InboxItem } from '@/data/inbox';
import { BarChart3, CircleCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { parseAsStringLiteral, useQueryState } from 'nuqs';
import { useEffect, useMemo } from 'react';

/** The two lists the page can be showing. */
export const INBOX_VIEWS = ['active', 'archived'] as const;
export type InboxView = (typeof INBOX_VIEWS)[number];

/**
 * Which list is on screen, in the URL.
 *
 * A reader who archives half an inbox and sends someone the link should be
 * showing them the archive, so this is query state rather than component
 * state — as is the selection below.
 */
export function useInboxView() {
   return useQueryState('view', parseAsStringLiteral(INBOX_VIEWS).withDefault('active'));
}

/** The selected notification, in the URL as `?issue=`. */
export function useInboxSelection() {
   return useQueryState('issue');
}

/** Which slice of the inbox the list is showing (Archived is a view, not a filter). */
export const INBOX_SHOW = ['all', 'unread', 'archived'] as const;
export type InboxShow = (typeof INBOX_SHOW)[number];

/** Read-state filters on the active inbox (not the archive). */
export type InboxShowFilter = Exclude<InboxShow, 'archived'>;

/** The sender bucket a notification with no named actor falls into. */
export const SENDER_AGENT = 'agent';
export const SENDER_SYSTEM = 'system';

/** What a notification is filtered on, once the live task is folded in. */
export interface InboxFacets {
   status: string | null;
   priority: string | null;
   sender: string;
}

export type FacetResolver = (item: InboxItem) => InboxFacets;

export function senderKey(item: InboxItem): string {
   if (!item.actor) return SENDER_SYSTEM;
   return item.actor.type === 'agent' ? SENDER_AGENT : item.actor.id;
}

/** Stand-in for "not about a task", which no option offers. */
const NO_FACET = '__none__';

/**
 * What the inbox can be narrowed by: the status and priority of the task a
 * notification is about. The filter menu counts each value over the list
 * before filtering, so a reader can see a dead end coming.
 */
export function useInboxFilterColumns(facetsOf: FacetResolver) {
   const t = useTranslations('inbox');

   return useMemo(() => {
      const dtf = createColumnConfigHelper<InboxItem>();
      return [
         dtf
            .option()
            .id('status')
            .accessor((item: InboxItem) => facetsOf(item).status ?? NO_FACET)
            .displayName(t('filters.status'))
            .icon(CircleCheck)
            .options(taskStatusFilterOptions)
            .build(),
         dtf
            .option()
            .id('priority')
            .accessor((item: InboxItem) => facetsOf(item).priority ?? NO_FACET)
            .displayName(t('filters.priority'))
            .icon(BarChart3)
            .options(priorityFilterOptions)
            .build(),
      ] as const;
   }, [facetsOf, t]);
}

export function applyInboxFilters(
   items: InboxItem[],
   show: InboxShowFilter,
   columns: ListFilterColumns<InboxItem>,
   filters: FiltersState
): InboxItem[] {
   const shown = show === 'unread' ? items.filter((item) => !item.read) : items;
   return applyListFilters(shown, columns, filters);
}

/**
 * What to select once `removedId` leaves the list: the one after it, else the
 * one before it, else nothing. Archiving from the keyboard has to leave the
 * cursor somewhere sensible, and the end of a list is not it.
 */
export function selectionAfterRemoval(items: InboxItem[], removedId: string): string | null {
   const index = items.findIndex((item) => item.id === removedId);
   if (index === -1) return null;
   const next = items[index + 1] ?? items[index - 1];
   return next ? next.id : null;
}

/** A keystroke that should reach the page rather than whatever is focused. */
function keystrokeIsOurs(event: KeyboardEvent): boolean {
   if (event.metaKey || event.ctrlKey || event.altKey) return false;
   const target = event.target;
   if (target instanceof HTMLElement) {
      if (target.isContentEditable) return false;
      const tag = target.tagName.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return false;
   }
   // A dialog, sheet or command palette on screen owns the keyboard until it
   // closes. Radix marks every one of them open on the element itself.
   if (typeof document !== 'undefined') {
      if (document.querySelector('[role="dialog"][data-state="open"]')) return false;
      if (document.querySelector('[role="alertdialog"][data-state="open"]')) return false;
   }
   return true;
}

export interface InboxKeyboardOptions {
   items: InboxItem[];
   selectedId: string | null;
   onSelect: (id: string) => void;
   /** `E`: archive in the inbox, put back in the archive. */
   onArchiveKey: () => void;
   enabled?: boolean;
}

/**
 * Up, down and `E`.
 *
 * `E` goes through the shell's registry, so archiving is one rebindable row in
 * settings shared with the notifications drawer; the arrows stay a local
 * listener, because moving a selection is not an action anyone rebinds and
 * there is no registry entry for it.
 */
export function useInboxKeyboard({
   items,
   selectedId,
   onSelect,
   onArchiveKey,
   enabled = true,
}: InboxKeyboardOptions): void {
   useEffect(() => {
      if (!enabled) return;
      const onKeyDown = (event: KeyboardEvent) => {
         if (!keystrokeIsOurs(event)) return;
         const key = event.key;
         if (key === 'ArrowDown' || key === 'ArrowUp') {
            if (items.length === 0) return;
            event.preventDefault();
            const index = selectedId ? items.findIndex((item) => item.id === selectedId) : -1;
            if (index === -1) {
               // Entering the list: from the top going down, the bottom
               // going up.
               const entry = key === 'ArrowDown' ? items[0] : items[items.length - 1];
               if (entry) onSelect(entry.id);
               return;
            }
            const nextIndex = key === 'ArrowDown' ? index + 1 : index - 1;
            const next = items[nextIndex];
            if (next) onSelect(next.id);
            return;
         }
      };
      window.addEventListener('keydown', onKeyDown);
      return () => window.removeEventListener('keydown', onKeyDown);
   }, [enabled, items, selectedId, onSelect]);

   useShortcut(
      'inbox.archive',
      () => {
         if (selectedId) onArchiveKey();
      },
      { enabled }
   );
}
