import { create } from 'zustand';

/**
 * Whether the command palette is open.
 *
 * Its own store so something other than ⌘K can open it: a phone has no
 * command key, so below `lg` the rail's Search row does. What the palette is
 * showing — its route, query and issue context — stays in the palette, which
 * clears it whenever it closes.
 */
interface CommandPaletteState {
   isOpen: boolean;
   setOpen: (isOpen: boolean) => void;
   open: () => void;
}

export const useCommandPaletteStore = create<CommandPaletteState>((set) => ({
   isOpen: false,
   setOpen: (isOpen) => set({ isOpen }),
   open: () => set({ isOpen: true }),
}));
