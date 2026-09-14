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
