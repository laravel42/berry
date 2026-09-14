import { Hono } from 'hono';
import { z } from 'zod';
import { requireSession, type AuthVariables } from '../auth/middleware.ts';
import type { SessionService } from '../auth/sessions.ts';
import { AgentRepository } from '../agents/repository.ts';
import { toRFC3339, type Sql } from '../db/pool.ts';
import { json } from '../http/app.ts';
import { ApiError } from '../http/errors.ts';
import type { Mount } from '../http/registry.ts';
import { CATALOG, WORKFLOWS, catalogRole } from '../organization/catalog.ts';
import { hashContract, parseContract } from '../organization/contract.ts';
import { DEPARTMENTS } from '../organization/contract.ts';
import { resetRole, RoleNotFound } from '../organization/provision.ts';
import { serializeAgent } from './agents.ts';
import { currentWorkspace, resolveScoped } from './shared.ts';

/**
 * `/api/v1/organization` and `/api/v1/work-proposals`.
 *
 * The organization view over a workspace's role agents: who fills each
 * department, whether an edit strayed from the catalog, delegation edges
 * between live roles, the named workflows they run, and whether weekly
 * discovery is on. Work proposals are what discovery autopilots file —
 * listed here, decided elsewhere (the approval they carry).
 *
 * Reads need `product.read`; every write needs `settings.write`, except
 * editing a single agent's contract, which lives on `/api/v1/agents` beside
 * its other admin-only writes. A role or proposal from another workspace is
 * a 404, never a 403.
 */

const STATUSES = new Set(['proposed', 'accepted', 'rejected', 'superseded']);
const SEVERITIES = new Set(['critical', 'high', 'medium', 'low']);
const ROLE_KEYS = new Set(CATALOG.map((role) => role.id));
const CATALOG_ORDER = new Map(CATALOG.map((role, index) => [role.id, index]));

const discoveryBody = z.object({ enabled: z.boolean() });

interface AgentRoleRow {
   id: string;
   name: string;
   role_key: string;
   role_contract: unknown;
   contract_hash: string | null;
   autonomy_level: number | null;
}

/**
 * One live role agent, normalised whether or not its stored contract still
 * parses. A row with a broken contract stays visible — with `contractValid:
 * false` and reasonable fallbacks read off the catalog and the row itself —
 * rather than vanishing from the view with no way for an admin to find and
 * reset it.
 */
interface RoleEntry {
   roleKey: string;
   name: string;
   role: string;
   autonomyLevel: number | null;
   agentId: string;
   customized: boolean;
   contractValid: boolean;
   department: string;
   canDelegateTo: readonly string[];
}

function toRoleEntry(row: AgentRoleRow): RoleEntry {
   const contract = parseContract(row.role_contract);
   if (contract) {
      return {
         roleKey: row.role_key,
         name: contract.name,
         role: contract.role,
         autonomyLevel: row.autonomy_level,
         agentId: row.id,
         customized: hashContract(contract) !== row.contract_hash,
         contractValid: true,
         department: contract.department,
         canDelegateTo: contract.can_delegate_to,
      };
   }
   const catalog = catalogRole(row.role_key);
   return {
      roleKey: row.role_key,
      name: row.name,
      role: catalog?.role ?? row.name,
      autonomyLevel: row.autonomy_level ?? 1,
      agentId: row.id,
      customized: true,
      contractValid: false,
      department: catalog?.department ?? 'operations',
      // An invalid contract cannot be trusted to name anyone it delegates to.
      canDelegateTo: [],
   };
}

interface DiscoveryRow {
   discovery_role: string;
   autopilot_id: string;
   status: string;
   cron_expression: string | null;
}

export function organizationMounts(options: {
   sessions: SessionService;
   sql: Sql;
   /** Provisions discovery for a workspace that just switched it on. */
   ensureDiscovery?: (workspaceId: string) => Promise<unknown>;
}): Mount[] {
   const { sql } = options;
   const agents = new AgentRepository(sql);

   const org = new Hono<{ Variables: AuthVariables }>();
   org.use('*', requireSession(options.sessions));

   org.get('/', async (context) => {
      const user = context.get('user');
      const workspaceId = currentWorkspace(user.currentWorkspaceId);
      await resolveScoped(sql, user.id, workspaceId, 'product.read');

      const [workspace] = await sql<Array<{ discovery_enabled: boolean }>>`
         SELECT discovery_enabled FROM workspaces WHERE id = ${workspaceId} AND deleted_at IS NULL`;
      if (!workspace) throw ApiError.notFound('Workspace');

      const agentRows = await sql<AgentRoleRow[]>`
         SELECT id, name, role_key, role_contract, contract_hash, autonomy_level
           FROM agents
          WHERE workspace_id = ${workspaceId} AND role_key IS NOT NULL AND archived_at IS NULL`;

      const discoveryRows = await sql<DiscoveryRow[]>`
         SELECT p.discovery_role AS discovery_role, p.id AS autopilot_id, p.status AS status,
                t.cron_expression AS cron_expression
           FROM autopilots p
           JOIN autopilot_triggers t ON t.autopilot_id = p.id AND t.kind = 'cron'
          WHERE p.workspace_id = ${workspaceId} AND p.discovery_role IS NOT NULL AND p.archived_at IS NULL`;
      const discoveryByRole = new Map(discoveryRows.map((row) => [row.discovery_role, row]));

      const liveRoleKeys = new Set(agentRows.map((row) => row.role_key));
      // An unknown role key (not in the catalog at all) sorts after every
      // catalog role in its department, rather than to the front.
      const entries = agentRows
         .map(toRoleEntry)
         .sort((a, b) => (CATALOG_ORDER.get(a.roleKey) ?? CATALOG.length) - (CATALOG_ORDER.get(b.roleKey) ?? CATALOG.length));

      const byDepartment = new Map<string, RoleEntry[]>();
      for (const entry of entries) {
         byDepartment.set(entry.department, [...(byDepartment.get(entry.department) ?? []), entry]);
      }

      const departments = DEPARTMENTS.filter((key) => byDepartment.has(key)).map((key) => ({
         key,
         roles: byDepartment.get(key)!.map((entry) => {
            const discovery = discoveryByRole.get(entry.roleKey);
            return {
               roleKey: entry.roleKey,
               name: entry.name,
               role: entry.role,
               autonomyLevel: entry.autonomyLevel,
               agentId: entry.agentId,
               customized: entry.customized,
               contractValid: entry.contractValid,
               discovery: discovery
                  ? { autopilotId: discovery.autopilot_id, status: discovery.status, cron: discovery.cron_expression }
                  : null,
            };
         }),
      }));

      const delegation = entries.flatMap((entry) =>
         entry.canDelegateTo
            .filter((target) => liveRoleKeys.has(target))
            .map((target) => ({ from: entry.roleKey, to: target }))
      );

      return json({
         departments,
         delegation,
         workflows: WORKFLOWS,
         discoveryEnabled: workspace.discovery_enabled,
      });
   });

   org.put('/discovery', async (context) => {
      const user = context.get('user');
      const workspaceId = currentWorkspace(user.currentWorkspaceId);
      await resolveScoped(sql, user.id, workspaceId, 'settings.write');

      const parsed = discoveryBody.safeParse(await context.req.json().catch(() => null));
      if (!parsed.success) throw ApiError.badRequest('enabled must be a boolean.');

      await sql`
         UPDATE workspaces SET discovery_enabled = ${parsed.data.enabled}
          WHERE id = ${workspaceId} AND deleted_at IS NULL`;
      // Switching it on provisions what a workspace with it off never got:
      // the Discovery task and weekly autopilot for each role.
      if (parsed.data.enabled) await options.ensureDiscovery?.(workspaceId);
      return json({ discoveryEnabled: parsed.data.enabled });
   });

   org.post('/roles/:roleKey/reset', async (context) => {
      const user = context.get('user');
      const workspaceId = currentWorkspace(user.currentWorkspaceId);
      await resolveScoped(sql, user.id, workspaceId, 'settings.write');
      const roleKey = context.req.param('roleKey');

      await resetRole(sql, workspaceId, roleKey).catch((error: unknown) => {
         if (error instanceof RoleNotFound) throw ApiError.notFound('Role');
         throw error;
      });
      const [row] = await sql<Array<{ id: string }>>`
         SELECT id FROM agents
          WHERE workspace_id = ${workspaceId} AND role_key = ${roleKey} AND archived_at IS NULL`;
      return json(serializeAgent(await agents.get(row!.id, workspaceId)));
   });

   const proposals = new Hono<{ Variables: AuthVariables }>();
   proposals.use('*', requireSession(options.sessions));

   proposals.get('/', async (context) => {
      const user = context.get('user');
      const workspaceId = currentWorkspace(user.currentWorkspaceId);
      await resolveScoped(sql, user.id, workspaceId, 'product.read');

      const url = new URL(context.req.url);
      const status = url.searchParams.get('status');
      const role = url.searchParams.get('role');
      const severity = url.searchParams.get('severity');
      if (status !== null && !STATUSES.has(status)) throw ApiError.badRequest('status is not supported.');
      if (severity !== null && !SEVERITIES.has(severity)) throw ApiError.badRequest('severity is not supported.');
      if (role !== null && !ROLE_KEYS.has(role)) throw ApiError.badRequest('role is not supported.');

      const rows = await sql<
         Array<{
            id: string;
            issue_id: string;
            identifier: string;
            approval_id: string | null;
            role_key: string;
            proposed_by_name: string | null;
            problem: string;
            evidence: unknown;
            impact: string;
            severity: string;
            impact_classes: string[];
            proposed_action: string;
            effort: string;
            dependencies: string[];
            responsible_role: string;
            required_reviewers: string[];
            status: string;
            created_at: string;
         }>
      >`
         SELECT wp.id, wp.issue_id, berry_issue_identifier(board.workspace_id, issue.number) AS identifier,
                wp.approval_id, wp.role_key, agent.name AS proposed_by_name,
                wp.problem, wp.evidence, wp.impact, wp.severity, wp.impact_classes,
                wp.proposed_action, wp.effort, wp.dependencies, wp.responsible_role,
                wp.required_reviewers, wp.status, wp.created_at
           FROM work_proposals wp
           JOIN issues issue ON issue.id = wp.issue_id
           JOIN boards board ON board.id = issue.board_id
           LEFT JOIN agents agent ON agent.id = wp.proposed_by
          WHERE wp.workspace_id = ${workspaceId}
            AND (${status === null} OR wp.status = ${status ?? ''})
            AND (${role === null} OR wp.role_key = ${role ?? ''})
            AND (${severity === null} OR wp.severity = ${severity ?? ''})
          ORDER BY wp.created_at DESC, wp.id DESC
          LIMIT 100`;

      return json({
         nodes: rows.map((row) => ({
            id: row.id,
            taskId: row.issue_id,
            identifier: row.identifier,
            approvalId: row.approval_id,
            roleKey: row.role_key,
            proposedBy: row.proposed_by_name,
            problem: row.problem,
            evidence: row.evidence,
            impact: row.impact,
            severity: row.severity,
            impactClasses: row.impact_classes,
            proposedAction: row.proposed_action,
            effort: row.effort,
            dependencies: row.dependencies,
            responsibleRole: row.responsible_role,
            requiredReviewers: row.required_reviewers,
            status: row.status,
            createdAt: toRFC3339(row.created_at),
         })),
      });
   });

   return [
      { prefix: '/api/v1/organization', handler: org },
      { prefix: '/api/v1/work-proposals', handler: proposals },
   ];
}
