# Berry Organization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every Berry workspace gets a default organization of 18 role agents plus the Orchestrator, each with an enforced contract (autonomy, tools, delegation, reviews, escalation) and weekly work discovery that files evidence-backed proposals.

**Architecture:** A typed catalog in `server-ts/src/organization/` is the source of role contracts. `ensureOrganization` writes them onto agent rows (new `role_key`, `role_contract`, `contract_version`, `contract_hash`, `autonomy_level` columns) at workspace creation and at boot. Autonomy levels are ceilings enforced in the runtime and the Berry tool API; new tools (`delegate_to_agent`, `escalate`, `propose_work`, `submit_review`) implement delegation, escalation, discovery and domain review; the ReviewGate runs multiple required reviews; discovery is one autopilot per role.

**Tech Stack:** Node 22 + TypeScript run with `--experimental-strip-types` (no build, `erasableSyntaxOnly`), Zod 4, postgres.js raw SQL, Hono mounts, `node --test`; Next.js 15 + next-intl + Zod 3 frontend.

**Spec:** `docs/superpowers/specs/2026-09-14-berry-organization-design.md`

## Global Constraints

- Server imports are relative with explicit `.ts`; no enums, namespaces or parameter properties; `import type` for type-only imports; `strict`, no `any`, no `!` where narrowing works.
- Migrations are forward-only and immutable: add `server-ts/migrations/186_berry_organization.up.sql` (+ `.down.sql` if the runner requires pairs); never edit an applied one.
- No agent merges: `merge_without_approval` is in no autonomy ceiling. No agent moves a task to `done`.
- Model ids (Bedrock inference profiles): Opus 5 `us.anthropic.claude-opus-5`, Sonnet 5 `us.anthropic.claude-sonnet-5`, Haiku 4.5 `us.anthropic.claude-haiku-4-5-20251001-v1:0`.
- `agents.instructions` ≤ 20000 chars; `role_contract` ≤ 65536 bytes; `manifest_limits` ≤ 2048 bytes.
- Discovery: weekly, staggered, `quota_period = 'week'`, `quota_max = 1`, at most 5 proposals per run, seeded `active`, workspace switch `settings.organization.discovery` (default true).
- Wire shapes stay stable: new API fields are additive, camelCase on the wire.
- Database tests are gated on `BERRY_TEST_DATABASE_URL` and skip without it. Local test DB: `postgres://postgres@127.0.0.1:5432/berry_test?sslmode=disable` (C collation). **Never use Docker.**
- Frontend: Prettier 3-space, single quotes; every string in en, ja, ko, zh-Hans; verify with `pnpm lint`, `npx tsc --noEmit`, `pnpm build:check` (never plain `pnpm build` while `next dev` runs).
- Commits only when the user asks (project rule); tasks end with verification instead of a commit.

## File Map

| File | Responsibility |
| --- | --- |
| `server-ts/src/organization/contract.ts` | Zod `RoleContract` schema, `parseContract`, `hashContract` |
| `server-ts/src/organization/autonomy.ts` | Level ceilings, `effectiveTools`, `effectivePermissions`, `KNOWN_TOOLS` |
| `server-ts/src/organization/catalog.ts` | 19 role specs (18 + Orchestrator), workflows, review rules, `CATALOG`, `CATALOG_VERSION` |
| `server-ts/src/organization/prompt.ts` | `renderSystemPrompt(spec, derived)` |
| `server-ts/src/organization/catalog.test.ts` | Catalog validation rules (spec §5) |
| `server-ts/src/organization/provision.ts` | `ensureOrganization(sql, workspaceId)` |
| `server-ts/src/organization/delegation.ts` | `canDelegate(from, to)` over stored contracts |
| `server-ts/src/organization/reviews.ts` | `requiredReviews(input)` |
| `server-ts/src/organization/proposals.ts` | `fingerprintProposal`, `acceptDecision`, `WorkProposalRepository` |
| `server-ts/src/organization/discovery.ts` | Discovery autopilot definitions, cron staggering, fire-time skip |
| `server-ts/src/organization/tools.ts` | `delegate_to_agent`, `escalate`, `propose_work`, `submit_review` |
| `server-ts/src/mounts/organization.ts` | `/api/v1/organization`, `/api/v1/work-proposals` |
| `server-ts/migrations/186_berry_organization.up.sql` | Columns, `work_proposals`, approval kinds, auto-review changes |
| `frontend/lib/organization.ts` | Client for organization and proposals |
| `frontend/components/common/agents/agent-role-tab.tsx` | Role tab |
| `frontend/components/common/settings/organization-settings.tsx` | Settings → Organization |
| `frontend/components/common/proposals/proposals.tsx` | Proposals view |

---

### Task 1: Contract schema and autonomy ceilings

**Files:**
- Create: `server-ts/src/organization/contract.ts`
- Create: `server-ts/src/organization/autonomy.ts`
- Test: `server-ts/src/organization/autonomy.test.ts`

**Interfaces:**
- Produces:
  - `type RoleKey = string`
  - `type Department = 'operations' | 'product' | 'engineering' | 'quality-security' | 'platform' | 'growth-insight' | 'leadership'`
  - `type AutonomyLevel = 1 | 2 | 3 | 4 | 5`
  - `const roleContractSchema: z.ZodType<RoleContract>`; `type RoleContract = z.infer<typeof roleContractSchema>`
  - `function parseContract(value: unknown): RoleContract | null`
  - `function hashContract(contract: RoleContract): string` (sha256 hex of canonical JSON, keys sorted)
  - `const KNOWN_TOOLS: readonly string[]`
  - `function toolCeiling(level: AutonomyLevel): readonly string[]`
  - `function effectiveTools(contract: Pick<RoleContract, 'allowed_tools' | 'autonomy_level'>): string[]`
  - `function effectivePermissions(contract: Pick<RoleContract, 'allowed_tools' | 'autonomy_level'>): Permission[]`
  - `const INVALID_CONTRACT_TOOLS: readonly string[]` (Level 1 read-only set used when a stored contract fails validation)

- [ ] **Step 1: Write the failing test**

`server-ts/src/organization/autonomy.test.ts`:

```ts
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
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server-ts && node --test --experimental-strip-types src/organization/autonomy.test.ts`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `./autonomy.ts`.

- [ ] **Step 3: Write `contract.ts`**

```ts
import { createHash } from 'node:crypto';

import { z } from 'zod';

/**
 * A role agent's contract: what it owns, what it may do, whom it hands work
 * to, who reviews it and where it escalates. Stored on the agent row
 * (`agents.role_contract`) and validated here, on every read, so a hand-edited
 * row cannot grant what the schema does not describe.
 */

export const DEPARTMENTS = [
   'operations',
   'product',
   'engineering',
   'quality-security',
   'platform',
   'growth-insight',
   'leadership',
] as const;

export type Department = (typeof DEPARTMENTS)[number];
export type RoleKey = string;
export type AutonomyLevel = 1 | 2 | 3 | 4 | 5;

const roleKey = z.string().regex(/^[a-z][a-z0-9-]{1,48}$/);
const text = z.string().trim().min(1).max(2000);
const list = z.array(text).max(40);

export const reviewConditionSchema = z.object({
   labels_any: z.array(z.string().min(1)).max(20).optional(),
   paths_any: z.array(z.string().min(1)).max(40).optional(),
   impact_any: z.array(z.string().min(1)).max(10).optional(),
   workflow_any: z.array(z.string().min(1)).max(10).optional(),
   always: z.literal(true).optional(),
});

export const roleContractSchema = z.object({
   id: roleKey,
   name: z.string().trim().min(1).max(100),
   role: z.string().trim().min(1).max(200),
   department: z.enum(DEPARTMENTS),
   mission: text,
   responsibilities: list,
   capabilities: z.array(z.string().regex(/^[a-z][a-z0-9-]*$/)).max(20),
   allowed_tools: z.array(z.string().min(1)).max(40),
   preferred_model: z.string().min(1).max(200),
   inputs: list,
   outputs: list,
   can_delegate_to: z.array(roleKey).max(30),
   receives_work_from: z.array(roleKey).max(30),
   escalation_rules: z
      .array(
         z.object({
            when: text,
            to: z.union([roleKey, z.literal('human')]),
            decision: z.enum(['product', 'technical', 'security', 'operational']),
         })
      )
      .max(10),
   review_requirements: z
      .array(
         z.object({
            reviewer: roleKey,
            authority: z.enum(['blocking', 'advisory']),
            when: reviewConditionSchema,
         })
      )
      .max(20),
   autonomy_level: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(5)]),
   review_domains: z.array(text).max(10),
   discovery: z
      .object({
         cron: z.string().min(9).max(100),
         focus: list,
         evidence_sources: list,
      })
      .nullable(),
   run_limits: z.object({
      max_turns: z.number().int().min(1).max(200),
      max_output_tokens: z.number().int().min(256).max(64000),
   }),
   never: list,
   system_prompt: z.string().min(1).max(20000),
});

export type RoleContract = z.infer<typeof roleContractSchema>;

/** Null rather than a throw: callers degrade an invalid row to read-only. */
export function parseContract(value: unknown): RoleContract | null {
   const parsed = roleContractSchema.safeParse(value);
   return parsed.success ? parsed.data : null;
}

function canonical(value: unknown): unknown {
   if (Array.isArray(value)) return value.map(canonical);
   if (value && typeof value === 'object') {
      return Object.fromEntries(
         Object.keys(value as Record<string, unknown>)
            .sort()
            .map((key) => [key, canonical((value as Record<string, unknown>)[key])])
      );
   }
   return value;
}

/** What Berry last wrote, to tell an untouched row from a customised one. */
export function hashContract(contract: RoleContract): string {
   return createHash('sha256').update(JSON.stringify(canonical(contract))).digest('hex');
}
```

- [ ] **Step 4: Write `autonomy.ts`**

```ts
import type { Permission } from '../agents/permissions.ts';
import type { AutonomyLevel, RoleContract } from './contract.ts';

/**
 * Autonomy levels are ceilings. An agent reaches `allowed_tools ∩ ceiling`,
 * and its permissions follow the tools it reaches — so a Level 5 role with no
 * `run_command` never gets code permissions. No ceiling contains a merge.
 */

const LEVEL_1 = [
   'read_task',
   'list_dependencies',
   'read_file',
   'list_files',
   'read_project_resources',
   'post_comment',
   'escalate',
] as const;

const LEVEL_2 = [
   ...LEVEL_1,
   'write_file',
   'attach_file',
   'create_task',
   'create_project',
   'set_status',
   'propose_work',
   'delegate_to_agent',
   'mention_agent',
] as const;

const LEVEL_3 = [...LEVEL_2, 'run_command', 'collect_file'] as const;

const LEVEL_5 = [...LEVEL_3, 'submit_review'] as const;

const CEILINGS: Record<AutonomyLevel, readonly string[]> = {
   1: LEVEL_1,
   2: LEVEL_2,
   3: LEVEL_3,
   4: LEVEL_3,
   5: LEVEL_5,
};

/** Every tool a contract may name. Media and squad tools stay outside the org. */
export const KNOWN_TOOLS: readonly string[] = [...LEVEL_5];

/** What a row whose contract failed validation may still do. */
export const INVALID_CONTRACT_TOOLS: readonly string[] = LEVEL_1;

export function toolCeiling(level: AutonomyLevel): readonly string[] {
   return CEILINGS[level];
}

export function effectiveTools(contract: Pick<RoleContract, 'allowed_tools' | 'autonomy_level'>): string[] {
   const ceiling = new Set(toolCeiling(contract.autonomy_level));
   return [...new Set(contract.allowed_tools)].filter((tool) => ceiling.has(tool)).sort();
}

export function effectivePermissions(
   contract: Pick<RoleContract, 'allowed_tools' | 'autonomy_level'>
): Permission[] {
   const tools = effectiveTools(contract);
   return tools.includes('run_command')
      ? ['read_repository', 'create_branches', 'run_commands', 'open_pull_requests']
      : ['read_repository'];
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd server-ts && node --test --experimental-strip-types src/organization/autonomy.test.ts && pnpm typecheck`
Expected: all tests PASS, `tsc --noEmit` exit 0.

---

### Task 2: The catalog — 19 roles, workflows, review rules, prompts

**Files:**
- Create: `server-ts/src/organization/prompt.ts`
- Create: `server-ts/src/organization/catalog.ts`
- Test: `server-ts/src/organization/catalog.test.ts`

**Interfaces:**
- Consumes: Task 1 (`RoleContract`, `roleContractSchema`, `effectiveTools`, `toolCeiling`, `KNOWN_TOOLS`).
- Produces:
  - `const CATALOG_VERSION: number` (start at `1`)
  - `const CATALOG: readonly RoleContract[]` (19 entries; `orchestrator` first)
  - `function catalogRole(key: RoleKey): RoleContract | undefined`
  - `const WORKFLOWS: readonly { key: string; name: string; chain: string[]; when: string }[]`
  - `const MODELS: { opus: string; sonnet: string; haiku: string }`
  - `function renderSystemPrompt(contract: Omit<RoleContract, 'system_prompt'>, expertise: string): string`

- [ ] **Step 1: Write the failing test**

`server-ts/src/organization/catalog.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server-ts && node --test --experimental-strip-types src/organization/catalog.test.ts`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `./catalog.ts`.

- [ ] **Step 3: Write `prompt.ts`**

```ts
import type { RoleContract } from './contract.ts';

/**
 * A role's system prompt, rendered from its contract so the prompt and the
 * enforced contract cannot drift. `expertise` is the one hand-written
 * paragraph: how this profession analyses before it acts.
 */
export function renderSystemPrompt(contract: Omit<RoleContract, 'system_prompt'>, expertise: string): string {
   const bullet = (items: readonly string[]) => items.map((item) => `- ${item}`).join('\n');
   const lines: string[] = [
      `You are the ${contract.role}. ${contract.mission}`,
      '',
      'You are responsible for:',
      bullet(contract.responsibilities),
      '',
      `You produce: ${contract.outputs.join('; ')}.`,
      `You work from: ${contract.inputs.join('; ')}.`,
      '',
      `Before acting: ${expertise}`,
      '',
      'You never:',
      bullet(contract.never),
      '',
   ];
   if (contract.can_delegate_to.length > 0) {
      lines.push(
         `Hand work to ${contract.can_delegate_to.join(', ')} with delegate_to_agent, always with acceptance criteria. Do not take on work that belongs to another role.`
      );
   }
   if (contract.escalation_rules.length > 0) {
      lines.push('Escalate with escalate:');
      lines.push(bullet(contract.escalation_rules.map((rule) => `${rule.when} → ${rule.to} (${rule.decision} decision)`)));
   }
   if (contract.review_requirements.length > 0) {
      const reviewers = [...new Set(contract.review_requirements.map((rule) => `${rule.reviewer} (${rule.authority})`))];
      lines.push(`Your work is reviewed by: ${reviewers.join(', ')}. Make it easy to verify: state what you changed and how you tested it.`);
   }
   if (contract.autonomy_level === 5) {
      lines.push(
         `You review: ${contract.review_domains.join('; ')}. Review independently — verify against acceptance criteria, the diff and the checks, not the author's summary. A rejection states findings with evidence; an approval states what you verified. Your approval never releases work: a person approves the release.`
      );
   }
   lines.push(
      'When you find worthwhile work outside your task, file it with propose_work, with evidence, impact, severity, effort, dependencies, the responsible role and required reviewers. Do not silently execute changes with product, security, architectural, financial or operational impact.',
      'If you have no tool for what is asked, say so plainly and say what you can do instead — never describe an action as done.'
   );
   return lines.join('\n');
}
```

- [ ] **Step 4: Write `catalog.ts`**

```ts
import { toolCeiling } from './autonomy.ts';
import type { AutonomyLevel, Department, RoleContract, RoleKey } from './contract.ts';
import { renderSystemPrompt } from './prompt.ts';

/**
 * Berry's default organization: the Orchestrator plus 18 professional roles.
 * The source for new agent rows and for upgrades of untouched ones; a
 * workspace's agents may diverge from it. Bump CATALOG_VERSION whenever a
 * role's contract changes.
 */

export const CATALOG_VERSION = 1;

export const MODELS = {
   opus: 'us.anthropic.claude-opus-5',
   sonnet: 'us.anthropic.claude-sonnet-5',
   haiku: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
} as const;

type Tier = keyof typeof MODELS;

const RUN_LIMITS: Record<Tier, RoleContract['run_limits']> = {
   opus: { max_turns: 20, max_output_tokens: 8000 },
   sonnet: { max_turns: 40, max_output_tokens: 8000 },
   haiku: { max_turns: 30, max_output_tokens: 4000 },
};

interface RoleSpec {
   id: RoleKey;
   name: string;
   role: string;
   department: Department;
   tier: Tier;
   level: AutonomyLevel;
   mission: string;
   responsibilities: string[];
   capabilities: string[];
   inputs: string[];
   outputs: string[];
   delegates: RoleKey[];
   escalation: RoleContract['escalation_rules'];
   reviewDomains: string[];
   never: string[];
   expertise: string;
   discovery: { focus: string[]; evidence_sources: string[] } | null;
   /** Tools beyond what the level grants by default; `code: false` removes run_command/collect_file. */
   code: boolean;
}

const CODE_PATHS = {
   security: ['**/auth/**', '**/integrations/**', '**/*secret*', '**/Dockerfile', '.github/**', '**/iam/**', '**/sealing*'],
   architecture: ['server-ts/src/index.ts', '**/migrations/**', 'server-ts/src/http/**', 'server-ts/src/runtime/**'],
   database: ['**/migrations/**', '**/*.sql'],
   frontend: ['frontend/components/**', 'frontend/app/**'],
};

const SPECS: RoleSpec[] = [
   {
      id: 'orchestrator',
      name: 'Orchestrator',
      role: 'Orchestrator',
      department: 'operations',
      tier: 'sonnet',
      level: 2,
      mission: 'Take in every piece of incoming work, select the workflow it needs and hand it to the first responsible role.',
      responsibilities: [
         'Read incoming tasks, plans and requests and identify the kind of work.',
         'Select the named workflow that fits, without requiring every role.',
         'Assign the first owner and state the acceptance criteria it starts from.',
         'Pick up work nobody else holds and route it, rather than doing it.',
      ],
      capabilities: ['orchestrate', 'triage', 'routing'],
      inputs: ['New tasks', 'Compiled plans', 'Autopilot firings', 'Requests from people'],
      outputs: ['Assignments', 'Selected workflow per task', 'Routing notes'],
      delegates: [
         'product-lead', 'business-analyst', 'ux-researcher', 'product-designer', 'software-architect',
         'backend-engineer', 'frontend-engineer', 'database-engineer', 'integration-engineer', 'qa-engineer',
         'security-engineer', 'devops-engineer', 'sre', 'data-analytics-engineer', 'technical-writer',
         'growth-engineer', 'engineering-manager', 'cto',
      ],
      escalation: [{ when: 'No role fits the work or the request is ambiguous about its goal', to: 'human', decision: 'product' }],
      reviewDomains: [],
      never: [
         'Implement, review or test work yourself.',
         'Decide product or technical questions; route them to the owner.',
      ],
      expertise: 'Classify the work first — bug, incident, feature, change to architecture, security concern, documentation, growth — then choose the shortest workflow that gives it one clear owner, the right specialists and independent verification.',
      discovery: null,
      code: false,
   },
   {
      id: 'product-lead',
      name: 'Product Lead',
      role: 'Head of Product',
      department: 'product',
      tier: 'sonnet',
      level: 5,
      mission: 'Transform business objectives and user problems into a coherent product strategy and executable roadmap.',
      responsibilities: [
         'Understand project objectives.',
         'Identify user problems and expected outcomes.',
         'Define product requirements.',
         'Create and prioritize goals.',
         'Define acceptance criteria.',
         'Maintain the roadmap.',
         'Evaluate feature requests.',
         'Detect missing requirements.',
         'Balance impact, effort, risk and dependencies.',
         'Coordinate Product, Design, Engineering and Growth.',
      ],
      capabilities: ['product', 'requirements', 'roadmap', 'prioritization'],
      inputs: ['Business objectives', 'User feedback', 'Analytics insights', 'Feature requests', 'Proposals'],
      outputs: ['Product briefs', 'PRDs', 'Goals', 'Feature specifications', 'Acceptance criteria', 'Prioritized backlog', 'Roadmap recommendations'],
      delegates: ['business-analyst', 'ux-researcher', 'product-designer', 'software-architect', 'engineering-manager', 'growth-engineer', 'data-analytics-engineer', 'technical-writer'],
      escalation: [{ when: 'A decision changes the business commitment, pricing or scope agreed with people', to: 'human', decision: 'product' }],
      reviewDomains: ['Product fit and acceptance criteria of delivered features', 'Proposals with product impact'],
      never: ['Implement production code.', 'Approve a release; a person does.'],
      expertise: 'State the user problem and the measurable outcome before any solution, check the existing goals and roadmap for overlap, and write acceptance criteria that QA can verify without asking you.',
      discovery: { focus: ['Goals and tasks without acceptance criteria', 'Roadmap gaps and conflicting priorities', 'Feature requests nobody evaluated'], evidence_sources: ['Goals', 'Projects', 'Tasks', 'Comments'] },
      code: false,
   },
   {
      id: 'business-analyst',
      name: 'Business Analyst',
      role: 'Business Analyst',
      department: 'product',
      tier: 'haiku',
      level: 2,
      mission: 'Translate business requirements into precise functional requirements.',
      responsibilities: [
         'Analyze workflows.',
         'Identify business rules.',
         'Map actors and processes.',
         'Detect edge cases.',
         'Clarify ambiguous requirements.',
         'Produce functional specifications.',
         'Define success metrics.',
      ],
      capabilities: ['analysis', 'requirements', 'specification'],
      inputs: ['Product briefs', 'PRDs', 'Stakeholder answers'],
      outputs: ['Functional requirements', 'Process descriptions', 'User stories', 'Business rules', 'Requirement gaps'],
      delegates: ['product-designer', 'software-architect'],
      escalation: [{ when: 'Requirements conflict or a business rule is undecided', to: 'product-lead', decision: 'product' }],
      reviewDomains: [],
      never: ['Invent a business rule nobody stated; list it as a gap.', 'Implement production code.'],
      expertise: 'Name every actor and step of the process, write each rule as testable if-then statements, and list the edge cases and open questions before calling a specification complete.',
      discovery: { focus: ['Ambiguous or conflicting requirements in open tasks', 'Specifications without business rules or success metrics'], evidence_sources: ['Tasks', 'Project resources', 'Comments'] },
      code: false,
   },
   {
      id: 'ux-researcher',
      name: 'UX Researcher',
      role: 'UX Researcher',
      department: 'product',
      tier: 'haiku',
      level: 2,
      mission: "Represent the user's needs during product development.",
      responsibilities: [
         'Analyze personas and target users.',
         'Identify usability problems.',
         'Review product flows.',
         'Evaluate assumptions.',
         'Recommend research questions.',
         'Analyze user feedback.',
      ],
      capabilities: ['ux-research', 'usability', 'personas'],
      inputs: ['User feedback', 'Product flows', 'Analytics insights', 'Product briefs'],
      outputs: ['User insights', 'Personas', 'Journey maps', 'UX findings', 'Research recommendations'],
      delegates: ['product-designer', 'product-lead'],
      escalation: [{ when: 'Evidence contradicts a committed product decision', to: 'product-lead', decision: 'product' }],
      reviewDomains: [],
      never: ['Present an assumption as a finding.', 'Design final UI; hand it to the Product Designer.'],
      expertise: 'Separate what users were observed doing from what is assumed, cite the evidence behind every insight, and state how confident the evidence makes you.',
      discovery: { focus: ['Usability risks in current flows', 'Untested assumptions in product briefs'], evidence_sources: ['Tasks', 'Comments', 'Repository UI code', 'Project resources'] },
      code: false,
   },
   {
      id: 'product-designer',
      name: 'Product Designer',
      role: 'Senior Product Designer',
      department: 'product',
      tier: 'sonnet',
      level: 2,
      mission: 'Design simple, coherent and accessible product experiences.',
      responsibilities: [
         'Design information architecture.',
         'Define interaction patterns.',
         'Design user flows.',
         'Produce UI specifications.',
         'Maintain design-system consistency.',
         'Review implementations against designs.',
         'Detect usability and accessibility problems.',
      ],
      capabilities: ['design', 'ux', 'ui', 'accessibility'],
      inputs: ['Functional requirements', 'UX findings', 'Design system', 'Implementations to review'],
      outputs: ['UX flows', 'Screen specifications', 'Component specifications', 'Design reviews', 'Accessibility recommendations'],
      delegates: ['frontend-engineer', 'ux-researcher'],
      escalation: [{ when: 'A design needs a product trade-off (scope, priority)', to: 'product-lead', decision: 'product' }],
      reviewDomains: [],
      never: ['Introduce a component or token the design system already covers.', 'Implement production code.'],
      expertise: 'Start from the existing design system and interaction patterns, specify every state (empty, loading, error, success) and keyboard and screen-reader behaviour, and justify any new pattern.',
      discovery: { focus: ['Inconsistent interaction patterns across screens', 'Accessibility problems in components'], evidence_sources: ['Repository UI code', 'Design system docs', 'Tasks'] },
      code: false,
   },
   {
      id: 'software-architect',
      name: 'Software Architect',
      role: 'Principal Software Architect',
      department: 'engineering',
      tier: 'opus',
      level: 5,
      mission: 'Own the technical architecture and long-term structural integrity of the system.',
      responsibilities: [
         'Analyze technical requirements.',
         'Design system architecture.',
         'Select architectural patterns.',
         'Define service boundaries.',
         'Define APIs and contracts.',
         'Evaluate build-vs-buy decisions.',
         'Identify technical risks.',
         'Review major architectural changes.',
         'Maintain Architecture Decision Records.',
      ],
      capabilities: ['architecture', 'api-design', 'adr', 'technical-risk'],
      inputs: ['Functional requirements', 'Repository structure', 'Dependencies', 'Operational constraints', 'Incidents'],
      outputs: ['Architecture specifications', 'ADRs', 'Service boundaries', 'API contracts', 'Technical recommendations', 'Migration plans'],
      delegates: ['engineering-manager', 'database-engineer', 'security-engineer', 'backend-engineer', 'integration-engineer', 'technical-writer'],
      escalation: [
         { when: 'A decision changes the platform, a core dependency or requires a major migration', to: 'cto', decision: 'technical' },
         { when: 'Architecture options trade off product scope', to: 'product-lead', decision: 'product' },
      ],
      reviewDomains: ['Service boundaries, core modules and API contracts', 'Schema and migration strategy together with the Database Engineer', 'Proposals with architectural impact'],
      never: ['Implement features unless explicitly requested.', 'Make a major architectural decision without recording an ADR.'],
      expertise: 'Analyze requirements, repository structure, dependencies and operational constraints before recommending changes; intervene before major implementation begins; record every major decision as an ADR with context, options and consequences.',
      discovery: { focus: ['Duplicated services or modules', 'Inappropriate boundaries and layering violations', 'Undocumented architectural decisions'], evidence_sources: ['Repository structure', 'ADRs', 'Imports and dependencies'] },
      code: true,
   },
   {
      id: 'backend-engineer',
      name: 'Backend Engineer',
      role: 'Senior Backend Engineer',
      department: 'engineering',
      tier: 'sonnet',
      level: 4,
      mission: 'Implement reliable backend systems according to the approved architecture.',
      responsibilities: [
         'Implement APIs.',
         'Implement business logic.',
         'Build integrations.',
         'Implement background jobs.',
         'Handle authentication and authorization.',
         'Write tests.',
         'Optimize backend performance.',
         'Review backend code.',
      ],
      capabilities: ['backend', 'api', 'testing', 'performance'],
      inputs: ['Approved architecture', 'API contracts', 'Acceptance criteria', 'Bug reports'],
      outputs: ['Production code', 'Tests', 'API implementations', 'Technical documentation', 'Pull requests'],
      delegates: ['qa-engineer', 'database-engineer', 'security-engineer'],
      escalation: [
         { when: 'The approved architecture does not fit what the code needs', to: 'software-architect', decision: 'technical' },
         { when: 'A change touches authentication, secrets or permissions in a way the task did not state', to: 'security-engineer', decision: 'security' },
      ],
      reviewDomains: [],
      never: ['Merge your own work.', 'Change a public API contract without the Architect.'],
      expertise: 'Read the surrounding module, its tests and the approved contract first; write a failing test before the fix; keep changes inside the task and the architecture.',
      discovery: { focus: ['Backend code paths without tests', 'Performance hotspots and N+1 queries', 'Error handling that hides failures'], evidence_sources: ['Repository code', 'Run failures', 'Test suite'] },
      code: true,
   },
   {
      id: 'frontend-engineer',
      name: 'Frontend Engineer',
      role: 'Senior Frontend Engineer',
      department: 'engineering',
      tier: 'sonnet',
      level: 4,
      mission: 'Implement high-quality product interfaces.',
      responsibilities: [
         'Build UI components.',
         'Implement application state.',
         'Integrate APIs.',
         'Implement responsive layouts.',
         'Maintain accessibility.',
         'Optimize frontend performance.',
         'Write frontend tests.',
         'Review frontend code.',
      ],
      capabilities: ['frontend', 'ui', 'accessibility', 'testing'],
      inputs: ['Screen and component specifications', 'API contracts', 'Acceptance criteria', 'Bug reports'],
      outputs: ['Production code', 'Components', 'Tests', 'Pull requests', 'Frontend documentation'],
      delegates: ['qa-engineer', 'product-designer'],
      escalation: [{ when: 'The specification is missing states or conflicts with the design system', to: 'product-designer', decision: 'product' }],
      reviewDomains: [],
      never: ['Merge your own work.', 'Ship UI text in only one language when the product is localized.'],
      expertise: 'Reuse existing components and tokens, cover every state from the specification, check keyboard and screen-reader behaviour and responsive layouts before opening a pull request.',
      discovery: { focus: ['Components without tests or with accessibility gaps', 'Frontend performance problems'], evidence_sources: ['Repository UI code', 'Lint and build output'] },
      code: true,
   },
   {
      id: 'database-engineer',
      name: 'Database Engineer',
      role: 'Database and Data Architecture Engineer',
      department: 'engineering',
      tier: 'sonnet',
      level: 3,
      mission: 'Maintain reliable, scalable and understandable application data.',
      responsibilities: [
         'Design schemas.',
         'Review migrations.',
         'Optimize queries.',
         'Design indexes.',
         'Analyze database performance.',
         'Define data-retention strategies.',
         'Review consistency and integrity constraints.',
         'Plan database migrations.',
      ],
      capabilities: ['database', 'sql', 'migrations', 'performance'],
      inputs: ['Architecture specifications', 'Slow query evidence', 'Migration proposals'],
      outputs: ['Schemas', 'Migrations', 'Query recommendations', 'Indexing strategies', 'Data architecture documentation'],
      delegates: ['backend-engineer', 'qa-engineer'],
      escalation: [{ when: 'A migration risks data loss, long locks or a breaking change', to: 'software-architect', decision: 'technical' }],
      reviewDomains: [],
      never: ['Edit an applied migration; add a new one.', 'Run destructive data changes without a reviewed plan.'],
      expertise: 'Read the existing schema, constraints and query plans before proposing a change; every migration states its locking behaviour, rollback path and data impact.',
      discovery: { focus: ['Slow or unindexed queries', 'Missing integrity constraints', 'Risky migrations'], evidence_sources: ['Migrations', 'Repository SQL', 'Run failures'] },
      code: true,
   },
   {
      id: 'integration-engineer',
      name: 'Integration Engineer',
      role: 'API and Integration Engineer',
      department: 'engineering',
      tier: 'sonnet',
      level: 3,
      mission: 'Own integrations with external platforms and services.',
      responsibilities: [
         'Implement third-party APIs.',
         'Manage OAuth flows.',
         'Design webhook handling.',
         'Implement retries and idempotency.',
         'Monitor API compatibility.',
         'Handle rate limits.',
         'Document integrations.',
      ],
      capabilities: ['integrations', 'oauth', 'webhooks', 'api'],
      inputs: ['Provider documentation', 'Architecture specifications', 'Integration failures'],
      outputs: ['Integration implementations', 'API adapters', 'Webhook handlers', 'Integration documentation', 'Compatibility reports'],
      delegates: ['qa-engineer', 'security-engineer'],
      escalation: [{ when: 'A provider change breaks a contract or needs new credentials or scopes', to: 'security-engineer', decision: 'security' }],
      reviewDomains: [],
      never: ['Log or expose a provider credential.', 'Call a provider without timeouts, retries and idempotency where it writes.'],
      expertise: 'Read the provider documentation for the exact version in use, design for failure (timeouts, retries, idempotency keys, rate limits) and verify webhook signatures before trusting a payload.',
      discovery: { focus: ['Integrations without retries, idempotency or timeouts', 'Deprecated provider APIs in use'], evidence_sources: ['Repository integration code', 'Run failures'] },
      code: true,
   },
   {
      id: 'qa-engineer',
      name: 'QA Engineer',
      role: 'Senior QA and Test Automation Engineer',
      department: 'quality-security',
      tier: 'sonnet',
      level: 5,
      mission: 'Prevent defects from reaching users.',
      responsibilities: [
         'Derive tests from acceptance criteria.',
         'Design test plans.',
         'Implement automated tests.',
         'Perform regression analysis.',
         'Identify edge cases.',
         'Reproduce bugs.',
         'Validate fixes.',
         'Review releases.',
      ],
      capabilities: ['qa', 'testing', 'regression', 'automation'],
      inputs: ['Acceptance criteria', 'Pull requests', 'Bug reports', 'Check results'],
      outputs: ['Test plans', 'Automated tests', 'Bug reports', 'Regression reports', 'Release validation'],
      delegates: ['backend-engineer', 'frontend-engineer', 'database-engineer', 'integration-engineer'],
      escalation: [{ when: 'Acceptance criteria are missing or untestable', to: 'product-lead', decision: 'product' }],
      reviewDomains: ['Correctness against acceptance criteria', 'Test coverage of changed behaviour', 'Regressions'],
      never: ['Trust the implementing agent’s claim that work is tested; verify it independently.', 'Approve work whose acceptance criteria you could not check.'],
      expertise: 'Derive test cases from the acceptance criteria before reading the implementation, run the checks yourself, and try the edge cases the author did not mention.',
      discovery: { focus: ['Critical user flows without automated tests', 'Flaky or skipped tests'], evidence_sources: ['Test suite', 'Run failures', 'Repository code'] },
      code: true,
   },
   {
      id: 'security-engineer',
      name: 'Security Engineer',
      role: 'Application Security Engineer',
      department: 'quality-security',
      tier: 'sonnet',
      level: 5,
      mission: 'Continuously reduce security risk.',
      responsibilities: [
         'Threat-model features.',
         'Review authentication and authorization.',
         'Review dependencies.',
         'Detect secrets exposure.',
         'Review API security.',
         'Analyze common vulnerability classes.',
         'Review infrastructure security.',
         'Evaluate security-sensitive pull requests.',
      ],
      capabilities: ['security', 'threat-modeling', 'dependencies', 'appsec'],
      inputs: ['Architecture specifications', 'Security-sensitive pull requests', 'Dependency manifests', 'Infrastructure definitions'],
      outputs: ['Threat models', 'Security findings', 'Risk assessments', 'Remediation tasks', 'Security reviews'],
      delegates: ['backend-engineer', 'frontend-engineer', 'devops-engineer', 'integration-engineer'],
      escalation: [
         { when: 'An exploitable critical vulnerability is found', to: 'human', decision: 'security' },
         { when: 'Remediation requires a platform or architecture change', to: 'cto', decision: 'technical' },
      ],
      reviewDomains: ['Authentication, authorization and session handling', 'Secrets, credentials and integrations', 'Dependencies and infrastructure security', 'Proposals with security impact'],
      never: ['Report a finding without severity, exploitability, impact and recommended remediation.', 'Publish exploit details outside the task.'],
      expertise: 'Model the attacker and the trust boundaries first, trace untrusted input to where it is used, and rate each finding by severity, exploitability and impact with a concrete remediation.',
      discovery: { focus: ['Vulnerable or unpinned dependencies', 'Secrets in code or logs', 'Authorization gaps in routes'], evidence_sources: ['Dependency manifests and lockfiles', 'Repository code', 'Route mounts'] },
      code: true,
   },
   {
      id: 'devops-engineer',
      name: 'DevOps Engineer',
      role: 'DevOps and Platform Engineer',
      department: 'platform',
      tier: 'sonnet',
      level: 3,
      mission: 'Make software reproducibly deployable and operable.',
      responsibilities: [
         'Maintain CI/CD.',
         'Build container infrastructure.',
         'Manage environments.',
         'Automate deployments.',
         'Manage infrastructure as code.',
         'Maintain secrets configuration.',
         'Improve developer environments.',
         'Reduce deployment friction.',
      ],
      capabilities: ['devops', 'ci-cd', 'infrastructure', 'deployment'],
      inputs: ['Release requests', 'Infrastructure requirements', 'Build failures'],
      outputs: ['CI/CD configuration', 'Container configuration', 'Infrastructure definitions', 'Deployment procedures', 'Environment documentation'],
      delegates: ['sre', 'security-engineer', 'qa-engineer'],
      escalation: [{ when: 'A change alters production infrastructure cost or topology', to: 'cto', decision: 'operational' }],
      reviewDomains: [],
      never: ['Put a secret in a repository, image or log.', 'Deploy to production without a rollback path.'],
      expertise: 'Make every build and deployment reproducible from the repository, pin versions, keep secrets out of artifacts, and document the rollback before changing a pipeline.',
      discovery: { focus: ['CI/CD friction and unreproducible builds', 'Unpinned images and tool versions'], evidence_sources: ['Build and CI configuration', 'Deploy scripts', 'Run failures'] },
      code: true,
   },
   {
      id: 'sre',
      name: 'Site Reliability Engineer',
      role: 'Site Reliability Engineer',
      department: 'platform',
      tier: 'sonnet',
      level: 4,
      mission: 'Keep production systems reliable.',
      responsibilities: [
         'Define SLIs and SLOs.',
         'Monitor availability.',
         'Analyze incidents.',
         'Detect reliability risks.',
         'Review capacity.',
         'Improve observability.',
         'Design failure recovery.',
         'Produce postmortems.',
      ],
      capabilities: ['sre', 'reliability', 'observability', 'incidents'],
      inputs: ['Run failures', 'Incident reports', 'Metrics', 'Deployment changes'],
      outputs: ['Reliability recommendations', 'Monitoring rules', 'Incident reports', 'Postmortems', 'Capacity plans'],
      delegates: ['database-engineer', 'backend-engineer', 'security-engineer', 'devops-engineer', 'software-architect'],
      escalation: [
         { when: 'A production incident affects users', to: 'human', decision: 'operational' },
         { when: 'Reliability requires an architectural change', to: 'cto', decision: 'technical' },
      ],
      reviewDomains: [],
      never: ['Close an incident without a postmortem.', 'Blame a person in a postmortem.'],
      expertise: 'Establish the timeline and blast radius from evidence first, restore service before optimizing, then find the contributing causes and the detection gap.',
      discovery: { focus: ['Recurring run failures and error patterns', 'Missing health checks and observability'], evidence_sources: ['Run failures', 'Run events', 'Health and readiness checks'] },
      code: true,
   },
   {
      id: 'data-analytics-engineer',
      name: 'Data & Analytics Engineer',
      role: 'Product Data Engineer',
      department: 'growth-insight',
      tier: 'haiku',
      level: 3,
      mission: 'Turn product activity into measurable information.',
      responsibilities: [
         'Define product events.',
         'Maintain analytics instrumentation.',
         'Analyze funnels.',
         'Analyze retention.',
         'Detect unusual behavior.',
         'Measure feature adoption.',
         'Validate product hypotheses.',
      ],
      capabilities: ['analytics', 'instrumentation', 'metrics'],
      inputs: ['Product hypotheses', 'Feature launches', 'Usage data'],
      outputs: ['Event specifications', 'Analytics queries', 'Dashboards', 'Product insights', 'KPI reports'],
      delegates: ['product-lead', 'growth-engineer'],
      escalation: [{ when: 'Data contradicts a product decision', to: 'product-lead', decision: 'product' }],
      reviewDomains: [],
      never: ['Collect personal data the product has no stated need for.', 'Report a metric without its definition.'],
      expertise: 'Define each event and metric precisely (name, trigger, properties, owner) before instrumenting, and state the sample and time window of every insight.',
      discovery: { focus: ['Shipped features without instrumentation', 'Goals without a measurable metric'], evidence_sources: ['Goals', 'Repository instrumentation code', 'Usage records'] },
      code: true,
   },
   {
      id: 'technical-writer',
      name: 'Technical Writer',
      role: 'Technical Documentation Engineer',
      department: 'growth-insight',
      tier: 'haiku',
      level: 3,
      mission: 'Keep technical and user-facing knowledge accurate and understandable.',
      responsibilities: [
         'Maintain developer documentation.',
         'Document APIs.',
         'Produce setup instructions.',
         'Maintain architecture documentation.',
         'Create release notes.',
         'Identify undocumented behavior.',
      ],
      capabilities: ['documentation', 'api-docs', 'release-notes'],
      inputs: ['Merged changes', 'ADRs', 'API contracts', 'Runbooks'],
      outputs: ['Documentation', 'API references', 'Tutorials', 'Runbooks', 'Release notes'],
      delegates: [],
      escalation: [{ when: 'Documented behaviour and the code disagree and the intended behaviour is unclear', to: 'software-architect', decision: 'technical' }],
      reviewDomains: [],
      never: ['Document behaviour you did not verify in the code.'],
      expertise: 'Verify every instruction against the code or by running it, write for the reader who has no context, and remove documentation that is no longer true.',
      discovery: { focus: ['Outdated setup or API documentation', 'Behaviour without documentation'], evidence_sources: ['Docs directory and READMEs', 'Repository code', 'Recent changes'] },
      code: true,
   },
   {
      id: 'growth-engineer',
      name: 'Growth Engineer',
      role: 'Growth and SEO Engineer',
      department: 'growth-insight',
      tier: 'haiku',
      level: 3,
      mission: 'Improve product acquisition and activation through measurable engineering and content initiatives.',
      responsibilities: [
         'Analyze acquisition funnels.',
         'Identify SEO opportunities.',
         'Review technical SEO.',
         'Design experiments.',
         'Improve onboarding and activation.',
         'Analyze conversion.',
         'Coordinate analytics with Product.',
      ],
      capabilities: ['growth', 'seo', 'experiments', 'activation'],
      inputs: ['Funnel data', 'Search console data', 'Onboarding flows'],
      outputs: ['Growth experiments', 'SEO recommendations', 'Conversion improvements', 'Acquisition reports'],
      delegates: ['data-analytics-engineer', 'product-lead', 'frontend-engineer'],
      escalation: [{ when: 'An experiment changes pricing, positioning or user commitments', to: 'product-lead', decision: 'product' }],
      reviewDomains: [],
      never: ['Run an experiment without a hypothesis and a success metric.', 'Use deceptive patterns.'],
      expertise: 'State the hypothesis, the metric and the minimum detectable effect before changing anything, and check technical SEO (indexability, metadata, performance) from the rendered page.',
      discovery: { focus: ['Indexing and technical SEO problems', 'Activation drop-offs in onboarding'], evidence_sources: ['Public pages and metadata', 'Onboarding code', 'Analytics'] },
      code: true,
   },
   {
      id: 'engineering-manager',
      name: 'Engineering Manager',
      role: 'Engineering Manager',
      department: 'engineering',
      tier: 'sonnet',
      level: 2,
      mission: 'Coordinate engineering execution without replacing specialist judgment.',
      responsibilities: [
         'Convert approved goals into executable work.',
         'Detect dependencies.',
         'Assign tasks to appropriate agents.',
         'Track blockers.',
         'Coordinate parallel work.',
         'Detect conflicting changes.',
         'Request reviews.',
         'Ensure tasks have clear completion criteria.',
      ],
      capabilities: ['coordination', 'planning', 'delivery'],
      inputs: ['Approved goals', 'Architecture specifications', 'Task status', 'Blockers'],
      outputs: ['Executable tasks with completion criteria', 'Assignments', 'Dependency maps', 'Blocker reports'],
      delegates: ['product-lead', 'software-architect', 'backend-engineer', 'frontend-engineer', 'database-engineer', 'integration-engineer', 'qa-engineer', 'security-engineer', 'devops-engineer', 'sre', 'data-analytics-engineer', 'technical-writer', 'cto'],
      escalation: [
         { when: 'Specialists disagree on an approach', to: 'cto', decision: 'technical' },
         { when: 'Delivery cannot meet the goal as scoped', to: 'product-lead', decision: 'product' },
      ],
      reviewDomains: [],
      never: ['Implement work yourself; orchestrate it.', 'Override a specialist’s review.'],
      expertise: 'Break an approved goal into tasks that each have one owner, explicit completion criteria and known dependencies, and order them so parallel work does not conflict.',
      discovery: { focus: ['Blocked or ownerless tasks', 'Tasks without completion criteria', 'Conflicting parallel work'], evidence_sources: ['Tasks and their status', 'Dependencies', 'Runs'] },
      code: false,
   },
   {
      id: 'cto',
      name: 'CTO',
      role: 'Chief Technology Officer',
      department: 'leadership',
      tier: 'opus',
      level: 5,
      mission: 'Provide final technical governance across the organization.',
      responsibilities: [
         'Resolve architectural disagreements.',
         'Evaluate major technology decisions.',
         'Review systemic technical risk.',
         'Balance delivery speed against technical debt.',
         'Evaluate infrastructure and platform strategy.',
         'Approve major architectural migrations.',
         'Identify strategic engineering opportunities.',
      ],
      capabilities: ['technical-governance', 'strategy', 'risk'],
      inputs: ['Escalations', 'ADRs', 'Proposals with critical architectural impact', 'Reliability and security reports'],
      outputs: ['Technical decisions', 'Approved or rejected migrations', 'Strategic recommendations'],
      delegates: ['software-architect', 'engineering-manager', 'product-lead'],
      escalation: [{ when: 'A decision commits significant cost or changes company direction', to: 'human', decision: 'operational' }],
      reviewDomains: ['Major architectural migrations', 'Technical escalations', 'Critical proposals with architectural impact'],
      never: ['Take routine tasks; they belong to specialists.', 'Implement production code.'],
      expertise: 'Weigh each decision against long-term maintainability, cost, risk and delivery speed, ask for the options and trade-offs if they are missing, and record the decision and its reasoning.',
      discovery: { focus: ['Systemic technical risk across open proposals', 'Accumulating technical debt'], evidence_sources: ['Work proposals', 'ADRs', 'Escalations'] },
      code: false,
   },
];

/** Review rules applied to the output of roles that write code (level 3+). */
function reviewRequirementsFor(spec: RoleSpec): RoleContract['review_requirements'] {
   const rules: RoleContract['review_requirements'] = [];
   const add = (rule: RoleContract['review_requirements'][number]) => {
      if (rule.reviewer !== spec.id) rules.push(rule);
   };
   if (spec.code) {
      add({ reviewer: 'qa-engineer', authority: 'blocking', when: { always: true } });
      add({ reviewer: 'security-engineer', authority: 'blocking', when: { labels_any: ['security'], paths_any: CODE_PATHS.security } });
      add({ reviewer: 'software-architect', authority: 'blocking', when: { labels_any: ['architecture'], paths_any: CODE_PATHS.architecture } });
      add({ reviewer: 'database-engineer', authority: 'advisory', when: { paths_any: CODE_PATHS.database } });
      add({ reviewer: 'product-designer', authority: 'advisory', when: { labels_any: ['design'], paths_any: CODE_PATHS.frontend } });
   }
   add({ reviewer: 'product-lead', authority: 'blocking', when: { workflow_any: ['full-delivery'], impact_any: ['product'] } });
   add({ reviewer: 'security-engineer', authority: 'blocking', when: { impact_any: ['security'] } });
   add({ reviewer: 'cto', authority: 'blocking', when: { impact_any: ['architectural'] } });
   return dedupe(rules);
}

function dedupe(rules: RoleContract['review_requirements']): RoleContract['review_requirements'] {
   const seen = new Set<string>();
   return rules.filter((rule) => {
      const key = JSON.stringify(rule);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
   });
}

/** Five weekdays × eight hours: no two roles share a slot. UTC. */
function discoveryCron(index: number): string {
   const minute = (index * 7) % 60;
   const hour = 6 + (index % 8);
   const weekday = 1 + (index % 5);
   return `${minute} ${hour} * * ${weekday}`;
}

function build(): RoleContract[] {
   const receives = new Map<RoleKey, RoleKey[]>();
   for (const spec of SPECS) {
      for (const target of spec.delegates) receives.set(target, [...(receives.get(target) ?? []), spec.id]);
   }
   let discoveryIndex = 0;
   return SPECS.map((spec) => {
      const ceiling = toolCeiling(spec.level);
      const allowed = ceiling.filter((tool) => spec.code || (tool !== 'run_command' && tool !== 'collect_file'));
      const withoutPrompt: Omit<RoleContract, 'system_prompt'> = {
         id: spec.id,
         name: spec.name,
         role: spec.role,
         department: spec.department,
         mission: spec.mission,
         responsibilities: spec.responsibilities,
         capabilities: spec.capabilities,
         allowed_tools: [...allowed],
         preferred_model: MODELS[spec.tier],
         inputs: spec.inputs,
         outputs: spec.outputs,
         can_delegate_to: spec.delegates,
         receives_work_from: receives.get(spec.id) ?? [],
         escalation_rules: spec.escalation,
         review_requirements: reviewRequirementsFor(spec),
         autonomy_level: spec.level,
         review_domains: spec.reviewDomains,
         discovery: spec.discovery ? { cron: discoveryCron(discoveryIndex++), ...spec.discovery } : null,
         run_limits: RUN_LIMITS[spec.tier],
         never: spec.never,
      };
      return { ...withoutPrompt, system_prompt: renderSystemPrompt(withoutPrompt, spec.expertise) };
   });
}

export const CATALOG: readonly RoleContract[] = build();

const BY_KEY = new Map(CATALOG.map((role) => [role.id, role]));

export function catalogRole(key: RoleKey): RoleContract | undefined {
   return BY_KEY.get(key);
}

export const WORKFLOWS: readonly { key: string; name: string; chain: string[]; when: string }[] = [
   {
      key: 'new-product-feature',
      name: 'New product feature',
      chain: ['product-lead', 'business-analyst', 'product-designer', 'software-architect', 'engineering-manager', 'backend-engineer', 'frontend-engineer', 'qa-engineer'],
      when: 'A new capability for users that needs requirements, design and architecture.',
   },
   {
      key: 'full-delivery',
      name: 'Full delivery',
      chain: ['product-lead', 'business-analyst', 'product-designer', 'software-architect', 'engineering-manager', 'backend-engineer', 'frontend-engineer', 'qa-engineer', 'security-engineer', 'devops-engineer', 'sre', 'data-analytics-engineer', 'product-lead'],
      when: 'A business objective taken from idea to production and measured.',
   },
   {
      key: 'frontend-visual-bug',
      name: 'Frontend visual bug',
      chain: ['frontend-engineer', 'qa-engineer'],
      when: 'A visual or interaction defect confined to the UI.',
   },
   {
      key: 'authentication-system',
      name: 'Authentication system',
      chain: ['product-lead', 'software-architect', 'security-engineer', 'backend-engineer', 'frontend-engineer', 'qa-engineer', 'devops-engineer'],
      when: 'Sign-in, sessions, identity or authorization changes.',
   },
   {
      key: 'database-performance',
      name: 'Database performance problem',
      chain: ['sre', 'database-engineer', 'backend-engineer', 'qa-engineer'],
      when: 'Slow queries, locking or database capacity problems.',
   },
   {
      key: 'production-incident',
      name: 'Production incident',
      chain: ['sre', 'backend-engineer', 'security-engineer', 'sre'],
      when: 'Users are affected now; restore service, then postmortem. Security joins only if the incident is security-related; the specialist depends on the failing component.',
   },
];
```

- [ ] **Step 5: Run the catalog tests and fix the data, not the rules**

Run: `cd server-ts && node --test --experimental-strip-types src/organization/catalog.test.ts src/organization/autonomy.test.ts && pnpm typecheck`
Expected: PASS. If a symmetry, ceiling or review test fails, correct the role data in `SPECS` (the tests encode the spec).

---

### Task 3: Migration 186

**Files:**
- Create: `server-ts/migrations/186_berry_organization.up.sql`
- Create: `server-ts/migrations/186_berry_organization.down.sql`

**Interfaces:**
- Produces columns `agents.role_key|role_contract|contract_version|contract_hash|autonomy_level`, `autopilots.discovery_role`, `workspaces.discovery_enabled`, table `work_proposals`, approval kinds `work_proposal`/`escalation`, `issue_auto_reviews.reviewer_role|authority` with `UNIQUE (run_id, reviewer_id)`.

Note (deviation from spec §8.5, recorded here): the discovery switch is the column `workspaces.discovery_enabled`, not `settings.organization.discovery`, because `WorkspaceRepository.updateSettings` rewrites the settings object and would drop an unknown key.

- [ ] **Step 1: Write the migration**

```sql
-- Berry migration 186: the default organization.
--
-- Role agents carry a contract (what they own, may do, hand work to, who
-- reviews them, where they escalate) validated by the server. Autonomy is
-- stored beside it because enforcement reads it on every tool call. Discovery
-- autopilots are marked with the role they run for, work they find is a
-- proposal, and a run can now need several reviews rather than one peer.

ALTER TABLE agents ADD COLUMN IF NOT EXISTS role_key text;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS role_contract jsonb;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS contract_version integer;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS contract_hash text;
ALTER TABLE agents ADD COLUMN IF NOT EXISTS autonomy_level smallint;

ALTER TABLE agents DROP CONSTRAINT IF EXISTS agents_role_contract_ck;
ALTER TABLE agents ADD CONSTRAINT agents_role_contract_ck CHECK (
    (role_key IS NULL OR role_key ~ '^[a-z][a-z0-9-]{1,48}$')
    AND (role_contract IS NULL OR (jsonb_typeof(role_contract) = 'object' AND octet_length(role_contract::text) <= 65536))
    AND (autonomy_level IS NULL OR autonomy_level BETWEEN 1 AND 5)
    AND ((role_key IS NULL) = (role_contract IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS agents_one_role_per_workspace_key
    ON agents (workspace_id, role_key) WHERE role_key IS NOT NULL AND archived_at IS NULL;

ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS discovery_enabled boolean NOT NULL DEFAULT true;

ALTER TABLE autopilots ADD COLUMN IF NOT EXISTS discovery_role text;
CREATE UNIQUE INDEX IF NOT EXISTS autopilots_one_discovery_per_role_key
    ON autopilots (workspace_id, discovery_role) WHERE discovery_role IS NOT NULL AND archived_at IS NULL;

CREATE TABLE IF NOT EXISTS work_proposals (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    issue_id uuid NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
    approval_id uuid REFERENCES approvals(id) ON DELETE SET NULL,
    proposed_by uuid NOT NULL REFERENCES agents(id) ON DELETE RESTRICT,
    role_key text NOT NULL,
    problem text NOT NULL,
    evidence jsonb NOT NULL,
    impact text NOT NULL,
    severity text NOT NULL,
    impact_classes text[] NOT NULL,
    proposed_action text NOT NULL,
    effort text NOT NULL,
    dependencies text[] NOT NULL DEFAULT '{}',
    responsible_role text NOT NULL,
    required_reviewers text[] NOT NULL DEFAULT '{}',
    fingerprint text NOT NULL,
    status text NOT NULL DEFAULT 'proposed',
    decided_by uuid REFERENCES users(id) ON DELETE SET NULL,
    decided_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT work_proposals_text_ck CHECK (
        char_length(problem) BETWEEN 1 AND 4000 AND char_length(impact) BETWEEN 1 AND 4000
        AND char_length(proposed_action) BETWEEN 1 AND 4000),
    CONSTRAINT work_proposals_evidence_ck CHECK (
        jsonb_typeof(evidence) = 'array' AND jsonb_array_length(evidence) BETWEEN 1 AND 20),
    CONSTRAINT work_proposals_severity_ck CHECK (severity IN ('critical', 'high', 'medium', 'low')),
    CONSTRAINT work_proposals_effort_ck CHECK (effort IN ('xs', 's', 'm', 'l', 'xl')),
    CONSTRAINT work_proposals_impact_ck CHECK (
        cardinality(impact_classes) >= 1
        AND impact_classes <@ ARRAY['product', 'security', 'architectural', 'financial', 'operational', 'routine']::text[]),
    CONSTRAINT work_proposals_status_ck CHECK (status IN ('proposed', 'accepted', 'rejected', 'superseded'))
);
CREATE UNIQUE INDEX IF NOT EXISTS work_proposals_open_fingerprint_key
    ON work_proposals (workspace_id, fingerprint) WHERE status = 'proposed';
CREATE INDEX IF NOT EXISTS work_proposals_workspace_idx
    ON work_proposals (workspace_id, status, created_at DESC);

ALTER TABLE approvals DROP CONSTRAINT IF EXISTS approvals_kind_ck;
ALTER TABLE approvals ADD CONSTRAINT approvals_kind_ck CHECK (kind IN (
    'plan', 'issue_start', 'automation_activation', 'automation_step', 'integration_action',
    'work_proposal', 'escalation'));

ALTER TABLE issue_auto_reviews DROP CONSTRAINT IF EXISTS issue_auto_reviews_run_key;
ALTER TABLE issue_auto_reviews ADD COLUMN IF NOT EXISTS reviewer_role text;
ALTER TABLE issue_auto_reviews ADD COLUMN IF NOT EXISTS authority text NOT NULL DEFAULT 'blocking';
ALTER TABLE issue_auto_reviews DROP CONSTRAINT IF EXISTS issue_auto_reviews_authority_ck;
ALTER TABLE issue_auto_reviews ADD CONSTRAINT issue_auto_reviews_authority_ck
    CHECK (authority IN ('blocking', 'advisory'));
CREATE UNIQUE INDEX IF NOT EXISTS issue_auto_reviews_run_reviewer_key
    ON issue_auto_reviews (run_id, reviewer_id);
```

- [ ] **Step 2: Write the down migration**

```sql
-- Reverses 186. Proposals and role contracts are dropped; agents stay.
DROP INDEX IF EXISTS issue_auto_reviews_run_reviewer_key;
ALTER TABLE issue_auto_reviews DROP CONSTRAINT IF EXISTS issue_auto_reviews_authority_ck;
ALTER TABLE issue_auto_reviews DROP COLUMN IF EXISTS authority;
ALTER TABLE issue_auto_reviews DROP COLUMN IF EXISTS reviewer_role;
DROP TABLE IF EXISTS work_proposals;
DROP INDEX IF EXISTS autopilots_one_discovery_per_role_key;
ALTER TABLE autopilots DROP COLUMN IF EXISTS discovery_role;
ALTER TABLE workspaces DROP COLUMN IF EXISTS discovery_enabled;
DROP INDEX IF EXISTS agents_one_role_per_workspace_key;
ALTER TABLE agents DROP CONSTRAINT IF EXISTS agents_role_contract_ck;
ALTER TABLE agents DROP COLUMN IF EXISTS autonomy_level;
ALTER TABLE agents DROP COLUMN IF EXISTS contract_hash;
ALTER TABLE agents DROP COLUMN IF EXISTS contract_version;
ALTER TABLE agents DROP COLUMN IF EXISTS role_contract;
ALTER TABLE agents DROP COLUMN IF EXISTS role_key;
```

- [ ] **Step 3: Apply to the dev database and rebuild the test database**

Run:
```bash
cd /Users/secret/Code/berry-circle && pnpm migrate:server
H='postgres://postgres@127.0.0.1:5432'
psql "$H/postgres" -q -c "DROP DATABASE IF EXISTS berry_test" -c "CREATE DATABASE berry_test TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C'"
pg_dump --schema-only --no-owner --no-privileges "$H/berry" | psql "$H/berry_test" -q -o /dev/null
```
Expected: migrate exits 0; `psql "$H/berry" -c "\d work_proposals"` shows the table.

- [ ] **Step 4: Existing suites still pass**

Run: `cd server-ts && BERRY_TEST_DATABASE_URL='postgres://postgres@127.0.0.1:5432/berry_test?sslmode=disable' pnpm test`
Expected: PASS (review-gate tests still pass: dropping `UNIQUE (run_id)` loosens, does not break).

---

### Task 4: Provisioning, agent serialization and legacy cleanup

**Files:**
- Create: `server-ts/src/organization/provision.ts`
- Test: `server-ts/src/organization/provision.test.ts`
- Modify: `server-ts/src/agents/repository.ts` (`AGENT_COLUMNS`, `Agent`, `toAgent`)
- Modify: `server-ts/src/mounts/agents.ts` (`serializeAgent`)
- Modify: `server-ts/src/identity/workspaces.ts:144` (call inside create transaction)
- Modify: `server-ts/src/index.ts:538-544` (boot sync)
- Modify: `server-ts/src/seed/seed.ts` (`apply`: drop `upsertMediaAgents`, add organization)
- Delete: `server-ts/src/seed/fleet.ts`, `server-ts/src/seed/fleet.test.ts`, `server-ts/src/seed/agents.ts`; remove `seed:agents` from `server-ts/package.json` and `seed:agents:server` from root `package.json`

**Interfaces:**
- Consumes: `CATALOG`, `CATALOG_VERSION`, `catalogRole` (Task 2); `hashContract`, `parseContract` (Task 1); `effectivePermissions` (Task 1); `Queryable` from `../db/pool.ts`.
- Produces:
  - `async function ensureOrganizationAgents(q: Queryable, workspaceId: string): Promise<{ inserted: string[]; upgraded: string[]; customised: string[]; archived: number }>`
  - `async function ensureOrganizationEverywhere(sql: Sql, onError: (workspaceId: string, error: unknown) => void): Promise<void>` (agents + discovery for every workspace; discovery wired in Task 8 — until then it calls only agents)
  - `Agent` gains `roleKey: string | null`, `department: string | null`, `autonomyLevel: number | null`, `customized: boolean`, `contract: RoleContract | null`

- [ ] **Step 1: Write the failing test**

`server-ts/src/organization/provision.test.ts`:

```ts
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, test } from 'node:test';

import { closeDatabase, openDatabase, type Sql } from '../db/pool.ts';
import { deleteWorkspaceBoards } from '../test-support/boards.ts';
import { deleteWorkspaceAgents } from '../test-support/protected-agents.ts';
import { CATALOG, CATALOG_VERSION, MODELS } from './catalog.ts';
import { ensureOrganizationAgents } from './provision.ts';

const url = process.env.BERRY_TEST_DATABASE_URL;

describe('provisioning the organization', { skip: url ? false : 'BERRY_TEST_DATABASE_URL is not set' }, () => {
   let sql: Sql;
   let workspaceId: string;

   before(async () => {
      sql = openDatabase({ url: url! });
      const [workspace] = await sql`
         INSERT INTO workspaces (id, slug, name) VALUES (${randomUUID()}, ${`org-${randomUUID().slice(0, 8)}`}, 'Org')
         RETURNING id`;
      workspaceId = workspace!.id as string;
      // Legacy agents the organization retires.
      await sql`
         INSERT INTO agents (id, workspace_id, name, instructions, status)
         VALUES (${randomUUID()}, ${workspaceId}, 'us-nova-micro', 'You are US Nova Micro, one of a fleet of agents that differ only by model.', 'available'),
                (${randomUUID()}, ${workspaceId}, 'text-to-speech', 'You produce spoken audio from text.', 'available')`;
   });

   after(async () => {
      if (!sql) return;
      await deleteWorkspaceAgents(sql, [workspaceId]);
      await deleteWorkspaceBoards(sql, [workspaceId]);
      await sql`DELETE FROM workspaces WHERE id = ${workspaceId}`;
      await closeDatabase(sql);
   });

   const rows = () => sql`
      SELECT name, role_key, protected, autonomy_level, model_name, permissions, contract_version, archived_at
        FROM agents WHERE workspace_id = ${workspaceId} ORDER BY role_key NULLS LAST, name`;

   test('every role exists once; the Orchestrator keeps its protection and gains its contract', async () => {
      const result = await ensureOrganizationAgents(sql, workspaceId);
      assert.equal(result.inserted.length, CATALOG.length - 1, 'all but the trigger-made Orchestrator are inserted');
      const live = (await rows()).filter((row) => row.archived_at === null);
      const roles = live.filter((row) => row.role_key !== null);
      assert.equal(roles.length, CATALOG.length);
      const orchestrator = roles.find((row) => row.role_key === 'orchestrator');
      assert.equal(orchestrator?.protected, true);
      assert.equal(roles.filter((row) => row.protected).length, 1);
      assert.equal(roles.find((row) => row.role_key === 'engineering-manager')?.protected, false);
      assert.equal(roles.find((row) => row.role_key === 'cto')?.model_name, MODELS.opus);
      assert.deepEqual(roles.find((row) => row.role_key === 'product-lead')?.permissions, ['read_repository']);
      assert.ok(roles.every((row) => row.contract_version === CATALOG_VERSION));
   });

   test('legacy fleet and media agents are archived; the Guide is untouched', async () => {
      const all = await rows();
      assert.ok(all.find((row) => row.name === 'us-nova-micro')?.archived_at);
      assert.ok(all.find((row) => row.name === 'text-to-speech')?.archived_at);
      const guide = all.find((row) => row.name === 'Guide');
      assert.ok(guide && guide.archived_at === null && guide.role_key === null);
   });

   test('running it again changes nothing', async () => {
      const second = await ensureOrganizationAgents(sql, workspaceId);
      assert.deepEqual(second, { inserted: [], upgraded: [], customised: [], archived: 0 });
   });

   test('an older contract is upgraded unless a person edited it', async () => {
      await sql`
         UPDATE agents SET contract_version = 0
          WHERE workspace_id = ${workspaceId} AND role_key IN ('qa-engineer', 'technical-writer')`;
      await sql`
         UPDATE agents SET role_contract = jsonb_set(role_contract, '{mission}', '"Edited by a person."')
          WHERE workspace_id = ${workspaceId} AND role_key = 'technical-writer'`;
      const result = await ensureOrganizationAgents(sql, workspaceId);
      assert.deepEqual(result.upgraded, ['qa-engineer']);
      assert.deepEqual(result.customised, ['technical-writer']);
      const [writer] = await sql`
         SELECT role_contract->>'mission' AS mission FROM agents
          WHERE workspace_id = ${workspaceId} AND role_key = 'technical-writer'`;
      assert.equal(writer?.mission, 'Edited by a person.');
   });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server-ts && BERRY_TEST_DATABASE_URL='postgres://postgres@127.0.0.1:5432/berry_test?sslmode=disable' node --test --experimental-strip-types src/organization/provision.test.ts`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `./provision.ts`.

- [ ] **Step 3: Write `provision.ts`**

```ts
import { randomUUID } from 'node:crypto';

import type { Queryable, Sql } from '../db/pool.ts';
import { effectivePermissions } from './autonomy.ts';
import { CATALOG, CATALOG_VERSION } from './catalog.ts';
import { hashContract, parseContract, type RoleContract } from './contract.ts';

/**
 * Makes a workspace's organization match the catalog, keyed on role_key.
 * Idempotent: a second call changes nothing. A contract a person edited is
 * never overwritten — it no longer hashes to what Berry last wrote.
 */

const LEGACY_MEDIA = ['text-to-speech', 'text-to-video'];

export async function ensureOrganizationAgents(
   q: Queryable,
   workspaceId: string
): Promise<{ inserted: string[]; upgraded: string[]; customised: string[]; archived: number }> {
   const existing = await q<
      Array<{ id: string; role_key: string | null; role_contract: unknown; contract_version: number | null; contract_hash: string | null; protected: boolean }>
   >`
      SELECT id, role_key, role_contract, contract_version, contract_hash, protected
        FROM agents WHERE workspace_id = ${workspaceId} AND archived_at IS NULL`;
   const byRole = new Map(existing.filter((row) => row.role_key).map((row) => [row.role_key as string, row]));
   const inserted: string[] = [];
   const upgraded: string[] = [];
   const customised: string[] = [];

   for (const contract of CATALOG) {
      const current = byRole.get(contract.id);
      if (current) {
         if ((current.contract_version ?? 0) >= CATALOG_VERSION) continue;
         const stored = parseContract(current.role_contract);
         if (!stored || hashContract(stored) !== current.contract_hash) {
            customised.push(contract.id);
            continue;
         }
         await writeContract(q, current.id, contract);
         upgraded.push(contract.id);
         continue;
      }
      if (contract.id === 'orchestrator') {
         // The workspace trigger made it; adopt it rather than insert a second.
         const orchestrator = existing.find((row) => row.protected && !row.role_key);
         if (orchestrator) {
            await adoptOrchestrator(q, orchestrator.id, contract);
            inserted.length; // adoption is not an insert
            continue;
         }
      }
      await insertRole(q, workspaceId, contract);
      inserted.push(contract.id);
   }

   const archived = await q`
      UPDATE agents SET archived_at = now(), updated_at = now()
       WHERE workspace_id = ${workspaceId} AND archived_at IS NULL AND protected = false
         AND role_key IS NULL AND system_role IS NULL
         AND (instructions LIKE '%one of a fleet of agents%' OR name = ANY(${LEGACY_MEDIA}))
      RETURNING id`;

   return { inserted, upgraded, customised, archived: archived.length };
}

function columnsOf(contract: RoleContract) {
   return {
      role_key: contract.id,
      role_contract: contract,
      contract_version: CATALOG_VERSION,
      contract_hash: hashContract(contract),
      autonomy_level: contract.autonomy_level,
      permissions: effectivePermissions(contract),
      capabilities: contract.capabilities,
      manifest_limits: { maxTurns: contract.run_limits.max_turns, maxTokens: contract.run_limits.max_output_tokens },
   };
}

async function insertRole(q: Queryable, workspaceId: string, contract: RoleContract): Promise<void> {
   const c = columnsOf(contract);
   await q`
      INSERT INTO agents (
         id, workspace_id, name, description, instructions, status, capabilities, model_provider, model_name,
         permissions, manifest_limits, role_key, role_contract, contract_version, contract_hash, autonomy_level
      ) VALUES (
         ${randomUUID()}, ${workspaceId}, ${contract.name}, ${contract.mission}, ${contract.system_prompt},
         'available', ${c.capabilities}, 'bedrock', ${contract.preferred_model},
         ${c.permissions}, ${q.json(c.manifest_limits as never)}, ${c.role_key}, ${q.json(contract as never)},
         ${c.contract_version}, ${c.contract_hash}, ${c.autonomy_level}
      )`;
}

async function writeContract(q: Queryable, agentId: string, contract: RoleContract): Promise<void> {
   const c = columnsOf(contract);
   await q`
      UPDATE agents
         SET instructions = ${contract.system_prompt}, description = ${contract.mission},
             capabilities = ${c.capabilities}, permissions = ${c.permissions},
             manifest_limits = ${q.json(c.manifest_limits as never)},
             role_contract = ${q.json(contract as never)}, contract_version = ${c.contract_version},
             contract_hash = ${c.contract_hash}, autonomy_level = ${c.autonomy_level}, updated_at = now()
       WHERE id = ${agentId}`;
}

/** Migration 184's exact text: only then are the Orchestrator's instructions ours to replace. */
const ORCHESTRATOR_184 =
   "You are Orchestrator, the workspace's built-in agent: you take on work when no other agent is available. " +
   'Be brief and concrete. If you have no tool for what someone asks, say so plainly and say what you can do ' +
   'instead — never describe the action as done.';

async function adoptOrchestrator(q: Queryable, agentId: string, contract: RoleContract): Promise<void> {
   const c = columnsOf(contract);
   await q`
      UPDATE agents
         SET instructions = CASE WHEN instructions IS NULL OR instructions = ${ORCHESTRATOR_184}
                                 THEN ${contract.system_prompt} ELSE instructions END,
             capabilities = ${c.capabilities}, permissions = ${c.permissions},
             model_name = COALESCE(model_name, ${contract.preferred_model}),
             manifest_limits = ${q.json(c.manifest_limits as never)},
             role_key = ${c.role_key}, role_contract = ${q.json(contract as never)},
             contract_version = ${c.contract_version}, contract_hash = ${c.contract_hash},
             autonomy_level = ${c.autonomy_level}, updated_at = now()
       WHERE id = ${agentId}`;
}

export async function ensureOrganizationEverywhere(
   sql: Sql,
   onError: (workspaceId: string, error: unknown) => void
): Promise<void> {
   const workspaces = await sql<Array<{ id: string }>>`SELECT id FROM workspaces WHERE deleted_at IS NULL`;
   for (const workspace of workspaces) {
      await sql
         .begin((tx) => ensureOrganizationAgents(tx as unknown as Queryable, workspace.id))
         .catch((error: unknown) => onError(workspace.id, error));
   }
}
```

Remove the stray `inserted.length;` line when writing the file (it is a no-op). Confirm the agent column the model provider is stored in: if seeded agents use a different provider value than `'bedrock'`, copy the value `seed.ts` uses (`AgentModelProvider`).

- [ ] **Step 4: Run test to verify it passes**

Run: the Step 2 command.
Expected: PASS (4 tests).

- [ ] **Step 5: Wire it in**

`server-ts/src/identity/workspaces.ts` — after line 144 (`await installStarterLabels(tx, id, params.actorId, now);`):

```ts
            await ensureOrganizationAgents(tx, id);
```
and add `import { ensureOrganizationAgents } from '../organization/provision.ts';` beside the starter-labels import.

`server-ts/src/index.ts` — after the `syncPlatformRuntime` block (line 544):

```ts
// Every workspace carries the default organization. A failure costs that
// workspace its missing roles until the next boot, never the boot itself.
await ensureOrganizationEverywhere(sql, (workspaceId, error) =>
   logger.error('could not provision the organization', {
      workspaceId,
      error: error instanceof Error ? error.message : String(error),
   })
);
```
with `import { ensureOrganizationEverywhere } from './organization/provision.ts';`.

`server-ts/src/seed/seed.ts` — in `apply`, delete `await upsertMediaAgents(tx, now);` and after `await upsertLabels(tx, now);` add:

```ts
      const workspaces = await tx`SELECT id FROM workspaces WHERE deleted_at IS NULL`;
      for (const workspace of workspaces) await ensureOrganizationAgents(tx, workspace.id as string);
```
Delete the now-unused `upsertMediaAgents` function. `assignAgentModels` only fills null models and may stay.

Delete `src/seed/fleet.ts`, `src/seed/fleet.test.ts`, `src/seed/agents.ts`; remove the `seed:agents` script (server-ts) and `seed:agents:server` (root).

- [ ] **Step 6: Serialize the contract on agents**

`server-ts/src/agents/repository.ts`:
- Append `, agent.role_key, agent.role_contract, agent.contract_hash, agent.contract_version, agent.autonomy_level` to `AGENT_COLUMNS` (before `agent.created_at`).
- Add to `Agent`: `roleKey: string | null; department: string | null; autonomyLevel: number | null; customized: boolean; contract: RoleContract | null;` (`import type { RoleContract } from '../organization/contract.ts';`, `import { hashContract, parseContract } from '../organization/contract.ts';`).
- In `toAgent`:

```ts
   const contract = parseContract(row.role_contract);
   // ...inside the returned object:
      roleKey: (row.role_key as string | null) ?? null,
      department: contract?.department ?? null,
      autonomyLevel: row.autonomy_level === null || row.autonomy_level === undefined ? null : Number(row.autonomy_level),
      customized: contract !== null && hashContract(contract) !== row.contract_hash,
      contract,
```

`server-ts/src/mounts/agents.ts` `serializeAgent`: add `roleKey`, `department`, `autonomyLevel`, `customized` always, and `contract` (the object as stored, snake_case keys preserved inside it — it is a document, not a Berry resource).

- [ ] **Step 7: Verify**

Run:
```bash
cd server-ts && pnpm typecheck
BERRY_TEST_DATABASE_URL='postgres://postgres@127.0.0.1:5432/berry_test?sslmode=disable' pnpm test
cd .. && pnpm seed:server
psql 'postgres://postgres@127.0.0.1:5432/berry' -c "SELECT w.slug, count(*) FILTER (WHERE a.role_key IS NOT NULL) roles, count(*) FILTER (WHERE a.protected) protected FROM agents a JOIN workspaces w ON w.id=a.workspace_id WHERE a.archived_at IS NULL GROUP BY w.slug"
```
Expected: typecheck 0; tests PASS; each workspace shows `roles = 19`, `protected = 1`.

---

### Task 5: Autonomy enforcement

**Files:**
- Create: `server-ts/src/organization/enforcement.ts`
- Test: `server-ts/src/organization/enforcement.test.ts`
- Modify: `server-ts/src/runtime/agent-tools/mount.ts:29-63`
- Modify: `server-ts/src/runtime/envelope.ts:61-70` (agent `tools`)
- Modify: `server-ts/src/runtime/envelope-builder.ts:43-50,143-162,300-316`
- Modify: `server-ts/src/agents/runtime/container/handler.ts:172-181`
- Modify: `server-ts/src/agents/runtime/plugins/permissions.ts`

**Interfaces:**
- Consumes: `effectiveTools`, `INVALID_CONTRACT_TOOLS` (Task 1), `parseContract`.
- Produces:
  - `function toolsForAgentRow(row: { role_key: string | null; role_contract: unknown }): string[] | null` — `null` means "not an organization agent: unrestricted as before"
  - `async function agentToolAllowlist(sql: Sql, agentId: string): Promise<Set<string> | null>`
  - envelope `agent.tools: string[] | null`
  - `PermissionPlugin` option `allowed?: ReadonlySet<string> | null`

- [ ] **Step 1: Write the failing test**

`server-ts/src/organization/enforcement.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd server-ts && node --test --experimental-strip-types src/organization/enforcement.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `enforcement.ts`**

```ts
import type { Sql } from '../db/pool.ts';
import { effectiveTools, INVALID_CONTRACT_TOOLS } from './autonomy.ts';
import { parseContract } from './contract.ts';

/**
 * Which tools an agent may reach. Null for an agent outside the organization
 * (no role_key): its existing permissions still govern it. An organization
 * agent whose stored contract no longer validates is read-only, not open.
 */
export function toolsForAgentRow(row: { role_key: string | null; role_contract: unknown }): string[] | null {
   if (!row.role_key) return null;
   const contract = parseContract(row.role_contract);
   if (!contract) return [...INVALID_CONTRACT_TOOLS].sort();
   return effectiveTools(contract);
}

export async function agentToolAllowlist(sql: Sql, agentId: string): Promise<Set<string> | null> {
   const [row] = await sql<Array<{ role_key: string | null; role_contract: unknown }>>`
      SELECT role_key, role_contract FROM agents WHERE id = ${agentId}`;
   if (!row) return new Set();
   const tools = toolsForAgentRow(row);
   return tools === null ? null : new Set(tools);
}
```

- [ ] **Step 4: Enforce at the Berry tool API** (`mount.ts`)

In the middleware after `context.set('task', claims);` add `context.set('allowed', await agentToolAllowlist(options.sql, claims.agentId));` and declare the variable type `allowed: Set<string> | null` on the Hono generics. Then:

```ts
   route.get('/', (context) => {
      const scopes = context.get('task').scopes;
      const allowed = context.get('allowed');
      return json({
         tools: listAgentTools()
            .filter((tool) => scopes.includes(tool.scope))
            .filter((tool) => allowed === null || allowed.has(tool.name))
            .map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.jsonSchema })),
      });
   });
```
and in `route.post('/:name', …)` after the scope check:

```ts
      const allowed = context.get('allowed');
      if (allowed !== null && !allowed.has(tool.name)) {
         throw new ApiError(403, 'TOOL_NOT_ALLOWED', `${tool.name} is outside this agent's autonomy level`);
      }
```

- [ ] **Step 5: Enforce in the runtime for local tools**

`envelope.ts` agent object: add `tools: z.array(z.string().min(1)).nullable().default(null),`.
`envelope-builder.ts`: select `role_key, role_contract` in `#agent`, add `tools: toolsForAgentRow(row)` to `AgentConfig` (type `string[] | null`), and put `tools: agent.tools` in the envelope `agent` block.
`plugins/permissions.ts`: constructor accepts `allowed?: ReadonlySet<string> | null`; in the hook, before the table lookup:

```ts
         if (this.#allowed && !this.#allowed.has(name) && !this.#remote.has(name)) {
            event.cancel = `${name} is outside this agent's autonomy level`;
            return;
         }
```
where `#remote` is an optional `ReadonlySet<string>` of remote (Berry) tool names, which the server already filtered. `handler.ts`: pass `allowed: envelope.agent.tools ? new Set(envelope.agent.tools) : null, remote: new Set(remote.map((t) => t.name))`.

Add a test to `server-ts/src/agents/runtime/plugins/permissions.test.ts` in the existing style: a plugin with `allowed = new Set(['read_task'])` cancels `run_command` with "outside this agent's autonomy level" and lets `read_task` through.

- [ ] **Step 6: Verify**

Run: `cd server-ts && pnpm typecheck && BERRY_TEST_DATABASE_URL='postgres://postgres@127.0.0.1:5432/berry_test?sslmode=disable' pnpm test`
Expected: PASS.

---

### Task 6: Delegation and escalation tools; triage on contracts

**Files:**
- Create: `server-ts/src/organization/delegation.ts`
- Create: `server-ts/src/organization/tools.ts` (this task: `delegate_to_agent`, `escalate`)
- Test: `server-ts/src/organization/delegation.test.ts`, `server-ts/src/organization/tools.test.ts`
- Modify: `server-ts/src/runtime/wiring.ts` (register), `server-ts/src/index.ts:834`
- Modify: `server-ts/src/plans/triage.ts` (roster, prompt, workflow metadata)
- Modify: `server-ts/src/plans/triage.test.ts`

**Interfaces:**
- Consumes: `parseContract`, `WORKFLOWS`; `IssueRepository.create/update`; `enqueueTask(sql, EnqueueTaskInput)` from `../runs/queue.ts`; `setParent` from `../work/hierarchy.ts`; `patchMetadata` from `../work/metadata.ts`; `AgentToolDefinition` from `../runtime/agent-tools/registry.ts`.
- Produces:
  - `function canDelegate(from: RoleContract, to: RoleContract): boolean`
  - `async function roleAgent(sql: Sql, workspaceId: string, roleKey: string): Promise<{ id: string; contract: RoleContract } | null>`
  - `function registerOrganizationTools(deps: { sql: Sql; issues: IssueRepository }): void` (extended in Tasks 7–8)
  - triage answer `{ assignments: [{ taskId, agentId, workflow?: string }] }`; metadata key `berry.workflow`

- [ ] **Step 1: Write the failing tests**

`server-ts/src/organization/delegation.test.ts`:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { catalogRole } from './catalog.ts';
import { canDelegate } from './delegation.ts';

const role = (key: string) => {
   const found = catalogRole(key);
   assert.ok(found, key);
   return found;
};

test('delegation needs both sides of the edge', () => {
   assert.equal(canDelegate(role('engineering-manager'), role('backend-engineer')), true);
   assert.equal(canDelegate(role('backend-engineer'), role('engineering-manager')), false);
   assert.equal(canDelegate({ ...role('engineering-manager') }, { ...role('backend-engineer'), receives_work_from: [] }), false);
});

test('the Orchestrator can route to every role', () => {
   for (const key of ['product-lead', 'sre', 'frontend-engineer', 'cto']) {
      assert.equal(canDelegate(role('orchestrator'), role(key)), true, key);
   }
});
```

`server-ts/src/organization/tools.test.ts` (database-gated; follow `provision.test.ts` setup: create a workspace, a board via `insertBoard` from `../test-support/boards.ts`, a user, call `ensureOrganizationAgents`, create a parent issue assigned to the engineering manager):

```ts
test('delegate_to_agent creates an assigned sub-task along the graph', async () => {
   const result = await tool('delegate_to_agent').run(contextFor('engineering-manager', parentIssueId), {
      role: 'backend-engineer',
      title: 'Implement the endpoint',
      description: 'POST /things',
      acceptanceCriteria: ['Returns 201 with the created thing'],
   });
   assert.equal(result.ok, true);
   const [child] = await sql`SELECT assignee_id, parent_id, description FROM issues WHERE title = 'Implement the endpoint'`;
   assert.equal(child?.parent_id, parentIssueId);
   assert.equal(child?.assignee_id, agentIdFor('backend-engineer'));
   assert.match(String(child?.description), /Acceptance criteria/);
});

test('delegate_to_agent outside the graph is refused and creates nothing', async () => {
   await assert.rejects(
      tool('delegate_to_agent').run(contextFor('backend-engineer', parentIssueId), {
         role: 'engineering-manager', title: 'Nope', description: '', acceptanceCriteria: ['x'],
      }),
      /cannot hand work to engineering-manager/
   );
   const rows = await sql`SELECT 1 FROM issues WHERE title = 'Nope'`;
   assert.equal(rows.length, 0);
});

test('escalate to a person blocks the task and opens an escalation approval', async () => {
   await sql`UPDATE issues SET status = 'in_progress' WHERE id = ${parentIssueId}`;
   const result = await tool('escalate').run(contextFor('sre', parentIssueId), {
      to: 'human', decision: 'operational', question: 'Roll back?', options: ['Roll back', 'Hotfix'], recommendation: 'Roll back',
   });
   assert.equal(result.ok, true);
   const [issue] = await sql`SELECT status FROM issues WHERE id = ${parentIssueId}`;
   assert.equal(issue?.status, 'blocked');
   const [approval] = await sql`SELECT kind, status FROM approvals WHERE issue_id = ${parentIssueId} AND kind = 'escalation'`;
   assert.equal(approval?.status, 'pending');
});
```
`contextFor(roleKey, issueId)` builds an `AgentToolContext` `{ sql, storage: null, issues: new IssueRepository(sql), projects: {} as never, task: { tokenId: 't', runId: <a run row you insert for the issue>, workspaceId, agentId: agentIdFor(roleKey), issueId, boardId, scopes: ['task:read', 'task:write'] } }`; `tool(name)` is `getAgentTool(name)!` after `registerOrganizationTools({ sql, issues: new IssueRepository(sql) })`.

- [ ] **Step 2: Run to verify they fail**

Run: `cd server-ts && node --test --experimental-strip-types src/organization/delegation.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `delegation.ts`**

```ts
import type { Sql } from '../db/pool.ts';
import { parseContract, type RoleContract } from './contract.ts';

/** Both sides must agree: the sender lists the receiver and the receiver lists the sender. */
export function canDelegate(from: RoleContract, to: RoleContract): boolean {
   return from.can_delegate_to.includes(to.id) && to.receives_work_from.includes(from.id);
}

export async function roleAgent(
   sql: Sql,
   workspaceId: string,
   roleKey: string
): Promise<{ id: string; contract: RoleContract } | null> {
   const [row] = await sql<Array<{ id: string; role_contract: unknown }>>`
      SELECT id, role_contract FROM agents
       WHERE workspace_id = ${workspaceId} AND role_key = ${roleKey} AND archived_at IS NULL`;
   const contract = row ? parseContract(row.role_contract) : null;
   return row && contract ? { id: row.id, contract } : null;
}

export async function callerContract(sql: Sql, agentId: string): Promise<RoleContract | null> {
   const [row] = await sql<Array<{ role_contract: unknown }>>`SELECT role_contract FROM agents WHERE id = ${agentId}`;
   return row ? parseContract(row.role_contract) : null;
}
```

- [ ] **Step 4: Write `tools.ts` with `delegate_to_agent` and `escalate`**

```ts
import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import type { IssueRepository } from '../core/issues.ts';
import type { Sql } from '../db/pool.ts';
import { ApiError } from '../http/errors.ts';
import { enqueueTask } from '../runs/queue.ts';
import { getAgentTool, registerAgentTool, type AgentToolContext } from '../runtime/agent-tools/registry.ts';
import { setParent } from '../work/hierarchy.ts';
import { callerContract, canDelegate, roleAgent } from './delegation.ts';

interface OrganizationToolDeps {
   sql: Sql;
   issues: IssueRepository;
}

function issueOf(context: AgentToolContext): string {
   if (!context.task.issueId) throw ApiError.badRequest('this task is not on an issue');
   return context.task.issueId;
}

async function requireContract(context: AgentToolContext) {
   const contract = await callerContract(context.sql, context.task.agentId);
   if (!contract) throw new ApiError(403, 'NOT_AN_ORGANIZATION_ROLE', 'only an organization role can use this tool');
   return contract;
}

async function parentOf(context: AgentToolContext, issueId: string) {
   const [row] = await context.sql<Array<{ board_id: string; priority: string; requested_by: string | null }>>`
      SELECT i.board_id, i.priority, COALESCE(r.requested_by, i.created_by) AS requested_by
        FROM issues i LEFT JOIN runs r ON r.id = ${context.task.runId}
       WHERE i.id = ${issueId}`;
   if (!row) throw ApiError.notFound('Task');
   return row;
}

const unblockable = new Set(['todo', 'in_progress', 'in_review']);

export function registerOrganizationTools(deps: OrganizationToolDeps): void {
   if (getAgentTool('delegate_to_agent')) return;

   registerAgentTool('delegate_to_agent', {
      description:
         'Hand a piece of this task to another role in the organization, as a sub-task with acceptance criteria. ' +
         'Only along your delegation list.',
      scope: 'task:write',
      inputSchema: z.object({
         role: z.string().regex(/^[a-z][a-z0-9-]{1,48}$/),
         title: z.string().trim().min(1).max(500),
         description: z.string().max(20_000).default(''),
         acceptanceCriteria: z.array(z.string().trim().min(1).max(1000)).min(1).max(20),
      }),
      handler: async (context, input) => {
         const caller = await requireContract(context);
         const target = await roleAgent(context.sql, context.task.workspaceId, input.role);
         if (!target) throw ApiError.notFound('Role');
         if (!canDelegate(caller, target.contract)) {
            throw new ApiError(403, 'DELEGATION_NOT_ALLOWED', `${caller.id} cannot hand work to ${input.role}`);
         }
         const parentId = issueOf(context);
         const parent = await parentOf(context, parentId);
         const description = [
            input.description.trim(),
            `Acceptance criteria:\n${input.acceptanceCriteria.map((line) => `- ${line}`).join('\n')}`,
            `Delegated by ${caller.name}.`,
         ].filter(Boolean).join('\n\n');
         const { issue } = await deps.issues.create({
            boardId: parent.board_id,
            title: input.title,
            description,
            status: 'todo',
            priority: parent.priority,
            sortOrder: 0,
            dueDate: null,
            assignee: { type: 'agent', id: target.id },
            project: null,
            createdBy: parent.requested_by,
         });
         await setParent(context.sql, { workspaceId: context.task.workspaceId, issueId: issue.id, parentId, stage: null });
         let runId: string | null = null;
         try {
            ({ runId } = await enqueueTask(context.sql, {
               workspaceId: context.task.workspaceId,
               agentId: target.id,
               issueId: issue.id,
               kind: 'agent',
               source: 'assignment',
               ...(parent.requested_by ? { requestedBy: parent.requested_by } : {}),
            }));
         } catch {
            // Assigned but not started (e.g. the runtime refuses): the task is visible and can be started.
         }
         return { id: issue.id, identifier: issue.identifier, assignedTo: input.role, runId };
      },
   });

   registerAgentTool('escalate', {
      description:
         'Stop and ask for a decision you do not own: to the CTO (technical), the Product Lead (product) or a person. ' +
         'Blocks this task until it is answered.',
      scope: 'task:write',
      inputSchema: z.object({
         to: z.enum(['cto', 'product-lead', 'human']),
         decision: z.enum(['product', 'technical', 'security', 'operational']),
         question: z.string().trim().min(1).max(4000),
         options: z.array(z.string().trim().min(1).max(1000)).max(6).default([]),
         recommendation: z.string().max(4000).default(''),
      }),
      handler: async (context, input) => {
         const caller = await requireContract(context);
         const issueId = issueOf(context);
         const parent = await parentOf(context, issueId);
         const body = [
            `${caller.name} needs a ${input.decision} decision.`,
            input.question,
            input.options.length ? `Options:\n${input.options.map((option) => `- ${option}`).join('\n')}` : '',
            input.recommendation ? `Recommendation: ${input.recommendation}` : '',
         ].filter(Boolean).join('\n\n');

         let reference: { approvalId?: string; taskId?: string };
         if (input.to === 'human') {
            const approvalId = randomUUID();
            await context.sql`
               INSERT INTO approvals (id, workspace_id, kind, risk, title, description, issue_id,
                                      requested_from_role, requested_by_type, requested_by, status)
               VALUES (${approvalId}, ${context.task.workspaceId}, 'escalation',
                       ${input.decision === 'security' ? 'high' : 'medium'},
                       ${`Decision needed: ${input.question.slice(0, 200)}`}, ${body}, ${issueId},
                       'admin', 'agent', ${context.task.agentId}, 'pending')`;
            reference = { approvalId };
         } else {
            const owner = await roleAgent(context.sql, context.task.workspaceId, input.to);
            if (!owner) throw ApiError.notFound('Role');
            const { issue } = await deps.issues.create({
               boardId: parent.board_id,
               title: `Decision: ${input.question.slice(0, 200)}`,
               description: body,
               status: 'todo',
               priority: 'high',
               sortOrder: 0,
               dueDate: null,
               assignee: { type: 'agent', id: owner.id },
               project: null,
               createdBy: parent.requested_by,
            });
            await setParent(context.sql, { workspaceId: context.task.workspaceId, issueId: issue.id, parentId: issueId, stage: null });
            reference = { taskId: issue.id };
         }
         const [current] = await context.sql<Array<{ status: string }>>`SELECT status::text AS status FROM issues WHERE id = ${issueId}`;
         if (current && unblockable.has(current.status)) {
            await deps.issues.update({
               issueId,
               patch: { status: 'blocked', descriptionSet: false, dueDateSet: false, assigneeSet: false, projectSet: false },
               actorId: context.task.agentId,
               actorType: 'agent',
            });
         }
         return { escalatedTo: input.to, blocked: true, ...reference };
      },
   });
}
```

`approvals.requested_by` must accept an agent id: check its column type/FK (`\d approvals`). If it references `users`, store the requesting person (`parent.requested_by`) instead and put the agent in the description.

`wiring.ts`: export `registerOrganizationToolsFor(deps)` calling `registerOrganizationTools(deps)`; `index.ts`: call it beside `registerDelegateTool` (line 834).

- [ ] **Step 5: Triage on contracts and workflows** (`plans/triage.ts`)

- `roster` SQL: select `role_key, role_contract` as well, drop `AND protected = false`'s effect only for routing roles — keep it (the Orchestrator itself is the router), and map each row to `{ ...row, role: contract?.role ?? null, mission: contract?.mission ?? null, capabilities: contract?.capabilities ?? row.capabilities ?? [], autonomy: contract?.autonomy_level ?? null }` using `parseContract`.
- `SYSTEM`: append:

```
Each agent may carry a role (e.g. "Principal Software Architect"), a mission and an autonomy level.
Choose one of these workflows for each task and assign the task to the FIRST role of that workflow
that exists on the roster:
<WORKFLOWS rendered as "- key: chain (when)">
A task answer may name the workflow: { "taskId": "...", "agentId": "...", "workflow": "frontend-visual-bug" }.
```
  built with `WORKFLOWS.map((w) => \`- ${w.key}: ${w.chain.join(' → ')} (${w.when})\`).join('\n')`.
- `ASSIGNMENTS` schema: `workflow: z.string().optional()` in each item.
- `#decide` user JSON agents: add `role`, `mission`, `capabilities`, `autonomy`.
- `#decide` returns `Map<string, { agentId: string; workflow: string | null }>`; keep dropping unknown agents and tasks; a workflow key not in `WORKFLOWS` becomes `null`.
- `triage`: after the assignment UPDATE, when `workflow` is set: `await this.#sql.begin((tx) => patchMetadata(tx as never, task.id, { set: { 'berry.workflow': workflow } }))`.

Update `triage.test.ts`: the existing "what the orchestrator is shown" test asserts the user JSON now includes `role` and `mission` for an agent carrying a contract, and a new test asserts an answer with `"workflow": "frontend-visual-bug"` writes `berry.workflow` (stub `sql.begin` in the existing no-database style, or move that assertion to a database-gated test).

- [ ] **Step 6: Verify**

Run: `cd server-ts && pnpm typecheck && BERRY_TEST_DATABASE_URL='postgres://postgres@127.0.0.1:5432/berry_test?sslmode=disable' node --test --experimental-strip-types src/organization/*.test.ts src/plans/triage.test.ts && BERRY_TEST_DATABASE_URL='postgres://postgres@127.0.0.1:5432/berry_test?sslmode=disable' pnpm test`
Expected: PASS.

---

### Task 7: Required reviews and Level 5 authority

**Files:**
- Create: `server-ts/src/organization/reviews.ts`
- Test: `server-ts/src/organization/reviews.test.ts`
- Modify: `server-ts/src/agents/review-gate.ts`
- Modify: `server-ts/src/agents/review-gate.test.ts`
- Modify: `server-ts/src/organization/tools.ts` (`submit_review`)

**Interfaces:**
- Consumes: `RoleContract['review_requirements']`, `parseContract`, `roleAgent`.
- Produces:
  - `interface ReviewSubject { labels: string[]; paths: string[]; impactClasses: string[]; workflow: string | null }`
  - `function requiredReviews(requirements: RoleContract['review_requirements'], subject: ReviewSubject): Array<{ reviewer: string; authority: 'blocking' | 'advisory' }>` (deduped; blocking wins over advisory for the same reviewer)
  - `function globMatch(pattern: string, path: string): boolean`
  - `ReviewGate.review(runId, options)` unchanged signature; for an organization author it runs every required reviewer
  - `ReviewGate.recordVerdict(input: { runId: string; reviewerId: string; reviewerRole: string; verdict: Verdict }): Promise<void>` (used by `submit_review`)

- [ ] **Step 1: Write the failing test**

`server-ts/src/organization/reviews.test.ts`:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { catalogRole } from './catalog.ts';
import { globMatch, requiredReviews } from './reviews.ts';

const backend = catalogRole('backend-engineer')!.review_requirements;
const subject = (over: Partial<Parameters<typeof requiredReviews>[1]> = {}) => ({
   labels: [], paths: ['server-ts/src/core/issues.ts'], impactClasses: [], workflow: null, ...over,
});

test('QA always reviews implementation', () => {
   assert.deepEqual(requiredReviews(backend, subject()), [{ reviewer: 'qa-engineer', authority: 'blocking' }]);
});

test('auth paths bring Security; migrations bring the Architect and the Database Engineer', () => {
   const reviews = requiredReviews(backend, subject({ paths: ['server-ts/src/auth/sessions.ts', 'server-ts/migrations/187_x.up.sql'] }));
   assert.deepEqual(reviews.map((r) => `${r.reviewer}:${r.authority}`).sort(), [
      'database-engineer:advisory', 'qa-engineer:blocking', 'security-engineer:blocking', 'software-architect:blocking',
   ]);
});

test('labels and workflow trigger reviews too', () => {
   const reviews = requiredReviews(backend, subject({ labels: ['security'], workflow: 'full-delivery' }));
   assert.ok(reviews.some((r) => r.reviewer === 'security-engineer'));
   assert.ok(reviews.some((r) => r.reviewer === 'product-lead' && r.authority === 'blocking'));
});

test('globs', () => {
   assert.equal(globMatch('**/auth/**', 'server-ts/src/auth/x.ts'), true);
   assert.equal(globMatch('**/*.sql', 'a/b/c.sql'), true);
   assert.equal(globMatch('.github/**', '.github/workflows/ci.yml'), true);
   assert.equal(globMatch('**/auth/**', 'server-ts/src/author.ts'), false);
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd server-ts && node --test --experimental-strip-types src/organization/reviews.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `reviews.ts`**

```ts
import type { RoleContract } from './contract.ts';

export interface ReviewSubject {
   labels: string[];
   paths: string[];
   impactClasses: string[];
   workflow: string | null;
}

export function globMatch(pattern: string, path: string): boolean {
   let source = '';
   for (let i = 0; i < pattern.length; i += 1) {
      const char = pattern[i]!;
      if (char === '*' && pattern[i + 1] === '*') {
         // "**/" matches zero or more directories; a trailing "**" matches the rest.
         if (pattern[i + 2] === '/') { source += '(?:.*/)?'; i += 2; } else { source += '.*'; i += 1; }
      } else if (char === '*') {
         source += '[^/]*';
      } else {
         source += /[.+?^${}()|[\]\\]/.test(char) ? `\\${char}` : char;
      }
   }
   return new RegExp(`^${source}$`).test(path);
}

function applies(when: RoleContract['review_requirements'][number]['when'], subject: ReviewSubject): boolean {
   if (when.always) return true;
   const labels = new Set(subject.labels.map((label) => label.toLowerCase()));
   return Boolean(
      when.labels_any?.some((label) => labels.has(label.toLowerCase())) ||
         when.paths_any?.some((pattern) => subject.paths.some((path) => globMatch(pattern, path))) ||
         when.impact_any?.some((impact) => subject.impactClasses.includes(impact)) ||
         (subject.workflow !== null && when.workflow_any?.includes(subject.workflow))
   );
}

export function requiredReviews(
   requirements: RoleContract['review_requirements'],
   subject: ReviewSubject
): Array<{ reviewer: string; authority: 'blocking' | 'advisory' }> {
   const chosen = new Map<string, 'blocking' | 'advisory'>();
   for (const rule of requirements) {
      if (!applies(rule.when, subject)) continue;
      if (chosen.get(rule.reviewer) === 'blocking') continue;
      chosen.set(rule.reviewer, rule.authority);
   }
   return [...chosen].map(([reviewer, authority]) => ({ reviewer, authority }));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: the Step 2 command. Expected: PASS.

- [ ] **Step 5: Extend the ReviewGate**

In `review-gate.ts`:
1. `ReviewMaterial` gains `labels: string[]`, `workflow: string | null`, `authorContract: RoleContract | null`. `#material` adds: labels via `SELECT l.name FROM issue_label_memberships m JOIN issue_labels l ON l.id = m.label_id WHERE m.issue_id = ${issueId}`, workflow via `issue.metadata->>'berry.workflow'`, and the author's `role_contract` (`parseContract`).
2. `review()`: when `material.authorContract` is null keep today's path exactly (single peer, `autoGate`, approved → done). When it is set (an organization author):
   - skip `autoGate` (organization work is always reviewed) but still require `delivered.pullRequest` and status `in_review`;
   - `const required = requiredReviews(material.authorContract.review_requirements, { labels, paths: delivered.files, impactClasses: [], workflow })`;
   - for each required reviewer resolve `roleAgent(sql, workspaceId, reviewer)`; skip a missing role (logged via `onError`) and skip one equal to the author;
   - for each, `#openVerdict` with `reviewer_role` and `authority`, run the completion with the reviewer's own `model_name`, system prompt = `SYSTEM` + the reviewer contract's `review_domains` and `never`, and for `security-engineer` use `SECURITY_VERDICT` (below);
   - after all verdicts: if any **blocking** verdict rejected → `#apply` rejection path (status `todo`, re-admit within `maxAttempts`, comment with every blocking finding); else → comment "**Required reviews passed** — waiting for a person" and leave status `in_review` (never `done`);
   - advisory verdicts only post their comment.
   - `#attempts` counts `approved = false AND authority = 'blocking'`.
3. `SECURITY_VERDICT`:

```ts
const SECURITY_VERDICT = z.object({
   approved: z.boolean(),
   reason: z.string(),
   findings: z.array(z.object({
      severity: z.enum(['critical', 'high', 'medium', 'low']),
      exploitability: z.enum(['proven', 'likely', 'possible', 'unlikely']),
      impact: z.string().min(1),
      remediation: z.string().min(1),
      path: z.string().nullable().optional(),
      message: z.string(),
   })).default([]),
});
```
   Normalise to `Verdict` by mapping `critical → high` and folding exploitability/impact/remediation into `message`.
4. `recordVerdict(input)`: insert a decided row (`reviewer_role`, `authority: 'blocking'`) for the run, then re-evaluate: if every required blocking reviewer for the run has approved → leave in_review with the "passed" comment; if this verdict rejects → rejection path.

Tests to add to `review-gate.test.ts` (database-gated, reuse `delivered()` and `gate()`; give the author agent a `role_key`/`role_contract` of `catalogRole('backend-engineer')` and create `qa-engineer` and `security-engineer` agents with their contracts):
- an organization author with `files: ['src/a.ts']` gets exactly one review row (`reviewer_role = 'qa-engineer'`), and approval leaves the task `in_review`;
- with `files: ['server-ts/src/auth/x.ts']` it gets QA and Security rows; a Security rejection sets `todo`;
- a Security verdict without `exploitability` fails schema parsing and is recorded as not decided, the task stays `in_review`;
- the legacy test "approve moves to done" still passes for an author without a contract.

- [ ] **Step 6: `submit_review` tool** (append to `registerOrganizationTools`; `deps` gains `gate: Pick<ReviewGate, 'recordVerdict'> | null`)

```ts
   registerAgentTool('submit_review', {
      description:
         'Record your blocking review of the latest delivered run on this task, within your review domains. ' +
         'A rejection needs findings with evidence.',
      scope: 'task:write',
      inputSchema: z.object({
         approved: z.boolean(),
         reason: z.string().trim().min(1).max(4000),
         findings: z.array(z.object({
            severity: z.enum(['high', 'medium', 'low']),
            path: z.string().nullable().optional(),
            message: z.string().min(1).max(2000),
         })).max(50).default([]),
      }),
      handler: async (context, input) => {
         const caller = await requireContract(context);
         if (caller.autonomy_level !== 5) throw new ApiError(403, 'NOT_A_REVIEWER', `${caller.name} has no review authority`);
         if (!deps.gate) throw new ApiError(412, 'REVIEWER_UNAVAILABLE', 'this deployment cannot run reviews');
         if (!input.approved && input.findings.length === 0) throw ApiError.badRequest('a rejection needs findings');
         const issueId = issueOf(context);
         const [run] = await context.sql<Array<{ id: string; agent_id: string }>>`
            SELECT id, agent_id FROM runs WHERE issue_id = ${issueId} AND status = 'succeeded'
             ORDER BY completed_at DESC NULLS LAST, created_at DESC LIMIT 1`;
         if (!run) throw ApiError.notFound('Delivered run');
         if (run.agent_id === context.task.agentId) throw new ApiError(403, 'SELF_REVIEW', 'you cannot review your own run');
         await deps.gate.recordVerdict({ runId: run.id, reviewerId: context.task.agentId, reviewerRole: caller.id, verdict: input });
         return { recorded: true, approved: input.approved };
      },
   });
```

- [ ] **Step 7: Verify**

Run: `cd server-ts && pnpm typecheck && BERRY_TEST_DATABASE_URL='postgres://postgres@127.0.0.1:5432/berry_test?sslmode=disable' pnpm test`
Expected: PASS.

---

### Task 8: Work proposals and discovery

**Files:**
- Create: `server-ts/src/organization/proposals.ts`
- Create: `server-ts/src/organization/discovery.ts`
- Test: `server-ts/src/organization/proposals.test.ts`, `server-ts/src/organization/discovery.test.ts`
- Modify: `server-ts/src/organization/tools.ts` (`propose_work`)
- Modify: `server-ts/src/organization/provision.ts` (`ensureOrganizationEverywhere` adds discovery)
- Modify: `server-ts/src/autopilots/fire.ts:223-248` (`reasonToSkip`)
- Modify: `server-ts/src/approvals/repository.ts` (`ApprovalKind`, `toWireKind`, `toColumnKind`, `resolve`)
- Modify: `server-ts/src/mounts/approvals.ts:40` (`KINDS`)
- Modify: `server-ts/src/mounts/workspaces.ts` (create route: ensure discovery after create)

**Interfaces:**
- Produces:
  - `const proposalSchema` (zod) and `type ProposalInput`
  - `function fingerprintProposal(roleKey: string, input: Pick<ProposalInput, 'problem' | 'evidence'>): string`
  - `function acceptDecision(input: { severity: string; impactClasses: string[]; proposerLevel: number }): 'auto_accept' | 'needs_decision'`
  - `async function applyProposalDecision(q: Queryable, input: { approvalId: string; decision: 'approved' | 'rejected'; userId: string }): Promise<void>`
  - `const DISCOVERY_PROMPT: (contract: RoleContract) => string`
  - `async function ensureDiscovery(sql: Sql, workspaceId: string, deps: { autopilots: AutopilotRepository; issues: IssueRepository }): Promise<{ created: string[] }>`
  - Approval wire kinds `workProposal`, `escalation`

- [ ] **Step 1: Write the failing test**

`server-ts/src/organization/proposals.test.ts`:

```ts
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { acceptDecision, fingerprintProposal, proposalSchema } from './proposals.ts';

const valid = {
   problem: 'lodash 4.17.15 has a prototype pollution advisory',
   evidence: [{ kind: 'dependency', ref: 'frontend/package.json', excerpt: '"lodash": "4.17.15"' }],
   impact: 'Crafted input can modify object prototypes server-side.',
   severity: 'high',
   impactClasses: ['security'],
   proposedAction: 'Upgrade lodash to 4.17.21 and add a lockfile check.',
   effort: 's',
   dependencies: [],
   responsibleRole: 'backend-engineer',
   requiredReviewers: ['security-engineer', 'qa-engineer'],
};

test('a proposal needs evidence', () => {
   assert.equal(proposalSchema.safeParse(valid).success, true);
   assert.equal(proposalSchema.safeParse({ ...valid, evidence: [] }).success, false);
});

test('fingerprints ignore case, spacing and evidence order', () => {
   const a = fingerprintProposal('security-engineer', valid);
   const b = fingerprintProposal('security-engineer', { ...valid, problem: `  ${valid.problem.toUpperCase()} ` });
   assert.equal(a, b);
   assert.notEqual(a, fingerprintProposal('qa-engineer', valid));
});

test('only routine, low or medium work from Level 4+ is auto-accepted', () => {
   assert.equal(acceptDecision({ severity: 'medium', impactClasses: ['routine'], proposerLevel: 4 }), 'auto_accept');
   assert.equal(acceptDecision({ severity: 'medium', impactClasses: ['routine'], proposerLevel: 3 }), 'needs_decision');
   assert.equal(acceptDecision({ severity: 'high', impactClasses: ['routine'], proposerLevel: 5 }), 'needs_decision');
   assert.equal(acceptDecision({ severity: 'low', impactClasses: ['routine', 'operational'], proposerLevel: 5 }), 'needs_decision');
});
```

`server-ts/src/organization/discovery.test.ts` (database-gated): after `ensureOrganizationAgents` and `ensureDiscovery`, assert 18 autopilots with `discovery_role` set, `status = 'active'`, `quota_period = 'week'`, `quota_max = 1`, each with one enabled cron trigger; a second `ensureDiscovery` creates none; with `discovery_enabled = false`, `fireAutopilot` records `skipped` with `reason_code = 'DISCOVERY_OFF'`; with no project linked to a repository and no other tasks it records `NOTHING_TO_INSPECT`.

- [ ] **Step 2: Run to verify it fails**

Run: `cd server-ts && node --test --experimental-strip-types src/organization/proposals.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Write `proposals.ts`**

```ts
import { createHash } from 'node:crypto';

import { z } from 'zod';

import type { Queryable } from '../db/pool.ts';

export const proposalSchema = z.object({
   problem: z.string().trim().min(1).max(4000),
   evidence: z.array(z.object({
      kind: z.enum(['file', 'run', 'dependency', 'metric', 'task', 'url']),
      ref: z.string().trim().min(1).max(1000),
      excerpt: z.string().max(2000).default(''),
   })).min(1).max(20),
   impact: z.string().trim().min(1).max(4000),
   severity: z.enum(['critical', 'high', 'medium', 'low']),
   impactClasses: z.array(z.enum(['product', 'security', 'architectural', 'financial', 'operational', 'routine'])).min(1).max(6),
   proposedAction: z.string().trim().min(1).max(4000),
   effort: z.enum(['xs', 's', 'm', 'l', 'xl']),
   dependencies: z.array(z.string().trim().min(1).max(500)).max(20).default([]),
   responsibleRole: z.string().regex(/^[a-z][a-z0-9-]{1,48}$/),
   requiredReviewers: z.array(z.string().regex(/^[a-z][a-z0-9-]{1,48}$/)).max(10).default([]),
});

export type ProposalInput = z.infer<typeof proposalSchema>;

export function fingerprintProposal(roleKey: string, input: Pick<ProposalInput, 'problem' | 'evidence'>): string {
   const problem = input.problem.trim().toLowerCase().replace(/\s+/g, ' ');
   const refs = input.evidence.map((item) => item.ref.trim()).sort().join('|');
   return createHash('sha256').update(`${roleKey}\n${problem}\n${refs}`).digest('hex');
}

const SIGNIFICANT = new Set(['product', 'security', 'architectural', 'financial', 'operational']);

export function acceptDecision(input: { severity: string; impactClasses: string[]; proposerLevel: number }): 'auto_accept' | 'needs_decision' {
   if (input.proposerLevel < 4) return 'needs_decision';
   if (input.severity === 'critical' || input.severity === 'high') return 'needs_decision';
   if (input.impactClasses.some((impact) => SIGNIFICANT.has(impact))) return 'needs_decision';
   return input.impactClasses.every((impact) => impact === 'routine') ? 'auto_accept' : 'needs_decision';
}

/** Accept assigns the task to the responsible role and moves it to todo; reject cancels it. */
export async function applyProposalDecision(
   q: Queryable,
   input: { approvalId: string; decision: 'approved' | 'rejected'; userId: string }
): Promise<void> {
   const [proposal] = await q<Array<{ id: string; issue_id: string; workspace_id: string; responsible_role: string }>>`
      SELECT id, issue_id, workspace_id, responsible_role FROM work_proposals
       WHERE approval_id = ${input.approvalId} AND status = 'proposed' FOR UPDATE`;
   if (!proposal) return;
   if (input.decision === 'rejected') {
      await q`UPDATE work_proposals SET status = 'rejected', decided_by = ${input.userId}, decided_at = now(), updated_at = now() WHERE id = ${proposal.id}`;
      await q`UPDATE issues SET status = 'cancelled', updated_at = now() WHERE id = ${proposal.issue_id} AND status = 'backlog'`;
      return;
   }
   const [owner] = await q<Array<{ id: string }>>`
      SELECT id FROM agents WHERE workspace_id = ${proposal.workspace_id} AND role_key = ${proposal.responsible_role} AND archived_at IS NULL`;
   await q`UPDATE work_proposals SET status = 'accepted', decided_by = ${input.userId}, decided_at = now(), updated_at = now() WHERE id = ${proposal.id}`;
   await q`
      UPDATE issues SET status = 'todo',
             assignee_type = CASE WHEN ${owner?.id ?? null}::uuid IS NULL THEN assignee_type ELSE 'agent' END,
             assignee_id = COALESCE(${owner?.id ?? null}::uuid, assignee_id), updated_at = now()
       WHERE id = ${proposal.issue_id} AND status = 'backlog'`;
}
```

Check `issues.status` is the `issue_status` enum: if the raw UPDATE needs a cast, write `status = 'todo'::issue_status`. Also insert into `assignments` if the repository keeps assignments in a separate table (see `IssueRepository.create`), using the same insert it uses.

- [ ] **Step 4: `propose_work` tool** (append to `registerOrganizationTools`)

```ts
   registerAgentTool('propose_work', {
      description:
         'File worthwhile work you discovered, with evidence, impact, severity, effort, dependencies, the responsible role ' +
         'and required reviewers. Work with product, security, architectural, financial or operational impact waits for a person.',
      scope: 'task:write',
      inputSchema: proposalSchema,
      handler: async (context, input) => {
         const caller = await requireContract(context);
         const workspaceId = context.task.workspaceId;
         const owner = await roleAgent(context.sql, workspaceId, input.responsibleRole);
         if (!owner) throw ApiError.badRequest(`unknown responsible role ${input.responsibleRole}`);
         for (const reviewer of input.requiredReviewers) {
            if (!(await roleAgent(context.sql, workspaceId, reviewer))) throw ApiError.badRequest(`unknown reviewer ${reviewer}`);
         }
         const fingerprint = fingerprintProposal(caller.id, input);
         const [open] = await context.sql<Array<{ id: string; issue_id: string }>>`
            SELECT id, issue_id FROM work_proposals WHERE workspace_id = ${workspaceId} AND fingerprint = ${fingerprint} AND status = 'proposed'`;
         if (open) return { proposalId: open.id, taskId: open.issue_id, duplicate: true };

         const boardId = await defaultBoardId(context.sql, workspaceId);
         const description = renderProposal(caller.name, input);
         const decision = acceptDecision({ severity: input.severity, impactClasses: input.impactClasses, proposerLevel: caller.autonomy_level });
         const [requester] = await context.sql<Array<{ requested_by: string | null }>>`SELECT requested_by FROM runs WHERE id = ${context.task.runId}`;
         const { issue } = await deps.issues.create({
            boardId,
            title: input.problem.slice(0, 200),
            description,
            status: decision === 'auto_accept' ? 'todo' : 'backlog',
            priority: input.severity === 'critical' ? 'urgent' : input.severity === 'high' ? 'high' : input.severity === 'medium' ? 'medium' : 'low',
            sortOrder: 0,
            dueDate: null,
            assignee: decision === 'auto_accept' ? { type: 'agent', id: owner.id } : null,
            project: null,
            createdBy: requester?.requested_by ?? null,
         });
         await labelProposal(context.sql, workspaceId, issue.id, requester?.requested_by ?? null);

         let approvalId: string | null = null;
         if (decision === 'needs_decision') {
            approvalId = randomUUID();
            await context.sql`
               INSERT INTO approvals (id, workspace_id, kind, risk, title, description, issue_id,
                                      requested_from_role, requested_by_type, requested_by, status)
               VALUES (${approvalId}, ${workspaceId}, 'work_proposal',
                       ${input.severity === 'critical' || input.severity === 'high' ? 'high' : input.severity === 'medium' ? 'medium' : 'low'},
                       ${`Proposal: ${input.problem.slice(0, 200)}`}, ${description}, ${issue.id},
                       'admin', 'agent', ${context.task.agentId}, 'pending')`;
         }
         const [proposal] = await context.sql<Array<{ id: string }>>`
            INSERT INTO work_proposals (workspace_id, issue_id, approval_id, proposed_by, role_key, problem, evidence, impact,
                                        severity, impact_classes, proposed_action, effort, dependencies, responsible_role,
                                        required_reviewers, fingerprint, status, decided_at)
            VALUES (${workspaceId}, ${issue.id}, ${approvalId}, ${context.task.agentId}, ${caller.id}, ${input.problem},
                    ${context.sql.json(input.evidence as never)}, ${input.impact}, ${input.severity}, ${input.impactClasses},
                    ${input.proposedAction}, ${input.effort}, ${input.dependencies}, ${input.responsibleRole},
                    ${input.requiredReviewers}, ${fingerprint}, ${decision === 'auto_accept' ? 'accepted' : 'proposed'},
                    ${decision === 'auto_accept' ? new Date().toISOString() : null})
            RETURNING id`;
         return { proposalId: proposal!.id, taskId: issue.id, identifier: issue.identifier, decision };
      },
   });
```

with helpers in `tools.ts`:

```ts
function renderProposal(proposer: string, input: ProposalInput): string {
   return [
      `**Proposed by ${proposer}.**`,
      `**Problem**\n${input.problem}`,
      `**Evidence**\n${input.evidence.map((item) => `- ${item.kind}: ${item.ref}${item.excerpt ? ` — ${item.excerpt}` : ''}`).join('\n')}`,
      `**Impact** (${input.severity}; ${input.impactClasses.join(', ')})\n${input.impact}`,
      `**Proposed action** (effort ${input.effort})\n${input.proposedAction}`,
      input.dependencies.length ? `**Dependencies**\n${input.dependencies.map((d) => `- ${d}`).join('\n')}` : '',
      `**Responsible role:** ${input.responsibleRole}`,
      input.requiredReviewers.length ? `**Required reviewers:** ${input.requiredReviewers.join(', ')}` : '',
   ].filter(Boolean).join('\n\n');
}

/** The `proposal` label, created once per workspace. assigned_by references users, so it is a person or null. */
async function labelProposal(sql: Sql, workspaceId: string, issueId: string, userId: string | null): Promise<void> {
   const [label] = await sql<Array<{ id: string }>>`
      INSERT INTO issue_labels (workspace_id, name, description, color, created_by, created_at, updated_at)
      VALUES (${workspaceId}, 'proposal', 'Work an agent discovered and proposed', '#8b5cf6', ${userId}, now(), now())
      ON CONFLICT (workspace_id, lower(name)) WHERE archived_at IS NULL DO UPDATE SET updated_at = issue_labels.updated_at
      RETURNING id`;
   if (!label) return;
   await sql`
      INSERT INTO issue_label_memberships (workspace_id, issue_id, label_id, assigned_by)
      VALUES (${workspaceId}, ${issueId}, ${label.id}, ${userId})
      ON CONFLICT (workspace_id, issue_id, label_id) DO NOTHING`;
}
```
Imports: `defaultBoardId` from `../work/batch.ts`; `acceptDecision, fingerprintProposal, proposalSchema, type ProposalInput` from `./proposals.ts`.

- [ ] **Step 5: Approvals resolve dispatch**

`approvals/repository.ts`:
- `ApprovalKind = 'plan' | 'issueStart' | 'integrationAction' | 'workProposal' | 'escalation'`; extend `toWireKind`/`toColumnKind` with `work_proposal ↔ workProposal`, `escalation ↔ escalation`.
- In `resolve`, select `kind` with the row (`SELECT id, kind, issue_id, …`). Replace the `issueId && approved` block with:

```ts
   if (current.kind === 'work_proposal') {
      await applyProposalDecision(tx, { approvalId: current.id as string, decision: input.decision, userId: input.userId });
   } else if (current.kind === 'escalation') {
      if (issueId) {
         await tx`UPDATE issues SET status = 'todo', updated_at = now() WHERE id = ${issueId} AND status = 'blocked'`;
      }
   } else if (issueId && input.decision === 'approved') {
      // existing issue_start behaviour, unchanged
   }
```
`mounts/approvals.ts:40`: `const KINDS = new Set(['plan', 'issueStart', 'integrationAction', 'workProposal', 'escalation']);`

Add a database-gated test to `proposals.test.ts`: approving a `work_proposal` approval assigns the responsible role and sets `todo`; rejecting cancels the task.

- [ ] **Step 6: Write `discovery.ts`**

```ts
import type { AutopilotRepository } from '../autopilots/repository.ts';
import type { IssueRepository } from '../core/issues.ts';
import type { Sql } from '../db/pool.ts';
import { defaultBoardId } from '../work/batch.ts';
import { parseContract, type RoleContract } from './contract.ts';

export const MAX_PROPOSALS_PER_RUN = 5;

export function discoveryPrompt(contract: RoleContract): string {
   const discovery = contract.discovery;
   if (!discovery) throw new Error(`${contract.id} has no discovery`);
   return [
      `Weekly discovery for the ${contract.role}.`,
      `Inspect this workspace's projects, repositories and tasks from your profession's perspective. Focus on:`,
      ...discovery.focus.map((item) => `- ${item}`),
      `Look for evidence in: ${discovery.evidence_sources.join('; ')}.`,
      `File at most ${MAX_PROPOSALS_PER_RUN} findings with propose_work. Every finding needs concrete evidence (file and line, run, dependency version, metric or task).`,
      'File nothing you cannot evidence. If nothing is worth proposing, post a one-line comment saying what you inspected and stop.',
      'Do not implement anything in this run.',
   ].join('\n');
}

export async function ensureDiscovery(
   sql: Sql,
   workspaceId: string,
   deps: { autopilots: AutopilotRepository; issues: IssueRepository }
): Promise<{ created: string[] }> {
   const [workspace] = await sql<Array<{ created_by: string | null }>>`
      SELECT created_by FROM workspaces WHERE id = ${workspaceId} AND deleted_at IS NULL`;
   const owner = workspace?.created_by;
   if (!owner) return { created: [] };
   const agents = await sql<Array<{ id: string; role_key: string; role_contract: unknown }>>`
      SELECT a.id, a.role_key, a.role_contract FROM agents a
       WHERE a.workspace_id = ${workspaceId} AND a.role_key IS NOT NULL AND a.archived_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM autopilots p WHERE p.workspace_id = a.workspace_id
                          AND p.discovery_role = a.role_key AND p.archived_at IS NULL)`;
   const boardId = await defaultBoardId(sql, workspaceId);
   const created: string[] = [];
   for (const agent of agents) {
      const contract = parseContract(agent.role_contract);
      if (!contract?.discovery) continue;
      const { issue } = await deps.issues.create({
         boardId,
         title: `Discovery: ${contract.name}`,
         description: `Where the ${contract.role}'s weekly discovery runs. Findings arrive as proposals.`,
         status: 'backlog',
         priority: 'none',
         sortOrder: 0,
         dueDate: null,
         assignee: { type: 'agent', id: agent.id },
         project: null,
         createdBy: owner,
      });
      const autopilot = await deps.autopilots.create(
         workspaceId,
         {
            name: `Discovery: ${contract.name}`,
            description: `Weekly inspection by the ${contract.role}.`,
            assigneeType: 'agent',
            assigneeId: agent.id,
            promptTemplate: discoveryPrompt(contract),
            executionMode: 'fixed_issue',
            boardId,
            issueId: issue.id,
            quotaPeriod: 'week',
            quotaMax: 1,
         },
         owner
      );
      await sql`UPDATE autopilots SET discovery_role = ${contract.id} WHERE id = ${autopilot.id}`;
      await deps.autopilots.addCronTrigger(workspaceId, autopilot.id, { expression: contract.discovery.cron, timezone: 'UTC', enabled: true });
      created.push(contract.id);
   }
   return { created };
}
```
If `renderPrompt` in `autopilots/template.ts` treats `{{…}}` or `$` specially, confirm `discoveryPrompt` output contains none of its placeholders.

- [ ] **Step 7: Skip at fire time** (`fire.ts` `reasonToSkip`, before the quota block)

```ts
   if (row.discovery_role) {
      const [state] = await tx`
         SELECT w.discovery_enabled,
                EXISTS (SELECT 1 FROM projects p WHERE p.workspace_id = w.id AND p.deleted_at IS NULL
                         AND p.github_repo_full_name IS NOT NULL) AS has_repository,
                EXISTS (SELECT 1 FROM issues i JOIN boards b ON b.id = i.board_id
                         WHERE b.workspace_id = w.id AND i.deleted_at IS NULL
                           AND i.title NOT LIKE 'Discovery: %') AS has_tasks
           FROM workspaces w WHERE w.id = ${row.workspace_id as string}`;
      if (state && state.discovery_enabled === false) {
         return { code: 'DISCOVERY_OFF', message: 'Discovery is turned off for this workspace.' };
      }
      if (state && !state.has_repository && !state.has_tasks) {
         return { code: 'NOTHING_TO_INSPECT', message: 'There is no repository or task to inspect yet.' };
      }
   }
```
Confirm the project repository column name (`github_repo_full_name`) with `\d projects`.

- [ ] **Step 8: Provision discovery**

`provision.ts` `ensureOrganizationEverywhere(sql, onError, deps?: { autopilots: AutopilotRepository; issues: IssueRepository })`: after the agents transaction, when `deps` is given, `await ensureDiscovery(sql, workspace.id, deps).catch((error) => onError(workspace.id, error))`. `index.ts` passes `{ autopilots: <the AutopilotRepository instance index.ts already builds>, issues }`.
`mounts/workspaces.ts` create route: after a non-replayed create, call the same `ensureDiscovery` (inject it as an optional mount option `ensureDiscovery?: (workspaceId: string) => Promise<unknown>`, errors logged, never failing the create).

- [ ] **Step 9: Verify**

Run: `cd server-ts && pnpm typecheck && BERRY_TEST_DATABASE_URL='postgres://postgres@127.0.0.1:5432/berry_test?sslmode=disable' pnpm test`
Expected: PASS.

---

### Task 9: Organization API and contract editing

**Files:**
- Create: `server-ts/src/mounts/organization.ts`
- Test: `server-ts/src/mounts/organization.test.ts`
- Modify: `server-ts/src/mounts/agents.ts` (`PUT /:agentId/contract`)
- Modify: `server-ts/src/index.ts` (register mount)

**Interfaces:**
- Produces (wire, camelCase outside the stored contract document):
  - `GET /api/v1/organization` → `{ departments: [{ key, roles: [{ roleKey, name, role, autonomyLevel, agentId, customized, discovery: { autopilotId, status, cron } | null }] }], delegation: [{ from, to }], workflows: [{ key, name, chain, when }], discoveryEnabled }`
  - `PUT /api/v1/organization/discovery` body `{ enabled: boolean }` → `{ discoveryEnabled }` (`settings.write`)
  - `POST /api/v1/organization/roles/:roleKey/reset` → the agent (`settings.write`), rewrites the catalog contract
  - `GET /api/v1/work-proposals?status=&role=&severity=` → `{ nodes: [{ id, taskId, identifier, approvalId, roleKey, proposedBy, problem, evidence, impact, severity, impactClasses, proposedAction, effort, dependencies, responsibleRole, requiredReviewers, status, createdAt }] }`
  - `PUT /api/v1/agents/:agentId/contract` body = contract document → the agent (`settings.write`); 400 `CONTRACT_INVALID` with Zod issues; 400 `TOOLS_ABOVE_LEVEL` naming the tools; 400 when level 5 without `review_domains`

- [ ] **Step 1: Write the failing test** (`organization.test.ts`, database-gated, in the style of `mounts/runtimes.test.ts`: `seedFixture`, `issueTestToken`, `createApp(registry)`)

```ts
test('the organization lists every department and role with discovery state', async () => {
   const response = await call('/api/v1/organization');
   assert.equal(response.status, 200);
   const body = await response.json() as { departments: Array<{ key: string; roles: Array<{ roleKey: string }> }>; discoveryEnabled: boolean };
   assert.equal(body.departments.flatMap((d) => d.roles).length, 19);
   assert.equal(body.discoveryEnabled, true);
});

test('a contract with tools above its level is refused', async () => {
   const contract = { ...catalogRole('business-analyst')!, allowed_tools: ['read_task', 'run_command'] };
   const response = await call(`/api/v1/agents/${agentIdFor('business-analyst')}/contract`, { method: 'PUT', body: JSON.stringify(contract) });
   assert.equal(response.status, 400);
   assert.equal(((await response.json()) as { error: { code: string } }).error.code, 'TOOLS_ABOVE_LEVEL');
});

test('an edited contract is customised until reset', async () => {
   const contract = { ...catalogRole('technical-writer')!, mission: 'Keep the docs honest.' };
   assert.equal((await call(`/api/v1/agents/${agentIdFor('technical-writer')}/contract`, { method: 'PUT', body: JSON.stringify(contract) })).status, 200);
   const edited = await (await call(`/api/v1/agents/${agentIdFor('technical-writer')}`)).json() as { customized: boolean };
   assert.equal(edited.customized, true);
   assert.equal((await call('/api/v1/organization/roles/technical-writer/reset', { method: 'POST', body: '{}' })).status, 200);
   const reset = await (await call(`/api/v1/agents/${agentIdFor('technical-writer')}`)).json() as { customized: boolean };
   assert.equal(reset.customized, false);
});
```
Note: `customized` compares against `contract_hash`; the contract PUT must **not** update `contract_hash` (it records what Berry wrote), while reset writes both.

- [ ] **Step 2: Run to verify it fails**

Run: `cd server-ts && BERRY_TEST_DATABASE_URL='postgres://postgres@127.0.0.1:5432/berry_test?sslmode=disable' node --test --experimental-strip-types src/mounts/organization.test.ts`
Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

`mounts/organization.ts` exports `organizationMounts(options: { sessions: SessionService; sql: Sql })` returning `[{ prefix: '/api/v1/organization', handler }, { prefix: '/api/v1/work-proposals', handler }]`. Authorize with `resolveScoped(options.sql, user.id, workspaceId, write ? 'settings.write' : 'product.read')` from `./shared.ts` exactly as `mounts/runtimes.ts` does; build departments by grouping `agents` rows with a `role_key` by `role_contract->>'department'` in `DEPARTMENTS` order; delegation edges from each contract's `can_delegate_to`; discovery by joining `autopilots` (`discovery_role`) and `autopilot_triggers` (`kind = 'cron'`); reset calls a new exported `resetRole(q, workspaceId, roleKey)` in `provision.ts` that runs `writeContract` with the catalog entry (or `adoptOrchestrator` semantics for `orchestrator`).

`PUT /:agentId/contract` in `mounts/agents.ts`: authorize `settings.write` via `agents.authorizeAgent(user.id, agentId, 'settings.write')` (use the permission name `mounts/agents.ts` uses for admin-only writes, as in the permissions route); `parseContract(body)` → 400 `CONTRACT_INVALID`; `body.id` must equal the row's `role_key` → 400 `ROLE_MISMATCH`; tools outside `toolCeiling(level)` → 400 `TOOLS_ABOVE_LEVEL`; level 5 with empty `review_domains` → 400 `REVIEW_DOMAINS_REQUIRED`; then `UPDATE agents SET role_contract, instructions = system_prompt, capabilities, autonomy_level, permissions = effectivePermissions(contract), updated_at` (leave `contract_hash`, `contract_version`).

Register in `index.ts` beside `runtimeMounts`: `registry.registerAll(organizationMounts({ sessions, sql }));`. `server-ts/SCOPE.md` served list: add `/api/v1/organization` and `/api/v1/work-proposals`.

- [ ] **Step 4: Verify**

Run: `cd server-ts && pnpm typecheck && BERRY_TEST_DATABASE_URL='postgres://postgres@127.0.0.1:5432/berry_test?sslmode=disable' pnpm test`
Expected: PASS, including `organization.test.ts`.

---

### Task 10: Frontend — Role tab, Organization settings, Proposals

**Files:**
- Create: `frontend/lib/organization.ts`
- Create: `frontend/components/common/agents/agent-role-tab.tsx`
- Create: `frontend/components/common/settings/organization-settings.tsx`
- Create: `frontend/app/[orgId]/settings/organization/page.tsx`
- Create: `frontend/components/common/proposals/proposals.tsx`
- Create: `frontend/app/[orgId]/proposals/page.tsx`
- Create: `frontend/messages/{en,ja,ko,zh-Hans}/organization.json`
- Modify: `frontend/lib/agents.ts` (schema fields)
- Modify: `frontend/components/common/agents/agent-details.tsx:48-52,204-210,349-413`
- Modify: `frontend/components/layout/sidebar/nav-settings.tsx` (item `organization` under workspace), `SettingsNavKey`
- Modify: `frontend/messages/*/workspaceAdmin.json` (`nav.organization`), `frontend/messages/*/agentsChat.json` (`detail.tabRole`), `frontend/messages/*/shell.json` (`nav.proposals`)
- Modify: `frontend/components/layout/shell/shell-routes.ts` (WORK route `proposals`, `ShellRoute`, `ShellLabelKey`)
- Modify: `frontend/lib/i18n/locales.ts:26-43`, `frontend/i18n/messages-en.ts`, `scripts/check-locale-catalogues.py:20-29` (namespace `organization`)

**Interfaces:**
- Consumes: API from Task 9; approvals `POST /api/v1/approvals/:id/approve|reject` (body `{ note? }`).
- Produces:
  - `lib/agents.ts` agent schema adds `roleKey: z.string().nullish()`, `department: z.string().nullish()`, `autonomyLevel: z.number().nullish()`, `customized: z.boolean().default(false)`, `contract: roleContractSchema.nullish()`
  - `lib/organization.ts`: `roleContractSchema` (Zod 3 mirror of the server shape), `getOrganization(): Promise<Organization>`, `setDiscovery(enabled: boolean): Promise<boolean>`, `resetRole(roleKey: string): Promise<void>`, `listProposals(filter?: { status?: string }): Promise<WorkProposal[]>`, `decideProposal(approvalId: string, decision: 'approve' | 'reject', note?: string): Promise<void>`

- [ ] **Step 1: Client module**

`frontend/lib/organization.ts`:

```ts
import { z } from 'zod';

import { apiFetch } from './api';

export const roleContractSchema = z.object({
   id: z.string(),
   name: z.string(),
   role: z.string(),
   department: z.string(),
   mission: z.string(),
   responsibilities: z.array(z.string()),
   capabilities: z.array(z.string()),
   allowed_tools: z.array(z.string()),
   preferred_model: z.string(),
   inputs: z.array(z.string()),
   outputs: z.array(z.string()),
   can_delegate_to: z.array(z.string()),
   receives_work_from: z.array(z.string()),
   escalation_rules: z.array(z.object({ when: z.string(), to: z.string(), decision: z.string() })),
   review_requirements: z.array(z.object({ reviewer: z.string(), authority: z.string(), when: z.record(z.unknown()) })),
   autonomy_level: z.number(),
   review_domains: z.array(z.string()),
   discovery: z.object({ cron: z.string(), focus: z.array(z.string()), evidence_sources: z.array(z.string()) }).nullable(),
   never: z.array(z.string()),
});
export type RoleContract = z.infer<typeof roleContractSchema>;

const organizationSchema = z.object({
   departments: z.array(z.object({
      key: z.string(),
      roles: z.array(z.object({
         roleKey: z.string(),
         name: z.string(),
         role: z.string(),
         autonomyLevel: z.number(),
         agentId: z.string(),
         customized: z.boolean(),
         discovery: z.object({ autopilotId: z.string(), status: z.string(), cron: z.string().nullable() }).nullable(),
      })),
   })),
   delegation: z.array(z.object({ from: z.string(), to: z.string() })),
   workflows: z.array(z.object({ key: z.string(), name: z.string(), chain: z.array(z.string()), when: z.string() })),
   discoveryEnabled: z.boolean(),
});
export type Organization = z.infer<typeof organizationSchema>;

const proposalSchema = z.object({
   id: z.string(),
   taskId: z.string(),
   identifier: z.string(),
   approvalId: z.string().nullable(),
   roleKey: z.string(),
   problem: z.string(),
   evidence: z.array(z.object({ kind: z.string(), ref: z.string(), excerpt: z.string().optional() })),
   impact: z.string(),
   severity: z.enum(['critical', 'high', 'medium', 'low']),
   impactClasses: z.array(z.string()),
   proposedAction: z.string(),
   effort: z.string(),
   dependencies: z.array(z.string()),
   responsibleRole: z.string(),
   requiredReviewers: z.array(z.string()),
   status: z.string(),
   createdAt: z.string(),
});
export type WorkProposal = z.infer<typeof proposalSchema>;

function parse<T>(schema: z.ZodType<T>, json: unknown, what: string): T {
   const parsed = schema.safeParse(json);
   if (!parsed.success) throw new Error(`${what} was not recognized`);
   return parsed.data;
}

export async function getOrganization(): Promise<Organization> {
   return parse(organizationSchema, await apiFetch('/api/v1/organization'), 'Organization');
}

export async function setDiscovery(enabled: boolean): Promise<boolean> {
   const json = await apiFetch('/api/v1/organization/discovery', { method: 'PUT', body: JSON.stringify({ enabled }) });
   return parse(z.object({ discoveryEnabled: z.boolean() }), json, 'Discovery setting').discoveryEnabled;
}

export async function resetRole(roleKey: string): Promise<void> {
   await apiFetch(`/api/v1/organization/roles/${encodeURIComponent(roleKey)}/reset`, { method: 'POST', body: '{}' });
}

export async function listProposals(filter: { status?: string } = {}): Promise<WorkProposal[]> {
   const query = filter.status ? `?status=${encodeURIComponent(filter.status)}` : '';
   return parse(z.object({ nodes: z.array(proposalSchema) }), await apiFetch(`/api/v1/work-proposals${query}`), 'Proposals').nodes;
}

export async function decideProposal(approvalId: string, decision: 'approve' | 'reject', note?: string): Promise<void> {
   await apiFetch(`/api/v1/approvals/${encodeURIComponent(approvalId)}/${decision}`, {
      method: 'POST',
      body: JSON.stringify(note ? { note } : {}),
      headers: { 'Idempotency-Key': crypto.randomUUID() },
   });
}
```

Add to the agent schema in `lib/agents.ts`: `roleKey: z.string().nullish(), department: z.string().nullish(), autonomyLevel: z.number().nullish(), customized: z.boolean().default(false), contract: roleContractSchema.nullish(),` (import from `./organization`).

- [ ] **Step 2: Messages**

`frontend/messages/en/organization.json`:

```json
{
   "roleTab": {
      "notARole": "This agent is not part of the organization. Its permissions are set in Settings → Agents.",
      "mission": "Mission",
      "responsibilities": "Responsibilities",
      "inputs": "Works from",
      "outputs": "Produces",
      "delegatesTo": "Hands work to",
      "receivesFrom": "Receives work from",
      "escalation": "Escalates",
      "reviews": "Reviewed by",
      "reviewDomains": "Reviews",
      "never": "Never",
      "autonomy": "Autonomy level {level}",
      "discovery": "Weekly discovery",
      "customized": "Customized — this role no longer matches Berry's version.",
      "reset": "Reset to Berry's version",
      "resetDone": "Role reset"
   },
   "levels": {
      "1": "Advisory — analyzes and recommends",
      "2": "Contributor — creates specifications, proposals and tasks",
      "3": "Executor — changes code and opens pull requests",
      "4": "Autonomous — finds, executes and submits work for review",
      "5": "Authority — approves or rejects work in its domain"
   },
   "departments": {
      "operations": "Operations",
      "product": "Product",
      "engineering": "Engineering",
      "quality-security": "Quality & Security",
      "platform": "Platform",
      "growth-insight": "Growth & Insight",
      "leadership": "Leadership"
   },
   "settings": {
      "title": "Organization",
      "description": "The roles your agents fill, what each may do, and the work they look for on their own.",
      "discovery": "Work discovery",
      "discoveryHint": "Each role inspects the workspace once a week and proposes work with evidence.",
      "workflows": "Workflows",
      "paused": "Paused",
      "active": "Active"
   },
   "proposals": {
      "title": "Proposals",
      "empty": "No proposals yet. Roles file them as they inspect the workspace.",
      "evidence": "Evidence",
      "impact": "Impact",
      "action": "Proposed action",
      "effort": "Effort {effort}",
      "owner": "Owner: {role}",
      "reviewers": "Reviewers: {roles}",
      "accept": "Accept",
      "reject": "Reject",
      "decided": "Decision recorded"
   }
}
```

Write `ja`, `ko`, `zh-Hans` with the same keys and placeholders (`{level}`, `{effort}`, `{role}`, `{roles}`), translated. Add `organization` to `NAMESPACES` in `frontend/lib/i18n/locales.ts`, import it in `frontend/i18n/messages-en.ts`, and add it to `NAMESPACES` in `scripts/check-locale-catalogues.py`. Add `nav.organization` to each `workspaceAdmin.json` ("Organization" / "組織" / "조직" / "组织"), `detail.tabRole` to each `agentsChat.json` ("Role" / "役割" / "역할" / "角色"), `nav.proposals` to each `shell.json` ("proposals" / "提案" / "제안" / "提案").

- [ ] **Step 3: Role tab**

`frontend/components/common/agents/agent-role-tab.tsx`:

```tsx
'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { SettingsCard, SettingsSection } from '@/components/common/settings/shared';
import { Button } from '@/components/ui/button';
import type { Agent } from '@/lib/agents';
import { resetRole } from '@/lib/organization';

function List({ items }: { items: string[] }) {
   return (
      <ul className="list-disc space-y-1 pl-5">
         {items.map((item) => (
            <li key={item}>{item}</li>
         ))}
      </ul>
   );
}

export function AgentRoleTab({ agent, readOnly, onReset }: { agent: Agent; readOnly: boolean; onReset: () => void }) {
   const t = useTranslations('organization');
   const [resetting, setResetting] = useState(false);
   const contract = agent.contract;
   if (!contract) {
      return <p className="p-6 text-muted-foreground">{t('roleTab.notARole')}</p>;
   }
   const level = String(contract.autonomy_level) as '1' | '2' | '3' | '4' | '5';
   const reviewers = [...new Set(contract.review_requirements.map((rule) => `${rule.reviewer} (${rule.authority})`))];

   const reset = async () => {
      setResetting(true);
      try {
         await resetRole(contract.id);
         toast.success(t('roleTab.resetDone'));
         onReset();
      } catch (error) {
         toast.error(error instanceof Error ? error.message : String(error));
      } finally {
         setResetting(false);
      }
   };

   return (
      <div className="flex flex-col gap-6 p-6">
         <div>
            <div className="text-lg">{contract.role}</div>
            <div className="text-muted-foreground">
               {t(`departments.${contract.department}` as 'departments.product')} ·{' '}
               {t('roleTab.autonomy', { level: contract.autonomy_level })} — {t(`levels.${level}`)}
            </div>
         </div>
         {agent.customized ? (
            <div className="flex items-center justify-between gap-4 rounded-md border px-4 py-3">
               <span>{t('roleTab.customized')}</span>
               {!readOnly ? (
                  <Button size="sm" variant="outline" disabled={resetting} onClick={() => void reset()}>
                     {t('roleTab.reset')}
                  </Button>
               ) : null}
            </div>
         ) : null}
         <SettingsSection title={t('roleTab.mission')}>
            <SettingsCard className="p-4">{contract.mission}</SettingsCard>
         </SettingsSection>
         <SettingsSection title={t('roleTab.responsibilities')}>
            <SettingsCard className="p-4"><List items={contract.responsibilities} /></SettingsCard>
         </SettingsSection>
         <SettingsSection title={t('roleTab.outputs')}>
            <SettingsCard className="p-4"><List items={contract.outputs} /></SettingsCard>
         </SettingsSection>
         <SettingsSection title={t('roleTab.inputs')}>
            <SettingsCard className="p-4"><List items={contract.inputs} /></SettingsCard>
         </SettingsSection>
         <SettingsSection title={t('roleTab.delegatesTo')}>
            <SettingsCard className="p-4">{contract.can_delegate_to.join(', ') || '—'}</SettingsCard>
         </SettingsSection>
         <SettingsSection title={t('roleTab.receivesFrom')}>
            <SettingsCard className="p-4">{contract.receives_work_from.join(', ') || '—'}</SettingsCard>
         </SettingsSection>
         <SettingsSection title={t('roleTab.escalation')}>
            <SettingsCard className="p-4">
               <List items={contract.escalation_rules.map((rule) => `${rule.when} → ${rule.to}`)} />
            </SettingsCard>
         </SettingsSection>
         {reviewers.length ? (
            <SettingsSection title={t('roleTab.reviews')}>
               <SettingsCard className="p-4">{reviewers.join(', ')}</SettingsCard>
            </SettingsSection>
         ) : null}
         {contract.review_domains.length ? (
            <SettingsSection title={t('roleTab.reviewDomains')}>
               <SettingsCard className="p-4"><List items={contract.review_domains} /></SettingsCard>
            </SettingsSection>
         ) : null}
         <SettingsSection title={t('roleTab.never')}>
            <SettingsCard className="p-4"><List items={contract.never} /></SettingsCard>
         </SettingsSection>
         {contract.discovery ? (
            <SettingsSection title={t('roleTab.discovery')}>
               <SettingsCard className="p-4"><List items={contract.discovery.focus} /></SettingsCard>
            </SettingsSection>
         ) : null}
      </div>
   );
}
```

`agent-details.tsx`: `TABS = ['overview', 'role', 'activity', 'work', 'capabilities', 'settings']`; `tabLabel.role = t('tabRole')`; panel `{view === 'role' ? <AgentRoleTab agent={agent} readOnly={readOnly || archived} onReset={() => void reload()} /> : null}` where `reload` is the function the page already uses to refetch the agent (use the existing refresh callback in that file).

- [ ] **Step 4: Organization settings and Proposals**

`organization-settings.tsx` uses `useSettingsResource(getOrganization)`, renders a `SettingsShell` with title/description from `organization.settings`, a section with a `Switch` bound to `discoveryEnabled` calling `setDiscovery` via `resource.mutate`, then one `SettingsSection` per department with a `SettingsRow` per role (`title={role.name}`, `description={`${role.role} · ${t('roleTab.autonomy', { level: role.autonomyLevel })} · ${role.discovery ? t(`settings.${role.discovery.status === 'active' ? 'active' : 'paused'}`) : '—'}`}`, `chevron`, `onClick` → `/${orgId}/agents/${role.agentId}?view=role`), and a Workflows section listing `workflow.name — chain.join(' → ')`.

`app/[orgId]/settings/organization/page.tsx` mirrors `settings/join-links/page.tsx`. `nav-settings.tsx`: add `'organization'` to `SettingsNavKey` and `{ labelKey: 'organization', url: '/settings/organization', icon: Network }` (from `lucide-react`) to the `workspace` group, after `agents`.

`proposals.tsx`: loads `listProposals({ status: 'proposed' })`; each proposal is a card with severity badge, problem, evidence list (`kind: ref — excerpt`), impact, proposed action, effort, owner, reviewers, a link to the task (`/${orgId}/issue/${identifier}`), and Accept / Reject buttons calling `decideProposal(approvalId, …)` then reloading; empty state `proposals.empty`. `app/[orgId]/proposals/page.tsx` mirrors `reviews/page.tsx`. `shell-routes.ts`: add `'proposals'` to `ShellRoute` and `ShellLabelKey`, and a WORK entry `{ id: 'proposals', label: 'proposals', labelKey: 'proposals', href: '/proposals', prefsKey: 'proposals', icon: '<path d="M9 18h6M10 21h4M12 3a6 6 0 00-3.5 10.9c.6.5 1 1.2 1 2V17h5v-1.1c0-.8.4-1.5 1-2A6 6 0 0012 3z" />' }`; add `'proposals'` to `SidebarItemKey`, `DEFAULT_VISIBILITY` and `DEFAULT_ORDER.workspace` in `store/sidebar-prefs-store.ts`, and `{ key: 'proposals', label: 'proposals', icon: Lightbulb }` to `WORKSPACE_ITEMS` in the customize dialog.

- [ ] **Step 5: Verify**

Run:
```bash
cd /Users/secret/Code/berry-circle && python3 scripts/check-locale-catalogues.py
cd frontend && npx tsc --noEmit && pnpm lint && pnpm build:check
```
Expected: locale check "agree"; tsc exit 0; "No ESLint warnings or errors"; build succeeds. Then open `/berry/settings/organization`, an agent's Role tab, and `/berry/proposals` in the running dev server and check each renders.

---

## Self-Review Notes

- Spec §4 `settings.organization.discovery` is implemented as `workspaces.discovery_enabled` (Task 3 note).
- Spec §11 `/work-proposals/:id/accept|reject` is served by the existing approvals approve/reject routes on the proposal's `approvalId` (one decision path); `GET /work-proposals` returns `approvalId`.
- Enforcement point 1 (runtime) needs only the envelope `tools` field for local tools: Berry tools are already filtered by the server manifest (Task 5 Step 4), which the container trusts.
- Orchestrator keeps `protected`; `ensureOrganizationAgents` adopts the trigger-made row (spec §10 step 2).
