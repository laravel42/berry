import { describe, expect, test } from 'bun:test';

import {
  getSettingsSection,
  SETTINGS_GROUPS,
  type SettingsSectionId,
} from './settings-sections';

describe('settings-sections', () => {
  test('contains all 9 expected sections grouped cleanly', () => {
    const allIds = SETTINGS_GROUPS.flatMap((group) => group.items.map((item) => item.id));
    expect(allIds).toEqual([
      'overview',
      'profile',
      'tokens',
      'workspace',
      'members',
      'runtimes',
      'labels',
      'usage',
      'integrations',
    ]);
    expect(SETTINGS_GROUPS.map((g) => g.title)).toEqual([
      'General',
      'Personal',
      'Workspace',
      'Connections',
    ]);
  });

  test('getSettingsSection returns exact metadata for every section id', () => {
    const ids: SettingsSectionId[] = [
      'overview',
      'profile',
      'tokens',
      'workspace',
      'members',
      'runtimes',
      'labels',
      'integrations',
      'usage',
    ];
    for (const id of ids) {
      const section = getSettingsSection(id);
      expect(section.id).toBe(id);
      expect(section.label.length > 0).toBe(true);
      expect(section.description.length > 0).toBe(true);
      expect(section.group.length > 0).toBe(true);
    }

    const tokens = getSettingsSection('tokens');
    expect(tokens.id).toBe('tokens');
    expect(tokens.label).toBe('API Tokens');
    expect(tokens.group).toBe('Personal');

    const integrations = getSettingsSection('integrations');
    expect(integrations.id).toBe('integrations');
    expect(integrations.label).toBe('Integrations & MCP');
    expect(integrations.group).toBe('Connections');
  });
});
