import {
   Bell,
   Blocks,
   Braces,
   Building2,
   Keyboard,
   KeyRound,
   ListChecks,
   LucideIcon,
   Plug,
   Puzzle,
   Server,
   Settings,
   Sparkles,
   Tag,
   Users,
   UsersRound,
   Zap,
} from 'lucide-react';

export type SettingsGroupKey = 'personal' | 'workspace' | 'connections';

/**
 * The keys under `workspaceAdmin.nav`, spelled out rather than left as
 * `string`.
 *
 * The rail and the header dropdown both render `nav.${labelKey}`, and only a
 * union makes that a message key the compiler can check — with `string`, a
 * typo here would ship and surface as a raw key in the navigation.
 */
export type SettingsNavKey =
   | 'preferences'
   | 'notifications'
   | 'shortcuts'
   | 'security'
   | 'tokens'
   | 'connectedAccounts'
   | 'general'
   | 'members'
   | 'agents'
   | 'runtimes'
   | 'labels'
   | 'properties'
   | 'quickActions'
   | 'integrations'
   | 'mcp'
   | 'plugins';

interface SettingsNavItem {
   /** Key under `workspaceAdmin.nav` in the message catalogues. */
   labelKey: SettingsNavKey;
   /** Path under /{orgId}. */
   url: string;
   icon: LucideIcon;
}

interface SettingsNavGroup {
   /** Key under `workspaceAdmin.groups`. */
   labelKey: SettingsGroupKey;
   items: SettingsNavItem[];
}

/**
 * Settings navigation, rendered by the rail in settings mode and by the
 * narrow-screen dropdown in the settings header.
 *
 * Three groups: what is true of *me* (personal), what is true of *this
 * workspace* (workspace), and what Berry is *attached to* (connections).
 *
 * Only pages with a backend are listed. A workstream that ships a settings page
 * appends its item here in the same change; a page with nothing behind it is
 * not listed and not built.
 */
export const settingsNav: SettingsNavGroup[] = [
   {
      labelKey: 'personal',
      items: [
         { labelKey: 'preferences', url: '/settings/preferences', icon: Settings },
         { labelKey: 'notifications', url: '/settings/notifications', icon: Bell },
         { labelKey: 'shortcuts', url: '/settings/shortcuts', icon: Keyboard },
         { labelKey: 'security', url: '/settings/security', icon: KeyRound },
         { labelKey: 'tokens', url: '/settings/tokens', icon: Braces },
         { labelKey: 'connectedAccounts', url: '/settings/connected-accounts', icon: Users },
      ],
   },
   {
      labelKey: 'workspace',
      items: [
         { labelKey: 'general', url: '/settings/general', icon: Building2 },
         { labelKey: 'members', url: '/settings/members', icon: UsersRound },
         { labelKey: 'agents', url: '/settings/ai', icon: Sparkles },
         { labelKey: 'runtimes', url: '/settings/runtimes', icon: Server },
         { labelKey: 'labels', url: '/settings/issue-labels', icon: Tag },
         { labelKey: 'properties', url: '/settings/issue-properties', icon: ListChecks },
         { labelKey: 'quickActions', url: '/settings/quick-actions', icon: Zap },
      ],
   },
   {
      labelKey: 'connections',
      items: [
         { labelKey: 'integrations', url: '/settings/integrations', icon: Blocks },
         { labelKey: 'mcp', url: '/settings/mcp', icon: Plug },
         { labelKey: 'plugins', url: '/settings/plugins', icon: Puzzle },
      ],
   },
];
