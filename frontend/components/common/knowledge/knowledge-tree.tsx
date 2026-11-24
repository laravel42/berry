'use client';

import { Archive, ChevronRight, FileText, FolderInput, MoreHorizontal, Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';

import {
   ContextMenu,
   ContextMenuContent,
   ContextMenuItem,
   ContextMenuSeparator,
   ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
   DropdownMenu,
   DropdownMenuContent,
   DropdownMenuItem,
   DropdownMenuSeparator,
   DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { childrenByParent, type KnowledgePageSummary } from '@/lib/knowledge';
import { cn } from '@/lib/utils';

/** Every page beneath `id`, at any depth. */
export function descendantIds(pages: KnowledgePageSummary[], id: string): string[] {
   const byParent = childrenByParent(pages);
   const found: string[] = [];
   const stack = [id];
   while (stack.length > 0) {
      const current = stack.pop()!;
      for (const child of byParent.get(current) ?? []) {
         found.push(child.id);
         stack.push(child.id);
      }
   }
   return found;
}

interface TreeProps {
   pages: KnowledgePageSummary[];
   activeId: string | null;
   expanded: Set<string>;
   onToggle: (id: string) => void;
   onOpen: (id: string) => void;
   onCreateChild: (parentId: string) => void;
   onMove: (page: KnowledgePageSummary) => void;
   onTrash: (page: KnowledgePageSummary) => void;
}

/**
 * The page tree. A row unfolds with its chevron and opens with a click; on
 * hover it offers a sub-page and a menu to move or delete it. Depth is shown
 * by indentation alone, as in Notion.
 */
export function KnowledgeTree(props: TreeProps) {
   const t = useTranslations('knowledge');
   const byParent = useMemo(() => childrenByParent(props.pages), [props.pages]);
   const roots = byParent.get(null) ?? [];
   if (roots.length === 0) {
      return <p className="px-2 py-1.5 text-muted-foreground">{t('treeEmpty')}</p>;
   }
   return (
      <ul role="tree" aria-label={t('title')} className="flex flex-col gap-px">
         {roots.map((page) => (
            <TreeRow key={page.id} page={page} depth={0} byParent={byParent} {...props} />
         ))}
      </ul>
   );
}

function TreeRow({
   page,
   depth,
   byParent,
   activeId,
   expanded,
   onToggle,
   onOpen,
   onCreateChild,
   onMove,
   onTrash,
   ...rest
}: TreeProps & {
   page: KnowledgePageSummary;
   depth: number;
   byParent: Map<string | null, KnowledgePageSummary[]>;
}) {
   const t = useTranslations('knowledge');
   const children = byParent.get(page.id) ?? [];
   const open = expanded.has(page.id);
   const active = page.id === activeId;
   const title = page.title || t('untitled');
   // One list for the "…" menu and the right-click menu, so they cannot drift.
   const actions: Array<
      | 'separator'
      | { id: string; label: string; icon: typeof Plus; destructive?: boolean; run: () => void }
   > = [
      { id: 'add', label: t('addSubPage'), icon: Plus, run: () => onCreateChild(page.id) },
      { id: 'move', label: t('moveTo'), icon: FolderInput, run: () => onMove(page) },
      'separator',
      {
         id: 'delete',
         label: t('delete'),
         icon: Archive,
         destructive: true,
         run: () => onTrash(page),
      },
   ];

   return (
      <li
         role="treeitem"
         aria-expanded={children.length > 0 ? open : undefined}
         aria-selected={active}
      >
         {/* Right-click opens the same actions at the pointer. */}
         <ContextMenu>
            <ContextMenuTrigger asChild>
               <div
                  className={cn(
                     'group/row flex items-center gap-1 rounded-md pr-1 hover:bg-accent data-[state=open]:bg-accent has-[[data-state=open]]:bg-accent',
                     active && 'bg-accent text-accent-foreground'
                  )}
                  style={{ paddingLeft: `${4 + depth * 14}px` }}
               >
                  <button
                     type="button"
                     aria-label={open ? t('collapse') : t('expand')}
                     onClick={() => onToggle(page.id)}
                     className={cn(
                        'flex size-5 flex-none items-center justify-center rounded text-muted-foreground hover:text-foreground',
                        children.length === 0 && 'invisible'
                     )}
                  >
                     <ChevronRight
                        className={cn('size-3.5 transition-transform', open && 'rotate-90')}
                     />
                  </button>
                  <button
                     type="button"
                     onClick={() => onOpen(page.id)}
                     className="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left"
                     aria-current={active ? 'page' : undefined}
                  >
                     {page.icon ? (
                        <span
                           className="flex size-4 flex-none items-center justify-center"
                           aria-hidden
                        >
                           {page.icon}
                        </span>
                     ) : (
                        <FileText className="size-4 flex-none text-muted-foreground" aria-hidden />
                     )}
                     <span
                        className={cn(
                           'truncate',
                           !page.title && 'text-muted-foreground',
                           active && 'font-semibold'
                        )}
                     >
                        {title}
                     </span>
                  </button>
                  {/* Kept while its menu is open: a hidden trigger leaves the menu with
                nothing to anchor to, and it lands in a corner of the page. */}
                  <span className="hidden flex-none items-center group-hover/row:flex group-focus-within/row:flex has-[[data-state=open]]:flex">
                     <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                           <button
                              type="button"
                              aria-label={t('pageActions', { title })}
                              className="flex size-5 items-center justify-center rounded text-muted-foreground hover:text-foreground"
                           >
                              <MoreHorizontal className="size-3.5" />
                           </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start">
                           {actions.map((action) =>
                              action === 'separator' ? (
                                 <DropdownMenuSeparator key="separator" />
                              ) : (
                                 <DropdownMenuItem
                                    key={action.id}
                                    variant={action.destructive ? 'destructive' : 'default'}
                                    onSelect={action.run}
                                 >
                                    <action.icon className="size-4" /> {action.label}
                                 </DropdownMenuItem>
                              )
                           )}
                        </DropdownMenuContent>
                     </DropdownMenu>
                     <button
                        type="button"
                        aria-label={t('addSubPageTo', { title })}
                        title={t('addSubPage')}
                        onClick={() => onCreateChild(page.id)}
                        className="flex size-5 items-center justify-center rounded text-muted-foreground hover:text-foreground"
                     >
                        <Plus className="size-3.5" />
                     </button>
                  </span>
               </div>
            </ContextMenuTrigger>
            <ContextMenuContent>
               {actions.map((action) =>
                  action === 'separator' ? (
                     <ContextMenuSeparator key="separator" />
                  ) : (
                     <ContextMenuItem
                        key={action.id}
                        variant={action.destructive ? 'destructive' : 'default'}
                        onSelect={action.run}
                     >
                        <action.icon className="size-4" /> {action.label}
                     </ContextMenuItem>
                  )
               )}
            </ContextMenuContent>
         </ContextMenu>
         {open && children.length > 0 ? (
            <ul role="group" className="flex flex-col gap-px">
               {children.map((child) => (
                  <TreeRow
                     key={child.id}
                     page={child}
                     depth={depth + 1}
                     byParent={byParent}
                     activeId={activeId}
                     expanded={expanded}
                     onToggle={onToggle}
                     onOpen={onOpen}
                     onCreateChild={onCreateChild}
                     onMove={onMove}
                     onTrash={onTrash}
                     {...rest}
                  />
               ))}
            </ul>
         ) : null}
      </li>
   );
}
