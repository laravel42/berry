'use client';

import { BerryLoading, BerryMark } from '@/components/brand/berry-mark';
import {
   AlertDialog,
   AlertDialogAction,
   AlertDialogCancel,
   AlertDialogContent,
   AlertDialogDescription,
   AlertDialogFooter,
   AlertDialogHeader,
   AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button, buttonVariants } from '@/components/ui/button';
import {
   ContextMenu,
   ContextMenuContent,
   ContextMenuItem,
   ContextMenuSeparator,
   ContextMenuTrigger,
} from '@/components/ui/context-menu';
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
   /**
    * Reads, creates and removes files on the branch the tree is showing.
    * Together they let the file menu cut, copy, rename and delete. A task's
    * saved files omit them: that tree is evidence, and the menu only copies paths.
    */
   readFile?: (path: string, sha: string) => Promise<string>;
   writeFile?: (path: string, content: string, message: string) => Promise<void>;
   removeFile?: (path: string, sha: string, message: string) => Promise<void>;
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
   readFile,
   writeFile,
   removeFile,
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
   /** A file or folder staged by Cut or Copy, pasted into the folder that is right-clicked. */
   const [clip, setClip] = useState<{
      op: 'cut' | 'copy';
      path: string;
      kind: 'file' | 'folder';
   } | null>(null);
   /** The row whose name is being edited. */
   const [renaming, setRenaming] = useState<{
      path: string;
      kind: 'file' | 'folder';
      value: string;
   } | null>(null);
   /** The row waiting on the delete confirmation. */
   const [pendingDelete, setPendingDelete] = useState<{
      path: string;
      kind: 'file' | 'folder';
   } | null>(null);
   const [busy, setBusy] = useState(false);
   /**
    * Edits shown before the branch listing catches up. A failed write drops
    * its edit; a listing that already contains it drops it too.
    */
   const [ops, setOps] = useState<TreeOp[]>([]);
   const opSeq = useRef(0);
   /** Stops a rename's blur from committing after Escape already cancelled it. */
   const renameClosed = useRef(false);
   const markedRef = useRef(marked);
   markedRef.current = marked;
   /** Resolves when the reload started by `refresh` has settled. */
   const refreshWait = useRef<Promise<void> | null>(null);
   const refreshDone = useRef<(() => void) | null>(null);

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
      if (!issueRef) {
         setAll([]);
         setLoaded(true);
         return;
      }
      let cancelled = false;
      void (load ? load() : loadIssueArtifacts(issueRef))
         .then((fetched) => {
            if (cancelled) return;
            setAll(fetched);
            setLoaded(true);
            setOps((held) => held.filter((op) => !opLanded(op, fetched, markedRef.current)));
            refreshDone.current?.();
            refreshDone.current = null;
         })
         .catch(() => {
            if (cancelled) return;
            setLoaded(true);
            refreshDone.current?.();
            refreshDone.current = null;
         });
      return () => {
         cancelled = true;
      };
   }, [issueRef, load, reloads]);

   const artifacts = useMemo(
      () => (runId ? all.filter((artifact) => artifact.runId === runId) : all),
      [all, runId]
   );
   /** The tree as the pending edits leave it, laid over the loaded files. */
   const shown = useMemo(() => projectTree(artifacts, marked, ops), [artifacts, marked, ops]);

   useEffect(() => {
      if (loaded) onLoadedRef.current?.(shown.files);
   }, [loaded, shown.files]);

   const visibleArtifacts = useMemo(() => {
      if (!changesOnly || !marked) return shown.files;
      return shown.files.filter((artifact) => shown.marks.has(artifact.path));
   }, [shown, changesOnly, marked]);

   const visibleFolders = useMemo(() => {
      if (!changesOnly || !marked) return folders;
      return folders.filter((folder) =>
         [...shown.marks.keys()].some((path) => path === folder || path.startsWith(`${folder}/`))
      );
   }, [folders, changesOnly, marked, shown.marks]);

   const tree = useMemo(
      () => buildArtifactTree(visibleArtifacts, visibleFolders),
      [visibleArtifacts, visibleFolders]
   );
   // Folders start closed. Seeding during render, once, so the first paint is
   // not a tree that then snaps shut.
   const [foldersSeeded, setFoldersSeeded] = useState(false);
   if (!foldersSeeded) {
      const paths = folderPaths(tree);
      if (paths.length > 0) {
         setFoldersSeeded(true);
         setCollapsed(new Set(paths));
      }
   }
   // The files in the order the tree shows them, so the viewer's arrows walk
   // the tree rather than the order the server happened to send.
   const ordered = useMemo(() => flatten(tree), [tree]);
   const site = useMemo(() => siteEntry(shown.files), [shown.files]);

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
      setDraft(null);
      setCreating(true);
      wanted.current = path;
      const op = nextOp();
      op.show = [blankFile(path, runId)];
      op.marks = [[path, 'added']];
      try {
         await runChange(path, op, () => create(path));
      } finally {
         setCreating(false);
      }
   };

   const collapseAll = () => {
      const paths = folderPaths(tree);
      setCollapsed((previous) => new Set(previous.has(ROOT) ? [ROOT, ...paths] : paths));
   };

   const refresh = () => {
      onRefresh?.();
      setReloads((current) => current + 1);
      refreshWait.current = new Promise((resolve) => {
         refreshDone.current = resolve;
      });
   };

   const writable = Boolean(readFile && writeFile && removeFile);
   const filesUnder = (path: string) =>
      artifacts.filter((file) => file.path === path || file.path.startsWith(`${path}/`));
   const pathTaken = (path: string) =>
      shown.files.some((file) => file.path === path || file.path.startsWith(`${path}/`)) ||
      folders.some((entry) => entry === path || entry.startsWith(`${path}/`));
   const deletedFile = (path: string) => shown.marks.get(path) === 'deleted';
   const addedFile = (path: string) => shown.marks.get(path) === 'added';

   const nextOp = (): TreeOp => {
      opSeq.current += 1;
      return { id: opSeq.current, hide: [], show: [], marks: [] };
   };

   const copyText = async (path: string) => {
      try {
         await navigator.clipboard.writeText(path);
      } catch {
         setError(t('menu.copyFailed'));
      }
   };

   const runChange = async (path: string, op: TreeOp, work: () => Promise<void>) => {
      if (op.hide.length > 0 || op.show.length > 0 || op.marks.length > 0) {
         setOps((held) => [...held, op]);
      }
      setBusy(true);
      setError(null);
      try {
         await work();
         refresh();
         await refreshWait.current;
      } catch (cause) {
         setOps((held) => held.filter((item) => item.id !== op.id));
         setError(cause instanceof Error ? cause.message : t('menu.actionFailed', { path }));
      } finally {
         setBusy(false);
      }
   };

   /** How a copy or move should look before the commits land. */
   const describeTransfer = (
      files: RunArtifact[],
      from: string,
      to: string,
      kind: 'file' | 'folder',
      mode: 'copy' | 'move'
   ): TreeOp => {
      const op = nextOp();
      for (const file of files) {
         if (deletedFile(file.path)) continue;
         const dest = kind === 'file' ? to : `${to}${file.path.slice(from.length)}`;
         op.show.push(relocateFile(file, dest));
         op.marks.push([dest, 'added']);
         if (mode !== 'move') continue;
         if (addedFile(file.path)) op.hide.push(file.path);
         else {
            op.show.push(file);
            op.marks.push([file.path, 'deleted']);
         }
      }
      return op;
   };

   const retargetFolders = (from: string, to: string | null) => {
      setFolders((held) =>
         held.flatMap((folder) => {
            const next = movedPath(folder, from, to);
            return next === null ? [] : [next];
         })
      );
      setDirectory((current) => movedPath(current, from, to) ?? '');
      if (folder !== null && (folder === from || folder.startsWith(`${from}/`))) {
         setFolder(to === null ? null : movedPath(folder, from, to));
      }
   };

   const transfer = async (
      from: string,
      kind: 'file' | 'folder',
      to: string,
      mode: 'copy' | 'move'
   ) => {
      if (!readFile || !writeFile || !removeFile) return;
      if (kind === 'folder' && (to === from || to.startsWith(`${from}/`))) {
         throw new Error(t('menu.moveIntoSelf'));
      }
      const files =
         kind === 'file' ? artifacts.filter((file) => file.path === from) : filesUnder(from);
      if (files.length === 0) {
         if (kind === 'folder' && mode === 'move') retargetFolders(from, to);
         else if (kind === 'folder') setFolders((held) => [...held, to]);
         return;
      }
      const verb =
         mode === 'copy'
            ? t('menu.commitCopy', { from, to })
            : parentOf(from) === parentOf(to)
              ? t('menu.commitRename', { from, to })
              : t('menu.commitMove', { from, to });
      for (const file of files) {
         if (mode === 'move' && deletedFile(file.path)) continue;
         const sha = blobId(file);
         if (!sha) throw new Error(t('menu.actionFailed', { path: file.path }));
         const dest = kind === 'file' ? to : `${to}${file.path.slice(from.length)}`;
         await writeFile(dest, await readFile(file.path, sha), verb);
      }
      if (mode === 'move') {
         for (const file of files) {
            if (deletedFile(file.path)) continue;
            const sha = blobId(file);
            if (sha) await removeFile(file.path, sha, verb);
         }
         if (kind === 'folder') retargetFolders(from, to);
         const open = selectedPath.current;
         const next =
            open === null
               ? null
               : kind === 'file'
                 ? open === from
                    ? to
                    : open
                 : movedPath(open, from, to);
         if (next && next !== open) wanted.current = next;
      }
   };

   const commitRename = () => {
      if (renameClosed.current || !renaming) return;
      const current = renaming;
      const name = current.value.trim();
      if (name === '' || name === baseName(current.path)) {
         renameClosed.current = true;
         setRenaming(null);
         return;
      }
      if (name.includes('/') || name === '.' || name === '..') {
         setError(t('menu.nameInvalid'));
         return;
      }
      const to = joinPath(parentOf(current.path), name);
      if (pathTaken(to)) {
         setError(t('pathTaken', { path: to }));
         return;
      }
      renameClosed.current = true;
      setRenaming(null);
      const empty = current.kind === 'folder' && filesUnder(current.path).length === 0;
      if (empty) {
         retargetFolders(current.path, to);
         return;
      }
      const moving =
         current.kind === 'file'
            ? artifacts.filter((file) => file.path === current.path)
            : filesUnder(current.path);
      void runChange(
         current.path,
         describeTransfer(moving, current.path, to, current.kind, 'move'),
         () => transfer(current.path, current.kind, to, 'move')
      );
   };

   const pasteInto = (directory: string) => {
      if (!clip || busy) return;
      if (
         clip.kind === 'folder' &&
         (directory === clip.path || directory.startsWith(`${clip.path}/`))
      ) {
         setError(t('menu.moveIntoSelf'));
         return;
      }
      const empty = clip.kind === 'folder' && filesUnder(clip.path).length === 0;
      if (!empty && !writable) return;
      const dest =
         clip.op === 'copy'
            ? unusedPath(directory, baseName(clip.path), pathTaken)
            : joinPath(directory, baseName(clip.path));
      if (clip.op === 'cut' && dest === clip.path) {
         setClip(null);
         return;
      }
      if (clip.op === 'cut' && pathTaken(dest)) {
         setError(t('pathTaken', { path: dest }));
         return;
      }
      const staged = clip;
      const moving = empty
         ? []
         : staged.kind === 'file'
           ? artifacts.filter((file) => file.path === staged.path)
           : filesUnder(staged.path);
      const op = empty
         ? nextOp()
         : describeTransfer(
              moving,
              staged.path,
              dest,
              staged.kind,
              staged.op === 'copy' ? 'copy' : 'move'
           );
      void runChange(staged.path, op, async () => {
         if (empty) {
            if (staged.op === 'cut') retargetFolders(staged.path, dest);
            else setFolders((held) => [...held, dest]);
         } else {
            await transfer(staged.path, staged.kind, dest, staged.op === 'copy' ? 'copy' : 'move');
         }
         if (staged.op === 'cut') setClip(null);
      });
   };

   const undoDelete = (node: ArtifactTreeNode) => {
      const file = node.file;
      if (!file || !readFile || !writeFile || busy) return;
      const op = nextOp();
      op.show = [file];
      op.marks = [[file.path, null]];
      void runChange(file.path, op, async () => {
         const sha = blobId(file);
         if (!sha) throw new Error(t('menu.actionFailed', { path: file.path }));
         await writeFile(
            file.path,
            await readFile(file.path, sha),
            t('menu.commitRestore', { path: file.path })
         );
         wanted.current = file.path;
      });
   };

   const removeTarget = () => {
      const target = pendingDelete;
      setPendingDelete(null);
      if (!target) return;
      const empty = target.kind === 'folder' && filesUnder(target.path).length === 0;
      if (empty) {
         retargetFolders(target.path, null);
         return;
      }
      if (!removeFile) return;
      const files =
         target.kind === 'file'
            ? artifacts.filter((file) => file.path === target.path)
            : filesUnder(target.path);
      const op = nextOp();
      for (const file of files) {
         if (deletedFile(file.path)) continue;
         if (addedFile(file.path)) op.hide.push(file.path);
         else {
            op.show.push(file);
            op.marks.push([file.path, 'deleted']);
         }
      }
      void runChange(target.path, op, async () => {
         const message = t('menu.commitDelete', { path: target.path });
         for (const file of files) {
            if (deletedFile(file.path)) continue;
            const sha = blobId(file);
            if (!sha) throw new Error(t('menu.actionFailed', { path: file.path }));
            await removeFile(file.path, sha, message);
         }
         if (target.kind === 'folder') retargetFolders(target.path, null);
         if (
            selectedPath.current &&
            (selectedPath.current === target.path ||
               selectedPath.current.startsWith(`${target.path}/`))
         ) {
            selectedPath.current = null;
            setViewing(null);
         }
      });
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

   const startRename = (node: ArtifactTreeNode) => {
      renameClosed.current = false;
      setError(null);
      setRenaming({ path: node.path, kind: node.file ? 'file' : 'folder', value: node.name });
   };

   const treeMenu: TreeMenu = {
      writable,
      busy,
      clip,
      renaming,
      deleted: deletedFile,
      hasFiles: (path) => filesUnder(path).length > 0,
      onCut: (node) => setClip({ op: 'cut', path: node.path, kind: node.file ? 'file' : 'folder' }),
      onCopy: (node) =>
         setClip({ op: 'copy', path: node.path, kind: node.file ? 'file' : 'folder' }),
      onPaste: pasteInto,
      onCopyPath: (path) => void copyText(path),
      onStartRename: startRename,
      onRenameValue: (value) =>
         setRenaming((current) => (current ? { ...current, value } : current)),
      onCommitRename: commitRename,
      onCancelRename: () => {
         renameClosed.current = true;
         setRenaming(null);
         setError(null);
      },
      onDelete: (node) =>
         setPendingDelete({ path: node.path, kind: node.file ? 'file' : 'folder' }),
      onUndoDelete: undoDelete,
   };

   if (!loaded) {
      return (
         <section className={cn('flex h-full min-h-0 flex-col', className)}>
            <BerryLoading label={t('loading')} />
         </section>
      );
   }

   if (shown.files.length === 0) return null;

   const agents = [...new Set(shown.files.map((artifact) => artifact.agentName))].filter(Boolean);
   const showTree = heading === null || open;
   const selectedId = viewing === null ? null : (ordered[viewing]?.id ?? null);

   return (
      <section className={cn(className && 'flex h-full min-h-0 flex-col')}>
         {heading === null ? null : (
            <div className="mb-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 pb-[7px]">
               <h2 data-heading="label" className="text-muted-foreground">
                  {heading ?? t('title', { count: shown.files.length })}
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
                  className="relative flex shrink-0 flex-col overflow-hidden border-r bg-background"
                  style={{
                     width: treeWidth,
                     minWidth: TREE_WIDTH_MIN,
                     fontSize: '12px',
                     lineHeight: '14px',
                  }}
               >
                  {root ? (
                     <div className="flex min-h-6 shrink-0 items-center gap-0.5 border-b pr-1 text-muted-foreground">
                        <button
                           type="button"
                           onClick={() => toggle(ROOT)}
                           aria-expanded={!collapsed.has(ROOT)}
                           title={root}
                           className="flex min-h-6 min-w-0 flex-1 items-center gap-1 rounded-sm pl-2 text-left font-mono outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                        >
                           {collapsed.has(ROOT) ? (
                              <ChevronRight className="size-3.5 shrink-0" aria-hidden />
                           ) : (
                              <ChevronDown className="size-3.5 shrink-0" aria-hidden />
                           )}
                           <span className="truncate font-bold">{root}</span>
                        </button>
                        {create ? (
                           <>
                              <RootAction label={t('newFile')} onClick={() => startDraft('file')}>
                                 <FilePlus className="size-4" aria-hidden />
                              </RootAction>
                              <RootAction
                                 label={t('newFolder')}
                                 onClick={() => startDraft('folder')}
                              >
                                 <FolderPlus className="size-4" aria-hidden />
                              </RootAction>
                           </>
                        ) : null}
                        <RootAction label={t('refresh')} onClick={refresh} disabled={!loaded}>
                           <RefreshCw
                              className={cn('size-4', !loaded && 'animate-spin')}
                              aria-hidden
                           />
                        </RootAction>
                        <RootAction label={t('collapseAll')} onClick={collapseAll}>
                           <CopyMinus className="size-4" aria-hidden />
                        </RootAction>
                        {marked ? (
                           <RootAction
                              label={changesOnly ? t('showAll') : t('changesOnly')}
                              onClick={toggleChangesOnly}
                              pressed={changesOnly}
                           >
                              <GitCompare className="size-4" aria-hidden />
                           </RootAction>
                        ) : null}
                     </div>
                  ) : null}
                  <div className="min-h-0 flex-1 overflow-y-auto py-1">
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
                                marked={shown.marks}
                                selectedFolder={folder}
                                draftAt={draft ? draft.at : null}
                                draftRow={draftRow}
                                menu={treeMenu}
                             />
                          ))}
                  </div>
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
         <AlertDialog
            open={pendingDelete !== null}
            onOpenChange={(open) => !open && setPendingDelete(null)}
         >
            <AlertDialogContent>
               <AlertDialogHeader>
                  <AlertDialogTitle>
                     {t('menu.deleteTitle', { path: pendingDelete?.path ?? '' })}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                     {pendingDelete?.kind === 'folder'
                        ? filesUnder(pendingDelete.path).length === 0
                           ? t('menu.deleteEmpty', { path: pendingDelete.path })
                           : t('menu.deleteFolder', { path: pendingDelete.path })
                        : t('menu.deleteFile', { path: pendingDelete?.path ?? '' })}
                  </AlertDialogDescription>
               </AlertDialogHeader>
               <AlertDialogFooter>
                  <AlertDialogCancel>{t('menu.cancel')}</AlertDialogCancel>
                  <AlertDialogAction
                     className={buttonVariants({ variant: 'destructive' })}
                     onClick={removeTarget}
                  >
                     {t('menu.delete')}
                  </AlertDialogAction>
               </AlertDialogFooter>
            </AlertDialogContent>
         </AlertDialog>
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
         className={cn('size-6 shrink-0', pressed && 'bg-accent text-foreground')}
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

interface TreeMenu {
   writable: boolean;
   busy: boolean;
   clip: { op: 'cut' | 'copy'; path: string; kind: 'file' | 'folder' } | null;
   renaming: { path: string; kind: 'file' | 'folder'; value: string } | null;
   deleted: (path: string) => boolean;
   hasFiles: (path: string) => boolean;
   onCut: (node: ArtifactTreeNode) => void;
   onCopy: (node: ArtifactTreeNode) => void;
   onPaste: (directory: string) => void;
   onCopyPath: (path: string) => void;
   onStartRename: (node: ArtifactTreeNode) => void;
   onRenameValue: (value: string) => void;
   onCommitRename: () => void;
   onCancelRename: () => void;
   onDelete: (node: ArtifactTreeNode) => void;
   onUndoDelete: (node: ArtifactTreeNode) => void;
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
   menu,
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
   menu: TreeMenu;
}) {
   const t = useTranslations('issueDetail.artifacts');
   // Indent by nesting rather than by a computed class name, so Tailwind's
   // scanner sees every padding it has to emit.
   const indent = { paddingLeft: `${8 + depth * 12}px` };
   const naming = menu.renaming?.path === node.path ? menu.renaming : null;
   const cut =
      menu.clip?.op === 'cut' &&
      (node.path === menu.clip.path || node.path.startsWith(`${menu.clip.path}/`));
   const emptyFolder = !node.file && !menu.hasFiles(node.path);
   const gone = Boolean(node.file && menu.deleted(node.path));
   const canChange = !menu.busy && ((menu.writable && !gone) || emptyFolder);
   const canCopy = !menu.busy && (menu.writable || emptyFolder);
   const clipEmpty = menu.clip?.kind === 'folder' && !menu.hasFiles(menu.clip.path);
   const canPaste = !menu.busy && menu.clip !== null && (menu.writable || clipEmpty);

   const name = naming ? (
      <form
         className="min-w-0 flex-1"
         onSubmit={(event) => {
            event.preventDefault();
            menu.onCommitRename();
         }}
      >
         <input
            autoFocus
            value={naming.value}
            spellCheck={false}
            aria-label={t('menu.renamePath')}
            onChange={(event) => menu.onRenameValue(event.target.value)}
            onKeyDown={(event) => {
               if (event.key === 'Escape') menu.onCancelRename();
            }}
            onBlur={menu.onCommitRename}
            className="h-[18px] w-full min-w-0 rounded-sm border border-ring bg-background px-1 outline-none"
         />
      </form>
   ) : null;

   if (node.file) {
      const artifact = node.file;
      const viewable = artifactView(artifact).kind !== 'unsupported';
      const selected = selectedId === artifact.id;
      return (
         <TreeContextMenu
            menu={menu}
            node={node}
            canChange={canChange}
            canCopy={canCopy}
            canPaste={canPaste}
            canUndo={gone}
            pasteAt={parentOf(node.path)}
         >
            <div
               className={cn(
                  'group flex min-h-5 min-w-0 items-center gap-1.5 pr-1 hover:bg-accent',
                  selected && 'bg-accent',
                  cut && 'opacity-50'
               )}
               style={indent}
            >
               <FileKindMark name={node.name} />
               {name ??
                  (viewable ? (
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
                  ))}
               <ChangeMark change={marked?.get(artifact.path)} />
            </div>
         </TreeContextMenu>
      );
   }

   const isCollapsed = collapsed.has(node.path);
   const folderRow = (
      <>
         {isCollapsed ? (
            <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
         ) : (
            <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
         )}
         <Folder className="size-3.5 shrink-0 text-status-warning" aria-hidden />
         {name ?? <span className="truncate">{node.name}</span>}
      </>
   );
   const folderClass = cn(
      'flex min-h-5 w-full min-w-0 items-center gap-1 rounded-sm pr-2 text-left outline-none hover:bg-accent/60 focus-visible:ring-[3px] focus-visible:ring-ring/50',
      selectedFolder === node.path && 'bg-accent',
      cut && 'opacity-50'
   );
   return (
      <>
         {naming ? (
            <div className={folderClass} style={indent}>
               {folderRow}
            </div>
         ) : (
            <TreeContextMenu
               menu={menu}
               node={node}
               canChange={canChange}
               canCopy={canCopy}
               canPaste={canPaste}
               canUndo={false}
               pasteAt={node.path}
            >
               <button
                  type="button"
                  onClick={() => onToggle(node.path)}
                  aria-expanded={!isCollapsed}
                  className={folderClass}
                  style={indent}
               >
                  {folderRow}
               </button>
            </TreeContextMenu>
         )}
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
                    menu={menu}
                 />
              ))}
      </>
   );
}

/** Right-click menu for one file or folder in the tree. */
function TreeContextMenu({
   menu,
   node,
   canChange,
   canCopy,
   canPaste,
   canUndo,
   pasteAt,
   children,
}: {
   menu: TreeMenu;
   node: ArtifactTreeNode;
   canChange: boolean;
   canCopy: boolean;
   canPaste: boolean;
   canUndo: boolean;
   pasteAt: string;
   children: ReactNode;
}) {
   const t = useTranslations('issueDetail.artifacts');
   return (
      <ContextMenu>
         <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
         <ContextMenuContent className="min-w-48">
            <ContextMenuItem disabled={!canChange} onSelect={() => menu.onCut(node)}>
               {t('menu.cut')}
            </ContextMenuItem>
            <ContextMenuItem disabled={!canCopy} onSelect={() => menu.onCopy(node)}>
               {t('menu.copy')}
            </ContextMenuItem>
            <ContextMenuItem disabled={!canPaste} onSelect={() => menu.onPaste(pasteAt)}>
               {t('menu.paste')}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => menu.onCopyPath(node.path)}>
               {t('menu.copyPath')}
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem disabled={!canChange} onSelect={() => menu.onStartRename(node)}>
               {t('menu.rename')}
            </ContextMenuItem>
            {canUndo ? (
               <ContextMenuItem disabled={menu.busy} onSelect={() => menu.onUndoDelete(node)}>
                  {t('menu.undoDelete')}
               </ContextMenuItem>
            ) : (
               <ContextMenuItem
                  variant="destructive"
                  disabled={!canChange}
                  onSelect={() => menu.onDelete(node)}
               >
                  {t('menu.delete')}
               </ContextMenuItem>
            )}
         </ContextMenuContent>
      </ContextMenu>
   );
}

type TreeChange = 'added' | 'modified' | 'deleted';

/** One file-tree edit, shown until the loaded branch listing already says the same thing. */
interface TreeOp {
   id: number;
   hide: string[];
   show: RunArtifact[];
   marks: Array<readonly [string, TreeChange | null]>;
}

function projectTree(
   files: readonly RunArtifact[],
   marks: ReadonlyMap<string, TreeChange> | undefined,
   ops: readonly TreeOp[]
): { files: RunArtifact[]; marks: Map<string, TreeChange> } {
   let next = [...files];
   const shown = new Map(marks);
   for (const op of ops) {
      const hide = new Set(op.hide);
      const replace = new Map(op.show.map((file) => [file.path, file]));
      next = next.filter((file) => !hide.has(file.path) && !replace.has(file.path));
      next.push(...op.show);
      for (const [path, mark] of op.marks) {
         if (mark === null) shown.delete(path);
         else shown.set(path, mark);
      }
   }
   return { files: next, marks: shown };
}

/** The loaded listing already includes this edit, so the overlay can go. */
function opLanded(
   op: TreeOp,
   files: readonly RunArtifact[],
   marks: ReadonlyMap<string, TreeChange> | undefined
): boolean {
   const paths = new Set(files.map((file) => file.path));
   if (op.show.some((file) => !paths.has(file.path))) return false;
   if (op.hide.some((path) => paths.has(path))) return false;
   for (const [path, mark] of op.marks) {
      if (op.hide.includes(path)) continue;
      if (mark === 'deleted' && marks?.get(path) !== 'deleted') return false;
      if (mark === null && marks?.get(path) === 'deleted') return false;
   }
   return true;
}

function relocateFile(file: RunArtifact, path: string): RunArtifact {
   const slash = path.lastIndexOf('/');
   return {
      ...file,
      id: `${blobId(file) ?? 'new'}:${path}`,
      path,
      name: path.slice(slash + 1),
      directory: slash === -1 ? '' : path.slice(0, slash),
   };
}

function blankFile(path: string, runId: string | undefined): RunArtifact {
   const slash = path.lastIndexOf('/');
   return {
      id: `new:${path}`,
      path,
      name: path.slice(slash + 1),
      directory: slash === -1 ? '' : path.slice(0, slash),
      contentType: 'text/plain',
      sizeBytes: 0,
      runId: runId ?? '',
      agentName: '',
      downloadUrl: '',
      createdAt: '',
   };
}

function folderPaths(nodes: ArtifactTreeNode[]): string[] {
   const paths: string[] = [];
   const walk = (items: ArtifactTreeNode[]) => {
      for (const node of items) {
         if (node.file) continue;
         paths.push(node.path);
         walk(node.children);
      }
   };
   walk(nodes);
   return paths;
}

function parentOf(path: string): string {
   const slash = path.lastIndexOf('/');
   return slash === -1 ? '' : path.slice(0, slash);
}

function baseName(path: string): string {
   const slash = path.lastIndexOf('/');
   return path.slice(slash + 1);
}

function joinPath(directory: string, name: string): string {
   return directory ? `${directory}/${name}` : name;
}

/** The blob id carried on a repository file's record, or null for a saved artifact. */
function blobId(file: RunArtifact): string | null {
   const sha = file.id.split(':')[0] ?? '';
   return /^[0-9a-f]{40}([0-9a-f]{24})?$/i.test(sha) ? sha : null;
}

/** `to` replaces `from` as a path prefix. Null drops a path that was under `from`. */
function movedPath(path: string, from: string, to: string | null): string | null {
   if (path === from) return to;
   if (from !== '' && path.startsWith(`${from}/`))
      return to === null ? null : `${to}${path.slice(from.length)}`;
   return path;
}

/** A path in `directory` that is not already taken, adding "copy" when the name is. */
function unusedPath(directory: string, name: string, taken: (path: string) => boolean): string {
   const first = joinPath(directory, name);
   if (!taken(first)) return first;
   const dot = name.lastIndexOf('.');
   const stem = dot > 0 ? name.slice(0, dot) : name;
   const ext = dot > 0 ? name.slice(dot) : '';
   for (let n = 1; n < 100; n += 1) {
      const label = n === 1 ? `${stem} copy${ext}` : `${stem} copy ${n}${ext}`;
      const path = joinPath(directory, label);
      if (!taken(path)) return path;
   }
   return joinPath(directory, `${stem} copy${ext}`);
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
