import assert from 'node:assert/strict';
import { test } from 'node:test';

import { catalogRole } from './catalog.ts';
import { toolsForAgentRow } from './enforcement.ts';

test('an agent outside the organization keeps its current behaviour', () => {
   assert.equal(toolsForAgentRow({ role_key: null, role_contract: null }), null);
});

test('an organization agent reaches only its effective tools', () => {
   const tools = toolsForAgentRow({ role_key: 'product-lead', role_contract: catalogRole('product-lead') });
   assert.ok(tools);
   assert.equal(tools.includes('run_command'), false);
   assert.equal(tools.includes('submit_review'), true);
   const ba = toolsForAgentRow({ role_key: 'business-analyst', role_contract: catalogRole('business-analyst') });
   assert.equal(ba?.includes('submit_review'), false);
});

test('a contract that fails validation degrades to read-only', () => {
   const tools = toolsForAgentRow({ role_key: 'backend-engineer', role_contract: { broken: true } });
   assert.deepEqual(tools, ['escalate', 'list_dependencies', 'list_files', 'post_comment', 'read_file', 'read_project_resources', 'read_task']);
});
