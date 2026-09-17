'use client';

import { useTranslations } from 'next-intl';

import { Button } from '@/components/ui/button';

interface UnsavedChangesBarProps {
   /** Already-localised list of what changed, e.g. "instructions, starters". */
   what: string;
   onDiscard: () => void;
   onSave: () => void;
   busy?: boolean;
   discardLabel?: string;
   saveLabel?: string;
}

/**
 * Sticky save/discard strip for a detail view that edits a draft.
 *
 * Same bar skills use: what is dirty, discard restores the loaded copy, save
 * writes it. Kept as one helper so agent and skill surfaces stay aligned.
 */
export function UnsavedChangesBar({
   what,
   onDiscard,
   onSave,
   busy = false,
   discardLabel,
   saveLabel,
}: UnsavedChangesBarProps) {
   const t = useTranslations('common.unsavedBar');

   return (
      <div className="sticky bottom-0 z-10 flex flex-wrap items-center gap-3 border-t border-status-warning/40 bg-status-warning/10 px-6 py-2">
         <span className="mr-auto text-status-warning">{t('unsaved', { what })}</span>
         <Button size="xs" variant="ghost" disabled={busy} onClick={onDiscard}>
            {discardLabel ?? t('discard')}
         </Button>
         <Button size="xs" disabled={busy} onClick={onSave}>
            {saveLabel ?? (busy ? t('saving') : t('save'))}
         </Button>
      </div>
   );
}
