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

/** Every tool a contract may name. Media tools stay outside the org. */
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
