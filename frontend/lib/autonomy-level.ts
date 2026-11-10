/**
 * Autonomy levels 1–5 are privilege ceilings. Colours escalate with what the
 * agent may do — advise, contribute, execute, self-direct, or approve — so a
 * roster row reads the same way the contract does.
 */
export type AutonomyLevel = 1 | 2 | 3 | 4 | 5;

export function asAutonomyLevel(value: number | null | undefined): AutonomyLevel | null {
   if (value === 1 || value === 2 || value === 3 || value === 4 || value === 5) return value;
   return null;
}

/**
 * The permissions the server gives a role when its level changes: from level 3
 * the ceiling holds run_command, which brings the code permissions; below it,
 * reading only. Mirrors `effectivePermissions` in server-ts; merging is never
 * a default.
 */
export function permissionsForLevel(level: AutonomyLevel): string[] {
   return level >= 3
      ? ['read_repository', 'create_branches', 'run_commands', 'open_pull_requests']
      : ['read_repository'];
}

/** Border / fill / text for a level chip. Matches workspace-role badge density. */
export const AUTONOMY_LEVEL_STYLE: Record<AutonomyLevel, string> = {
   1: 'border-status-neutral/40 bg-status-neutral/10 text-status-neutral',
   2: 'border-status-info/40 bg-status-info/10 text-status-info',
   3: 'border-status-success/40 bg-status-success/10 text-status-success',
   4: 'border-review-pending/40 bg-review-pending/10 text-review-pending',
   5: 'border-primary/40 bg-primary/10 text-primary',
};
