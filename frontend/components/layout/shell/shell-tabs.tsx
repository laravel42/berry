'use client';

import { useEffect, useRef, type KeyboardEvent } from 'react';
import { Plus, X } from 'lucide-react';
import { shellIconButton } from './shell-icon';
import type { ShellTab } from '@/store/shell-store';
import { BerryMark } from './shell-icon';
import { useTranslations } from 'next-intl';
import { tabLabelFor } from './shell-tab-model';

interface ShellTabsProps {
   tabs: ShellTab[];
   /** Null when nothing should read as selected, as in settings. */
   activeTabId: string | null;
   onActivate: (tab: ShellTab) => void;
   onClose: (id: string) => void;
   onNew: () => void;
}

/**
 * The tab strip, ported from `Berry Prototype.dc.html`.
 *
 * Each tab's close control is a real button rather than a click handler on a
 * span, which makes it keyboard-reachable. That is also why the tab itself is a
 * button and not a wrapping anchor: nesting an interactive element inside a
 * link is invalid and breaks activation for both.
 *
 * Keyboard, as a browser's strip: one tab is in the Tab order (the selected
 * one, or the first when nothing is), Left and Right move the selection,
 * Home and End jump to the ends, Delete or Backspace close the tab under
 * focus. Tab from a tab reaches its own close button; the strip's other
 * controls are ordinary stops after it.
 */
export function ShellTabs({ tabs, activeTabId, onActivate, onClose, onNew }: ShellTabsProps) {
   const stripRef = useRef<HTMLDivElement>(null);
   const activeRef = useRef<HTMLDivElement>(null);
   const tabRefs = useRef(new Map<string, HTMLButtonElement>());
   // Set by a key that moved the selection, so focus follows it once the
   // strip has re-rendered; a click or a rail link never moves focus here.
   const focusAfterRender = useRef(false);

   // The strip scrolls, so an active tab opened beyond the fold would otherwise
   // be selected but invisible.
   useEffect(() => {
      activeRef.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      if (focusAfterRender.current && activeTabId) {
         focusAfterRender.current = false;
         tabRefs.current.get(activeTabId)?.focus();
      }
   }, [activeTabId]);

   const t = useTranslations('shell');
   // A tab reads like the rail: its section's translated name, an issue key
   // as itself, and — once the page has said so — the name of what it shows.
   const labelOf = (tab: ShellTab) => {
      if (tab.title) return tab.title;
      const resolved = tabLabelFor(tab.href, tab.label);
      if (resolved.kind === 'nav') return t(`nav.${resolved.key}`);
      if (resolved.kind === 'issue') return resolved.key;
      return resolved.text;
   };

   // The one tab that takes focus from Tab: the selected one, else the first.
   const focusableId = tabs.some((tab) => tab.id === activeTabId) ? activeTabId : tabs[0]?.id;

   const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
      const count = tabs.length;
      let target: number | null = null;
      switch (event.key) {
         case 'ArrowLeft':
            target = (index - 1 + count) % count;
            break;
         case 'ArrowRight':
            target = (index + 1) % count;
            break;
         case 'Home':
            target = 0;
            break;
         case 'End':
            target = count - 1;
            break;
         case 'Delete':
         case 'Backspace': {
            event.preventDefault();
            const tab = tabs[index];
            if (!tab) return;
            // Closing moves the selection, and focus goes with it.
            focusAfterRender.current = true;
            onClose(tab.id);
            return;
         }
         default:
            return;
      }
      event.preventDefault();
      const next = tabs[target];
      if (!next) return;
      if (next.id === activeTabId) {
         tabRefs.current.get(next.id)?.focus();
         return;
      }
      focusAfterRender.current = true;
      onActivate(next);
   };

   return (
      <div
         ref={stripRef}
         role="tablist"
         aria-label={t('tabs.openViews')}
         className="tabstrip flex h-full min-w-0 flex-1 items-stretch overflow-x-auto bg-[var(--shell-rail)]"
      >
         {tabs.map((tab, index) => {
            const on = tab.id === activeTabId;
            const inTabOrder = tab.id === focusableId;
            const label = labelOf(tab);
            return (
               <div
                  key={tab.id}
                  ref={on ? activeRef : undefined}
                  className={[
                     // One pixel short of the strip, so the rail colour shows
                     // as a hairline under the selected tab at either height.
                     'group flex h-[calc(var(--shell-strip)_-_1px)] min-w-24 max-w-[180px] flex-none items-center gap-2 pr-1.5 pl-3 transition-colors',
                     on
                        ? 'bg-[var(--shell-canvas)] text-[var(--shell-text)]'
                        : 'bg-[var(--shell-rail)] text-[var(--shell-text-muted)] hover:bg-[var(--shell-hover)] hover:text-[var(--shell-text)]',
                  ].join(' ')}
               >
                  <button
                     ref={(element) => {
                        if (element) tabRefs.current.set(tab.id, element);
                        else tabRefs.current.delete(tab.id);
                     }}
                     type="button"
                     role="tab"
                     aria-selected={on}
                     tabIndex={inTabOrder ? 0 : -1}
                     onKeyDown={(event) => onTabKeyDown(event, index)}
                     onClick={() => onActivate(tab)}
                     onAuxClick={(event) => {
                        // Middle-click closes, as in a browser.
                        if (event.button === 1) {
                           event.preventDefault();
                           onClose(tab.id);
                        }
                     }}
                     title={label}
                     className="flex h-full min-w-0 flex-1 cursor-pointer items-center gap-2 text-left focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ring)]"
                  >
                     <BerryMark size={13} muted />
                     <span className="truncate">{label}</span>
                  </button>
                  <button
                     type="button"
                     // Reached with Tab from its own tab; the others are one
                     // arrow key away, through their tab.
                     tabIndex={inTabOrder ? 0 : -1}
                     onClick={() => onClose(tab.id)}
                     aria-label={t('tabs.close', { label })}
                     className={[
                        // Unfilled until hovered: a filled square on every tab
                        // would read as a row of dismiss buttons.
                        'flex size-[18px] flex-none cursor-pointer items-center justify-center rounded-[3px]',
                        'text-[var(--shell-text-dim)] transition-colors',
                        'hover:bg-[var(--shell-line-strong)] hover:text-[var(--shell-text)]',
                        'focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)]',
                        // Keep the close affordance quiet until the tab is
                        // hovered or active, so a full strip does not read as a
                        // row of dismiss buttons. Focus reveals it for keyboard
                        // users, who get no hover.
                        on ? '' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100',
                     ].join(' ')}
                  >
                     <X size={14} strokeWidth={1.8} aria-hidden="true" />
                  </button>
               </div>
            );
         })}
         <button
            type="button"
            onClick={onNew}
            aria-label={t('tabs.newTab')}
            className={`mx-1 size-[26px] self-center ${shellIconButton}`}
         >
            <Plus size={16} strokeWidth={1.8} aria-hidden="true" />
         </button>
      </div>
   );
}
