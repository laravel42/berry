'use client';

import { redo, undo } from '@codemirror/commands';
import { SegmentedControl } from '@/components/common/segmented-control';
import { CodeEditor, languageForPath, type EditorView } from '@/components/ui/code-editor';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import {
   PREVIEW_SIZE_LIMIT,
   artifactObjectUrl,
   artifactPreviewBase,
   artifactPreviewUrl,
   artifactText,
   artifactView,
   formatFileSize,
   type RunArtifact,
} from '@/lib/attachments';
import { formatCombo, isApplePlatform } from '@/lib/shortcuts';
import { cn } from '@/lib/utils';
import {
   ChevronLeft,
   ChevronRight,
   ExternalLink,
   Redo2,
   RotateCw,
   Save,
   Undo2,
   X,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { SiteBuildFrame } from './site-build-frame';
import { FileKindMark } from './file-kind-mark';

interface ArtifactViewerProps {
   issueRef: string;
   /** The files the arrows move through, in the order the tree shows them. */
   artifacts: RunArtifact[];
   /** The file on screen; null closes the viewer (dialog) or shows the empty pane. */
   index: number | null;
   onIndexChange: (index: number | null) => void;
   /**
    * `dialog` opens over the page (task page, default). `pane` fills its parent
    * — the split layout beside the file tree.
    */
   layout?: 'dialog' | 'pane';
   className?: string;
}

type Mode = 'rendered' | 'source';

/**
 * What an agent produced, opened as what it is rather than downloaded.
 *
 * A markdown document reads formatted; an image, video, audio clip or PDF gets
 * the player its type needs; code gets the code view; and a page runs as a
 * page, in a webview, beside the stylesheet and scripts it links to — served
 * under a short-lived preview base (`artifactPreviewBase`) so its relative
 * paths resolve. Documents and pages can flip to their source.
 *
 * The page runs sandboxed twice over: the iframe's `sandbox` attribute and the
 * server's CSP both withhold same-origin access, so an agent's script cannot
 * reach Berry's session, storage or pages.
 */
export function ArtifactViewer({
   issueRef,
   artifacts,
   index,
   onIndexChange,
   layout = 'dialog',
   className,
}: ArtifactViewerProps) {
   const t = useTranslations('issueDetail.artifactViewer');
   const artifact = index === null ? undefined : artifacts[index];
   const view = artifact ? artifactView(artifact) : null;
   const [mode, setMode] = useState<Mode>('rendered');
   const [text, setText] = useState<string | null>(null);
   /** Last loaded or saved bytes — compared to `text` for the Save control. */
   const [savedText, setSavedText] = useState<string | null>(null);
   const [objectUrl, setObjectUrl] = useState<string | null>(null);
   const [base, setBase] = useState<string | null>(null);
   const [failed, setFailed] = useState(false);
   const [reload, setReload] = useState(0);
   /** Set when the page loads source a browser cannot run (TypeScript, JSX). */
   const [unbuilt, setUnbuilt] = useState(false);
   const [cursor, setCursor] = useState({ line: 1, column: 1 });
   const editorViewRef = useRef<EditorView | null>(null);
   const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });
   // Same on the server and the first client paint; Mac glyphs land after hydrate.
   const [undoKeys, setUndoKeys] = useState(() => formatCombo('mod+z', false));
   const [redoKeys, setRedoKeys] = useState(() => formatCombo('mod+y', false));
   const [saveKeys, setSaveKeys] = useState(() => formatCombo('mod+s', false));

   const kind = view?.kind ?? 'unsupported';
   const showsSource = mode === 'source' && (kind === 'markdown' || kind === 'html');
   const needsText = kind === 'markdown' || kind === 'code' || showsSource;
   /** CodeMirror is on screen — undo / redo apply here, not in rendered markdown. */
   const editing = kind === 'code' || showsSource;
   const needsBlob = kind === 'image' || kind === 'video' || kind === 'audio' || kind === 'pdf';
   const tooLarge = Boolean(
      artifact && artifact.sizeBytes > PREVIEW_SIZE_LIMIT && (needsText || needsBlob)
   );
   const language = artifact
      ? kind === 'markdown'
         ? 'plain'
         : languageForPath(artifact.path)
      : 'plain';

   useEffect(() => {
      setUndoKeys(formatCombo('mod+z'));
      setRedoKeys(formatCombo(isApplePlatform() ? 'mod+shift+z' : 'mod+y'));
      setSaveKeys(formatCombo('mod+s'));
   }, []);

   // A new file opens rendered.
   useEffect(() => {
      setMode('rendered');
      setCursor({ line: 1, column: 1 });
      setHistoryState({ canUndo: false, canRedo: false });
      editorViewRef.current = null;
   }, [artifact?.id]);

   // A base lives an hour; the next opening asks for a fresh one.
   useEffect(() => {
      if (index === null) setBase(null);
   }, [index]);

   // One preview base per opening: every page of the site loads under it.
   useEffect(() => {
      if (index === null || kind !== 'html' || base) return;
      let cancelled = false;
      artifactPreviewBase(issueRef)
         .then((value) => !cancelled && setBase(value))
         .catch(() => !cancelled && setFailed(true));
      return () => {
         cancelled = true;
      };
   }, [index, kind, base, issueRef]);

   // A page that loads `/src/main.tsx` is a build tool's source, not a site:
   // it renders blank in any browser until it is built. Said, rather than
   // leaving a white frame that looks like a broken preview.
   useEffect(() => {
      setUnbuilt(false);
      if (!artifact || kind !== 'html') return;
      let cancelled = false;
      artifactText(artifact)
         .then((page) => !cancelled && setUnbuilt(NEEDS_BUILD.test(page)))
         .catch(() => undefined);
      return () => {
         cancelled = true;
      };
   }, [artifact, kind]);

   // The bytes for the file on screen, and only that one. An object URL is a
   // copy of the file held in memory, so it is revoked when replaced.
   useEffect(() => {
      setFailed(false);
      setText(null);
      setSavedText(null);
      setObjectUrl(null);
      if (!artifact || tooLarge || (!needsText && !needsBlob)) return;
      let cancelled = false;
      let created: string | null = null;
      const load = async () => {
         try {
            if (needsText) {
               const body = await artifactText(artifact);
               if (!cancelled) {
                  setText(body);
                  setSavedText(body);
               }
            } else {
               created = await artifactObjectUrl(artifact);
               if (cancelled) URL.revokeObjectURL(created);
               else setObjectUrl(created);
            }
         } catch {
            if (!cancelled) setFailed(true);
         }
      };
      void load();
      return () => {
         cancelled = true;
         if (created) URL.revokeObjectURL(created);
      };
   }, [artifact, needsText, needsBlob, tooLarge]);

   const dirty = text !== null && savedText !== null && text !== savedText;

   const save = useCallback(() => {
      if (!artifact || text === null || !dirty) return;
      const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = artifact.name;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setSavedText(text);
   }, [artifact, text, dirty]);

   const runUndo = useCallback(() => {
      const view = editorViewRef.current;
      if (view) undo(view);
   }, []);

   const runRedo = useCallback(() => {
      const view = editorViewRef.current;
      if (view) redo(view);
   }, []);

   const move = useCallback(
      (step: number) => {
         if (index === null || artifacts.length === 0) return;
         onIndexChange((index + step + artifacts.length) % artifacts.length);
      },
      [index, artifacts.length, onIndexChange]
   );

   useEffect(() => {
      if (index === null) return;
      const onKeyDown = (event: KeyboardEvent) => {
         // Keep CodeMirror (and any other text field) on its own keys so
         // multi-line selection and caret motion are not stolen by file nav.
         const target = event.target as HTMLElement | null;
         if (
            event.isComposing ||
            target?.closest('input, textarea, [contenteditable="true"], .cm-editor')
         ) {
            return;
         }
         if (event.key === 'ArrowLeft') move(-1);
         if (event.key === 'ArrowRight') move(1);
         // Save downloads the buffer; CodeMirror already owns undo / redo chords.
         if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's' && needsText) {
            event.preventDefault();
            save();
         }
      };
      window.addEventListener('keydown', onKeyDown);
      return () => window.removeEventListener('keydown', onKeyDown);
   }, [index, move, needsText, save]);

   if (layout === 'pane' && (index === null || !artifact || !view)) {
      return (
         <div
            className={cn(
               'flex size-full items-center justify-center bg-muted/20 text-muted-foreground',
               className
            )}
         >
            <p>{t('pickFile')}</p>
         </div>
      );
   }

   if (index === null || !artifact || !view) return null;

   const pageUrl = base ? artifactPreviewUrl(base, artifact.path) : null;

   const body = (): ReactNode => {
      if (kind === 'unsupported') return <Message text={t('unsupported')} />;
      if (tooLarge)
         return <Message text={t('tooLarge', { size: formatFileSize(artifact.sizeBytes) })} />;
      if (failed) return <Message text={t('loadFailed')} />;

      if (kind === 'html' && !showsSource) {
         // A build tool's source page is built in a container and the built
         // site shown instead; a plain page shows as it is.
         return (
            <SiteBuildFrame
               issueRef={issueRef}
               pageUrl={pageUrl}
               base={base}
               unbuilt={unbuilt}
               reload={reload}
               title={t('webview', { path: artifact.path })}
            />
         );
      }
      if (needsText) {
         if (text === null) return <Message text={t('loading')} />;
         if (kind === 'markdown' && !showsSource) {
            return (
               <div className="size-full overflow-auto">
                  <article className={MARKDOWN}>
                     <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
                  </article>
               </div>
            );
         }
         return (
            <CodeEditor
               value={text}
               language={language}
               className="size-full min-h-0"
               readOnly={false}
               onChange={setText}
               onCursorChange={setCursor}
               viewRef={editorViewRef}
               onHistoryChange={setHistoryState}
            />
         );
      }
      if (!objectUrl) return <Message text={t('loading')} />;
      if (kind === 'image') {
         return (
            <div className="absolute inset-0 flex items-center justify-center py-5">
               {/* eslint-disable-next-line @next/next/no-img-element */}
               <img
                  src={objectUrl}
                  alt={artifact.path}
                  className="max-h-full max-w-[80%] object-contain"
               />
            </div>
         );
      }
      if (kind === 'video') {
         return <video src={objectUrl} controls className="max-h-full max-w-full" />;
      }
      if (kind === 'audio') return <audio src={objectUrl} controls className="w-full max-w-lg" />;
      return <iframe src={objectUrl} title={artifact.path} className="size-full border-0" />;
   };

   const chrome = (
      <>
         <div className="flex items-center gap-2 border-b px-3 py-1">
            <nav
               aria-label={artifact.path}
               title={artifact.path}
               className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden font-mono text-muted-foreground"
               style={{ fontSize: '12px', lineHeight: '16px' }}
            >
               {artifact.path
                  .split('/')
                  .filter(Boolean)
                  .map((segment, index, segments) => {
                     const last = index === segments.length - 1;
                     return (
                        <span
                           key={`${index}-${segment}`}
                           className="inline-flex min-w-0 items-center gap-1"
                        >
                           {index > 0 ? (
                              <ChevronRight className="size-3 shrink-0 opacity-50" aria-hidden />
                           ) : null}
                           {last ? (
                              <>
                                 <FileKindMark name={segment} />
                                 <span className="truncate text-foreground">{segment}</span>
                              </>
                           ) : (
                              <span className="shrink-0">{segment}</span>
                           )}
                        </span>
                     );
                  })}
            </nav>
            <div className="flex shrink-0 items-center gap-0.5">
               {kind === 'markdown' || kind === 'html' ? (
                  <SegmentedControl
                     aria-label={t('modeLabel')}
                     options={[
                        { value: 'rendered', label: kind === 'html' ? t('page') : t('document') },
                        { value: 'source', label: t('source') },
                     ]}
                     value={mode}
                     onValueChange={setMode}
                  />
               ) : null}
               {kind === 'html' && !showsSource ? (
                  <ToolbarButton
                     label={t('reload')}
                     onClick={() => setReload((value) => value + 1)}
                  >
                     <RotateCw className="size-4" />
                  </ToolbarButton>
               ) : null}
               {kind === 'html' && pageUrl ? (
                  <a
                     href={pageUrl}
                     target="_blank"
                     rel="noreferrer noopener"
                     aria-label={t('openInNewTab')}
                     title={t('openInNewTab')}
                     className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                     <ExternalLink className="size-4" />
                  </a>
               ) : null}
               {needsText ? (
                  <>
                     {editing ? (
                        <>
                           <ToolbarButton
                              label={`${t('undo')} (${undoKeys})`}
                              onClick={runUndo}
                              disabled={!historyState.canUndo}
                           >
                              <Undo2 className="size-4" />
                           </ToolbarButton>
                           <ToolbarButton
                              label={`${t('redo')} (${redoKeys})`}
                              onClick={runRedo}
                              disabled={!historyState.canRedo}
                           >
                              <Redo2 className="size-4" />
                           </ToolbarButton>
                        </>
                     ) : null}
                     <ToolbarButton
                        label={`${t('save')} (${saveKeys})`}
                        onClick={save}
                        disabled={!dirty}
                     >
                        <Save className="size-4" />
                     </ToolbarButton>
                  </>
               ) : null}
               {layout === 'dialog' ? (
                  <ToolbarButton label={t('close')} onClick={() => onIndexChange(null)}>
                     <X className="size-4" />
                  </ToolbarButton>
               ) : null}
            </div>
         </div>

         <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-[var(--brand-void)]">
            {layout === 'dialog' && artifacts.length > 1 ? (
               <ToolbarButton
                  label={t('previous')}
                  onClick={() => move(-1)}
                  className="absolute left-2 top-1/2 z-10 -translate-y-1/2 bg-background/80"
               >
                  <ChevronLeft className="size-5" />
               </ToolbarButton>
            ) : null}
            <div className="relative min-h-0 flex-1 overflow-hidden">{body()}</div>
            {layout === 'dialog' && artifacts.length > 1 ? (
               <ToolbarButton
                  label={t('next')}
                  onClick={() => move(1)}
                  className="absolute right-2 top-1/2 z-10 -translate-y-1/2 bg-background/80"
               >
                  <ChevronRight className="size-5" />
               </ToolbarButton>
            ) : null}
         </div>

         <div
            className="flex h-6 shrink-0 items-center gap-x-2 border-t px-3 text-muted-foreground"
            style={{ fontSize: '11.5px', lineHeight: '16px' }}
         >
            <span className="shrink-0">
               {t('footerLineCol', { line: cursor.line, column: cursor.column })}
            </span>
            <span aria-hidden>·</span>
            <span className="shrink-0">{t('footerCharset')}</span>
            <span aria-hidden>·</span>
            <span className="inline-flex min-w-0 items-center gap-1 truncate">
               <FileKindMark name={artifact.name} />
               <span className="truncate">{languageLabel(language)}</span>
            </span>
            <span aria-hidden>·</span>
            <span className="shrink-0">
               {formatFileSize(
                  dirty && text !== null
                     ? new TextEncoder().encode(text).length
                     : artifact.sizeBytes
               )}
            </span>
            <span className="ml-auto inline-flex shrink-0 items-center gap-1.5">
               <span
                  className="size-2 shrink-0 rounded-full"
                  style={{
                     backgroundColor: dirty ? 'var(--status-danger)' : 'var(--status-success)',
                  }}
                  aria-hidden
               />
               {dirty ? t('footerModified') : t('footerSaved')}
            </span>
         </div>
      </>
   );

   if (layout === 'pane') {
      return (
         <div
            role="region"
            aria-label={t('title', { path: artifact.path })}
            className={cn('flex size-full min-h-0 flex-col overflow-hidden', className)}
         >
            {chrome}
         </div>
      );
   }

   return (
      <Dialog open onOpenChange={(open) => !open && onIndexChange(null)}>
         <DialogContent
            showCloseButton={false}
            className="flex h-[88vh] w-[94vw] max-w-7xl flex-col gap-0 overflow-hidden p-0 sm:max-w-7xl"
         >
            <DialogTitle className="sr-only">{t('title', { path: artifact.path })}</DialogTitle>
            <DialogDescription className="sr-only">{artifact.path}</DialogDescription>
            {chrome}
         </DialogContent>
      </Dialog>
   );
}

/** A module script a browser cannot run as it is: TypeScript, JSX or a framework's single-file component. */
const NEEDS_BUILD = /<script[^>]*\bsrc\s*=\s*["'][^"']+\.(?:tsx?|jsx|vue|svelte)["']/i;

/**
 * Document styling for rendered markdown, by element. Heading sizes come from
 * the base layer (h1–h4), as everywhere in the app.
 */
const MARKDOWN = [
   'mx-auto flex max-w-3xl flex-col gap-3 px-8 py-6 leading-6',
   '[&_h1]:mt-4 [&_h1]:font-display [&_h2]:mt-4 [&_h2]:font-medium [&_h3]:mt-3 [&_h3]:font-medium [&_h4]:font-medium',
   '[&_a]:text-status-info [&_a]:underline',
   '[&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_li]:my-0.5',
   '[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground',
   '[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:font-mono',
   '[&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_pre_code]:bg-transparent [&_pre_code]:p-0',
   '[&_table]:w-full [&_table]:border-collapse [&_th]:border [&_th]:border-border [&_th]:px-2 [&_th]:py-1 [&_th]:text-left [&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1',
   '[&_hr]:border-border [&_img]:max-w-full',
].join(' ');

function Message({ text }: { text: string }) {
   return (
      <div className="flex size-full items-center justify-center bg-muted/30">
         <p className="max-w-sm px-6 text-center text-muted-foreground">{text}</p>
      </div>
   );
}

function languageLabel(language: ReturnType<typeof languageForPath>): string {
   switch (language) {
      case 'bash':
         return 'Shell';
      case 'javascript':
         return 'JavaScript';
      case 'typescript':
         return 'TypeScript';
      case 'json':
         return 'JSON';
      case 'css':
         return 'CSS';
      case 'html':
         return 'HTML';
      case 'xml':
         return 'XML';
      case 'yaml':
         return 'YAML';
      case 'python':
         return 'Python';
      case 'sql':
         return 'SQL';
      case 'markdown':
         return 'Markdown';
      case 'plain':
         return 'Plain text';
   }
}

function ToolbarButton({
   label,
   onClick,
   className,
   children,
   disabled = false,
}: {
   label: string;
   onClick: () => void;
   className?: string;
   children: ReactNode;
   disabled?: boolean;
}) {
   return (
      <button
         type="button"
         onClick={onClick}
         disabled={disabled}
         aria-label={label}
         title={label}
         className={[
            'inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground',
            'transition-colors hover:bg-accent hover:text-foreground',
            'disabled:pointer-events-none disabled:opacity-40',
            className ?? '',
         ].join(' ')}
      >
         {children}
      </button>
   );
}
