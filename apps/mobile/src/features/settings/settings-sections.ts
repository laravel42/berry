export type SettingsSectionId =
  | 'overview'
  | 'profile'
  | 'tokens'
  | 'workspace'
  | 'members'
  | 'runtimes'
  | 'labels'
  | 'integrations'
  | 'usage';

export type SettingsSectionItem = {
  id: SettingsSectionId;
  label: string;
  description: string;
  group: string;
};

export type SettingsGroup = {
  id: string;
  title: string;
  items: readonly SettingsSectionItem[];
};

const OVERVIEW_SECTION: SettingsSectionItem = {
  id: 'overview',
  label: 'Overview',
  description: 'Workspace summary, notifications, server & account',
  group: 'General',
};

export const SETTINGS_GROUPS: readonly SettingsGroup[] = [
  {
    id: 'general',
    title: 'General',
    items: [OVERVIEW_SECTION],
  },
  {
    id: 'personal',
    title: 'Personal',
    items: [
      {
        id: 'profile',
        label: 'Profile & Account',
        description: 'Your name, email, workspace role and server session',
        group: 'Personal',
      },
      {
        id: 'tokens',
        label: 'API Tokens',
        description: 'Create and revoke personal access tokens',
        group: 'Personal',
      },
    ],
  },
  {
    id: 'workspace',
    title: 'Workspace',
    items: [
      {
        id: 'workspace',
        label: 'Workspace General',
        description: 'Slug, issue prefix, boards, projects and agents',
        group: 'Workspace',
      },
      {
        id: 'members',
        label: 'Members',
        description: 'Workspace members and their roles',
        group: 'Workspace',
      },
      {
        id: 'runtimes',
        label: 'AI Runtimes',
        description: 'Connected AI providers and compute runtimes',
        group: 'Workspace',
      },
      {
        id: 'labels',
        label: 'Issue Labels',
        description: 'Workspace issue labels and colors',
        group: 'Workspace',
      },
      {
        id: 'usage',
        label: 'Usage & Logs',
        description: 'Token spend, run totals and recent prompt logs',
        group: 'Workspace',
      },
    ],
  },
  {
    id: 'connections',
    title: 'Connections',
    items: [
      {
        id: 'integrations',
        label: 'Integrations & MCP',
        description: 'Connected providers and MCP servers',
        group: 'Connections',
      },
    ],
  },
];

export function getSettingsSection(id: SettingsSectionId): SettingsSectionItem {
  for (const group of SETTINGS_GROUPS) {
    const match = group.items.find((item) => item.id === id);
    if (match) return match;
  }
  return OVERVIEW_SECTION;
}
