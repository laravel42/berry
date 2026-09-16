import { z } from 'zod';

import { apiFetch } from './api';

/**
 * Zod 3 mirror of the server's stored role contract document (snake_case, as
 * persisted). `contractValid` on `Organization` and `Agent.contract` being
 * null are how the frontend learns a stored contract no longer validates —
 * this schema itself only describes a contract that does parse.
 */
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
   review_requirements: z.array(
      z.object({
         reviewer: z.string(),
         authority: z.string(),
         when: z.record(z.string(), z.unknown()),
      })
   ),
   autonomy_level: z.number(),
   review_domains: z.array(z.string()),
   discovery: z
      .object({
         cron: z.string(),
         focus: z.array(z.string()),
         evidence_sources: z.array(z.string()),
      })
      .nullable(),
   run_limits: z.object({ max_turns: z.number(), max_output_tokens: z.number() }),
   never: z.array(z.string()),
   system_prompt: z.string(),
});
export type RoleContract = z.infer<typeof roleContractSchema>;

const organizationSchema = z.object({
   departments: z.array(
      z.object({
         key: z.string(),
         roles: z.array(
            z.object({
               roleKey: z.string(),
               name: z.string(),
               role: z.string(),
               autonomyLevel: z.number().nullable(),
               agentId: z.string(),
               customized: z.boolean(),
               /** False when the stored contract for this role no longer validates. */
               contractValid: z.boolean(),
               discovery: z
                  .object({
                     autopilotId: z.string(),
                     status: z.string(),
                     cron: z.string().nullable(),
                  })
                  .nullable(),
            })
         ),
      })
   ),
   delegation: z.array(z.object({ from: z.string(), to: z.string() })),
   workflows: z.array(
      z.object({ key: z.string(), name: z.string(), chain: z.array(z.string()), when: z.string() })
   ),
   discoveryEnabled: z.boolean(),
});
export type Organization = z.infer<typeof organizationSchema>;
export type OrganizationRole = Organization['departments'][number]['roles'][number];

const evidenceSchema = z.object({
   kind: z.string(),
   ref: z.string(),
   excerpt: z.string().optional(),
});

const proposalSchema = z.object({
   id: z.string(),
   taskId: z.string(),
   identifier: z.string(),
   approvalId: z.string().nullable(),
   roleKey: z.string(),
   proposedBy: z.string().nullable(),
   problem: z.string(),
   evidence: z.array(evidenceSchema),
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
   const json = await apiFetch('/api/v1/organization/discovery', {
      method: 'PUT',
      body: JSON.stringify({ enabled }),
   });
   return parse(z.object({ discoveryEnabled: z.boolean() }), json, 'Discovery setting')
      .discoveryEnabled;
}

export async function resetRole(roleKey: string): Promise<void> {
   await apiFetch(`/api/v1/organization/roles/${encodeURIComponent(roleKey)}/reset`, {
      method: 'POST',
      body: '{}',
   });
}

export async function listProposals(filter: { status?: string } = {}): Promise<WorkProposal[]> {
   const query = filter.status ? `?status=${encodeURIComponent(filter.status)}` : '';
   return parse(
      z.object({ nodes: z.array(proposalSchema) }),
      await apiFetch(`/api/v1/work-proposals${query}`),
      'Proposals'
   ).nodes;
}

export async function decideProposal(
   approvalId: string,
   decision: 'approve' | 'reject',
   note?: string
): Promise<void> {
   await apiFetch(`/api/v1/approvals/${encodeURIComponent(approvalId)}/${decision}`, {
      method: 'POST',
      body: JSON.stringify(note ? { note } : {}),
      headers: { 'Idempotency-Key': crypto.randomUUID() },
   });
}
