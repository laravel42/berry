'use client';

import {
   attachmentObjectUrl,
   isImageAttachment,
   loadIssueAttachments,
   onCommentFilesRemoved,
   onIssueAttachment,
   uploadIssueAttachment,
   type ApiAttachment,
} from '@/lib/attachments';
import { keepPluginMentions, stripPluginMentions } from '@/lib/plugins';
import { cn } from '@/lib/utils';
import { useIssuesStore } from '@/store/issues-store';
import { CollapsibleDescription } from '@/components/common/editor/collapsible-description';
import { TiptapAiEditor } from '@/components/common/editor/tiptap-ai-editor-lazy';
import { ChatMarkdown } from '@/components/common/chat/chat-markdown';
import { Button } from '@/components/ui/button';
import { Check, Copy, ImageIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
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
 * on blur so keystrokes do not PATCH the issue. Until someone focuses or
 * clicks the text it is drawn read-only: the editor is ~560 KB of script that
 * most visits to a task never need.
 */
export function IssueDescription({
   issueId,
   issueRef,
   description,
   mobileLeadingActions,
   mobileTrailingActions,
}: {
   issueId: string;
   issueRef: string;
   description: string;
   /** Optional mobile-only (< md) controls placed left of the copy button. */
   mobileLeadingActions?: ReactNode;
   /** Optional mobile-only (< md) controls placed right of the copy button. */
   mobileTrailingActions?: ReactNode;
}) {
   const t = useTranslations('issueDetail.description');
   const updateIssueDescription = useIssuesStore((state) => state.updateIssueDescription);
   const [attachments, setAttachments] = useState<ApiAttachment[]>([]);
   const [images, setImages] = useState<ViewerImage[]>([]);
   const [dragging, setDragging] = useState(false);
   const [viewerAt, setViewerAt] = useState<number | null>(null);
   const [copied, setCopied] = useState(false);
   const [editing, setEditing] = useState(false);
   const [draft, setDraft] = useState<string | null>(null);
   const surface = useRef<HTMLDivElement>(null);

   // Reset local edit state when navigating to another task in the drawer.
   useEffect(() => {
      setEditing(false);
      setDraft(null);
   }, [issueId]);

   // Clear live draft once the persisted description catches up.
   useEffect(() => {
      setDraft(null);
   }, [description]);

   // The editor arrives a moment after the click that asked for it; once its
   // text field exists, put the caret there so the click was not wasted.
   useEffect(() => {
      if (!editing) return;
      let frame = 0;
      const startedAt = performance.now();
      const focusWhenReady = () => {
         const field = surface.current?.querySelector<HTMLElement>(
            '.ProseMirror[contenteditable="true"]'
         );
         if (field) {
            field.focus();
            return;
         }
         if (performance.now() - startedAt < 5000) frame = requestAnimationFrame(focusWhenReady);
      };
      frame = requestAnimationFrame(focusWhenReady);
      return () => cancelAnimationFrame(frame);
   }, [editing]);

   // What a person reads: the live draft while editing, or the saved text
   // without the plugin links the editor hides.
   const savedReadable = stripPluginMentions(description).trim();
   const readable = stripPluginMentions(draft ?? description).trim();

   const copyDescription = () => {
      if (!readable) {
         toast.message(t('nothingToCopy'));
         return;
      }
      const markCopied = () => {
         setCopied(true);
         window.setTimeout(() => setCopied(false), 1200);
      };
      const copyFallback = () => {
         const area = document.createElement('textarea');
         area.value = readable;
         area.setAttribute('readonly', '');
         area.style.position = 'fixed';
         area.style.opacity = '0';
         document.body.appendChild(area);
         area.select();
         const ok = document.execCommand('copy');
         document.body.removeChild(area);
         if (ok) markCopied();
         else toast.error(t('copyFailed'));
      };
      if (navigator.clipboard?.writeText) {
         void navigator.clipboard.writeText(readable).then(markCopied, copyFallback);
         return;
      }
      copyFallback();
   };
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

   useEffect(() => {
      return onIssueAttachment((ref, attachment) => {
         if (ref !== issueRef) return;
         setAttachments((current) => [
            attachment,
            ...current.filter((entry) => entry.id !== attachment.id),
         ]);
      });
   }, [issueRef]);

   useEffect(() => {
      return onCommentFilesRemoved((commentIds, attachmentIds) => {
         const goneComments = new Set(commentIds);
         const goneFiles = new Set(attachmentIds);
         setAttachments((current) =>
            current.filter(
               (entry) =>
                  !goneFiles.has(entry.id) &&
                  (!entry.commentId || !goneComments.has(entry.commentId))
            )
         );
      });
   }, []);

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
               await uploadIssueAttachment(issueRef, file);
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
            data-detail-description
            className={cn(
               'rounded-sm border border-transparent transition-colors',
               dragging && 'border-dashed border-status-info bg-status-info/5'
            )}
         >
            <CollapsibleDescription>
               <div ref={surface}>
                  {editing ? (
                     <TiptapAiEditor
                        value={stripPluginMentions(description)}
                        onChange={(markdown) => setDraft(markdown)}
                        onBlur={(markdown) => {
                           const next = keepPluginMentions(markdown, description);
                           if (next.trim() === description.trim()) return;
                           updateIssueDescription(issueId, next);
                        }}
                        placeholder={dragging ? t('dropHere') : 'Add description…'}
                        aria-label="Task description"
                        className="min-h-24 [&_.ProseMirror]:min-h-0 [&_.ProseMirror]:!font-thin [&_.ProseMirror_*]:!font-thin [&_.ProseMirror_strong]:!font-bold [&_.ProseMirror_b]:!font-bold [&_.ProseMirror_strong_*]:!font-bold [&_.ProseMirror_b_*]:!font-bold [&_.ProseMirror>:last-child]:!mb-0"
                        aiAssist={false}
                        formatting
                     />
                  ) : (
                     <div
                        role="textbox"
                        aria-readonly="true"
                        aria-label="Task description"
                        tabIndex={0}
                        onFocus={() => setEditing(true)}
                        onClick={(event) => {
                           if (!(event.target as HTMLElement).closest('a')) setEditing(true);
                        }}
                        className="tiptap-ai-editor formatting-editor min-h-24 cursor-text"
                     >
                        <div className="ProseMirror min-h-0 !font-thin [&_*]:!font-thin [&_strong]:!font-bold [&_b]:!font-bold [&_strong_*]:!font-bold [&_b_*]:!font-bold [&>:last-child]:!mb-0">
                           {savedReadable ? (
                              <ChatMarkdown body={stripPluginMentions(description)} tone="page" />
                           ) : (
                              <p className="text-muted-foreground">
                                 {dragging ? t('dropHere') : 'Add description…'}
                              </p>
                           )}
                        </div>
                     </div>
                  )}
               </div>
            </CollapsibleDescription>
         </div>
         <div
            data-description-actions
            className={cn(
               mobileLeadingActions || mobileTrailingActions
                  ? 'mt-2 flex min-h-11 items-center justify-between gap-2 border-b border-border/60 pb-2 md:-mt-0.5 md:min-h-0 md:justify-end md:border-b-0 md:pb-0'
                  : '-mt-0.5 flex justify-end'
            )}
         >
            {mobileLeadingActions ? (
               <div className="flex items-center gap-1 md:hidden">{mobileLeadingActions}</div>
            ) : null}
            <div
               className={cn(
                  'flex items-center',
                  (mobileLeadingActions || mobileTrailingActions) &&
                     '-mr-1.5 gap-1 md:mr-0 md:gap-0'
               )}
            >
               <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className={cn(
                     'text-muted-foreground hover:text-foreground',
                     mobileLeadingActions || mobileTrailingActions
                        ? 'size-9 md:size-6 md:hover:bg-card'
                        : 'size-6 hover:bg-card'
                  )}
                  aria-label={t('copy')}
                  title={t('copy')}
                  disabled={!readable}
                  onClick={copyDescription}
               >
                  {copied ? (
                     <Check
                        className={cn(
                           mobileLeadingActions || mobileTrailingActions
                              ? 'size-[18px] md:size-3.5'
                              : 'size-3.5'
                        )}
                        aria-hidden
                     />
                  ) : (
                     <Copy
                        className={cn(
                           mobileLeadingActions || mobileTrailingActions
                              ? 'size-[18px] md:size-3.5'
                              : 'size-3.5'
                        )}
                        aria-hidden
                     />
                  )}
               </Button>
               {mobileTrailingActions ? (
                  <div className="flex items-center md:hidden">{mobileTrailingActions}</div>
               ) : null}
            </div>
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
