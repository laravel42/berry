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

/** Border / fill / text for a level chip. Matches workspace-role badge density. */
export const AUTONOMY_LEVEL_STYLE: Record<AutonomyLevel, string> = {
   1: 'border-status-neutral/40 bg-status-neutral/10 text-status-neutral',
   2: 'border-status-info/40 bg-status-info/10 text-status-info',
   3: 'border-status-warning/40 bg-status-warning/10 text-status-warning',
   4: 'border-review-pending/40 bg-review-pending/10 text-review-pending',
   5: 'border-status-success/40 bg-status-success/10 text-status-success',
};
