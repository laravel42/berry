/**
 * Shell route table, ported from `Berry Prototype.dc.html`.
 *
 * The prototype distinguishes a route's identifier from its label — `members`
 * renders as "agents" — so both are kept here rather than derived. Deriving one
 * from the other would quietly rename a route the next time a label changes.
 */

import type { SidebarItemKey, SidebarSection } from '@/store/sidebar-prefs-store';

export type ShellRoute =
   | 'issues'
   | 'runs'
   | 'reviews'
   | 'chat'
   | 'inbox'
   | 'projects'
   | 'cycles'
   | 'loops'
   | 'members'
   | 'skills'
   | 'integrations'
   | 'usage'
   | 'logs';

/** Key under `shell.nav` in the message catalogues. */
export type ShellLabelKey =
   | 'tasks'
   | 'chat'
   | 'reviews'
   | 'projects'
   | 'cycles'
   | 'loops'
   | 'runtimes'
   | 'agents'
   | 'analytics'
   | 'skills'
   | 'integrations'
   | 'usage'
   | 'logs';

export interface ShellRouteDef {
   /** Stable identifier, also the tab key. */
   id: ShellRoute;
   /** What the sidebar and tab strip display. */
   label: string;
   /**
    * Catalogue key the rail and tabs render. `label` stays as the English
    * form for the persisted tab model, which runs outside React.
    */
   labelKey: ShellLabelKey;
   /** Inner SVG markup, drawn on a 24x24 viewBox with currentColor stroke. */
   icon: string;
   /**
    * Route this navigates to, relative to the workspace. Omitted for rail
    * placeholders that have no page yet.
    */
   href?: string;
   /**
    * Extra pathname fragments that count as this route being active, for the
    * singular detail paths that hang off a plural list (`/issue/…` under
    * `/tasks`). Matched with the same longest-match rule as `href`.
    */
   match?: string[];
   /**
    * Key in the sidebar preference store, when the user can pin or hide this
    * item. Every rail destination is pinnable.
    */
   prefsKey?: SidebarItemKey;
   /**
    * Show a live dot on this item while something is running, the way the rail
    * marks runtimes. Declared here rather than matched on `id` in the rail so
    * the route table stays the one description of what a route is.
    */
   live?: 'runs';
   /**
    * Show a count at the end of this item, the way Personal's Inbox row
    * counts unread: reviews waiting for a person. Named here for the same
    * reason as `live`: the rail asks the route what it carries, and the
    * route table stays the one answer. Approvals land in Inbox now.
    */
   badge?: 'reviews';
}

const WORK: ShellRouteDef[] = [
   {
      id: 'projects',
      label: 'projects',
      labelKey: 'projects',
      href: '/projects',
      match: ['/project/'],
      prefsKey: 'projects',
      icon: '<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" /><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" />',
   },
   {
      id: 'cycles',
      label: 'cycles',
      labelKey: 'cycles',
      href: '/cycles',
      match: ['/cycle/'],
      prefsKey: 'cycles',
      // A calendar page with one week marked: a cycle is a stretch of days.
      icon: '<path d="M4 6h16v14H4zM4 10h16M9 3v5M15 3v5M8 15h8" />',
   },
   {
      // The workspace's tasks, every one. Personal's "My tasks" opens the
      // same page on its assigned tab, and the shell lights whichever of the
      // two the URL names rather than both.
      id: 'issues',
      label: 'tasks',
      labelKey: 'tasks',
      href: '/tasks',
      match: ['/issue/'],
      prefsKey: 'my-issues',
      // Lucide Folders — stacked double folder.
      icon: '<path d="M20 5a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h2.5a1.5 1.5 0 0 1 1.2.6l.6.8a1.5 1.5 0 0 0 1.2.6z" /><path d="M3 8.268a2 2 0 0 0-1 1.738V19a2 2 0 0 0 2 2h11a2 2 0 0 0 1.732-1" />',
   },
   {
      id: 'loops',
      label: 'loops',
      labelKey: 'loops',
      href: '/loops',
      match: ['/loop/'],
      prefsKey: 'loops',
      // Lucide Atom.
      icon: '<circle cx="12" cy="12" r="1" /><path d="M20.2 20.2c2.04-2.03.02-7.36-4.5-11.9-4.54-4.52-9.87-6.54-11.9-4.5-2.04 2.03-.02 7.36 4.5 11.9 4.54 4.52 9.87 6.54 11.9 4.5Z" /><path d="M15.7 15.7c4.52-4.54 6.54-9.87 4.5-11.9-2.03-2.04-7.36-.02-11.9 4.5-4.52 4.54-6.54 9.87-4.5 11.9 2.03 2.04 7.36.02 11.9-4.5Z" />',
   },
];

// Routes with a page but no rail entry: they still resolve the active route
// and label their tabs, and are reached from the command palette.
const OFF_RAIL: ShellRouteDef[] = [
   {
      // Waiting on you, so Personal renders this rather than Work.
      id: 'reviews',
      label: 'reviews',
      labelKey: 'reviews',
      href: '/reviews',
      match: ['/review/'],
      icon: '<circle cx="7" cy="6" r="2" /><circle cx="7" cy="18" r="2" /><circle cx="17" cy="12" r="2" /><path d="M7 8v8M9 18h4a2 2 0 002-2v-2" />',
   },
   {
      // Every model call Berry made: the structured prompt it sent and what
      // came back. Settings, because it is where a person goes to debug.
      id: 'logs',
      label: 'logs',
      labelKey: 'logs',
      href: '/settings/logs',
      icon: '<path d="M6 4h9l3 3v13H6z" /><path d="M9 10h6M9 13h6M9 16h4" />',
   },
];

// Runtimes and Logs stay in Settings. Usage sits on the rail under Connect.
const MANAGE: ShellRouteDef[] = [
   {
      id: 'members',
      label: 'agents',
      labelKey: 'agents',
      href: '/agents',
      prefsKey: 'agents',
      // Lucide Cpu — same glyph run tabs use for a runtime without a logo.
      icon: '<path d="M12 20v2" /><path d="M12 2v2" /><path d="M17 20v2" /><path d="M17 2v2" /><path d="M2 12h2" /><path d="M2 17h2" /><path d="M2 7h2" /><path d="M20 12h2" /><path d="M20 17h2" /><path d="M20 7h2" /><path d="M7 20v2" /><path d="M7 2v2" /><rect x="4" y="4" width="16" height="16" rx="2" /><rect x="8" y="8" width="8" height="8" rx="1" />',
   },
   {
      id: 'skills',
      label: 'skills',
      labelKey: 'skills',
      href: '/skills',
      match: ['/skills/'],
      prefsKey: 'skills',
      // Lucide Lightbulb.
      icon: '<path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5" /><path d="M9 18h6M10 22h4" />',
   },
   {
      id: 'integrations',
      label: 'integrations',
      labelKey: 'integrations',
      href: '/integrations',
      match: ['/settings/plugins'],
      prefsKey: 'integrations',
      // Lucide Blocks — same glyph Settings uses for integrations.
      icon: '<path d="M10 22V7a1 1 0 0 0-1-1H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-5a1 1 0 0 0-1-1H2" /><rect x="14" y="2" width="8" height="8" rx="1" />',
   },
   {
      id: 'usage',
      label: 'usage',
      labelKey: 'usage',
      href: '/usage',
      match: ['/settings/usage'],
      prefsKey: 'usage',
      // Lucide ChartColumn — vertical bar chart.
      icon: '<path d="M3 3v16a2 2 0 0 0 2 2h16" /><path d="M18 17V9M13 17V5M8 17v-3" />',
   },
];

export const MORE_ICON =
   '<circle cx="6" cy="12" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="18" cy="12" r="1.4" />';

export const SHELL_SECTIONS: {
   heading: string | null;
   /** Key under `shell.sections`; null when the section has no heading. */
   headingKey: 'work' | 'manage' | null;
   routes: ShellRouteDef[];
   prefsSection?: SidebarSection;
}[] = [
   { heading: 'Work', headingKey: 'work', routes: WORK, prefsSection: 'workspace' },
   { heading: 'Manage', headingKey: 'manage', routes: MANAGE, prefsSection: 'configure' },
];

/** Every rail destination, for surfaces that label a path by its rail entry. */
export const SHELL_ROUTES: ShellRouteDef[] = [...WORK, ...MANAGE, ...OFF_RAIL];

const BY_ID = new Map<string, ShellRouteDef>(SHELL_ROUTES.map((route) => [route.id, route]));

/** The tasks page filtered to what is assigned to the person: Personal's view of it. */
export const MY_TASKS_HREF = '/tasks?tab=assigned';

export function isMyTasks(pathname: string, search?: string): boolean {
   return pathname.includes('/tasks') && /(?:^|[?&])tab=assigned(?:&|$)/.test(search ?? '');
}

/** The reviews list and a single review: Personal's Reviews, not Work. */
export function isReviews(pathname: string, orgId: string): boolean {
   return pathname.startsWith(`/${orgId}/review`);
}

export function shellRoute(id: string): ShellRouteDef | undefined {
   return BY_ID.get(id);
}

/**
 * Resolve the active route from a pathname.
 *
 * Longest match wins so `/projects/abc` resolves to `projects` rather than
 * matching a shorter unrelated prefix, and a detail path such as
 * `/milestone/abc/overview` lights up its list item through `match` rather than
 * through a bare `pathname.includes`, which would hand any path containing
 * a shorter route's name to the wrong item.
 */
export function activeShellRoute(pathname: string, search?: string): ShellRoute | null {
   // The assigned tab of the tasks page is Personal's "My tasks", not the
   // workspace's Tasks; lighting the rail entry too would mark two items.
   if (isMyTasks(pathname, search)) return null;
   let match: ShellRouteDef | null = null;
   // Tracked beside the match: `href` is optional on the type, so comparing
   // against `match.href` would need a non-null assertion even though a match
   // is only ever a route that has one.
   let matchLength = 0;
   for (const route of BY_ID.values()) {
      if (!route.href) continue;
      for (const candidate of [route.href, ...(route.match ?? [])]) {
         if (pathname.includes(candidate) && candidate.length > matchLength) {
            match = route;
            matchLength = candidate.length;
         }
      }
   }
   return match?.id ?? null;
}
