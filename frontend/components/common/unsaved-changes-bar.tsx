'use client';

import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';
import { useFloatingFloor } from '@/store/floating-stack-store';

interface UnsavedChangesBarProps {
   onDiscard: () => void;
   onSave: () => void;
   busy?: boolean;
   /** Holds Save back while the draft cannot be written, e.g. it does not parse. */
   saveDisabled?: boolean;
   discardLabel?: string;
   saveLabel?: string;
}

/**
 * Sticky save/discard strip for a detail view that edits a draft.
 *
 * Same bar skills use: discard restores the loaded copy, save writes it. Kept
 * as one helper so agent and skill surfaces stay aligned.
 *
 * It sticks to the bottom of whatever scrolls the form. No rule on top: a
 * warning tint rises from the bottom edge and fades out into the card, the
 * inverse of the tint a detail header falls from, so the form scrolls under
 * it. Discard and Save stand on their own, so they take the button height.
 */
export function UnsavedChangesBar({
   onDiscard,
   onSave,
   busy = false,
   saveDisabled = false,
   discardLabel,
   saveLabel,
}: UnsavedChangesBarProps) {
   const t = useTranslations('common.unsavedBar');
   // Joins the floating stack's floor, so the Agents launcher and a task's
   // Console rise above the bar instead of covering Save.
   const ref = useFloatingFloor();

   return (
      <div
         ref={ref}
         className="sticky bottom-0 z-10 flex w-full shrink-0 flex-wrap items-center gap-3 bg-[linear-gradient(to_top,color-mix(in_oklab,var(--status-warning)_12%,var(--container))_55%,transparent)] px-8 pt-10 pb-4"
      >
         <span className="mr-auto text-status-warning">{t('unsaved')}</span>
         <Button variant="ghost" disabled={busy} onClick={onDiscard}>
            {discardLabel ?? t('discard')}
         </Button>
         <Button disabled={busy || saveDisabled} onClick={onSave}>
            {saveLabel ?? (busy ? t('saving') : t('save'))}
         </Button>
      </div>
   );
}
