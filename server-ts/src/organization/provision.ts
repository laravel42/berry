import { randomUUID } from 'node:crypto';

import type { Queryable, Sql } from '../db/pool.ts';
import { effectivePermissions } from './autonomy.ts';
import { CATALOG, CATALOG_VERSION, catalogRole } from './catalog.ts';
import { hashContract, parseContract, type RoleContract } from './contract.ts';

/** Thrown by {@link resetRole}: an unknown catalog role, or no live agent fills it here. */
export class RoleNotFound extends Error {
   constructor() {
      super('role not found');
      this.name = 'RoleNotFound';
   }
}

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
   // A role whose agent a person archived was removed on purpose: it is not
   // re-inserted, and restoring the archived agent brings the role back.
   const removed = new Set(
      (await q<Array<{ role_key: string }>>`
         SELECT DISTINCT role_key FROM agents
          WHERE workspace_id = ${workspaceId} AND role_key IS NOT NULL AND archived_at IS NOT NULL`).map((row) => row.role_key)
   );
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
      if (removed.has(contract.id)) continue;
      if (contract.id === 'orchestrator') {
         // The workspace trigger made it; adopt it rather than insert a second.
         const orchestrator = existing.find((row) => row.protected && !row.role_key);
         if (orchestrator) {
            await adoptOrchestrator(q, orchestrator.id, contract);
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

export async function writeContract(q: Queryable, agentId: string, contract: RoleContract): Promise<void> {
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

/**
 * Appended to the catalog hash when an adopted Orchestrator keeps instructions
 * a person wrote: the stored hash can then never match a contract, so the row
 * reads as customised (spec §10 step 2), is never silently upgraded, and
 * `resetRole` — which writes the plain hash — is what clears it.
 */
export const KEPT_INSTRUCTIONS_SUFFIX = ':instructions-kept';

async function adoptOrchestrator(q: Queryable, agentId: string, contract: RoleContract): Promise<void> {
   const c = columnsOf(contract);
   // Every CASE reads the row as it was before this UPDATE.
   await q`
      UPDATE agents
         SET contract_hash = CASE WHEN instructions IS NULL OR instructions = ${ORCHESTRATOR_184}
                                  THEN ${c.contract_hash} ELSE ${c.contract_hash + KEPT_INSTRUCTIONS_SUFFIX} END,
             instructions = CASE WHEN instructions IS NULL OR instructions = ${ORCHESTRATOR_184}
                                 THEN ${contract.system_prompt} ELSE instructions END,
             capabilities = ${c.capabilities}, permissions = ${c.permissions},
             model_name = COALESCE(model_name, ${contract.preferred_model}),
             manifest_limits = ${q.json(c.manifest_limits as never)},
             role_key = ${c.role_key}, role_contract = ${q.json(contract as never)},
             contract_version = ${c.contract_version},
             autonomy_level = ${c.autonomy_level}, updated_at = now()
       WHERE id = ${agentId}`;
}

/**
 * Puts the catalog contract back on one role, discarding a person's edit.
 *
 * Reuses {@link writeContract} for every role, orchestrator included: unlike
 * {@link adoptOrchestrator} (which only replaces instructions still at
 * migration 184's placeholder text), a reset unconditionally replaces
 * `instructions` with the catalog's `system_prompt` — the whole point of a
 * reset is to discard whatever a person put there. `protected` is a
 * different column and untouched either way.
 */
export async function resetRole(q: Queryable, workspaceId: string, roleKey: string): Promise<void> {
   const contract = catalogRole(roleKey);
   if (!contract) throw new RoleNotFound();
   const [row] = await q<Array<{ id: string }>>`
      SELECT id FROM agents
       WHERE workspace_id = ${workspaceId} AND role_key = ${roleKey} AND archived_at IS NULL`;
   if (!row) throw new RoleNotFound();
   await writeContract(q, row.id, contract);
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
