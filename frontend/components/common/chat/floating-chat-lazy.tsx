'use client';

import dynamic from 'next/dynamic';
import { useEffect, useState } from 'react';

import { useShortcut } from '@/components/layout/shortcut-provider';
import { useShellStore } from '@/store/shell-store';

const DynamicFloatingChat = dynamic(
   () => import('@/components/common/chat/floating-chat').then((m) => m.FloatingChat),
   { ssr: false }
);

/**
 * The floating chat, fetched the first time it is asked for.
 *
 * It starts closed on every page load and renders nothing while closed, so
 * its code has no reason to ship with the route. This stub keeps the shortcut
 * and watches the shell store; the first time the window is opened it mounts
 * the real component, which then stays mounted so its slide-out can play.
 */
export function FloatingChatLazy() {
   const state = useShellStore((store) => store.chatWindow);
   const toggleChat = useShellStore((store) => store.toggleChat);
   const [wanted, setWanted] = useState(false);

   // Claims the action until the real component mounts and claims it itself.
   useShortcut('chat.toggleFloating', toggleChat);

   useEffect(() => {
      if (state !== 'closed') setWanted(true);
   }, [state]);

   return wanted ? <DynamicFloatingChat /> : null;
}
