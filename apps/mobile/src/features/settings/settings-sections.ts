export type SettingsSectionId =
  | 'overview'
  | 'profile'
  | 'notifications'
  | 'shortcuts'
  | 'security'
  | 'tokens'
  | 'connectedAccounts'
  | 'workspace'
  | 'members'
  | 'runtimes'
  | 'modelTiers'
  | 'labels'
  | 'skillLabels'
  | 'properties'
  | 'quickActions'
  | 'usage'
  | 'integrations'
  | 'mcp';

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
  description: 'Workspace summary, app notifications, server & account',
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
        label: 'Preferences & Profile',
        description: 'Name, language, theme, timezone & reduced motion',
        group: 'Personal',
      },
      {
        id: 'notifications',
        label: 'Notifications',
        description: 'Platform inbox notification preferences per workspace',
        group: 'Personal',
      },
      {
        id: 'shortcuts',
        label: 'Keyboard Shortcuts',
        description: 'Reference of Berry keyboard shortcuts',
        group: 'Personal',
      },
      {
        id: 'security',
        label: 'Security & Access',
        description: 'Active sessions and signed-in devices',
        group: 'Personal',
      },
      {
        id: 'tokens',
        label: 'API Tokens',
        description: 'Create and revoke personal access tokens',
        group: 'Personal',
      },
      {
        id: 'connectedAccounts',
        label: 'Connected Accounts',
        description: 'Addresses where Berry can reach you',
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
        label: 'General',
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
        id: 'modelTiers',
        label: 'Model Tiers',
        description: 'Model placement across BerryMax to BerryLow',
        group: 'Workspace',
      },
      {
        id: 'labels',
        label: 'Issue Labels',
        description: 'Workspace issue labels and colors',
        group: 'Workspace',
      },
      {
        id: 'skillLabels',
        label: 'Skill Labels',
        description: 'Skill catalogue labels and colors',
        group: 'Workspace',
      },
      {
        id: 'properties',
        label: 'Issue Properties',
        description: 'Custom task fields for this workspace',
        group: 'Workspace',
      },
      {
        id: 'quickActions',
        label: 'Quick Actions',
        description: 'Prompt templates agents run on tasks',
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
        label: 'Integrations',
        description: 'Connected workspace providers like GitHub',
        group: 'Connections',
      },
      {
        id: 'mcp',
        label: 'MCP Servers',
        description: 'Configured Model Context Protocol servers',
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
