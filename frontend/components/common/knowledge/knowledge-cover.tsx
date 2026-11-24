'use client';

import { ImageUp, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef, useState } from 'react';
import { toast } from 'sonner';

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { BerryApiError } from '@/lib/api';
import {
   knowledgeCoverUrl,
   updateKnowledgePage,
   uploadKnowledgeCover,
   type KnowledgeCover,
   type KnowledgePage,
} from '@/lib/knowledge';
import { cn } from '@/lib/utils';
import { COVER_PRESETS, coverPreset } from './knowledge-covers';

/** The upload ceiling the server enforces, checked first so a refusal is instant. */
const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPT = 'image/png,image/jpeg,image/gif,image/webp';

interface CoverProps {
   workspaceId: string;
   pageId: string;
   cover: KnowledgeCover;
   /** The page as saved after a cover change. */
   onSaved: (page: KnowledgePage) => void;
}

/** Saves a preset (or none) and hands back the saved page; reports a failure. */
function useCoverActions({ workspaceId, pageId, onSaved }: Omit<CoverProps, 'cover'>) {
   const t = useTranslations('knowledge');
   const [busy, setBusy] = useState(false);

   const run = async (work: () => Promise<KnowledgePage>, failure: string) => {
      setBusy(true);
      try {
         onSaved(await work());
      } catch (cause) {
         toast.error(cause instanceof BerryApiError ? cause.message : failure);
      } finally {
         setBusy(false);
      }
   };

   return {
      busy,
      setPreset: (name: string | null) =>
         run(() => updateKnowledgePage(workspaceId, pageId, { cover: name }), t('coverFailed')),
      upload: (file: File) => {
         if (file.size > MAX_BYTES) {
            toast.error(t('coverTooLarge'));
            return;
         }
         void run(() => uploadKnowledgeCover(workspaceId, pageId, file), t('coverUploadFailed'));
      },
   };
}

/** "Add cover": a gallery cover at random, which "Change cover" can then replace. */
export function AddCoverButton(props: Omit<CoverProps, 'cover'>) {
   const t = useTranslations('knowledge');
   const { busy, setPreset } = useCoverActions(props);
   return (
      <button
         type="button"
         disabled={busy}
         onClick={() => {
            const preset = COVER_PRESETS[Math.floor(Math.random() * COVER_PRESETS.length)];
            if (preset) void setPreset(preset.name);
         }}
         className="flex w-fit items-center gap-1.5 rounded-md px-2 py-1 text-muted-foreground hover:bg-accent hover:text-foreground"
      >
         {busy ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
         ) : (
            <ImageUp className="size-4" aria-hidden />
         )}
         {t('addCover')}
      </button>
   );
}

/**
 * The page's cover, full width under the breadcrumb, as in Notion. Hovering
 * it offers Change cover (the gallery, or an uploaded image) and Remove.
 */
export function KnowledgeCoverBanner({ workspaceId, pageId, cover, onSaved }: CoverProps) {
   const t = useTranslations('knowledge');
   const { busy, setPreset, upload } = useCoverActions({ workspaceId, pageId, onSaved });
   const input = useRef<HTMLInputElement>(null);
   if (!cover) return null;

   const preset = cover.kind === 'preset' ? coverPreset(cover.name) : undefined;

   return (
      <div className="group/cover relative -mx-6 mt-3 h-44 overflow-hidden sm:-mx-12 sm:h-56">
         {cover.kind === 'image' ? (
            // An uploaded image the workspace's own API serves; not a remote URL.
            // eslint-disable-next-line @next/next/no-img-element
            <img
               src={knowledgeCoverUrl(workspaceId, pageId, cover.version)}
               alt=""
               className="size-full object-cover"
            />
         ) : (
            <div
               className="size-full"
               style={{ background: preset?.background ?? 'var(--muted)' }}
            />
         )}
         <div className="absolute right-4 bottom-3 hidden items-center gap-1 group-hover/cover:flex group-focus-within/cover:flex has-[[data-state=open]]:flex">
            {busy ? <Loader2 className="size-4 animate-spin text-white" aria-hidden /> : null}
            <Popover>
               <PopoverTrigger asChild>
                  <button
                     type="button"
                     className="rounded-md bg-background/85 px-2 py-1 text-foreground shadow-sm hover:bg-background"
                  >
                     {t('changeCover')}
                  </button>
               </PopoverTrigger>
               <PopoverContent align="end" className="w-80 p-3">
                  <p className="mb-2 text-muted-foreground" data-caption="">
                     {t('coverGallery')}
                  </p>
                  <div className="grid grid-cols-4 gap-1.5">
                     {COVER_PRESETS.map((choice) => (
                        <button
                           key={choice.name}
                           type="button"
                           aria-label={choice.label}
                           title={choice.label}
                           onClick={() => void setPreset(choice.name)}
                           className={cn(
                              'h-10 rounded-md ring-offset-2 ring-offset-popover hover:ring-2 hover:ring-ring/50',
                              cover.kind === 'preset' &&
                                 cover.name === choice.name &&
                                 'ring-2 ring-ring'
                           )}
                           style={{ background: choice.background }}
                        />
                     ))}
                  </div>
                  <button
                     type="button"
                     onClick={() => input.current?.click()}
                     className="mt-3 flex w-full items-center justify-center gap-2 rounded-md border px-2 py-1.5 hover:bg-accent"
                  >
                     <ImageUp className="size-4" aria-hidden />
                     {t('uploadCover')}
                  </button>
                  <p className="mt-1.5 text-muted-foreground" data-caption="">
                     {t('coverHint')}
                  </p>
               </PopoverContent>
            </Popover>
            <button
               type="button"
               onClick={() => void setPreset(null)}
               className="rounded-md bg-background/85 px-2 py-1 text-foreground shadow-sm hover:bg-background"
            >
               {t('removeCover')}
            </button>
         </div>
         <input
            ref={input}
            type="file"
            accept={ACCEPT}
            className="hidden"
            onChange={(event) => {
               const file = event.target.files?.[0];
               event.target.value = '';
               if (file) upload(file);
            }}
         />
      </div>
   );
}
