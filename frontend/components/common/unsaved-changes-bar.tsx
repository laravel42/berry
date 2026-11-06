'use client';

import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';

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

   return (
      <div className="z-10 flex w-full shrink-0 flex-wrap items-center gap-3 border-t border-status-warning/40 bg-status-warning/10 px-6 py-2">
         <span className="mr-auto text-status-warning">{t('unsaved')}</span>
         <Button size="xs" variant="ghost" disabled={busy} onClick={onDiscard}>
            {discardLabel ?? t('discard')}
         </Button>
         <Button size="xs" disabled={busy || saveDisabled} onClick={onSave}>
            {saveLabel ?? (busy ? t('saving') : t('save'))}
         </Button>
      </div>
   );
}
