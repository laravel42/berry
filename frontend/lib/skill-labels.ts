/** Same palette the workspace label catalogue hashes into. */
const LABEL_PALETTE = [
   '#6366f1',
   '#f97316',
   '#347b5a',
   '#9b6715',
   '#397caf',
   '#b4436c',
   '#7c5cbf',
   '#4a5568',
];

/** Stable colour for a free-form skill label name. */
export function colorForSkillLabel(name: string): string {
   let total = 0;
   for (const character of name) total = (total * 31 + character.charCodeAt(0)) >>> 0;
   return LABEL_PALETTE[total % LABEL_PALETTE.length]!;
}
