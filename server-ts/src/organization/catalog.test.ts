import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { KNOWN_TOOLS, toolCeiling } from './autonomy.ts';
import { CATALOG, catalogRole, MODELS, WORKFLOWS } from './catalog.ts';
import { roleContractSchema } from './contract.ts';

const keys = new Set(CATALOG.map((role) => role.id));

describe('the Berry organization catalog', () => {
   test('has the 18 roles and the Orchestrator, each a valid contract', () => {
      assert.equal(CATALOG.length, 19);
      assert.equal(keys.size, 19);
      for (const role of CATALOG) {
         const parsed = roleContractSchema.safeParse(role);
         assert.ok(parsed.success, `${role.id}: ${parsed.success ? '' : parsed.error.message}`);
      }
      for (const key of [
         'orchestrator', 'product-lead', 'business-analyst', 'ux-researcher', 'product-designer',
         'software-architect', 'backend-engineer', 'frontend-engineer', 'database-engineer',
         'integration-engineer', 'qa-engineer', 'security-engineer', 'devops-engineer', 'sre',
         'data-analytics-engineer', 'technical-writer', 'growth-engineer', 'engineering-manager', 'cto',
      ]) {
         assert.ok(keys.has(key), `missing ${key}`);
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
      for (const key of ['product-lead', 'cto', 'engineering-manager', 'orchestrator', 'business-analyst', 'ux-researcher', 'product-designer']) {
         assert.equal(catalogRole(key)?.allowed_tools.includes('run_command'), false, key);
      }
   });

   test('models are the three tiers the spec fixes', () => {
      assert.equal(catalogRole('cto')?.preferred_model, MODELS.opus);
      assert.equal(catalogRole('software-architect')?.preferred_model, MODELS.opus);
      for (const key of ['business-analyst', 'ux-researcher', 'technical-writer', 'data-analytics-engineer', 'growth-engineer']) {
         assert.equal(catalogRole(key)?.preferred_model, MODELS.haiku, key);
      }
      for (const role of CATALOG) {
         assert.ok(Object.values(MODELS).includes(role.preferred_model), role.id);
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
