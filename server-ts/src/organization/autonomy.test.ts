import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import {
   effectivePermissions,
   effectiveTools,
   INVALID_CONTRACT_TOOLS,
   KNOWN_TOOLS,
   toolCeiling,
} from './autonomy.ts';
import { hashContract, parseContract, type RoleContract } from './contract.ts';

const base: RoleContract = {
   id: 'backend-engineer',
   name: 'Backend Engineer',
   role: 'Senior Backend Engineer',
   department: 'engineering',
   mission: 'Implement reliable backend systems.',
   responsibilities: ['Implement APIs.'],
   capabilities: ['backend'],
   allowed_tools: ['read_task', 'run_command', 'create_task', 'submit_review'],
   preferred_model: 'us.anthropic.claude-sonnet-5',
   inputs: ['Approved architecture'],
   outputs: ['Production code'],
   can_delegate_to: ['qa-engineer'],
   receives_work_from: ['engineering-manager'],
   escalation_rules: [{ when: 'Architecture unclear', to: 'software-architect', decision: 'technical' }],
   review_requirements: [{ reviewer: 'qa-engineer', authority: 'blocking', when: { always: true } }],
   autonomy_level: 4,
   review_domains: [],
   discovery: null,
   run_limits: { max_turns: 40, max_output_tokens: 8000 },
   never: ['Merge your own work.'],
   system_prompt: 'You are the Senior Backend Engineer.',
};

describe('autonomy ceilings', () => {
   test('each level includes the level below it', () => {
      for (const level of [2, 3, 4, 5] as const) {
         const lower = toolCeiling((level - 1) as 1 | 2 | 3 | 4);
         for (const tool of lower) assert.ok(toolCeiling(level).includes(tool), `${tool} missing at ${level}`);
      }
   });

   test('only Level 5 may submit reviews, only Level 3+ may run commands', () => {
      assert.equal(toolCeiling(4).includes('submit_review'), false);
      assert.equal(toolCeiling(5).includes('submit_review'), true);
      assert.equal(toolCeiling(2).includes('run_command'), false);
      assert.equal(toolCeiling(3).includes('run_command'), true);
   });

   test('effective tools are the allowed tools inside the ceiling', () => {
      // Level 4 cannot review even when the contract lists the tool.
      assert.deepEqual(effectiveTools(base), ['create_task', 'read_task', 'run_command']);
   });

   test('code permissions follow run_command, never merge', () => {
      assert.deepEqual(effectivePermissions(base), [
         'read_repository',
         'create_branches',
         'run_commands',
         'open_pull_requests',
      ]);
      const leader = { ...base, autonomy_level: 5 as const, allowed_tools: ['read_task', 'submit_review'] };
      assert.deepEqual(effectivePermissions(leader), ['read_repository']);
   });

   test('every ceiling tool is a known tool', () => {
      for (const tool of toolCeiling(5)) assert.ok(KNOWN_TOOLS.includes(tool), tool);
      for (const tool of INVALID_CONTRACT_TOOLS) assert.ok(toolCeiling(1).includes(tool), tool);
   });
});

describe('contract parsing', () => {
   test('a valid contract parses and hashes stably regardless of key order', () => {
      const parsed = parseContract(base);
      assert.ok(parsed);
      const reordered = Object.fromEntries(Object.entries(base).reverse()) as RoleContract;
      assert.equal(hashContract(base), hashContract(reordered));
      assert.match(hashContract(base), /^[0-9a-f]{64}$/);
   });

   test('an invalid contract is null, not a throw', () => {
      assert.equal(parseContract({ ...base, autonomy_level: 7 }), null);
      assert.equal(parseContract('nope'), null);
   });

   test('oversized contract (exceeds 65536 bytes) is null', () => {
      // 40 strings of 2000 'x' characters each (valid per item, but over total size)
      const tooLarge = {
         ...base,
         responsibilities: Array.from({ length: 40 }, () => 'x'.repeat(2000)),
      };
      assert.equal(parseContract(tooLarge), null);
   });

   test('allowed_tools item exceeding 64 characters is null', () => {
      // One tool name with 65 characters (exceeds per-item max)
      const tooLongTool = {
         ...base,
         allowed_tools: ['x'.repeat(65)],
      };
      assert.equal(parseContract(tooLongTool), null);
   });
});
