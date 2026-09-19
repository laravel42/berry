'use client';

import { SegmentedControl } from '@/components/common/segmented-control';
import { CodeEditor, languageForPath } from '@/components/ui/code-editor';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import {
   PREVIEW_SIZE_LIMIT,
   artifactObjectUrl,
   artifactPreviewBase,
   artifactPreviewUrl,
   artifactText,
   artifactView,
   downloadArtifact,
   formatFileSize,
   type RunArtifact,
} from '@/lib/attachments';
import { ChevronLeft, ChevronRight, Download, ExternalLink, RotateCw, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { SiteBuildFrame } from './site-build-frame';

interface ArtifactViewerProps {
   issueRef: string;
   /** The files the arrows move through, in the order the tree shows them. */
   artifacts: RunArtifact[];
   /** The file on screen; null closes the viewer. */
   index: number | null;
   onIndexChange: (index: number | null) => void;
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
export function ArtifactViewer({ issueRef, artifacts, index, onIndexChange }: ArtifactViewerProps) {
   const t = useTranslations('issueDetail.artifactViewer');
   const artifact = index === null ? undefined : artifacts[index];
   const view = artifact ? artifactView(artifact) : null;
   const [mode, setMode] = useState<Mode>('rendered');
   const [text, setText] = useState<string | null>(null);
   const [objectUrl, setObjectUrl] = useState<string | null>(null);
   const [base, setBase] = useState<string | null>(null);
   const [failed, setFailed] = useState(false);
   const [reload, setReload] = useState(0);
   /** Set when the page loads source a browser cannot run (TypeScript, JSX). */
   const [unbuilt, setUnbuilt] = useState(false);

   const kind = view?.kind ?? 'unsupported';
   const showsSource = mode === 'source' && (kind === 'markdown' || kind === 'html');
   const needsText = kind === 'markdown' || kind === 'code' || showsSource;
   const needsBlob = kind === 'image' || kind === 'video' || kind === 'audio' || kind === 'pdf';
   const tooLarge = Boolean(
      artifact && artifact.sizeBytes > PREVIEW_SIZE_LIMIT && (needsText || needsBlob)
   );

   // A new file opens rendered.
   useEffect(() => setMode('rendered'), [artifact?.id]);

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
      setObjectUrl(null);
      if (!artifact || tooLarge || (!needsText && !needsBlob)) return;
      let cancelled = false;
      let created: string | null = null;
      const load = async () => {
         try {
            if (needsText) {
               const body = await artifactText(artifact);
               if (!cancelled) setText(body);
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
         // A page in the webview keeps its own keys; these only apply outside it.
         if (event.isComposing || (event.target as HTMLElement | null)?.closest('input, textarea'))
            return;
         if (event.key === 'ArrowLeft') move(-1);
         if (event.key === 'ArrowRight') move(1);
      };
      window.addEventListener('keydown', onKeyDown);
      return () => window.removeEventListener('keydown', onKeyDown);
   }, [index, move]);

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
               language={kind === 'markdown' ? 'plain' : languageForPath(artifact.path)}
               className="size-full overflow-auto"
            />
         );
      }
      if (!objectUrl) return <Message text={t('loading')} />;
      if (kind === 'image') {
         return (
            // eslint-disable-next-line @next/next/no-img-element
            <img
               src={objectUrl}
               alt={artifact.path}
               className="max-h-full max-w-full object-contain"
            />
         );
      }
      if (kind === 'video') {
         return <video src={objectUrl} controls className="max-h-full max-w-full" />;
      }
      if (kind === 'audio') return <audio src={objectUrl} controls className="w-full max-w-lg" />;
      return <iframe src={objectUrl} title={artifact.path} className="size-full border-0" />;
   };

   return (
      <Dialog open onOpenChange={(open) => !open && onIndexChange(null)}>
         <DialogContent
            showCloseButton={false}
            className="flex h-[88vh] w-[94vw] max-w-7xl flex-col gap-0 overflow-hidden p-0 sm:max-w-7xl"
         >
            <DialogTitle className="sr-only">{t('title', { path: artifact.path })}</DialogTitle>
            <DialogDescription className="sr-only">{artifact.path}</DialogDescription>

            <div className="flex items-center gap-2 border-b px-3 py-2">
               <span className="min-w-0 flex-1 truncate font-mono" title={artifact.path}>
                  {artifact.path}
               </span>
               <span className="shrink-0 text-muted-foreground">
                  {formatFileSize(artifact.sizeBytes)} · {artifact.agentName}
               </span>
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
               <ToolbarButton label={t('download')} onClick={() => void downloadArtifact(artifact)}>
                  <Download className="size-4" />
               </ToolbarButton>
               <ToolbarButton label={t('close')} onClick={() => onIndexChange(null)}>
                  <X className="size-4" />
               </ToolbarButton>
            </div>

            <div className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden bg-muted/30">
               {artifacts.length > 1 ? (
                  <ToolbarButton
                     label={t('previous')}
                     onClick={() => move(-1)}
                     className="absolute left-2 top-1/2 z-10 -translate-y-1/2 bg-background/80"
                  >
                     <ChevronLeft className="size-5" />
                  </ToolbarButton>
               ) : null}
               {body()}
               {artifacts.length > 1 ? (
                  <ToolbarButton
                     label={t('next')}
                     onClick={() => move(1)}
                     className="absolute right-2 top-1/2 z-10 -translate-y-1/2 bg-background/80"
                  >
                     <ChevronRight className="size-5" />
                  </ToolbarButton>
               ) : null}
            </div>
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
   return <p className="max-w-sm px-6 text-center text-muted-foreground">{text}</p>;
}

function ToolbarButton({
   label,
   onClick,
   className,
   children,
}: {
   label: string;
   onClick: () => void;
   className?: string;
   children: ReactNode;
}) {
   return (
      <button
         type="button"
         onClick={onClick}
         aria-label={label}
         title={label}
         className={[
            'inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground',
            'transition-colors hover:bg-accent hover:text-foreground',
            className ?? '',
         ].join(' ')}
      >
         {children}
      </button>
   );
}
