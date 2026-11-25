/**
 * The ledger redesign's own glyph for an AI action — two four-point stars,
 * one large and one small — ported from
 * `berry-redesign/ledger/screens/22-create-task-modal.html` ("Hand it to an
 * agent"). Distinct from lucide's `Sparkles` (which this replaces on the
 * `.spark` control) so the control the kit calls out as "a secondary
 * control inviting an AI action" carries its own mark rather than the
 * generic one used elsewhere for plain decoration.
 */
export function SparkIcon({ className }: { className?: string }) {
   return (
      <svg
         viewBox="0 0 16 16"
         fill="none"
         stroke="currentColor"
         strokeWidth={1.5}
         strokeLinejoin="round"
         className={className}
         aria-hidden="true"
      >
         <path d="m5 2 1.1 2.9L9 6 6.1 7.1 5 10 3.9 7.1 1 6l2.9-1.1z" />
         <path d="m11.5 8.5.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" />
      </svg>
   );
}
