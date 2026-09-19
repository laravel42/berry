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

export const MAX_CONTRACT_BYTES = 65536;
/** Maximum cumulative output across all model calls in one agent run. */
export const MAX_RUN_OUTPUT_TOKENS = 512 * 1024;

const roleKey = z.string().regex(/^[a-z][a-z0-9-]{1,48}$/);
const text = z.string().trim().min(1).max(2000);
const list = z.array(text).max(40);

export const reviewConditionSchema = z.object({
   labels_any: z.array(z.string().min(1).max(200)).max(20).optional(),
   paths_any: z.array(z.string().min(1).max(200)).max(40).optional(),
   impact_any: z.array(z.string().min(1).max(200)).max(10).optional(),
   workflow_any: z.array(z.string().min(1).max(200)).max(10).optional(),
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
   allowed_tools: z.array(z.string().min(1).max(64)).max(40),
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
      max_output_tokens: z.number().int().min(256).max(MAX_RUN_OUTPUT_TOKENS),
   }),
   never: list,
   system_prompt: z.string().min(1).max(20000),
}).refine((value) => Buffer.byteLength(JSON.stringify(value), 'utf8') <= MAX_CONTRACT_BYTES, {
   message: `role_contract must be at most ${MAX_CONTRACT_BYTES} bytes`,
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
