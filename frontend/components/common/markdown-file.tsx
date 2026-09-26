'use client';

import { Check, ChevronRight, Copy, Download, FileText } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { AgentMarkdown } from '@/components/common/agent-markdown';
import { SegmentedControl } from '@/components/common/segmented-control';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

type FileView = 'preview' | 'raw';

interface MarkdownFileProps {
   /** The name shown in the header and given to a download, e.g. `frontend-engineer.md`. */
   fileName: string;
   markdown: string;
   /** Names the file for assistive technology. */
   label: string;
   /** A marker beside the name, such as where the text came from. */
   badge?: React.ReactNode;
   /** Controls after Copy and Download. */
   action?: React.ReactNode;
   /** Makes the raw view an editor; absent, the raw text is read-only. */
   onEdit?: (text: string) => void;
   /** Holds the editor while a save is in flight. */
   busy?: boolean;
   /** Problems with the text, already worded, listed under it. */
   errors?: string[];
   /** Prefix for the parts' test ids: `<prefix>-file`, `-preview`, `-raw`, `-errors`. */
   testId: string;
   /** Fold the file to its header, closed at first; the header opens it. */
   collapsible?: boolean;
}

/**
 * Markdown shown as a file: previewed by default, or its raw text, which can
 * be copied or downloaded under the file's name. Given `onEdit`, the raw text
 * is the editor. `collapsible` folds it to its header until opened.
 */
export function MarkdownFile({
   fileName,
   markdown,
   label,
   badge,
   action,
   onEdit,
   busy = false,
   errors = [],
   testId,
   collapsible = false,
}: MarkdownFileProps) {
   const t = useTranslations('common.markdownFile');
   const [view, setView] = useState<FileView>('preview');
   const [copied, setCopied] = useState(false);
   const [open, setOpen] = useState(!collapsible);
   const bodyId = `${testId}-body`;
   const errorsId = `${testId}-errors`;

   useEffect(() => {
      if (!copied) return;
      const timer = window.setTimeout(() => setCopied(false), 1500);
      return () => window.clearTimeout(timer);
   }, [copied]);

   const copy = () => {
      void navigator.clipboard.writeText(markdown).then(
         () => setCopied(true),
         () => toast.error(t('copyFailed'))
      );
   };

   const download = () => {
      const url = URL.createObjectURL(
         new Blob([markdown], { type: 'text/markdown;charset=utf-8' })
      );
      try {
         const anchor = document.createElement('a');
         anchor.href = url;
         anchor.download = fileName;
         document.body.appendChild(anchor);
         anchor.click();
         anchor.remove();
      } finally {
         // Revoked on the next tick: revoking synchronously can cancel the download.
         setTimeout(() => URL.revokeObjectURL(url), 0);
      }
   };

   const body = () => {
      if (view === 'preview') {
         return (
            <div data-testid={`${testId}-preview`} className="min-w-0 p-4">
               <AgentMarkdown body={markdown} className="max-w-none" />
            </div>
         );
      }
      if (onEdit) {
         return (
            <Textarea
               data-testid={`${testId}-raw`}
               aria-label={fileName}
               aria-invalid={errors.length > 0 || undefined}
               aria-describedby={errors.length > 0 ? errorsId : undefined}
               spellCheck={false}
               readOnly={busy}
               value={markdown}
               onChange={(event) => onEdit(event.target.value)}
               className="min-h-96 rounded-none border-0 bg-transparent p-4 font-mono shadow-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
         );
      }
      return (
         <pre
            data-testid={`${testId}-raw`}
            className="min-w-0 p-4 font-mono break-words whitespace-pre-wrap"
         >
            {markdown}
         </pre>
      );
   };

   return (
      <section
         aria-label={label}
         data-testid={`${testId}-file`}
         className="flex min-w-0 flex-col rounded-lg border bg-container"
      >
         <div className={cn('flex flex-wrap items-center gap-2 px-3 py-2', open && 'border-b')}>
            {collapsible ? (
               <Button
                  size="xs"
                  variant="ghost"
                  aria-expanded={open}
                  aria-controls={bodyId}
                  aria-label={fileName}
                  onClick={() => setOpen((value) => !value)}
               >
                  <ChevronRight
                     aria-hidden
                     className={cn('size-4 transition-transform', open && 'rotate-90')}
                  />
               </Button>
            ) : null}
            <FileText aria-hidden className="size-4 shrink-0 text-muted-foreground" />
            <h3 className="min-w-0 truncate font-mono font-medium">{fileName}</h3>
            {badge}
            <div className="ml-auto flex flex-wrap items-center gap-2">
               {open ? (
                  <SegmentedControl
                     aria-label={t('view')}
                     value={view}
                     onValueChange={setView}
                     options={[
                        { value: 'preview', label: t('preview') },
                        { value: 'raw', label: t('raw') },
                     ]}
                  />
               ) : null}
               <Button size="xs" variant="ghost" onClick={copy}>
                  {copied ? <Check aria-hidden /> : <Copy aria-hidden />}
                  {copied ? t('copied') : t('copy')}
               </Button>
               <Button size="xs" variant="ghost" onClick={download}>
                  <Download aria-hidden />
                  {t('download')}
               </Button>
               {action}
            </div>
         </div>
         <div id={bodyId} hidden={!open}>
            {body()}
         </div>
         {errors.length > 0 ? (
            <ul
               id={errorsId}
               data-testid={errorsId}
               className={cn('flex flex-col gap-1 border-t px-4 py-3 text-status-danger')}
            >
               {errors.map((error, index) => (
                  <li key={index}>{error}</li>
               ))}
            </ul>
         ) : null}
      </section>
   );
}
