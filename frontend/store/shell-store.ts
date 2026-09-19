import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/** The floating chat window's state; `closed` renders nothing at all. */
export type ChatWindowState = 'closed' | 'open' | 'minimised' | 'expanded';

/**
 * Shell chrome: whether the rail is open, and the floating chat window.
 *
 * The rail has two states because it has two shapes. At `lg` and above it is
 * a column beside the page, and `railOpen` (persisted) says whether that
 * column is expanded or collapsed. Below `lg` it is an overlay over the page,
 * and `railOverlayOpen` says whether it is showing. The overlay state is
 * deliberately not persisted: a phone opens with the page, never the menu.
 */
interface ShellState {
   railOpen: boolean;
   railOverlayOpen: boolean;
   chatWindow: ChatWindowState;
   /** Unread chat messages across threads, kept by `useChatUnreadSync`. */
   chatUnread: number;
   toggleRail: () => void;
   setRailOverlayOpen: (open: boolean) => void;
   toggleRailOverlay: () => void;
   setChatWindow: (state: ChatWindowState) => void;
   /** Closed becomes open; anything showing becomes closed. */
   toggleChat: () => void;
   setChatUnread: (count: number) => void;
}

export const useShellStore = create<ShellState>()(
   persist(
      (set) => ({
         railOpen: true,
         railOverlayOpen: false,
         chatWindow: 'closed',
         chatUnread: 0,

         toggleRail: () => set((state) => ({ railOpen: !state.railOpen })),
         setRailOverlayOpen: (railOverlayOpen) =>
            set((state) =>
               state.railOverlayOpen === railOverlayOpen ? state : { railOverlayOpen }
            ),
         toggleRailOverlay: () => set((state) => ({ railOverlayOpen: !state.railOverlayOpen })),

         setChatWindow: (chatWindow) => set({ chatWindow }),
         toggleChat: () =>
            set((state) => ({ chatWindow: state.chatWindow === 'closed' ? 'open' : 'closed' })),
         setChatUnread: (chatUnread) =>
            set((state) => (state.chatUnread === chatUnread ? state : { chatUnread })),
      }),
      {
         name: 'berry.shell',
         version: 4,
         // Earlier versions stored a tab strip. The rail preference is the
         // only thing worth keeping, and a stored strip has nothing to map to.
         migrate: () => ({ railOpen: true }),
         // The overlay, the chat window and the unread count are session
         // state: each starts over with the page.
         partialize: (state) => ({ railOpen: state.railOpen }),
      }
   )
);
