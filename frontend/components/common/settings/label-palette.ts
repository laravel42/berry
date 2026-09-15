/**
 * Colours a workspace label or a select option can be created with.
 *
 * These are data, not styling: the chosen value is stored on the label by the
 * API and rendered back as-is wherever the chip appears, so they have to be
 * literal colours rather than theme tokens, which would resolve differently
 * on every surface. Every other colour in the frontend is a semantic token;
 * this is the one table that cannot be, and it is here so it is said once.
 */
export const LABEL_PALETTE: readonly string[] = [
   '#6366f1',
   '#f97316',
   '#347b5a',
   '#9b6715',
   '#397caf',
   '#b4436c',
   '#7c5cbf',
   '#4a5568',
];

/** The palette a new select option cycles through, in order. */
export const OPTION_PALETTE: readonly string[] = LABEL_PALETTE.slice(0, 6);

export const DEFAULT_LABEL_COLOR = LABEL_PALETTE[0] ?? '#6366f1';
