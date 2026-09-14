'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { TiptapAiEditor } from '@/components/common/editor/tiptap-ai-editor';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { BerryApiError } from '@/lib/api';
import { createSkill, type Skill } from '@/lib/skills';

interface Props {
   open: boolean;
   onOpenChange: (open: boolean) => void;
   onCreated: (skill: Skill) => void;
   /** The catalogue's names, so a clash is caught before the request. */
   existingNames: string[];
}

const NAME_SHAPE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Writing a skill here: a name, a description, and the instructions agents read. */
export default function NewSkillDialog({ open, onOpenChange, onCreated, existingNames }: Props) {
   const t = useTranslations('areas.skills');
   const [name, setName] = useState('');
   const [description, setDescription] = useState('');
   const [content, setContent] = useState('');
   const [busy, setBusy] = useState(false);

   const reset = () => {
      setName('');
      setDescription('');
      setContent('');
   };

   const taken = existingNames.includes(name.trim());
   const shapeOk = NAME_SHAPE.test(name.trim());
   const nameProblem =
      name.trim() === ''
         ? null
         : taken
           ? t('create.nameTaken')
           : shapeOk
             ? null
             : t('create.nameInvalid');

   const create = async () => {
      setBusy(true);
      try {
         const skill = await createSkill({
            name: name.trim(),
            description: description.trim(),
            content,
            labels: [],
            files: [],
         });
         toast.success(t('create.created', { name: skill.name }));
         reset();
         onCreated(skill);
         onOpenChange(false);
      } catch (error) {
         toast.error(error instanceof BerryApiError ? error.message : t('create.failed'));
      } finally {
         setBusy(false);
      }
   };

   return (
      <Dialog
         open={open}
         onOpenChange={(next) => {
            if (!next) reset();
            onOpenChange(next);
         }}
      >
         <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
               <DialogTitle>{t('create.title')}</DialogTitle>
            </DialogHeader>
            <div className="flex flex-col gap-3">
               <label className="flex flex-col gap-1.5">
                  <span className="text-muted-foreground">{t('create.name')}</span>
                  <Input
                     value={name}
                     aria-invalid={nameProblem !== null}
                     onChange={(event) => setName(event.target.value.toLowerCase())}
                  />
                  <span className={nameProblem ? 'text-destructive' : 'text-muted-foreground'}>
                     {nameProblem ?? t('create.nameHint')}
                  </span>
               </label>
               <label className="flex flex-col gap-1.5">
                  <span className="text-muted-foreground">{t('create.description')}</span>
                  <Input
                     value={description}
                     onChange={(event) => setDescription(event.target.value)}
                  />
               </label>
               <div className="flex flex-col gap-1.5">
                  <span className="text-muted-foreground">{t('create.instructions')}</span>
                  <div className="border-input bg-background focus-within:border-input max-h-80 min-h-48 overflow-y-auto rounded-md border px-3 py-2 shadow-xs">
                     <TiptapAiEditor
                        value={content}
                        onChange={setContent}
                        placeholder={t('create.instructionsPlaceholder')}
                        aria-label={t('create.instructions')}
                        className="min-h-44"
                        aiAssist={false}
                     />
                  </div>
               </div>
               <div className="flex justify-end">
                  <Button
                     size="sm"
                     disabled={busy || !shapeOk || taken || description.trim() === ''}
                     onClick={() => void create()}
                  >
                     {t('create.create')}
                  </Button>
               </div>
            </div>
         </DialogContent>
      </Dialog>
   );
}
