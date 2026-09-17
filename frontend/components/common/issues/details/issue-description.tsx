'use client';

import {
   attachmentObjectUrl,
   isImageAttachment,
   loadIssueAttachments,
   uploadIssueAttachment,
   type ApiAttachment,
} from '@/lib/attachments';
import { cn } from '@/lib/utils';
import { useIssuesStore } from '@/store/issues-store';
import { TiptapAiEditor } from '@/components/common/editor/tiptap-ai-editor';
import { ImageIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { ImageViewer, type ViewerImage } from './image-viewer';

/**
 * The description, and the image evidence that belongs with it.
 *
 * Dropping a screenshot onto the text is how people attach evidence to a bug.
 * The Files section further down is where deliberate uploads go; this surface
 * only catches what lands on the description.
 *
 * Images get a strip under the text and open in a viewer that steps through
 * all of them, since the second screenshot is usually the point.
 *
 * Markdown is edited with TipTap (same editor as project create) and committed
 * on blur so keystrokes do not PATCH the issue.
 */
export function IssueDescription({
   issueId,
   issueRef,
   description,
}: {
   issueId: string;
   issueRef: string;
   description: string;
}) {
   const t = useTranslations('issueDetail.description');
   const updateIssueDescription = useIssuesStore((state) => state.updateIssueDescription);
   const [attachments, setAttachments] = useState<ApiAttachment[]>([]);
   const [images, setImages] = useState<ViewerImage[]>([]);
   const [dragging, setDragging] = useState(false);
   const [viewerAt, setViewerAt] = useState<number | null>(null);
   const urls = useRef<string[]>([]);

   useEffect(() => {
      if (!issueRef) return;
      let cancelled = false;
      void loadIssueAttachments(issueRef)
         .then((loaded) => {
            if (!cancelled) setAttachments(loaded);
         })
         .catch(() => undefined);
      return () => {
         cancelled = true;
      };
   }, [issueRef]);

   // Blob URLs are made once per image and revoked when this unmounts; each
   // one holds the whole file, so leaking them leaks the pictures.
   useEffect(() => {
      let cancelled = false;
      const pictures = attachments.filter(isImageAttachment);
      void Promise.all(
         pictures.map(async (attachment) => {
            const url = await attachmentObjectUrl(attachment).catch(() => null);
            return url ? { id: attachment.id, name: attachment.fileName, url } : null;
         })
      ).then((loaded) => {
         const resolved = loaded.filter((entry): entry is ViewerImage => entry !== null);
         if (cancelled) {
            resolved.forEach((entry) => URL.revokeObjectURL(entry.url));
            return;
         }
         urls.current.forEach((url) => URL.revokeObjectURL(url));
         urls.current = resolved.map((entry) => entry.url);
         setImages(resolved);
      });
      return () => {
         cancelled = true;
      };
   }, [attachments]);

   useEffect(
      () => () => {
         urls.current.forEach((url) => URL.revokeObjectURL(url));
         urls.current = [];
      },
      []
   );

   const upload = useCallback(
      async (files: FileList | File[] | null) => {
         const list = files ? Array.from(files) : [];
         if (list.length === 0) return;
         try {
            for (const file of list) {
               const saved = await uploadIssueAttachment(issueRef, file);
               setAttachments((current) => [
                  saved,
                  ...current.filter((entry) => entry.id !== saved.id),
               ]);
            }
         } catch (cause) {
            toast.error(cause instanceof Error ? cause.message : t('uploadFailed'));
         }
      },
      [issueRef, t]
   );

   return (
      <div>
         <div
            onDragOver={(event) => {
               event.preventDefault();
               setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
               event.preventDefault();
               setDragging(false);
               void upload(event.dataTransfer.files);
            }}
            className={cn(
               'rounded-sm border border-transparent transition-colors',
               dragging && 'border-dashed border-status-info bg-status-info/5'
            )}
         >
            <TiptapAiEditor
               value={description}
               onChange={() => undefined}
               onBlur={(markdown) => {
                  if (markdown.trim() === description.trim()) return;
                  updateIssueDescription(issueId, markdown);
               }}
               placeholder={dragging ? t('dropHere') : 'Add description…'}
               aria-label="Task description"
               className="min-h-24"
               aiAssist={false}
            />
         </div>

         {images.length > 0 ? (
            <ul className="mt-2 flex flex-wrap gap-2">
               {images.map((image, index) => (
                  <li key={image.id}>
                     <button
                        type="button"
                        onClick={() => setViewerAt(index)}
                        className="flex items-center gap-1.5 rounded-sm border border-border/60 px-2 py-1 hover:bg-accent"
                     >
                        <ImageIcon className="size-3.5 shrink-0 text-muted-foreground" />
                        <span className="max-w-[160px] truncate">{image.name}</span>
                     </button>
                  </li>
               ))}
            </ul>
         ) : null}

         <ImageViewer
            images={images}
            startAt={viewerAt ?? 0}
            open={viewerAt !== null}
            onOpenChange={(open) => (open ? undefined : setViewerAt(null))}
         />
      </div>
   );
}
