import { describe, expect, test } from 'bun:test';

import {
  getSettingsSection,
  SETTINGS_GROUPS,
  type SettingsSectionId,
} from './settings-sections';

describe('settings-sections', () => {
  test('contains all 18 expected sections grouped cleanly across 4 groups', () => {
    const allIds = SETTINGS_GROUPS.flatMap((group) => group.items.map((item) => item.id));
    expect(allIds).toHaveLength(18);
    expect(allIds).toEqual([
      'overview',
      'profile',
      'notifications',
      'shortcuts',
      'security',
      'tokens',
      'connectedAccounts',
      'workspace',
      'members',
      'runtimes',
      'modelTiers',
      'labels',
      'skillLabels',
      'properties',
      'quickActions',
      'usage',
      'integrations',
      'mcp',
    ]);
    expect(SETTINGS_GROUPS.map((g) => g.title)).toEqual([
      'General',
      'Personal',
      'Workspace',
      'Connections',
    ]);
    expect(SETTINGS_GROUPS.map((g) => g.items.length)).toEqual([1, 6, 9, 2]);
  });

  test('getSettingsSection returns exact metadata for every section id', () => {
    const ids: SettingsSectionId[] = [
      'overview',
      'profile',
      'notifications',
      'shortcuts',
      'security',
      'tokens',
      'connectedAccounts',
      'workspace',
      'members',
      'runtimes',
      'modelTiers',
      'labels',
      'skillLabels',
      'properties',
      'quickActions',
      'usage',
      'integrations',
      'mcp',
    ];
    for (const id of ids) {
      const section = getSettingsSection(id);
      expect(section.id).toBe(id);
      expect(section.label.length > 0).toBe(true);
      expect(section.description.length > 0).toBe(true);
      expect(section.group.length > 0).toBe(true);
    }

    const profile = getSettingsSection('profile');
    expect(profile.label).toBe('Preferences & Profile');
    expect(profile.group).toBe('Personal');

    const tokens = getSettingsSection('tokens');
    expect(tokens.id).toBe('tokens');
    expect(tokens.label).toBe('API Tokens');
    expect(tokens.group).toBe('Personal');

    const modelTiers = getSettingsSection('modelTiers');
    expect(modelTiers.label).toBe('Model Tiers');
    expect(modelTiers.group).toBe('Workspace');

    const integrations = getSettingsSection('integrations');
    expect(integrations.id).toBe('integrations');
    expect(integrations.label).toBe('Integrations');
    expect(integrations.group).toBe('Connections');

    const mcp = getSettingsSection('mcp');
    expect(mcp.id).toBe('mcp');
    expect(mcp.label).toBe('MCP Servers');
    expect(mcp.group).toBe('Connections');
  });
});
