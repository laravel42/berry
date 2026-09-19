'use client';

import { BerryMark } from '@/components/brand/berry-mark';
import { Button } from '@/components/ui/button';
import {
   type ArtifactTreeNode,
   type RunArtifact,
   artifactView,
   buildArtifactTree,
   downloadArtifact,
   loadIssueArtifacts,
   siteEntry,
} from '@/lib/attachments';
import { cn } from '@/lib/utils';
import { ChevronDown, ChevronRight, Download, Folder, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArtifactViewer } from './artifact-viewer';
import { FileKindMark } from './file-kind-mark';

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
 * When open, the layout is a file tree on the left and a preview pane on the
 * right — pick a file, see it; no overlay. The review pane embeds the same
 * tree under its own heading, unfolded and narrowed to the run under review.
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
   /** Applied to the split tree + preview shell when the tree is shown. */
   className?: string;
}

export function IssueArtifacts({
   issueRef,
   heading,
   defaultOpen = false,
   onLoaded,
   runId,
   className,
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
   const view = useCallback(
      (artifact: RunArtifact) => setViewing(ordered.findIndex((file) => file.id === artifact.id)),
      [ordered]
   );

   // Open on the site entry, or the first viewable file, once the tree is up.
   useEffect(() => {
      if (!open && heading !== null) return;
      if (viewing !== null || ordered.length === 0) return;
      const first = site ?? ordered.find((file) => artifactView(file).kind !== 'unsupported');
      if (first) setViewing(ordered.findIndex((file) => file.id === first.id));
   }, [open, heading, ordered, site, viewing]);

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
   const selectedId = viewing === null ? null : (ordered[viewing]?.id ?? null);

   return (
      <section className={cn(className && 'flex h-full min-h-0 flex-col')}>
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
               <Button
                  variant="ghost"
                  size="xs"
                  className="ml-auto text-muted-foreground"
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

         {showTree ? (
            <div
               id={treeId}
               className={cn(
                  'flex h-[min(32rem,70vh)] min-h-80 overflow-hidden rounded-md border',
                  className && 'min-h-0 flex-1',
                  className
               )}
            >
               <aside
                  aria-label={t('tree')}
                  className="flex w-[280px] shrink-0 flex-col overflow-y-auto border-r bg-background py-1"
                  style={{ fontSize: '13px', lineHeight: '16px', minWidth: 280 }}
               >
                  {tree.map((node) => (
                     <TreeRow
                        key={node.path}
                        node={node}
                        depth={0}
                        collapsed={collapsed}
                        selectedId={selectedId}
                        onToggle={toggle}
                        onDownload={download}
                        onView={view}
                        pending={pending}
                     />
                  ))}
               </aside>
               <div className="min-w-0 flex-1">
                  <ArtifactViewer
                     layout="pane"
                     issueRef={issueRef}
                     artifacts={ordered}
                     index={viewing}
                     onIndexChange={setViewing}
                  />
               </div>
            </div>
         ) : null}

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
   selectedId,
   onToggle,
   onDownload,
   onView,
   pending,
}: {
   node: ArtifactTreeNode;
   depth: number;
   collapsed: Set<string>;
   selectedId: string | null;
   onToggle: (path: string) => void;
   onDownload: (artifact: RunArtifact) => void;
   onView: (artifact: RunArtifact) => void;
   pending: string | null;
}) {
   const t = useTranslations('issueDetail.artifacts');
   // Indent by nesting rather than by a computed class name, so Tailwind's
   // scanner sees every padding it has to emit.
   const indent = { paddingLeft: `${8 + depth * 12}px` };

   if (node.file) {
      const artifact = node.file;
      const viewable = artifactView(artifact).kind !== 'unsupported';
      const selected = selectedId === artifact.id;
      return (
         <div
            className={cn(
               'group flex min-w-0 items-center gap-1.5 py-0.5 pr-1 hover:bg-accent',
               selected && 'bg-accent'
            )}
            style={indent}
         >
            <FileKindMark name={node.name} />
            {viewable ? (
               <button
                  type="button"
                  onClick={() => onView(artifact)}
                  title={t('preview', { path: artifact.path })}
                  aria-current={selected ? 'true' : undefined}
                  className="min-w-0 flex-1 truncate rounded-sm text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
               >
                  {node.name}
               </button>
            ) : (
               <span className="min-w-0 flex-1 truncate">{node.name}</span>
            )}
            <Button
               variant="ghost"
               size="icon"
               className="size-6 shrink-0 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
               aria-label={t('download', { path: artifact.path })}
               title={artifact.path}
               disabled={pending === artifact.id}
               onClick={() => void onDownload(artifact)}
            >
               {pending === artifact.id ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
               ) : (
                  <Download className="size-3.5" aria-hidden />
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
            className="flex min-w-0 items-center gap-1 rounded-sm py-0.5 pr-2 text-left outline-none hover:bg-accent/60 focus-visible:ring-[3px] focus-visible:ring-ring/50"
            style={indent}
         >
            {isCollapsed ? (
               <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            ) : (
               <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            )}
            <Folder className="size-3.5 shrink-0 text-status-warning" aria-hidden />
            <span className="truncate">{node.name}</span>
         </button>
         {isCollapsed
            ? null
            : node.children.map((child) => (
                 <TreeRow
                    key={child.path}
                    node={child}
                    depth={depth + 1}
                    collapsed={collapsed}
                    selectedId={selectedId}
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
