'use client';

import { AttachmentPreview } from '@/components/layout/attachments/attachment-preview';
import {
   attachmentObjectUrl,
   formatFileSize,
   previewKind,
   type ApiAttachment,
} from '@/lib/attachments';
import { WORKSPACE_SLUG } from '@/lib/config';
import { cn } from '@/lib/utils';
import { File as FileIcon, FileText, Image as ImageIcon, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';

function ImageThumb({ file, localUrl }: { file: ApiAttachment; localUrl?: string }) {
   const [remoteUrl, setRemoteUrl] = useState<string | null>(null);

   useEffect(() => {
      if (localUrl) return;
      let cancelled = false;
      let created: string | null = null;
      void attachmentObjectUrl(file)
         .then((url) => {
            if (cancelled) {
               URL.revokeObjectURL(url);
               return;
            }
            created = url;
            setRemoteUrl(url);
         })
         .catch(() => undefined);
      return () => {
         cancelled = true;
         if (created) URL.revokeObjectURL(created);
      };
   }, [file, localUrl]);

   const src = localUrl ?? remoteUrl;
   if (!src) {
      return (
         <span className="flex size-full items-center justify-center text-muted-foreground">
            <ImageIcon className="size-5 opacity-60" aria-hidden />
         </span>
      );
   }

   return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={src} alt={file.fileName} className="size-full object-cover" />
   );
}

/**
 * Compact strip of attachment preview tiles for comments and composers:
 * - Images render a 64x64 mini thumbnail.
 * - Other files render a file-icon card with name and size.
 * - Optional top-right `X` button removes pending uploads before sending.
 * - Clicking any tile opens the full in-place AttachmentPreview modal
 *   (zoomable image viewer, scrollable text reader, PDF/HTML preview).
 */
export function AttachmentStrip({
   files,
   localThumbs,
   onRemove,
   className,
}: {
   files: ApiAttachment[];
   /** Optional object URLs keyed by attachment id for instant image thumbnails. */
   localThumbs?: ReadonlyMap<string, string>;
   /** When provided, shows a top-right `X` close button on every tile. */
   onRemove?: (file: ApiAttachment) => void;
   className?: string;
}) {
   const { orgId } = useParams<{ orgId?: string }>();
   const org = orgId ?? WORKSPACE_SLUG;
   const tAttach = useTranslations('navigation.attachments');
   const tConfirm = useTranslations('common.confirm');
   const [previewIndex, setPreviewIndex] = useState<number | null>(null);

   const activeIndex = previewIndex !== null && previewIndex < files.length ? previewIndex : null;

   if (files.length === 0) return null;

   return (
      <>
         <ul className={cn('flex flex-wrap gap-2.5 pt-1.5', className)}>
            {files.map((file, index) => {
               const kind = previewKind(file);
               const isImage = kind === 'image';
               const isTextLike = kind === 'text' || kind === 'html' || kind === 'pdf';
               const previewLabel = tAttach('preview', { name: file.fileName });

               return (
                  <li key={file.id} className="relative shrink-0">
                     {isImage ? (
                        <button
                           type="button"
                           onClick={() => setPreviewIndex(index)}
                           aria-label={previewLabel}
                           title={file.fileName}
                           className="block size-16 cursor-pointer overflow-hidden rounded-lg border border-border/70 bg-muted/40 outline-none transition-[border-color,filter] hover:border-foreground/30 hover:brightness-105 focus-visible:ring-[3px] focus-visible:ring-ring/50"
                        >
                           <ImageThumb file={file} localUrl={localThumbs?.get(file.id)} />
                        </button>
                     ) : (
                        <button
                           type="button"
                           onClick={() => setPreviewIndex(index)}
                           aria-label={previewLabel}
                           title={file.fileName}
                           className="flex h-16 min-w-[140px] max-w-[208px] cursor-pointer items-center gap-2.5 overflow-hidden rounded-lg border border-border/70 bg-background/85 px-2.5 py-2 text-left outline-none transition-colors hover:border-foreground/30 hover:bg-accent/60 focus-visible:ring-[3px] focus-visible:ring-ring/50"
                        >
                           <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted/70 text-muted-foreground">
                              {isTextLike ? (
                                 <FileText className="size-[18px]" aria-hidden />
                              ) : (
                                 <FileIcon className="size-[18px]" aria-hidden />
                              )}
                           </span>
                           <span className="min-w-0 flex-1">
                              <span className="block truncate font-medium text-foreground">
                                 {file.fileName}
                              </span>
                              <span className="block truncate text-muted-foreground tabular-nums">
                                 {formatFileSize(file.sizeBytes)}
                              </span>
                           </span>
                        </button>
                     )}

                     {onRemove ? (
                        <button
                           type="button"
                           onClick={(event) => {
                              event.stopPropagation();
                              onRemove(file);
                           }}
                           aria-label={`${tConfirm('remove')} ${file.fileName}`}
                           title={tConfirm('remove')}
                           className="absolute -top-1.5 -right-1.5 z-10 inline-flex size-5 cursor-pointer items-center justify-center rounded-full border border-border bg-background text-muted-foreground shadow-xs outline-none transition-colors hover:border-destructive hover:bg-destructive hover:text-white focus-visible:ring-2 focus-visible:ring-ring"
                        >
                           <X className="size-3" strokeWidth={2.4} aria-hidden />
                        </button>
                     ) : null}
                  </li>
               );
            })}
         </ul>

         {activeIndex !== null ? (
            <AttachmentPreview
               attachments={files}
               index={activeIndex}
               onIndexChange={setPreviewIndex}
               orgId={org}
            />
         ) : null}
      </>
   );
}
