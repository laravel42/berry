'use client';

import { useEffect } from 'react';
import { FLOATING_ORDER, useFloatingStackItem } from '@/store/floating-stack-store';
import { ShellChatButton } from './shell-chat-button';

/**
 * The Agents launcher's place in the floating stack.
 *
 * It stands on top of the stack, so when a page floats its own controls in the
 * corner the launcher rises above them rather than covering them. How far it
 * has risen is published as `--floating-stack-lift`: the floating chat window
 * and the toasts read it to keep clear of the launcher wherever it stands.
 *
 * At z-45 it sits over the floating chat window (z-40), so it can close it,
 * and under the dialog overlays (z-50), so an open modal covers it.
 */
export function ShellLauncherDock() {
   const { ref, lift, bottom } = useFloatingStackItem(FLOATING_ORDER.launcher);

   useEffect(() => {
      const root = document.documentElement;
      root.style.setProperty('--floating-stack-lift', `${lift}px`);
      return () => root.style.removeProperty('--floating-stack-lift');
   }, [lift]);

   return (
      <div
         ref={ref}
         style={{ bottom }}
         className="pointer-events-none fixed right-[calc(var(--app-inset-r)+0.75rem+4px)] z-[45] flex h-9 items-center gap-2 transition-[bottom] duration-200 ease-out motion-reduce:transition-none *:pointer-events-auto"
      >
         <ShellChatButton />
      </div>
   );
}
