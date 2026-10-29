'use client';

import { FileKindMark } from '@/components/common/issues/details/file-kind-mark';
import { formatFileSize } from '@/lib/attachments';
import { cn } from '@/lib/utils';
import { ChevronRight, File } from 'lucide-react';
import type { ReactNode } from 'react';

export interface FileListEntry {
   id: string;
   name: string;
   path: string;
   directory?: string;
   sizeBytes?: number;
   href?: string;
}

/**
 * Files attached to a comment, one row each.
 *
 * The name is the file. A directory sits under it, and the size sits at the
 * end. Opening a row follows `href` or calls `onOpen`.
 */
export function AttachedFileList({
   entries,
   onOpen,
   className,
}: {
   entries: FileListEntry[];
   onOpen?: (index: number) => void;
   className?: string;
}) {
   if (entries.length === 0) return null;
   return (
      <ul
         className={cn('overflow-hidden rounded-md border border-border/70 bg-muted/20', className)}
      >
         {entries.map((entry, index) => (
            <li key={entry.id} className="border-t border-border/50 first:border-t-0">
               {entry.href ? (
                  <a href={entry.href} title={entry.path} className={rowClass}>
                     <FileRow entry={entry} />
                  </a>
               ) : (
                  <button
                     type="button"
                     title={entry.path}
                     onClick={() => onOpen?.(index)}
                     className={rowClass}
                  >
                     <FileRow entry={entry} />
                  </button>
               )}
            </li>
         ))}
      </ul>
   );
}

const rowClass =
   'group flex w-full min-w-0 cursor-pointer items-center gap-2.5 px-2 py-1.5 text-left outline-none hover:bg-accent focus-visible:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset';

function FileRow({ entry }: { entry: FileListEntry }) {
   const directory = entry.directory?.trim() ?? '';
   return (
      <>
         <KindBadge name={entry.name} />
         <span className="min-w-0 flex-1">
            <span className="block truncate text-foreground">{entry.name}</span>
            {directory !== '' ? (
               <span className="block truncate text-muted-foreground">{directory}</span>
            ) : null}
         </span>
         {entry.sizeBytes !== undefined ? (
            <span className="shrink-0 text-muted-foreground tabular-nums">
               {formatFileSize(entry.sizeBytes)}
            </span>
         ) : null}
         <ChevronRight
            className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
            aria-hidden
         />
      </>
   );
}

function KindBadge({ name }: { name: string }): ReactNode {
   const dot = name.lastIndexOf('.');
   const ext = dot > 0 ? name.slice(dot + 1) : '';
   return (
      <span className="flex size-7 shrink-0 items-center justify-center rounded-sm bg-background/80">
         {ext !== '' ? (
            <FileKindMark name={name} />
         ) : (
            <File className="size-3.5 text-muted-foreground" aria-hidden />
         )}
      </span>
   );
}
