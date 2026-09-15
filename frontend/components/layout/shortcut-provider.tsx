'use client';

import { useEffect, useMemo, useRef } from 'react';
import {
   SEQUENCE_WINDOW_MS,
   comboFromEvent,
   sequencePrefixes,
   shortcutById,
   shortcutForCombo,
   type ShortcutDefinition,
} from '@/lib/shortcuts';
import { useShortcutBindings } from '@/store/shortcuts-store';

/**
 * The one keyboard listener, and the hook areas use to claim an action.
 *
 * How to use it, from anywhere in the app:
 *
 * ```tsx
 * useShortcut('issue.create', () => openCreateIssue());
 * useShortcut('issue.find', open, { enabled: onIssuePage });
 * ```
 *
 * The id must be one declared in `lib/shortcuts.ts`; an unknown id registers
 * nothing, because a shortcut nobody can see in settings is a shortcut nobody
 * can turn off. Several components may claim the same action — the one
 * mounted last wins, which is what makes a dialog's Send beat the page's.
 * Unmounting hands it back.
 *
 * The handler is called with the original `KeyboardEvent` and runs after the
 * event is already default-prevented, so a shortcut never also types.
 *
 * A sequence (`g i`) is two keystrokes. The first is held for
 * `SEQUENCE_WINDOW_MS` and fires nothing on its own; the second completes
 * the sequence or is dropped. A bare chord bound to the same key as a
 * sequence's opener wins, because a person who bound it asked for exactly
 * that — and the settings page refuses the clash anyway.
 */

type Handler = (event: KeyboardEvent) => void;

/**
 * Module state rather than context: the provider is mounted once at the root
 * and hooks register from anywhere below it, including from trees that render
 * into portals outside the provider's own subtree.
 */
const handlers = new Map<string, Handler[]>();

/**
 * Claim an action imperatively; returns the release function.
 *
 * `useShortcut` is the normal way in. This is here for the rare caller that is
 * not a component — a store subscription, an editor plugin — and for tests.
 */
export function registerShortcut(id: string, handler: Handler): () => void {
   if (!shortcutById(id)) return () => undefined;
   const stack = handlers.get(id) ?? [];
   stack.push(handler);
   handlers.set(id, stack);
   return () => {
      const current = handlers.get(id);
      if (!current) return;
      const index = current.lastIndexOf(handler);
      if (index !== -1) current.splice(index, 1);
      if (current.length === 0) handlers.delete(id);
   };
}

/** True when the action currently has a handler, for a UI that hides dead rows. */
export function shortcutIsClaimed(id: string): boolean {
   return (handlers.get(id)?.length ?? 0) > 0;
}

/**
 * Stop acting on keystrokes until told otherwise.
 *
 * There is exactly one caller: the settings page, while it is recording a new
 * combination. Someone pressing C to bind C must not also create a task. The
 * recorder stops the event in the capture phase as well, so this is the second
 * of two locks rather than the only one — and it is the one that still holds
 * if a keystroke reaches the listener by another path.
 */
let suspended = false;

export function setShortcutsSuspended(value: boolean): void {
   suspended = value;
}

export function useShortcut(
   id: string,
   handler: Handler,
   options: { enabled?: boolean } = {}
): void {
   const enabled = options.enabled ?? true;
   // Kept in a ref so a handler that closes over fresh props does not have to
   // re-register — re-registering would move it to the top of the stack on
   // every render and quietly outrank a dialog that claimed the action later.
   const latest = useRef(handler);
   latest.current = handler;

   useEffect(() => {
      if (!enabled) return;
      return registerShortcut(id, (event) => latest.current(event));
   }, [id, enabled]);
}

/** Is the person typing? Then a bare letter is a letter. */
function typingTarget(target: EventTarget | null): boolean {
   if (!(target instanceof HTMLElement)) return false;
   if (target.isContentEditable) return true;
   const tag = target.tagName;
   if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
   if (tag !== 'INPUT') return false;
   const type = (target as HTMLInputElement).type;
   return !['button', 'checkbox', 'radio', 'submit', 'reset', 'range', 'file'].includes(type);
}

/** An open Radix dialog, sheet or alert — anything modal over the page. */
function modalOpen(): boolean {
   if (typeof document === 'undefined') return false;
   return document.querySelector('[role="dialog"][data-state="open"]') !== null;
}

function allowed(definition: ShortcutDefinition, event: KeyboardEvent): boolean {
   if (!definition.allowInInput && typingTarget(event.target)) return false;
   if (definition.blockedByModal !== false && modalOpen()) return false;
   return true;
}

/**
 * Mounts the listener. One per app, at the root of the workspace shell.
 */
export function ShortcutProvider({ children }: { children?: React.ReactNode }) {
   // Stable between remappings, which is when the listener must change; the
   // store memoises it so a parent's render does not re-subscribe.
   const resolved = useShortcutBindings();
   const prefixes = useMemo(() => sequencePrefixes(resolved), [resolved]);

   // The opener of a sequence, while its window is open. The time is kept as
   // well as the timer: under a busy main thread the second key can be
   // served before an overdue timer, and the clock does not have that gap.
   const pending = useRef<{ prefix: string; at: number; timer: number } | null>(null);

   useEffect(() => {
      const forget = () => {
         if (!pending.current) return;
         window.clearTimeout(pending.current.timer);
         pending.current = null;
      };

      const fire = (definition: ShortcutDefinition, event: KeyboardEvent) => {
         if (!allowed(definition, event)) return;
         const stack = handlers.get(definition.id);
         const handler = stack?.[stack.length - 1];
         if (!handler) return;
         event.preventDefault();
         handler(event);
      };

      const onKeyDown = (event: KeyboardEvent) => {
         if (suspended) return;
         // Mid-composition, a keystroke belongs to the input method: a Japanese
         // or Chinese writer pressing C is choosing a candidate, not creating a
         // task. `keyCode === 229` is the same fact on browsers that do not set
         // `isComposing`.
         if (event.isComposing || event.keyCode === 229) return;
         // Held keys repeat. A shortcut is an instruction, not a rate.
         if (event.repeat) return;

         const combo = comboFromEvent(event);
         if (!combo) return;

         // The second key of a sequence completes it or ends it. A key that
         // completes nothing is not tried as a chord of its own: G then C is
         // a mistyped sequence, not a request for a new task.
         if (pending.current) {
            const { prefix, at } = pending.current;
            forget();
            if (performance.now() - at > SEQUENCE_WINDOW_MS) {
               // Too late to be the second half; the opener is gone and this
               // key falls through to be whatever it is on its own.
            } else {
               const definition = shortcutForCombo(`${prefix} ${combo}`, resolved);
               if (definition) fire(definition, event);
               return;
            }
         }

         const definition = shortcutForCombo(combo, resolved);
         if (definition) {
            fire(definition, event);
            return;
         }

         // An opener on its own: hold it, and wait. Not while typing — there
         // a G is a letter — and not past the window, after which it is
         // forgotten as if never pressed.
         if (prefixes.has(combo) && !typingTarget(event.target)) {
            event.preventDefault();
            pending.current = {
               prefix: combo,
               at: performance.now(),
               timer: window.setTimeout(forget, SEQUENCE_WINDOW_MS),
            };
         }
      };

      window.addEventListener('keydown', onKeyDown);
      // Leaving the window mid-sequence ends it; the next key after coming
      // back should not be read as its second half.
      window.addEventListener('blur', forget);
      return () => {
         window.removeEventListener('keydown', onKeyDown);
         window.removeEventListener('blur', forget);
         forget();
      };
   }, [resolved, prefixes]);

   return <>{children}</>;
}
