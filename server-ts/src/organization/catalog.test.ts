import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { KNOWN_TOOLS, toolCeiling } from './autonomy.ts';
import { CATALOG, CORE_ROLES, catalogRole, WORKFLOWS } from './catalog.ts';
import { roleContractSchema } from './contract.ts';
import { PROMPT_SECTIONS } from './prompt.ts';

const keys = new Set(CATALOG.map((role) => role.id));

describe('the Berry organization catalog', () => {
   test('has the Orchestrator, five core roles and thirteen specialists, each a valid contract', () => {
      assert.equal(CATALOG.length, 20);
      assert.equal(keys.size, 20);
      for (const role of CATALOG) {
         const parsed = roleContractSchema.safeParse(role);
         assert.ok(parsed.success, `${role.id}: ${parsed.success ? '' : parsed.error.message}`);
      }
      for (const key of [
         'orchestrator', 'product-lead', 'business-analyst', 'ux-researcher', 'product-designer', 'software-engineer',
         'software-architect', 'backend-engineer', 'frontend-engineer', 'database-engineer',
         'integration-engineer', 'qa-engineer', 'security-engineer', 'devops-engineer', 'sre',
         'data-analytics-engineer', 'technical-writer', 'growth-engineer', 'engineering-manager', 'cto',
      ]) {
         assert.ok(keys.has(key), `missing ${key}`);
      }
      // ADR-0018: what every workspace is given.
      assert.deepEqual(
         [...CORE_ROLES],
         ['orchestrator', 'product-lead', 'product-designer', 'software-engineer', 'qa-engineer', 'devops-engineer']
      );
   });

   test('the core roles hand work to each other, and workflows name only core roles', () => {
      const core = new Set(CORE_ROLES);
      for (const key of CORE_ROLES) assert.ok(keys.has(key), `core ${key} is not in the catalog`);
      // Build work reaches the one core role that can push, from every role that plans or reviews it.
      for (const from of ['orchestrator', 'product-lead', 'product-designer', 'qa-engineer', 'devops-engineer']) {
         assert.ok(catalogRole(from)!.can_delegate_to.includes('software-engineer'), `${from} cannot reach the engineer`);
      }
      assert.ok(catalogRole('software-engineer')!.allowed_tools.includes('run_command'));
      for (const workflow of WORKFLOWS) {
         for (const role of workflow.chain) assert.ok(core.has(role), `${workflow.key} names specialist ${role}`);
      }
   });

   test('delegation is symmetric and only names catalog roles', () => {
      for (const role of CATALOG) {
         for (const target of role.can_delegate_to) {
            assert.ok(keys.has(target), `${role.id} → unknown ${target}`);
            assert.ok(catalogRole(target)?.receives_work_from.includes(role.id), `${target} does not receive from ${role.id}`);
         }
         for (const source of role.receives_work_from) {
            assert.ok(catalogRole(source)?.can_delegate_to.includes(role.id), `${source} does not delegate to ${role.id}`);
         }
      }
   });

   test('tools exist and sit inside each role’s ceiling', () => {
      for (const role of CATALOG) {
         const ceiling = toolCeiling(role.autonomy_level);
         for (const tool of role.allowed_tools) {
            assert.ok(KNOWN_TOOLS.includes(tool), `${role.id}: unknown tool ${tool}`);
            assert.ok(ceiling.includes(tool), `${role.id}: ${tool} above Level ${role.autonomy_level}`);
         }
      }
   });

   test('reviewers and escalation targets exist, nobody reviews itself', () => {
      for (const role of CATALOG) {
         for (const rule of role.review_requirements) {
            assert.ok(keys.has(rule.reviewer), `${role.id}: reviewer ${rule.reviewer}`);
            assert.notEqual(rule.reviewer, role.id);
            assert.equal(catalogRole(rule.reviewer)?.autonomy_level, rule.authority === 'blocking' ? 5 : catalogRole(rule.reviewer)?.autonomy_level);
         }
         for (const rule of role.escalation_rules) {
            assert.ok(rule.to === 'human' || keys.has(rule.to), `${role.id}: escalates to ${rule.to}`);
         }
      }
   });

   test('five Level 5 roles, each with review domains; no one else reviews', () => {
      const authorities = CATALOG.filter((role) => role.autonomy_level === 5).map((role) => role.id).sort();
      assert.deepEqual(authorities, ['cto', 'product-lead', 'qa-engineer', 'security-engineer', 'software-architect']);
      for (const role of CATALOG) {
         assert.equal(role.review_domains.length > 0, role.autonomy_level === 5, role.id);
      }
   });

   test('roles that must never implement have no code tools', () => {
      for (const key of ['product-lead', 'cto', 'engineering-manager', 'orchestrator', 'business-analyst']) {
         assert.equal(catalogRole(key)?.allowed_tools.includes('run_command'), false, key);
      }
   });

   test('only the orchestrator and the product lead file goals and plans', () => {
      for (const role of CATALOG) {
         const planner = role.id === 'orchestrator' || role.id === 'product-lead';
         assert.equal(role.allowed_tools.includes('create_goal'), planner, role.id);
         assert.equal(role.allowed_tools.includes('create_plan'), planner, role.id);
      }
   });

   test('roles are on Berry tiers, and name no model or vendor', () => {
      assert.equal(catalogRole('cto')?.tier, 'berry_max');
      assert.equal(catalogRole('software-architect')?.tier, 'berry_max');
      for (const key of ['business-analyst', 'ux-researcher', 'technical-writer', 'data-analytics-engineer', 'growth-engineer']) {
         assert.equal(catalogRole(key)?.tier, 'berry_low', key);
      }
      for (const role of CATALOG) {
         assert.ok(['berry_max', 'berry_mid', 'berry_low'].includes(role.tier ?? ''), role.id);
         assert.equal(role.preferred_model, undefined, role.id);
      }
   });

   test('prompts name the role, the mission and the prohibitions, within the column limit', () => {
      for (const role of CATALOG) {
         assert.ok(role.system_prompt.length <= 20000, role.id);
         assert.ok(role.system_prompt.includes(role.role), `${role.id}: title`);
         assert.ok(role.system_prompt.includes(role.mission), `${role.id}: mission`);
         for (const rule of role.never) assert.ok(role.system_prompt.includes(rule), `${role.id}: ${rule}`);
         assert.doesNotMatch(role.system_prompt, /helpful (software engineering )?(agent|assistant)/i);
      }
   });

   test('prompts are written in the Instructions sections, in order', () => {
      const headings = Object.values(PROMPT_SECTIONS).map((heading) => `## ${heading}`);
      for (const role of CATALOG) {
         const found = role.system_prompt.split('\n').filter((line) => line.startsWith('## '));
         assert.deepEqual(found, headings, role.id);
      }
   });

   test('discovery: every role but the Orchestrator, weekly, no two in the same hour', () => {
      const slots = new Set<string>();
      for (const role of CATALOG) {
         if (role.id === 'orchestrator') {
            assert.equal(role.discovery, null);
            continue;
         }
         assert.ok(role.discovery, role.id);
         const [minute, hour, dom, month, dow] = role.discovery.cron.split(' ');
         assert.equal(dom, '*');
         assert.equal(month, '*');
         assert.match(dow ?? '', /^[1-5]$/);
         assert.match(minute ?? '', /^\d+$/);
         const slot = `${dow} ${hour}`;
         assert.equal(slots.has(slot), false, `${role.id} shares ${slot}`);
         slots.add(slot);
      }
   });

   test('workflows only name catalog roles', () => {
      assert.deepEqual(
         WORKFLOWS.map((workflow) => workflow.key).sort(),
         ['authentication-system', 'database-performance', 'frontend-visual-bug', 'full-delivery', 'new-product-feature', 'production-incident']
      );
      for (const workflow of WORKFLOWS) {
         for (const step of workflow.chain) assert.ok(keys.has(step), `${workflow.key}: ${step}`);
      }
   });
});

test('a level set by a person brings every tool it allows; planning stays with the planners', async () => {
   const { toolsForLevel } = await import('./catalog.ts');
   const { toolCeiling } = await import('./autonomy.ts');
   assert.ok(toolsForLevel('business-analyst', 3).includes('run_command'));
   assert.ok(!toolsForLevel('business-analyst', 2).includes('run_command'));
   assert.ok(!toolsForLevel('business-analyst', 3).includes('create_plan'));
   assert.ok(toolsForLevel('product-lead', 5).includes('create_plan'));
   for (const tool of toolsForLevel('backend-engineer', 4)) assert.ok(toolCeiling(4).includes(tool), tool);
});

test('a role that hands work on is told not to hand on a review of its own work', () => {
   for (const role of CATALOG) {
      if (role.can_delegate_to.length === 0) continue;
      assert.match(role.system_prompt, /never ask another role to review or test what you did/, role.id);
   }
});

test('a role that runs commands is told not to install large tools to check its work; others are not', () => {
   for (const role of CATALOG) {
      const told = /Do not install browsers or other large tools just to check your work/.test(role.system_prompt);
      assert.equal(told, role.allowed_tools.includes('run_command'), role.id);
      // Told the tools that do it for them, or the advice is only a refusal.
      if (told) assert.match(role.system_prompt, /check_page .*check_performance/, role.id);
   }
});
