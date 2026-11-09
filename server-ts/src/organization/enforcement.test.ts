import assert from 'node:assert/strict';
import { test } from 'node:test';

import { catalogRole } from './catalog.ts';
import type { Sql } from '../db/pool.ts';
import { agentToolAllowlist, toolsForAgentRow } from './enforcement.ts';

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

/**
 * Answers the reads the allowlist makes: the agent row, the Loop that started
 * the run (none, unless `loop` is given), then the run.
 */
function fakeSql(
   agent: { role_key: string | null; role_contract: unknown },
   chatSessionId: string | null,
   loop: { access_mode: string; max_turns: number | null } | null = null
): Sql {
   return (async (strings: TemplateStringsArray) => {
      const text = strings.join('?');
      if (text.includes('autopilot_runs')) return loop ? [{ autopilot_id: 'loop', autopilot_run_id: 'loop-run', ...loop }] : [];
      return text.includes('FROM runs') ? [{ chat_session_id: chatSessionId }] : [agent];
   }) as unknown as Sql;
}

test('a chat lets any organization role plan; its tasks do not', async () => {
   const analyst = { role_key: 'business-analyst', role_contract: catalogRole('business-analyst') };
   const chat = await agentToolAllowlist(fakeSql(analyst, 'conversation-1'), 'agent', 'run');
   assert.equal(chat?.has('create_plan'), true);
   assert.equal(chat?.has('create_milestone'), true);
   const task = await agentToolAllowlist(fakeSql(analyst, null), 'agent', 'run');
   assert.equal(task?.has('create_plan'), false);
});

test('a chat gives nothing new to a contract that fails validation', async () => {
   const broken = { role_key: 'backend-engineer', role_contract: { broken: true } };
   const chat = await agentToolAllowlist(fakeSql(broken, 'conversation-1'), 'agent', 'run');
   assert.equal(chat?.has('create_plan'), false);
});

test('a run a Loop started in recommend mode is held below the agent, whatever its contract', async () => {
   const engineer = { role_key: 'software-engineer', role_contract: catalogRole('software-engineer') };
   const own = await agentToolAllowlist(fakeSql(engineer, null), 'agent', 'run');
   const loop = await agentToolAllowlist(fakeSql(engineer, null, { access_mode: 'recommend', max_turns: null }), 'agent', 'run');
   assert.equal(own?.has('run_command'), true);
   assert.equal(loop?.has('run_command'), false);
   assert.equal(loop?.has('set_status'), false);
   assert.equal(loop?.has('post_comment'), true);
   for (const tool of loop ?? []) assert.equal(own?.has(tool), true, `${tool} is not the agent's own`);
});

test('an agent outside the organization is closed, not open, under a recommend-mode Loop', async () => {
   const outsider = { role_key: null, role_contract: null };
   assert.equal(await agentToolAllowlist(fakeSql(outsider, null), 'agent', 'run'), null);
   const loop = await agentToolAllowlist(fakeSql(outsider, null, { access_mode: 'recommend', max_turns: null }), 'agent', 'run');
   assert.equal(loop?.has('run_command'), false);
   assert.equal(loop?.has('read_task'), true);
});

test('an act-mode Loop leaves the agent exactly as its contract has it', async () => {
   const engineer = { role_key: 'software-engineer', role_contract: catalogRole('software-engineer') };
   const own = await agentToolAllowlist(fakeSql(engineer, null), 'agent', 'run');
   const loop = await agentToolAllowlist(fakeSql(engineer, null, { access_mode: 'act', max_turns: null }), 'agent', 'run');
   assert.deepEqual([...(loop ?? [])].sort(), [...(own ?? [])].sort());
});
