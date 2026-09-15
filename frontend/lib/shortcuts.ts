/**
 * Berry's keyboard shortcuts: what they are, how a key event becomes one, and
 * what a person is allowed to remap them to.
 *
 * One module so there is one answer. Before this, a shortcut was whatever
 * window listener happened to be mounted, which meant nobody could see the
 * whole set, two areas could bind the same keys without noticing, and nothing
 * could be remapped. Here an action is declared once — id, group, default
 * combination, and the two context rules that decide when it may fire — and
 * the areas that own the behaviour register a handler for it at runtime
 * (`useShortcut` in `components/layout/shortcut-provider.tsx`).
 *
 * Everything in this file is pure. The provider does the listening, the store
 * (`store/shortcuts-store.ts`) does the remembering.
 */

/** The two lists the settings page shows. */
export type ShortcutGroup = 'general' | 'navigation';

export interface ShortcutDefinition {
   /** Stable id: the key handlers register under and bindings persist against. */
   id: string;
   group: ShortcutGroup;
   /** Key under `navigation.shortcuts.actions` in the message catalogues. */
   labelKey: string;
   /**
    * The combination this action starts with. Null means registered but
    * unbound: it appears in settings, it can be given a key, and until then
    * nothing fires it.
    *
    * A space separates the chords of a sequence: `g i` is G, then I within
    * `SEQUENCE_WINDOW_MS`. The go-to actions ship as sequences so a single
    * letter is never claimed for a destination.
    */
   defaultCombo: string | null;
   /**
    * Browser-level or shell-level and not remappable. Shown on the settings
    * page as a read-only list so people can see why a key is taken.
    */
   fixed?: boolean;
   /** Fires even when a text field has focus. Off unless stated. */
   allowInInput?: boolean;
   /** Suppressed while a dialog is open. On unless stated otherwise. */
   blockedByModal?: boolean;
}

/**
 * `mod` is the platform's command key: ⌘ on Apple hardware, Ctrl elsewhere.
 * Stored rather than resolved so one stored binding means the same thing on
 * both, and a person who moves machines keeps their shortcuts.
 */
export const MOD = 'mod';

/** Order modifiers are written in, so two spellings of one combo compare equal. */
const MODIFIER_ORDER = [MOD, 'ctrl', 'alt', 'shift'] as const;

/** Between the chords of a sequence: `g i`. */
const SEQUENCE_SEPARATOR = ' ';

/**
 * How long the second key of a sequence may take. Long enough to read the
 * palette's hint and press it; short enough that a G pressed by accident is
 * forgotten before the next real keystroke.
 */
export const SEQUENCE_WINDOW_MS = 1000;

/**
 * The default set.
 *
 * `general` is what you do where you are; `navigation` is where you go. The
 * go-to actions are two-key sequences behind G, so the palette can print the
 * keys beside each page without Berry claiming a bare letter for any of them.
 * Runtimes stays unbound: it is a settings page, and G S gets you there.
 */
export const SHORTCUTS: ShortcutDefinition[] = [
   { id: 'issue.create', group: 'general', labelKey: 'createIssue', defaultCombo: 'c' },
   {
      id: 'sidebar.toggle',
      group: 'general',
      labelKey: 'toggleSidebar',
      defaultCombo: 'mod+b',
      allowInInput: true,
   },
   {
      id: 'rightSidebar.toggle',
      group: 'general',
      labelKey: 'toggleRightSidebar',
      defaultCombo: 'mod+/',
      allowInInput: true,
   },
   {
      id: 'chat.toggleFloating',
      group: 'general',
      labelKey: 'toggleFloatingChat',
      defaultCombo: 'mod+j',
      allowInInput: true,
   },
   {
      id: 'issue.find',
      group: 'general',
      labelKey: 'findInIssue',
      defaultCombo: 'mod+f',
      allowInInput: true,
   },
   {
      id: 'inbox.archive',
      group: 'general',
      labelKey: 'archiveInboxItem',
      defaultCombo: 'e',
      // The inbox is a drawer, and a drawer is a dialog. Blocking this one
      // while a dialog is open would mean it never fired at all.
      blockedByModal: false,
   },
   {
      id: 'composer.send',
      group: 'general',
      labelKey: 'send',
      defaultCombo: 'mod+enter',
      allowInInput: true,
      blockedByModal: false,
   },
   {
      id: 'history.back',
      group: 'navigation',
      labelKey: 'back',
      defaultCombo: 'mod+[',
      allowInInput: true,
   },
   {
      id: 'history.forward',
      group: 'navigation',
      labelKey: 'forward',
      defaultCombo: 'mod+]',
      allowInInput: true,
   },
   { id: 'goto.inbox', group: 'navigation', labelKey: 'goToInbox', defaultCombo: 'g i' },
   { id: 'goto.myIssues', group: 'navigation', labelKey: 'goToMyIssues', defaultCombo: 'g t' },
   { id: 'goto.reviews', group: 'navigation', labelKey: 'goToReviews', defaultCombo: 'g r' },
   { id: 'goto.approvals', group: 'navigation', labelKey: 'goToApprovals', defaultCombo: 'g a' },
   { id: 'goto.agents', group: 'navigation', labelKey: 'goToAgents', defaultCombo: 'g e' },
   { id: 'goto.projects', group: 'navigation', labelKey: 'goToProjects', defaultCombo: 'g p' },
   { id: 'goto.goals', group: 'navigation', labelKey: 'goToGoals', defaultCombo: 'g g' },
   { id: 'goto.chat', group: 'navigation', labelKey: 'goToChat', defaultCombo: 'g c' },
   { id: 'goto.views', group: 'navigation', labelKey: 'goToViews', defaultCombo: 'g v' },
   { id: 'goto.settings', group: 'navigation', labelKey: 'goToSettings', defaultCombo: 'g s' },
   { id: 'goto.runtimes', group: 'navigation', labelKey: 'goToRuntimes', defaultCombo: null },
];

/**
 * Shortcuts the shell owns and will not give up, listed so the settings page
 * can show them and the conflict check can refuse them. They are not in
 * `SHORTCUTS` because nothing registers a handler for them here — the palette
 * and the tab strip handle their own keys.
 */
export const FIXED_SHORTCUTS: { labelKey: string; combo: string }[] = [
   { labelKey: 'commandPalette', combo: 'mod+k' },
   { labelKey: 'closeOverlay', combo: 'escape' },
   { labelKey: 'newTab', combo: 'ctrl+t' },
   { labelKey: 'closeTab', combo: 'ctrl+w' },
   { labelKey: 'nextTab', combo: 'ctrl+tab' },
];

const BY_ID = new Map(SHORTCUTS.map((shortcut) => [shortcut.id, shortcut]));

export function shortcutById(id: string): ShortcutDefinition | undefined {
   return BY_ID.get(id);
}

/** True on Apple hardware, where `mod` is ⌘ and the display glyphs differ. */
export function isApplePlatform(): boolean {
   if (typeof navigator === 'undefined') return false;
   return /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent);
}

/**
 * A combination in canonical form: modifiers in a fixed order, lower case,
 * joined with `+`; the chords of a sequence separated by one space. Two
 * people describing one combination get one string, which is what makes
 * conflict detection a map lookup.
 */
export function normalizeCombo(combo: string): string {
   return combo
      .trim()
      .split(/\s+/)
      .filter((chord) => chord !== '')
      .map(normalizeChord)
      .join(SEQUENCE_SEPARATOR);
}

/** The chords of a combination: one for a chord, two or more for a sequence. */
export function comboChords(combo: string): string[] {
   return combo.split(SEQUENCE_SEPARATOR);
}

/**
 * The first chords of every bound sequence — the keys that start a sequence
 * rather than fire an action. The provider holds one of these for a moment
 * and waits for the key that completes it.
 */
export function sequencePrefixes(bindings: Record<string, string | null>): Set<string> {
   const prefixes = new Set<string>();
   for (const bound of Object.values(bindings)) {
      const chords = bound ? comboChords(bound) : [];
      if (chords.length > 1 && chords[0]) prefixes.add(chords[0]);
   }
   return prefixes;
}

function normalizeChord(combo: string): string {
   const parts = combo
      .toLowerCase()
      .split('+')
      .map((part) => part.trim())
      .filter((part) => part !== '');
   const key = parts.find(
      (part) => !(MODIFIER_ORDER as readonly string[]).includes(part) && part !== 'meta'
   );
   const modifiers = MODIFIER_ORDER.filter(
      (modifier) => parts.includes(modifier) || (modifier === MOD && parts.includes('meta'))
   );
   return [...modifiers, key ?? ''].filter(Boolean).join('+');
}

/** How a key event names itself, or null when only modifiers are held. */
export function comboFromEvent(event: KeyboardEvent): string | null {
   const key = event.key;
   // A keydown from a password manager, an extension or a script-made event
   // can carry no key at all, and a keystroke mid-composition (an IME
   // spelling out a character) names no shortcut either.
   if (typeof key !== 'string' || key === '' || key === 'Unidentified' || event.isComposing)
      return null;
   if (key === 'Control' || key === 'Shift' || key === 'Alt' || key === 'Meta') return null;

   const parts: string[] = [];
   // ⌘ and Ctrl both spell `mod`, so one binding works on either platform.
   if (event.metaKey || event.ctrlKey) parts.push(MOD);
   if (event.altKey) parts.push('alt');
   if (event.shiftKey) parts.push('shift');
   parts.push(keyName(key));
   return normalizeCombo(parts.join('+'));
}

/**
 * The stored name of a physical key.
 *
 * Shift is already carried as a modifier, so the *unshifted* meaning is what
 * is stored: otherwise `mod+shift+/` would record itself as `mod+shift+?` on
 * one layout and `mod+shift+/` on another and the two would never match.
 */
function keyName(key: string): string {
   if (key === ' ') return 'space';
   if (key.length === 1) return key.toLowerCase();
   return key.toLowerCase();
}

const APPLE_GLYPHS: Record<string, string> = {
   mod: '⌘',
   ctrl: '⌃',
   alt: '⌥',
   shift: '⇧',
   enter: '↵',
   escape: '⎋',
   backspace: '⌫',
   arrowup: '↑',
   arrowdown: '↓',
   arrowleft: '←',
   arrowright: '→',
};

const OTHER_NAMES: Record<string, string> = {
   mod: 'Ctrl',
   ctrl: 'Ctrl',
   alt: 'Alt',
   shift: 'Shift',
   enter: 'Enter',
   escape: 'Esc',
   backspace: 'Backspace',
   arrowup: '↑',
   arrowdown: '↓',
   arrowleft: '←',
   arrowright: '→',
};

/**
 * A combination as a person reads it: `⌘K` on a Mac, `Ctrl+K` elsewhere. The
 * chords of a sequence stay separated by a space (`G I`), so a caller that
 * wants one chip per key can split on it.
 */
export function formatCombo(combo: string, apple = isApplePlatform()): string {
   return comboChords(combo)
      .map((chord) => formatChord(chord, apple))
      .join(SEQUENCE_SEPARATOR);
}

function formatChord(combo: string, apple: boolean): string {
   const parts = combo.split('+').map((part) => {
      const mapped = apple ? APPLE_GLYPHS[part] : OTHER_NAMES[part];
      if (mapped) return mapped;
      return part.length === 1 ? part.toUpperCase() : part.charAt(0).toUpperCase() + part.slice(1);
   });
   return apple ? parts.join('') : parts.join('+');
}

/**
 * Combinations the browser keeps for itself. Binding one of these produces a
 * shortcut that either never fires or closes the tab, so the settings page
 * refuses them rather than letting someone discover it the hard way.
 */
const RESERVED = new Set(
   [
      'mod+t',
      'mod+n',
      'mod+w',
      'mod+q',
      'mod+r',
      'mod+l',
      'mod+d',
      'mod+p',
      'mod+s',
      'mod+shift+t',
      'mod+shift+n',
      'mod+shift+w',
      'mod+shift+q',
      'mod+shift+r',
      'mod+alt+i',
      'mod+tab',
      'alt+tab',
      'alt+f4',
      'f5',
      'f11',
      'f12',
   ].map(normalizeCombo)
);

/**
 * Keys that mean something while typing, and so may not be bound bare. With a
 * modifier they are fine — it is the naked Backspace, Space or arrow that
 * would eat a keystroke in every text field in the product.
 */
const TYPING_KEYS = new Set([
   'backspace',
   'delete',
   'space',
   'enter',
   'tab',
   'escape',
   'arrowup',
   'arrowdown',
   'arrowleft',
   'arrowright',
   'home',
   'end',
   'pageup',
   'pagedown',
]);

export type ComboProblem =
   | { kind: 'reserved' }
   | { kind: 'typing' }
   | { kind: 'conflict'; shortcutId: string }
   | { kind: 'fixed'; labelKey: string };

/**
 * Why this combination cannot be given to this action, or null when it can.
 *
 * `bindings` is the resolved map of every action's current combination, so a
 * conflict names the action already holding the keys rather than saying only
 * that something does.
 */
export function comboProblem(
   combo: string,
   forId: string,
   bindings: Record<string, string | null>
): ComboProblem | null {
   const normalized = normalizeCombo(combo);
   if (normalized === '') return { kind: 'typing' };
   const chords = comboChords(normalized);

   for (const chord of chords) {
      if (RESERVED.has(chord)) return { kind: 'reserved' };
      const parts = chord.split('+');
      const key = parts[parts.length - 1] ?? '';
      const bare = parts.length === 1;
      if (bare && TYPING_KEYS.has(key)) return { kind: 'typing' };
      const fixed = FIXED_SHORTCUTS.find((entry) => normalizeCombo(entry.combo) === chord);
      if (fixed) return { kind: 'fixed', labelKey: fixed.labelKey };
   }

   // A chord that opens someone else's sequence would start it instead of
   // firing; a sequence that opens with someone else's chord would never
   // begin. Both are conflicts, and both name the action in the way.
   const first = chords[0] ?? '';
   for (const [id, bound] of Object.entries(bindings)) {
      if (id === forId || !bound) continue;
      const other = normalizeCombo(bound);
      if (other === normalized) return { kind: 'conflict', shortcutId: id };
      const otherChords = comboChords(other);
      const otherFirst = otherChords[0] ?? '';
      if (chords.length === 1 && otherChords.length > 1 && otherFirst === normalized) {
         return { kind: 'conflict', shortcutId: id };
      }
      if (chords.length > 1 && otherChords.length === 1 && other === first) {
         return { kind: 'conflict', shortcutId: id };
      }
   }
   return null;
}

/** Defaults, as the map the provider and the settings page both read. */
export function defaultBindings(): Record<string, string | null> {
   const bindings: Record<string, string | null> = {};
   for (const shortcut of SHORTCUTS) {
      bindings[shortcut.id] = shortcut.defaultCombo ? normalizeCombo(shortcut.defaultCombo) : null;
   }
   return bindings;
}

/**
 * Defaults with the person's overrides applied.
 *
 * An override of `null` is a deliberately disabled shortcut, which is not the
 * same as "no override" — hence the `in` check rather than a falsy one.
 */
export function resolveBindings(
   overrides: Record<string, string | null>
): Record<string, string | null> {
   const bindings = defaultBindings();
   for (const id of Object.keys(bindings)) {
      if (id in overrides) {
         const value = overrides[id];
         bindings[id] = value ? normalizeCombo(value) : null;
      }
   }
   return bindings;
}

/** The action a combination fires, or null when nothing holds it. */
export function shortcutForCombo(
   combo: string,
   bindings: Record<string, string | null>
): ShortcutDefinition | null {
   for (const [id, bound] of Object.entries(bindings)) {
      if (bound && bound === combo) {
         const definition = BY_ID.get(id);
         if (definition) return definition;
      }
   }
   return null;
}
