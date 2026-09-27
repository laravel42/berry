import type { Queryable } from '../db/pool.ts';
import { CATALOG, isCoreRole } from '../organization/catalog.ts';
import { addRole, ensureOrganizationAgents } from '../organization/provision.ts';

/**
 * A workspace with every catalogue role: the core a workspace is given, and
 * each specialist added the way a person adds one (ADR-0018). For tests of
 * delegation, reviews and escalation between specialists, which a workspace
 * has only once someone added them.
 */
export async function provisionFullOrganization(q: Queryable, workspaceId: string): Promise<void> {
   await ensureOrganizationAgents(q, workspaceId);
   for (const role of CATALOG) {
      if (!isCoreRole(role.id)) await addRole(q, workspaceId, role.id);
   }
}
