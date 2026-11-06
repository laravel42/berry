'use client';

import { Button } from '@/components/ui/button';
import {
   Dialog,
   DialogContent,
   DialogFooter,
   DialogHeader,
   DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { createWorkspaceCycle } from '@/lib/cycles';
import { useCyclesStore } from '@/store/cycles-store';
import { useSessionStore } from '@/store/session-store';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

function isoDate(daysFromToday: number): string {
   const date = new Date();
   date.setDate(date.getDate() + daysFromToday);
   return date.toISOString().slice(0, 10);
}

export function CreateCycleDialog({
   open,
   onOpenChange,
}: {
   open: boolean;
   onOpenChange: (open: boolean) => void;
}) {
   const t = useTranslations('cycles.create');
   const workspaceId = useSessionStore((state) => state.workspace?.id);
   const upsertCycle = useCyclesStore((state) => state.upsertCycle);
   const [name, setName] = useState('');
   const [startsOn, setStartsOn] = useState(isoDate(0));
   const [endsOn, setEndsOn] = useState(isoDate(13));
   const [activate, setActivate] = useState(true);
   const [saving, setSaving] = useState(false);

   const submit = async () => {
      if (!workspaceId || saving) return;
      setSaving(true);
      try {
         const cycle = await createWorkspaceCycle({
            workspaceId,
            startsOn,
            endsOn,
            ...(name.trim() ? { name: name.trim() } : {}),
            ...(activate ? { status: 'active' as const } : {}),
         });
         upsertCycle(cycle);
         toast.success(t('created', { name: cycle.name }));
         onOpenChange(false);
         setName('');
      } catch {
         toast.error(t('failed'));
      } finally {
         setSaving(false);
      }
   };

   return (
      <Dialog open={open} onOpenChange={onOpenChange}>
         <DialogContent className="max-w-md">
            <DialogHeader>
               <DialogTitle>{t('title')}</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-3 py-2">
               <div className="flex flex-col gap-1.5">
                  <Label htmlFor="cycle-name">{t('name')}</Label>
                  <Input
                     id="cycle-name"
                     value={name}
                     onChange={(event) => setName(event.target.value)}
                     placeholder={t('namePlaceholder')}
                  />
               </div>
               <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                     <Label htmlFor="cycle-starts">{t('startsOn')}</Label>
                     <Input
                        id="cycle-starts"
                        type="date"
                        value={startsOn}
                        onChange={(event) => setStartsOn(event.target.value)}
                     />
                  </div>
                  <div className="flex flex-col gap-1.5">
                     <Label htmlFor="cycle-ends">{t('endsOn')}</Label>
                     <Input
                        id="cycle-ends"
                        type="date"
                        value={endsOn}
                        onChange={(event) => setEndsOn(event.target.value)}
                     />
                  </div>
               </div>
               <label className="flex items-center gap-2 text-muted-foreground">
                  <input
                     type="checkbox"
                     checked={activate}
                     onChange={(event) => setActivate(event.target.checked)}
                  />
                  {t('activate')}
               </label>
            </div>
            <DialogFooter>
               <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving}>
                  {t('cancel')}
               </Button>
               <Button onClick={() => void submit()} disabled={saving || !startsOn || !endsOn}>
                  {t('submit')}
               </Button>
            </DialogFooter>
         </DialogContent>
      </Dialog>
   );
}
