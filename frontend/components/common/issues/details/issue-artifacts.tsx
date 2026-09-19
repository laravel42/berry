'use client';

import { BerryMark } from '@/components/brand/berry-mark';
import { Button } from '@/components/ui/button';
import {
   type ArtifactTreeNode,
   type RunArtifact,
   artifactView,
   buildArtifactTree,
   loadIssueArtifacts,
   siteEntry,
} from '@/lib/attachments';
import { cn } from '@/lib/utils';
import {
   ChevronDown,
   ChevronRight,
   CopyMinus,
   FilePlus,
   Folder,
   FolderPlus,
   GitCompare,
   Loader2,
   RefreshCw,
   SquareDot,
   SquareMinus,
   SquarePlus,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import {
   useCallback,
   useEffect,
   useId,
   useMemo,
   useRef,
   useState,
   type PointerEvent as ReactPointerEvent,
   type ReactNode,
} from 'react';
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
/** The root node's key among the folded paths; no file path contains a NUL. */
const ROOT = '\0root';
const TREE_WIDTH = 280;
const TREE_WIDTH_MIN = 180;
const TREE_WIDTH_MAX = 480;

function clampTreeWidth(width: number): number {
   return Math.min(TREE_WIDTH_MAX, Math.max(TREE_WIDTH_MIN, Math.round(width)));
}

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
   /**
    * Where the files come from, when they are not the task's saved ones: the
    * review's Files tab hands the repository at the branch under review here,
    * as the same records, so it is this tree and this viewer that show them.
    * Must be stable between renders.
    */
   load?: () => Promise<RunArtifact[]>;
   /**
    * What a pull request does to each path, shown as a mark in the tree: a
    * green plus for a new file, a yellow dot for a modified one, a red minus
    * for a deleted one. Files only: a folder carries no mark.
    */
   marked?: ReadonlyMap<string, 'added' | 'modified' | 'deleted'>;
   /**
    * A root node above the tree, labelled with what the files are a view of:
    * the review's Files tab names the commit. It folds the whole tree.
    */
   root?: string;
   /**
    * Makes a new, empty file at a path. Given, the root node offers New file
    * and New folder; the caller's `load` must then return the file.
    */
   create?: (path: string) => Promise<void>;
   /** Called by the root node's Refresh before the files are read again, for a caller that keeps them. */
   onRefresh?: () => void;
   /** Commits an edited file where it lives. With it, the viewer offers "Commit changes" in place of Save. */
   commit?: (artifact: RunArtifact, content: string, message: string) => Promise<void>;
}

export function IssueArtifacts({
   issueRef,
   heading,
   defaultOpen = false,
   onLoaded,
   runId,
   className,
   load,
   marked,
   root,
   create,
   onRefresh,
   commit,
}: IssueArtifactsProps) {
   const t = useTranslations('issueDetail.artifacts');
   const treeId = useId();
   const [all, setAll] = useState<RunArtifact[]>([]);
   const [loaded, setLoaded] = useState(false);
   const [error, setError] = useState<string | null>(null);
   const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
   const [open, setOpen] = useState(defaultOpen);
   /** The file open in the viewer, as an index into `ordered`. */
   const [viewing, setViewing] = useState<number | null>(null);
   /** Bumped by Refresh: the files are read again. */
   const [reloads, setReloads] = useState(0);
   /** Folders made here that hold no file yet. Git has no such thing, so they live only on this page. */
   const [folders, setFolders] = useState<string[]>([]);
   /** The folder last touched: where a new file or folder is offered. */
   const [directory, setDirectory] = useState('');
   /** The folder clicked last, shown selected until a file is; null while a file holds the selection. */
   const [folder, setFolder] = useState<string | null>(null);
   /** The path being typed for a new file or folder. */
   const [draft, setDraft] = useState<{
      kind: 'file' | 'folder';
      /** The folder it is made in, where the input sits in the tree; '' is the root. */
      at: string;
      value: string;
   } | null>(null);
   const [creating, setCreating] = useState(false);
   /** A file just created, opened once the tree that holds it has loaded. */
   const wanted = useRef<string | null>(null);
   const [treeWidth, setTreeWidth] = useState(TREE_WIDTH);
   /** When the tree has change marks, narrow it to those paths only. */
   const [changesOnly, setChangesOnly] = useState(false);
   /** Keeps the open file across a filter toggle that rebuilds `ordered`. */
   const selectedPath = useRef<string | null>(null);

   /** Drags the tree's right edge. Pointer capture keeps the move even over the preview. */
   const resizeTree = (event: ReactPointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const target = event.currentTarget;
      const start = treeWidth;
      const origin = event.clientX;
      target.setPointerCapture(event.pointerId);
      const move = (moved: PointerEvent) =>
         setTreeWidth(clampTreeWidth(start + (moved.clientX - origin)));
      const end = () => {
         target.removeEventListener('pointermove', move);
         target.removeEventListener('pointerup', end);
         target.removeEventListener('pointercancel', end);
      };
      target.addEventListener('pointermove', move);
      target.addEventListener('pointerup', end);
      target.addEventListener('pointercancel', end);
   };

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
      void (load ? load() : loadIssueArtifacts(issueRef))
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
   }, [issueRef, load, reloads]);

   const artifacts = useMemo(
      () => (runId ? all.filter((artifact) => artifact.runId === runId) : all),
      [all, runId]
   );

   useEffect(() => {
      if (loaded) onLoadedRef.current?.(artifacts);
   }, [loaded, artifacts]);

   const visibleArtifacts = useMemo(() => {
      if (!changesOnly || !marked) return artifacts;
      return artifacts.filter((artifact) => marked.has(artifact.path));
   }, [artifacts, changesOnly, marked]);

   const visibleFolders = useMemo(() => {
      if (!changesOnly || !marked) return folders;
      return folders.filter((folder) =>
         [...marked.keys()].some((path) => path === folder || path.startsWith(`${folder}/`))
      );
   }, [folders, changesOnly, marked]);

   const tree = useMemo(
      () => buildArtifactTree(visibleArtifacts, visibleFolders),
      [visibleArtifacts, visibleFolders]
   );
   // The files in the order the tree shows them, so the viewer's arrows walk
   // the tree rather than the order the server happened to send.
   const ordered = useMemo(() => flatten(tree), [tree]);
   const site = useMemo(() => siteEntry(artifacts), [artifacts]);

   const view = useCallback(
      (artifact: RunArtifact) => {
         setDirectory(artifact.directory);
         setFolder(null);
         selectedPath.current = artifact.path;
         setViewing(ordered.findIndex((file) => file.id === artifact.id));
      },
      [ordered]
   );

   useEffect(() => {
      if (wanted.current === null) return;
      const index = ordered.findIndex((file) => file.path === wanted.current);
      if (index === -1) return;
      wanted.current = null;
      selectedPath.current = ordered[index]?.path ?? null;
      setViewing(index);
   }, [ordered]);

   // Open on the site entry, or the first viewable file, once the tree is up.
   useEffect(() => {
      if (!open && heading !== null) return;
      if (viewing !== null || ordered.length === 0) return;
      const first = site ?? ordered.find((file) => artifactView(file).kind !== 'unsupported');
      if (first) {
         selectedPath.current = first.path;
         setViewing(ordered.findIndex((file) => file.id === first.id));
      }
   }, [open, heading, ordered, site, viewing]);

   // After the changes filter rebuilds the list, keep the open file if it is still there.
   useEffect(() => {
      if (ordered.length === 0) {
         setViewing(null);
         return;
      }
      const path = selectedPath.current;
      const index = path ? ordered.findIndex((file) => file.path === path) : -1;
      if (index !== -1) {
         setViewing(index);
         return;
      }
      selectedPath.current = ordered[0]?.path ?? null;
      setViewing(0);
      // Only when the filter flips: `ordered` is already the filtered list on this render.
      // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [changesOnly]);

   const toggleChangesOnly = () => {
      setChangesOnly((on) => {
         if (!on) setCollapsed(new Set());
         return !on;
      });
   };

   const toggle = useCallback((path: string) => {
      if (path !== ROOT) {
         setDirectory(path);
         setFolder(path);
      }
      setCollapsed((previous) => {
         const next = new Set(previous);
         if (next.has(path)) next.delete(path);
         else next.add(path);
         return next;
      });
   }, []);

   const startDraft = (kind: 'file' | 'folder') => {
      setError(null);
      // The folder last selected, or the one holding the selected file. One that
      // is gone since (a refresh, another branch state) falls back to the root.
      const isFolder = (nodes: ArtifactTreeNode[]): boolean =>
         nodes.some((node) => !node.file && (node.path === directory || isFolder(node.children)));
      const at = directory !== '' && isFolder(tree) ? directory : '';
      // Unfolded down to it, so the input is in sight where the entry will be.
      const open = at.split('/').map((_, index, parts) => parts.slice(0, index + 1).join('/'));
      setCollapsed(
         (previous) =>
            new Set([...previous].filter((held) => held !== ROOT && !open.includes(held)))
      );
      setDraft({ kind, at, value: '' });
   };

   const submitDraft = async () => {
      if (!draft || creating) return;
      const typed = draft.value.trim().split('/').filter(Boolean);
      if (typed.length === 0) return setDraft(null);
      const segments = [...draft.at.split('/').filter(Boolean), ...typed];
      const path = segments.join('/');
      if (draft.value.trim().startsWith('/') || typed.some((part) => part === '.' || part === '..'))
         return setError(t('pathInvalid'));
      const taken = (nodes: ArtifactTreeNode[]): boolean =>
         nodes.some((node) => node.path === path || taken(node.children));
      if (taken(tree)) return setError(t('pathTaken', { path }));
      setError(null);
      // Every folder on the way down is unfolded, so what was made is in sight.
      const parents = segments.map((_, index) => segments.slice(0, index + 1).join('/'));
      setCollapsed((previous) => new Set([...previous].filter((held) => !parents.includes(held))));
      if (draft.kind === 'folder') {
         setFolders((held) => [...held, path]);
         setDirectory(path);
         return setDraft(null);
      }
      if (!create) return;
      setCreating(true);
      try {
         wanted.current = path;
         await create(path);
         setDraft(null);
      } catch (cause) {
         wanted.current = null;
         setError(cause instanceof Error ? cause.message : t('createFailed', { path }));
      } finally {
         setCreating(false);
      }
   };

   const collapseAll = () => {
      const paths: string[] = [];
      const walk = (nodes: ArtifactTreeNode[]) => {
         for (const node of nodes) {
            if (node.file) continue;
            paths.push(node.path);
            walk(node.children);
         }
      };
      walk(tree);
      setCollapsed((previous) => new Set(previous.has(ROOT) ? [ROOT, ...paths] : paths));
   };

   const refresh = () => {
      onRefresh?.();
      setReloads((current) => current + 1);
   };

   /** The input a new file or folder is named in, as a row of the tree at the depth it will land. */
   const draftRow = (depth: number): ReactNode =>
      draft ? (
         <form
            className="flex min-h-5 items-center gap-1.5 pr-1"
            style={{ paddingLeft: `${8 + depth * 12}px` }}
            onSubmit={(event) => {
               event.preventDefault();
               void submitDraft();
            }}
         >
            {draft.kind === 'file' ? (
               <FilePlus className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
            ) : (
               <Folder className="size-3.5 shrink-0 text-status-warning" aria-hidden />
            )}
            <input
               autoFocus
               value={draft.value}
               disabled={creating}
               spellCheck={false}
               aria-label={t(draft.kind === 'file' ? 'newFilePath' : 'newFolderPath')}
               title={draft.kind === 'folder' ? t('newFolderNote') : undefined}
               onChange={(event) => setDraft({ ...draft, value: event.target.value })}
               onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                     setDraft(null);
                     setError(null);
                  }
               }}
               onBlur={() => {
                  if (!creating && draft.value.trim() === '') setDraft(null);
               }}
               className="h-[18px] min-w-0 flex-1 rounded-sm border border-ring bg-background px-1 outline-none"
            />
            {creating ? <Loader2 className="size-3.5 shrink-0 animate-spin" aria-hidden /> : null}
         </form>
      ) : null;

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
                  className="relative flex shrink-0 flex-col overflow-y-auto border-r bg-background py-1"
                  style={{
                     width: treeWidth,
                     minWidth: TREE_WIDTH_MIN,
                     fontSize: '12px',
                     lineHeight: '14px',
                  }}
               >
                  {root ? (
                     <div className="flex min-h-5 min-w-0 items-center gap-0.5 pr-1 text-muted-foreground">
                        <button
                           type="button"
                           onClick={() => toggle(ROOT)}
                           aria-expanded={!collapsed.has(ROOT)}
                           title={root}
                           className="flex min-h-5 min-w-0 flex-1 items-center gap-1 rounded-sm pl-2 text-left font-mono outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                        >
                           {collapsed.has(ROOT) ? (
                              <ChevronRight className="size-3.5 shrink-0" aria-hidden />
                           ) : (
                              <ChevronDown className="size-3.5 shrink-0" aria-hidden />
                           )}
                           <span className="truncate">{root}</span>
                        </button>
                        {create ? (
                           <>
                              <RootAction label={t('newFile')} onClick={() => startDraft('file')}>
                                 <FilePlus className="size-3.5" aria-hidden />
                              </RootAction>
                              <RootAction
                                 label={t('newFolder')}
                                 onClick={() => startDraft('folder')}
                              >
                                 <FolderPlus className="size-3.5" aria-hidden />
                              </RootAction>
                           </>
                        ) : null}
                        <RootAction label={t('refresh')} onClick={refresh} disabled={!loaded}>
                           <RefreshCw
                              className={cn('size-3.5', !loaded && 'animate-spin')}
                              aria-hidden
                           />
                        </RootAction>
                        <RootAction label={t('collapseAll')} onClick={collapseAll}>
                           <CopyMinus className="size-3.5" aria-hidden />
                        </RootAction>
                        {marked ? (
                           <RootAction
                              label={changesOnly ? t('showAll') : t('changesOnly')}
                              onClick={toggleChangesOnly}
                              pressed={changesOnly}
                           >
                              <GitCompare className="size-3.5" aria-hidden />
                           </RootAction>
                        ) : null}
                     </div>
                  ) : null}
                  {draft && draft.at === '' ? draftRow(root ? 1 : 0) : null}
                  {root && collapsed.has(ROOT)
                     ? null
                     : tree.map((node) => (
                          <TreeRow
                             key={node.path}
                             node={node}
                             depth={root ? 1 : 0}
                             collapsed={collapsed}
                             selectedId={selectedId}
                             onToggle={toggle}
                             onView={view}
                             marked={marked}
                             selectedFolder={folder}
                             draftAt={draft ? draft.at : null}
                             draftRow={draftRow}
                          />
                       ))}
                  <span
                     className="absolute inset-y-0 right-0 z-10 w-1.5 cursor-col-resize"
                     style={{ touchAction: 'none' }}
                     onPointerDown={resizeTree}
                     role="separator"
                     aria-orientation="vertical"
                     aria-valuenow={treeWidth}
                     aria-valuemin={TREE_WIDTH_MIN}
                     aria-valuemax={TREE_WIDTH_MAX}
                     aria-label={t('resizeTree')}
                  />
               </aside>
               <div className="min-w-0 flex-1">
                  <ArtifactViewer
                     layout="pane"
                     issueRef={issueRef}
                     artifacts={ordered}
                     index={viewing}
                     onIndexChange={setViewing}
                     {...(commit ? { onCommit: commit } : {})}
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

/** One of the root node's icon buttons. */
function RootAction({
   label,
   onClick,
   disabled,
   pressed,
   children,
}: {
   label: string;
   onClick: () => void;
   disabled?: boolean;
   pressed?: boolean;
   children: ReactNode;
}) {
   return (
      <Button
         type="button"
         variant="ghost"
         size="icon"
         className={cn('size-5 shrink-0', pressed && 'bg-accent text-foreground')}
         aria-label={label}
         title={label}
         aria-pressed={pressed}
         disabled={disabled}
         onClick={onClick}
      >
         {children}
      </Button>
   );
}

function TreeRow({
   node,
   depth,
   collapsed,
   selectedId,
   onToggle,
   onView,
   marked,
   selectedFolder,
   draftAt,
   draftRow,
}: {
   node: ArtifactTreeNode;
   depth: number;
   collapsed: Set<string>;
   selectedId: string | null;
   onToggle: (path: string) => void;
   onView: (artifact: RunArtifact) => void;
   marked?: ReadonlyMap<string, 'added' | 'modified' | 'deleted'> | undefined;
   /** The folder a new entry is being named in, and the row to show there. */
   selectedFolder: string | null;
   draftAt: string | null;
   draftRow: (depth: number) => ReactNode;
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
               'group flex min-h-5 min-w-0 items-center gap-1.5 pr-1 hover:bg-accent',
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
            <ChangeMark change={marked?.get(artifact.path)} />
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
            className={cn(
               'flex min-h-5 min-w-0 items-center gap-1 rounded-sm pr-2 text-left outline-none hover:bg-accent/60 focus-visible:ring-[3px] focus-visible:ring-ring/50',
               selectedFolder === node.path && 'bg-accent'
            )}
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
         {!isCollapsed && draftAt === node.path ? draftRow(depth + 1) : null}
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
                    onView={onView}
                    marked={marked}
                    selectedFolder={selectedFolder}
                    draftAt={draftAt}
                    draftRow={draftRow}
                 />
              ))}
      </>
   );
}

/** Every file under the given nodes, in tree order. */
function flatten(nodes: ArtifactTreeNode[]): RunArtifact[] {
   return nodes.flatMap((node) => (node.file ? [node.file] : flatten(node.children)));
}

/** What a pull request did to this file, as a small squared mark: plus, dot, minus. */
function ChangeMark({ change }: { change: 'added' | 'modified' | 'deleted' | undefined }) {
   const t = useTranslations('issueDetail.artifacts');
   if (!change) return null;
   const Icon = change === 'added' ? SquarePlus : change === 'deleted' ? SquareMinus : SquareDot;
   const label =
      change === 'added'
         ? t('change.added')
         : change === 'deleted'
           ? t('change.deleted')
           : t('change.modified');
   return (
      <span className="inline-flex shrink-0" title={label}>
         <Icon
            className={cn(
               'size-3.5',
               change === 'added'
                  ? 'text-status-success'
                  : change === 'deleted'
                    ? 'text-status-danger'
                    : 'text-status-warning'
            )}
            aria-label={label}
         />
      </span>
   );
}
