import type { ShellLabelKey } from './shell-routes';

/**
 * What a route looks like when shown in a tab.
 *
 * Tabs hold detail routes (`/review/a929…`, `/issue/ELI-26`) as well as rail
 * destinations, so a label cannot be looked up from the nav table alone.
 */
export interface RouteDescriptor {
   label: string;
   href: string;
}

/**
 * Every label a tab can carry, as a key under `shell.nav`. The rail's own
 * keys plus the sections that have pages but no rail entry.
 */
export type TabLabelKey =
   ShellLabelKey | 'inbox' | 'runs' | 'plans' | 'views' | 'attachments' | 'plugins' | 'profiles';

/**
 * Path segments that name a section, and what each reads as.
 *
 * Singular detail paths (`/issue/`, `/review/`) read as their list: a review
 * open in a tab is still "Reviews", the way a browser tab on one message
 * still says which mailbox it came from. Old spellings (`my-issues`,
 * `members`) stay so a tab persisted before a rename still reads.
 */
const SECTION_KEYS: Record<string, TabLabelKey> = {
   'tasks': 'tasks',
   'my-issues': 'tasks',
   'issue': 'tasks',
   'agents': 'agents',
   'agent': 'agents',
   'members': 'agents',
   'runs': 'runs',
   'runtimes': 'runtimes',
   'project': 'projects',
   'projects': 'projects',
   'plan': 'plans',
   'plans': 'plans',
   'goal': 'goals',
   'goals': 'goals',
   'approval': 'inbox',
   'approvals': 'inbox',
   'review': 'reviews',
   'reviews': 'reviews',
   'view': 'views',
   'views': 'views',
   'inbox': 'inbox',
   'chat': 'chat',
   'proposals': 'inbox',
   'skills': 'skills',
   'autopilot': 'autopilots',
   'autopilots': 'autopilots',
   // The Dashboard merged into Usage; a tab saved on it reads as Usage.
   'dashboard': 'usage',
   'usage': 'usage',
   'logs': 'logs',
   'attachments': 'attachments',
   'plugins': 'plugins',
   'profiles': 'profiles',
};

/** Looks like an issue key (BER-404), which the prototype shows verbatim. */
const ISSUE_KEY = /^[a-z][a-z0-9]*-\d+$/i;

/**
 * How a tab reads, before translation.
 *
 * `nav` is a section the strip translates; `issue` is a key that identifies
 * itself in every language; `raw` is whatever the tab stored, for a path the
 * table does not know.
 */
export type TabLabel =
   | { kind: 'nav'; key: TabLabelKey }
   | { kind: 'issue'; key: string }
   | { kind: 'raw'; text: string };

/**
 * Resolve a workspace-relative href to a label, at render time.
 *
 * Resolved from the href rather than read from the tab so switching language
 * renames open tabs, and so a tab persisted under an older labelling scheme
 * reads like its neighbours. The detail id is never shown: a UUID in a tab
 * is noise, and the page names the tab itself once it knows its record
 * (`useTabLabel`).
 */
export function tabLabelFor(href: string, fallback: string): TabLabel {
   const path = href.split('?')[0] ?? href;
   const segments = path.split('/').filter(Boolean);
   const [section, ...rest] = segments;
   if (!section) return { kind: 'raw', text: fallback };

   const detail = rest[rest.length - 1];
   if (detail && ISSUE_KEY.test(detail)) return { kind: 'issue', key: detail.toUpperCase() };

   const key = SECTION_KEYS[section];
   if (key) return { kind: 'nav', key };
   return { kind: 'raw', text: fallback };
}

/**
 * Strip the workspace prefix so tabs are portable between workspaces and two
 * paths differing only by org do not become two tabs.
 */
function workspaceRelative(pathname: string, orgId: string): string | null {
   const prefix = `/${orgId}`;
   if (pathname === prefix) return '/';
   if (!pathname.startsWith(`${prefix}/`)) return null;
   return pathname.slice(prefix.length);
}

function capitalise(text: string): string {
   return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Describe the tab for a pathname, or null when the path is not tabbable.
 *
 * The label stored here is the English fallback the persisted model keeps,
 * which runs outside React; what the strip shows comes from `tabLabelFor`.
 *
 * Settings is deliberately excluded: it is a modal destination reached from the
 * rail's help control, and tabbing it would leave a tab pointing at a surface
 * the user thinks they closed.
 */
export function describeRoute(pathname: string, orgId: string): RouteDescriptor | null {
   const relative = workspaceRelative(pathname, orgId);
   if (!relative || relative === '/') return null;
   if (relative.startsWith('/settings')) return null;

   const segments = relative.split('/').filter(Boolean);
   const section = segments[0];
   if (!section) return null;

   const resolved = tabLabelFor(relative, capitalise(section));
   const label =
      resolved.kind === 'nav'
         ? capitalise(resolved.key)
         : resolved.kind === 'issue'
           ? resolved.key
           : resolved.text;
   return { label, href: relative };
}
