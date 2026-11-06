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
   /** The Berry tier the role runs on; the model is chosen from it per run. */
   tier: z.enum(['berry_max', 'berry_xhigh', 'berry_high', 'berry_mid', 'berry_low']).optional(),
   /** Superseded by `tier`; only contracts customised before tiers still carry it. */
   preferred_model: z.string().optional(),
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
   /** Catalogue roles the workspace does not have, to add (ADR-0018); absent from an older server. */
   specialists: z
      .array(
         z.object({
            roleKey: z.string(),
            name: z.string(),
            role: z.string(),
            department: z.string(),
            mission: z.string(),
            /** Absent from an older server. */
            tier: z.string().nullable().optional(),
            autonomyLevel: z.number().optional(),
         })
      )
      .default([]),
   discoveryEnabled: z.boolean(),
});
export type Organization = z.infer<typeof organizationSchema>;
export type Specialist = Organization['specialists'][number];

/** The order departments read in, software first; one the server adds later goes last. */
export const DEPARTMENT_ORDER = [
   'operations',
   'product',
   'engineering',
   'quality-security',
   'platform',
   'growth-insight',
   'leadership',
   'marketing',
   'customer',
   'people',
   'finance-legal',
   'knowledge',
] as const;

/** Specialists grouped by department, departments in reading order, roles by name. */
export function specialistsByDepartment(
   specialists: Specialist[]
): Array<{ department: string; roles: Specialist[] }> {
   const groups = new Map<string, Specialist[]>();
   for (const specialist of specialists) {
      groups.set(specialist.department, [...(groups.get(specialist.department) ?? []), specialist]);
   }
   const rank = (department: string) => {
      const index = (DEPARTMENT_ORDER as readonly string[]).indexOf(department);
      return index === -1 ? DEPARTMENT_ORDER.length : index;
   };
   return [...groups.entries()]
      .toSorted(([left], [right]) => rank(left) - rank(right) || left.localeCompare(right))
      .map(([department, roles]) => ({
         department,
         roles: roles.toSorted((left, right) => left.name.localeCompare(right.name)),
      }));
}
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

/** Adds a catalogue role to the workspace; its archived agent comes back if it had one. Returns the agent's id. */
export async function addRole(roleKey: string): Promise<string | null> {
   const json = await apiFetch(`/api/v1/organization/roles/${encodeURIComponent(roleKey)}`, {
      method: 'POST',
      body: '{}',
   });
   const parsed = z.object({ id: z.string() }).safeParse(json);
   const id = parsed.success ? parsed.data.id : null;
   if (typeof window !== 'undefined') window.dispatchEvent(new Event(ORGANIZATION_CHANGED));
   return id;
}

/** Fired after a role is added, so an open catalogue or settings view reloads. */
export const ORGANIZATION_CHANGED = 'berry:organization-changed';

const catalogRoleSchema = z.object({
   contract: roleContractSchema,
   /** Display names of the roles the contract refers to, by key. */
   names: z.record(z.string(), z.string()),
   core: z.boolean(),
   /** The workspace's agent for this role, when it has one. */
   agentId: z.string().nullable(),
});
export type CatalogRole = z.infer<typeof catalogRoleSchema>;

/** One catalogue role in full, as shipped. */
export async function getCatalogRole(roleKey: string): Promise<CatalogRole> {
   return parse(
      catalogRoleSchema,
      await apiFetch(`/api/v1/organization/roles/${encodeURIComponent(roleKey)}`),
      'Catalog role'
   );
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
