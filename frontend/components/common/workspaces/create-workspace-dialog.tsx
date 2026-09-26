'use client';

import { useTranslations } from 'next-intl';

import { NewWorkspaceForm } from '@/components/common/workspaces/new-workspace-form';
import { Button } from '@/components/ui/button';
import {
   Dialog,
   DialogContent,
   DialogDescription,
   DialogHeader,
   DialogTitle,
} from '@/components/ui/dialog';
import { useCreateWorkspaceStore } from '@/store/create-workspace-store';

/**
 * Create a workspace without leaving the one you are in: the workspace menu's
 * "Create" opens this. Mounted once, in the workspace layout, because the menu
 * that opens it unmounts as it closes.
 */
export function CreateWorkspaceDialog() {
   const t = useTranslations('workspaceAdmin.newWorkspace');
   const isOpen = useCreateWorkspaceStore((state) => state.isOpen);
   const closeModal = useCreateWorkspaceStore((state) => state.closeModal);

   return (
      <Dialog open={isOpen} onOpenChange={(open) => (open ? null : closeModal())}>
         <DialogContent className="sm:max-w-xl">
            <DialogHeader>
               <DialogTitle>{t('title')}</DialogTitle>
               <DialogDescription>{t('subtitle')}</DialogDescription>
            </DialogHeader>
            {/* Keyed on open, so each opening starts from an empty form. */}
            {isOpen ? (
               <NewWorkspaceForm
                  onCreated={closeModal}
                  cancel={
                     <Button variant="ghost" onClick={closeModal}>
                        {t('cancel')}
                     </Button>
                  }
               />
            ) : null}
         </DialogContent>
      </Dialog>
   );
}
