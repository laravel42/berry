'use client';

import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';

import { TiptapAiEditor } from '@/components/common/editor/tiptap-ai-editor';
import { SkillLabelMultiselect } from '@/components/common/skills/skill-label-multiselect';
import DetailDrawerShell from '@/components/layout/detail-drawer-shell';
import { PageTitleBar } from '@/components/layout/headers/page-title-bar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { BerryApiError } from '@/lib/api';
import { createSkill, type Skill } from '@/lib/skills';

interface Props {
   open: boolean;
   onOpenChange: (open: boolean) => void;
   onCreated: (skill: Skill) => void;
   /** The catalogue's names, so a clash is caught before the request. */
   existingNames: string[];
   /** Labels already used in the catalogue, offered in the selector. */
   labelOptions: string[];
   /** Stored colours for those labels. */
   labelColors?: Record<string, string>;
}

const NAME_SHAPE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Writing a skill here: a name, a description, labels, and the instructions agents read. */
export default function NewSkillDialog({
   open,
   onOpenChange,
   onCreated,
   existingNames,
   labelOptions,
   labelColors,
}: Props) {
   const t = useTranslations('areas.skills');
   const [name, setName] = useState('');
   const [description, setDescription] = useState('');
   const [labels, setLabels] = useState<string[]>([]);
   const [content, setContent] = useState('');
   const [busy, setBusy] = useState(false);

   const reset = () => {
      setName('');
      setDescription('');
      setLabels([]);
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
            labels,
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

   if (!open) return null;

   return (
      <DetailDrawerShell
         header={<PageTitleBar title={t('create.title')} />}
         onClose={() => {
            reset();
            onOpenChange(false);
         }}
      >
         <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex min-h-0 flex-1 flex-col gap-3 px-5 py-4">
               <label className="flex shrink-0 flex-col gap-1.5">
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
               <label className="flex shrink-0 flex-col gap-1.5">
                  <span className="text-muted-foreground">{t('create.description')}</span>
                  <Input
                     value={description}
                     onChange={(event) => setDescription(event.target.value)}
                  />
               </label>
               <div className="shrink-0">
                  <SkillLabelMultiselect
                     value={labels}
                     options={labelOptions}
                     colors={labelColors}
                     onChange={setLabels}
                  />
               </div>
               <div className="flex min-h-0 flex-1 flex-col gap-1.5">
                  <span className="shrink-0 text-muted-foreground">{t('create.instructions')}</span>
                  <div className="border-input bg-background focus-within:border-input flex min-h-0 flex-1 flex-col overflow-y-auto rounded-md border px-3 py-2 shadow-xs [&_.ProseMirror]:min-h-full">
                     <TiptapAiEditor
                        value={content}
                        onChange={setContent}
                        placeholder={t('create.instructionsPlaceholder')}
                        aria-label={t('create.instructions')}
                        className="min-h-0 flex-1"
                        aiAssist={false}
                     />
                  </div>
               </div>
            </div>
            <div className="flex shrink-0 justify-end border-t bg-container px-5 py-3">
               <Button
                  size="sm"
                  disabled={busy || !shapeOk || taken || description.trim() === ''}
                  onClick={() => void create()}
               >
                  {t('create.create')}
               </Button>
            </div>
         </div>
      </DetailDrawerShell>
   );
}
