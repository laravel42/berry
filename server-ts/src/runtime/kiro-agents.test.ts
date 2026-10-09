import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseKiroAgentList } from './kiro-agents.ts';

test('parses kiro-cli agent list, including the built-in marker', () => {
   const text = [
      'Workspace: ~/Code/berry/.kiro/agents',
      'Global:    ~/.kiro/agents',
      '',
      '* kiro_default    (Built-in)    Default agent',
      '  kiro_help       (Built-in)    Help agent that answers questions',
      '  kiro_planner    (Built-in)    Specialized planning agent',
   ].join('\n');
   assert.deepEqual(parseKiroAgentList(text), [
      { id: 'kiro_default', name: 'Default agent' },
      { id: 'kiro_help', name: 'Help agent that answers questions' },
      { id: 'kiro_planner', name: 'Specialized planning agent' },
   ]);
});
