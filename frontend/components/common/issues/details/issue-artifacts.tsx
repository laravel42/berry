'use client';

import { BerryMark } from '@/components/brand/berry-mark';
import { Button } from '@/components/ui/button';
import {
   type ArtifactTreeNode,
   type RunArtifact,
   artifactView,
   buildArtifactTree,
   downloadArtifact,
   formatFileSize,
   loadIssueArtifacts,
   siteEntry,
} from '@/lib/attachments';
import { cn } from '@/lib/utils';
import {
   ChevronDown,
   ChevronRight,
   Download,
   Eye,
   FileCode2,
   Folder,
   Globe,
   Loader2,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArtifactViewer } from './artifact-viewer';
import { useOpenSitePreview } from './site-preview-page';

/**
 * What the agents on this issue produced, as the tree they wrote.
 *
 * Separate from the attachment list, and shaped differently, because it is a
 * different thing. A person uploads a file and it has a name; an agent builds
 * something and it has a structure — src/password/generator.ts beside
 * src/password/index.ts is a fact about the work, and flattening it to a list
 * of names throws that away.
 *
 * Folded by default. The tree is the evidence, not the message: a reader
 * arriving at a delivered task wants the agent's summary first and the forty
 * files it touched on request, not four levels of folders between the title
 * and what was said. The fold remembers nothing, so every visit starts small.
 *
 * The review pane embeds the same tree under its own heading, unfolded and
 * narrowed to the run under review; the optional props exist for that.
 */
export interface IssueArtifactsProps {
   issueRef: string;
   /**
    * Replaces the section's own caption text. `null` removes the caption row
    * altogether — the caller supplies its own heading — and with no row to
    * hold the toggle, the tree is always shown.
    */
   heading?: ReactNode | null;
   /** Start with the tree unfolded; the task page leaves it folded. */
   defaultOpen?: boolean;
   /** The files, once loaded (after the `runId` filter), so a caller can state the count without a second fetch. */
   onLoaded?: (artifacts: RunArtifact[]) => void;
   /** Show only what this run produced. */
   runId?: string;
}

export function IssueArtifacts({
   issueRef,
   heading,
   defaultOpen = false,
   onLoaded,
   runId,
}: IssueArtifactsProps) {
   const t = useTranslations('issueDetail.artifacts');
   const treeId = useId();
   const [all, setAll] = useState<RunArtifact[]>([]);
   const [loaded, setLoaded] = useState(false);
   const [pending, setPending] = useState<string | null>(null);
   const [error, setError] = useState<string | null>(null);
   const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
   const [open, setOpen] = useState(defaultOpen);
   /** The file open in the viewer, as an index into `ordered`. */
   const [viewing, setViewing] = useState<number | null>(null);

   // The latest callback, read when the fetch lands: a caller re-rendering
   // with a new closure must not trigger another fetch.
   const onLoadedRef = useRef(onLoaded);
   onLoadedRef.current = onLoaded;

   useEffect(() => {
      setLoaded(false);
      if (!issueRef) {
         setAll([]);
         return;
      }
      let cancelled = false;
      void loadIssueArtifacts(issueRef)
         .then((fetched) => {
            if (cancelled) return;
            setAll(fetched);
            setLoaded(true);
         })
         .catch(() => {
            if (cancelled) return;
            setAll([]);
            setLoaded(true);
         });
      return () => {
         cancelled = true;
      };
   }, [issueRef]);

   const artifacts = useMemo(
      () => (runId ? all.filter((artifact) => artifact.runId === runId) : all),
      [all, runId]
   );

   useEffect(() => {
      if (loaded) onLoadedRef.current?.(artifacts);
   }, [loaded, artifacts]);

   const tree = useMemo(() => buildArtifactTree(artifacts), [artifacts]);
   // The files in the order the tree shows them, so the viewer's arrows walk
   // the tree rather than the order the server happened to send.
   const ordered = useMemo(() => flatten(tree), [tree]);
   const site = useMemo(() => siteEntry(artifacts), [artifacts]);
   // The site opens full size in its own "Preview" tab.
   const openPreview = useOpenSitePreview(issueRef);
   const view = useCallback(
      (artifact: RunArtifact) => setViewing(ordered.findIndex((file) => file.id === artifact.id)),
      [ordered]
   );

   const download = useCallback(
      async (artifact: RunArtifact) => {
         setPending(artifact.id);
         setError(null);
         try {
            await downloadArtifact(artifact);
         } catch {
            // Named rather than silent: a download that does nothing looks like
            // a broken button, and the file may simply no longer be there.
            setError(t('downloadFailed', { name: artifact.name }));
         } finally {
            setPending(null);
         }
      },
      [t]
   );

   const toggle = useCallback((path: string) => {
      setCollapsed((previous) => {
         const next = new Set(previous);
         if (next.has(path)) next.delete(path);
         else next.add(path);
         return next;
      });
   }, []);

   if (artifacts.length === 0) return null;

   const agents = [...new Set(artifacts.map((artifact) => artifact.agentName))].filter(Boolean);
   const showTree = heading === null || open;

   return (
      <section>
         {heading === null ? null : (
            <div className="mb-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 pb-[7px]">
               <h2 data-heading="label" className="text-muted-foreground">
                  {heading ?? t('title', { count: artifacts.length })}
               </h2>
               {agents.length > 0 ? (
                  <span className="flex min-w-0 items-center gap-1 text-actor-agent">
                     <BerryMark
                        size="sm"
                        tone="working"
                        bracketClassName="text-actor-agent"
                        className="[&_circle]:text-actor-agent"
                     />
                     <span className="min-w-0 truncate">
                        {t('by', { names: agents.join(', ') })}
                     </span>
                  </span>
               ) : null}
               {site ? (
                  <Button
                     variant="secondary"
                     size="xs"
                     className="ml-auto"
                     title={site.path}
                     onClick={() => openPreview(site)}
                  >
                     <Globe className="mr-1 size-3.5" aria-hidden />
                     {t('previewSite')}
                  </Button>
               ) : null}
               <Button
                  variant="ghost"
                  size="xs"
                  className={cn(!site && 'ml-auto', 'text-muted-foreground')}
                  aria-expanded={open}
                  aria-controls={treeId}
                  onClick={() => setOpen((value) => !value)}
               >
                  {open ? (
                     <ChevronDown className="mr-1 size-3.5" aria-hidden />
                  ) : (
                     <ChevronRight className="mr-1 size-3.5" aria-hidden />
                  )}
                  {open ? t('hide') : t('show')}
               </Button>
            </div>
         )}

         {heading === null && site ? (
            <Button
               variant="secondary"
               size="xs"
               className="mb-2 self-start"
               title={site.path}
               onClick={() => openPreview(site)}
            >
               <Globe className="mr-1 size-3.5" aria-hidden />
               {t('previewSite')}
            </Button>
         ) : null}

         {showTree ? (
            <div id={treeId} className="flex flex-col">
               {tree.map((node) => (
                  <TreeRow
                     key={node.path}
                     node={node}
                     depth={0}
                     collapsed={collapsed}
                     onToggle={toggle}
                     onDownload={download}
                     onView={view}
                     pending={pending}
                  />
               ))}
            </div>
         ) : null}

         <ArtifactViewer
            issueRef={issueRef}
            artifacts={ordered}
            index={viewing}
            onIndexChange={setViewing}
         />

         {error ? (
            <p className="mt-2 text-status-danger" role="alert">
               {error}
            </p>
         ) : null}
      </section>
   );
}

function TreeRow({
   node,
   depth,
   collapsed,
   onToggle,
   onDownload,
   onView,
   pending,
}: {
   node: ArtifactTreeNode;
   depth: number;
   collapsed: Set<string>;
   onToggle: (path: string) => void;
   onDownload: (artifact: RunArtifact) => void;
   onView: (artifact: RunArtifact) => void;
   pending: string | null;
}) {
   const t = useTranslations('issueDetail.artifacts');
   // Indent by nesting rather than by a computed class name, so Tailwind's
   // scanner sees every padding it has to emit.
   const indent = { paddingLeft: `${depth * 14}px` };

   if (node.file) {
      const artifact = node.file;
      const viewable = artifactView(artifact).kind !== 'unsupported';
      return (
         <div
            className="flex min-w-0 items-center gap-2 border-b border-border/50 py-1.5"
            style={indent}
         >
            <FileCode2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            {viewable ? (
               <button
                  type="button"
                  onClick={() => onView(artifact)}
                  title={t('preview', { path: artifact.path })}
                  className="min-w-0 truncate rounded-sm text-left outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
               >
                  {node.name}
               </button>
            ) : (
               <span className="truncate">{node.name}</span>
            )}
            <span className="shrink-0 text-muted-foreground">
               {formatFileSize(artifact.sizeBytes)}
            </span>
            {viewable ? (
               <Button
                  variant="ghost"
                  size="icon"
                  className="ml-auto size-7 shrink-0"
                  aria-label={t('preview', { path: artifact.path })}
                  title={t('preview', { path: artifact.path })}
                  onClick={() => onView(artifact)}
               >
                  <Eye className="size-4" aria-hidden />
               </Button>
            ) : null}
            <Button
               variant="ghost"
               size="icon"
               className={cn(!viewable && 'ml-auto', 'size-7 shrink-0')}
               aria-label={t('download', { path: artifact.path })}
               title={artifact.path}
               disabled={pending === artifact.id}
               onClick={() => void onDownload(artifact)}
            >
               {pending === artifact.id ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
               ) : (
                  <Download className="size-4" aria-hidden />
               )}
            </Button>
         </div>
      );
   }

   const isCollapsed = collapsed.has(node.path);
   return (
      <>
         <button
            type="button"
            onClick={() => onToggle(node.path)}
            aria-expanded={!isCollapsed}
            className="flex min-w-0 items-center gap-1.5 rounded-sm py-1.5 text-left outline-none hover:bg-accent/60 focus-visible:ring-[3px] focus-visible:ring-ring/50"
            style={indent}
         >
            {isCollapsed ? (
               <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            ) : (
               <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            )}
            <Folder className="size-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate font-medium">{node.name}</span>
            <span className="shrink-0 text-muted-foreground">{countFiles(node)}</span>
         </button>
         {isCollapsed
            ? null
            : node.children.map((child) => (
                 <TreeRow
                    key={child.path}
                    node={child}
                    depth={depth + 1}
                    collapsed={collapsed}
                    onToggle={onToggle}
                    onDownload={onDownload}
                    onView={onView}
                    pending={pending}
                 />
              ))}
      </>
   );
}

/** Every file under the given nodes, in tree order. */
function flatten(nodes: ArtifactTreeNode[]): RunArtifact[] {
   return nodes.flatMap((node) => (node.file ? [node.file] : flatten(node.children)));
}

function countFiles(node: ArtifactTreeNode): number {
   return node.children.reduce((total, child) => total + (child.file ? 1 : countFiles(child)), 0);
}
