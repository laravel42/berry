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
