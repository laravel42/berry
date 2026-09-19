import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type SidebarVisibility = 'always' | 'badged' | 'never';
export type SidebarBadgeStyle = 'count' | 'dot';

export type SidebarItemKey =
   | 'inbox'
   | 'reviews'
   | 'chat'
   | 'meetings'
   | 'my-issues'
   | 'goals'
   | 'autopilot'
   | 'projects'
   | 'views'
   | 'agents'
   | 'skills'
   | 'usage'
   | 'logs';

export type SidebarSection = 'personal' | 'workspace' | 'automate' | 'configure';

interface SidebarPrefsState {
   badgeStyle: SidebarBadgeStyle;
   visibility: Record<SidebarItemKey, SidebarVisibility>;
   /** Item order per section (drag & drop in the Customize sidebar modal). */
   order: Record<SidebarSection, SidebarItemKey[]>;
   /**
    * Whether the rail's Manage section is unfolded. Null until the person
    * decides: then the role decides (see `manageOpenByDefault`), because an
    * owner configures the workspace and a member mostly does not.
    */
   manageOpen: boolean | null;
   setBadgeStyle: (style: SidebarBadgeStyle) => void;
   setVisibility: (item: SidebarItemKey, visibility: SidebarVisibility) => void;
   moveItem: (section: SidebarSection, from: number, to: number) => void;
   setManageOpen: (open: boolean) => void;
}

/** Owners and admins start with Manage unfolded; everyone else with it folded. */
export function manageOpenByDefault(role: string | undefined): boolean {
   return role === 'owner' || role === 'admin';
}

/**
 * Everything shows. Nothing is hidden by default — a person who wants a
 * shorter rail can hide an item in "Customize sidebar", but the product does
 * not decide that for them, and an item nobody can find is not a feature.
 */
const DEFAULT_VISIBILITY: Record<SidebarItemKey, SidebarVisibility> = {
   'inbox': 'always',
   'reviews': 'always',
   'chat': 'always',
   'meetings': 'always',
   'my-issues': 'always',
   'goals': 'always',
   'autopilot': 'always',
   'projects': 'always',
   'views': 'always',
   'agents': 'always',
   'skills': 'always',
   'usage': 'always',
   'logs': 'always',
};

/**
 * "Customize sidebar" preferences: default badge style and per-item
 * visibility (always / show when badged / don't show). Persisted so the
 * sidebar keeps its shape across sessions.
 */
const DEFAULT_ORDER: Record<SidebarSection, SidebarItemKey[]> = {
   personal: [],
   // Goals sits under projects because that is where a goal comes from: it
   // groups the tasks one plan compiled inside a project. Approvals and
   // proposals land in Inbox now, not as their own Work rail entries.
   workspace: ['projects', 'goals', 'my-issues', 'reviews', 'chat'],
   automate: [],
   // No runtimes entry: Runtimes lives in Settings. A stored `agent` key from
   // before the move is dropped by resolveOrder, which keeps only known keys.
   // No dashboard entry: it merged into Usage. A stored `dashboard` key is
   // dropped by resolveOrder like the old `agent` one.
   configure: ['agents', 'skills', 'autopilot', 'usage', 'logs'],
};

/** The key the previous shape was persisted under; read once, when v7 has nothing. */
const PREVIOUS_STORAGE_KEY = 'sidebar-prefs-v6';

/**
 * Stored order, resilient to new items: unknown keys are dropped, missing
 * defaults are inserted after their default predecessor.
 */
export function resolveOrder(
   stored: SidebarItemKey[] | undefined,
   defaults: SidebarItemKey[]
): SidebarItemKey[] {
   const result = (stored ?? []).filter((key) => defaults.includes(key));
   defaults.forEach((key, index) => {
      if (result.includes(key)) return;
      let insertAt = 0;
      for (let i = index - 1; i >= 0; i--) {
         const position = result.indexOf(defaults[i]);
         if (position !== -1) {
            insertAt = position + 1;
            break;
         }
      }
      result.splice(insertAt, 0, key);
   });
   return result;
}

/**
 * The v3 preferences, when a person had customised them before the rail
 * grew its Automate section. Their visibility and order carry over; the
 * `automate` order is seeded from defaults, and `autopilot` leaves the
 * workspace list through `resolveOrder`, which only keeps a section's own
 * keys.
 */
type StoredPrefs = Omit<Partial<SidebarPrefsState>, 'visibility'> & {
   visibility?: Partial<Record<SidebarItemKey, SidebarVisibility>>;
};

function previousPrefs(): StoredPrefs | undefined {
   if (typeof window === 'undefined') return undefined;
   try {
      const raw = window.localStorage.getItem(PREVIOUS_STORAGE_KEY);
      if (!raw) return undefined;
      const parsed = JSON.parse(raw) as { state?: Partial<SidebarPrefsState> };
      const state = parsed.state;
      if (!state) return undefined;
      // Order is not carried over: the v7 Manage defaults were reordered, and
      // keeping a v6 order would pin the old one forever. Visibility and badge
      // style survive the upgrade.
      const carried: StoredPrefs = { ...state };
      delete carried.order;
      return carried;
   } catch {
      return undefined;
   }
}

export const useSidebarPrefsStore = create<SidebarPrefsState>()(
   persist(
      (set) => ({
         badgeStyle: 'count',
         visibility: DEFAULT_VISIBILITY,
         order: DEFAULT_ORDER,
         manageOpen: null,
         setBadgeStyle: (badgeStyle) => set({ badgeStyle }),
         setManageOpen: (manageOpen) => set({ manageOpen }),
         setVisibility: (item, value) =>
            set((state) => ({ visibility: { ...state.visibility, [item]: value } })),
         moveItem: (section, from, to) =>
            set((state) => {
               const keys = resolveOrder(state.order[section], DEFAULT_ORDER[section]);
               if (from < 0 || from >= keys.length || to < 0 || to >= keys.length) return state;
               const [moved] = keys.splice(from, 1);
               keys.splice(to, 0, moved);
               return { order: { ...state.order, [section]: keys } };
            }),
      }),
      {
         name: 'sidebar-prefs-v7',
         merge: (persisted, current) => {
            const stored = (persisted as StoredPrefs | undefined) ?? previousPrefs();
            const mergedOrder = { ...current.order, ...stored?.order };
            return {
               ...current,
               ...stored,
               visibility: { ...current.visibility, ...knownVisibility(stored?.visibility) },
               order: {
                  personal: resolveOrder(mergedOrder.personal, DEFAULT_ORDER.personal),
                  workspace: resolveOrder(mergedOrder.workspace, DEFAULT_ORDER.workspace),
                  automate: resolveOrder(mergedOrder.automate, DEFAULT_ORDER.automate),
                  configure: resolveOrder(mergedOrder.configure, DEFAULT_ORDER.configure),
               },
            };
         },
      }
   )
);

/**
 * Stored visibility, keeping only items the sidebar still has: a key for an
 * item since removed would otherwise ride along in the persisted state.
 */
function knownVisibility(
   stored: Partial<Record<SidebarItemKey, SidebarVisibility>> | undefined
): Partial<Record<SidebarItemKey, SidebarVisibility>> {
   const known: Partial<Record<SidebarItemKey, SidebarVisibility>> = {};
   for (const [key, value] of Object.entries(stored ?? {})) {
      if (key in DEFAULT_VISIBILITY) known[key as SidebarItemKey] = value;
   }
   return known;
}

/**
 * Should an item be rendered, given its visibility pref and badge count?
 * A missing pref (item added after the prefs were persisted) counts as
 * "always" so new sidebar entries show up by default.
 */
export function isSidebarItemVisible(
   visibility: SidebarVisibility | undefined,
   badgeCount: number
): boolean {
   if (!visibility || visibility === 'always') return true;
   if (visibility === 'badged') return badgeCount > 0;
   return false;
}
