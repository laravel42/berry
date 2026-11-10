import type { Sql } from '../db/pool.ts';
import { ceilTools, loopPolicyForRun } from '../autopilots/policy.ts';
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

/**
 * What a chat adds to any organization role: planning. A person talking to an
 * agent can ask it for a plan whatever its role, because the plan is filed in
 * that person's name, only if they could have made it, and stays a proposal
 * until they press Start Plan. Not for a contract that failed validation: an
 * agent nobody can vouch for gets no new reach.
 */
export const CHAT_TOOLS: readonly string[] = ['create_milestone', 'create_plan'];

export async function agentToolAllowlist(
   sql: Sql,
   agentId: string,
   runId?: string
): Promise<Set<string> | null> {
   const [row] = await sql<Array<{ role_key: string | null; role_contract: unknown }>>`
      SELECT role_key, role_contract FROM agents WHERE id = ${agentId}`;
   if (!row) return new Set();
   // A run a Loop started is held to the Loop's mode as well as the agent's
   // contract. Looked up first: recommend mode closes even an agent whose
   // own permissions would leave it open (tools === null).
   const loop = runId ? await loopPolicyForRun(sql, runId) : null;
   const tools = toolsForAgentRow(row);
   if (loop) {
      const ceiled = ceilTools(tools, loop.accessMode);
      return ceiled === null ? null : new Set(ceiled);
   }
   if (tools === null) return null;
   const allowed = new Set(tools);
   if (runId && parseContract(row.role_contract)) {
      const [run] = await sql`SELECT chat_session_id FROM runs WHERE id = ${runId}`;
      if (run?.chat_session_id) for (const tool of CHAT_TOOLS) allowed.add(tool);
   }
   return allowed;
}
