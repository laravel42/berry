'use client';

import { Fragment, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * The small subset of Markdown an agent actually writes back.
 *
 * Parsed to React elements rather than to HTML: a reply is text a model
 * produced, so there is no version of this that may reach
 * `dangerouslySetInnerHTML`. Everything unrecognised stays as the characters
 * that were written, which is the right failure for a chat message — a stray
 * asterisk should look like a stray asterisk, not swallow a paragraph.
 *
 * Deliberately not a full implementation. Footnotes and reference links stay
 * as the characters that were written. Tables follow GitHub flavoured
 * markdown: a header row, a delimiter of dashes, then body rows. A pipe in
 * prose is not a table. Raw HTML is never interpreted.
 */

const FENCE = /^```(\w+)?\s*$/;
const HEADING = /^(#{1,4})\s+(.*)$/;
const BULLET = /^\s*[-*]\s+(.*)$/;
const NUMBERED = /^\s*\d+[.)]\s+(.*)$/;
const QUOTE = /^>\s?(.*)$/;

/** `code`, **bold**, *italic*, [text](url), and bare links, in one pass. */
// Underscore emphasis only at word boundaries: `list_files` and `read_file`
// are identifiers, not an italic "files, read".
const INLINE =
   /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\s][^*]*\*)|((?<![\w])_[^_\s][^_]*_(?![\w]))|(\[[^\]]+\]\((https?:\/\/[^\s)]+)\))|(https?:\/\/[^\s<]+)/g;

function inline(text: string, keyPrefix: string): ReactNode[] {
   const nodes: ReactNode[] = [];
   let cursor = 0;
   let index = 0;
   for (const match of text.matchAll(INLINE)) {
      const at = match.index ?? 0;
      if (at > cursor) nodes.push(text.slice(cursor, at));
      const token = match[0];
      const key = `${keyPrefix}-${index}`;
      index += 1;

      if (token.startsWith('`')) {
         nodes.push(
            <code key={key} className="rounded bg-[var(--shell-line)] px-1 py-0.5 font-mono">
               {token.slice(1, -1)}
            </code>
         );
      } else if (token.startsWith('**')) {
         nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
      } else if (token.startsWith('*') || token.startsWith('_')) {
         nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
      } else if (token.startsWith('[')) {
         const label = token.slice(1, token.indexOf(']'));
         const href = match[6] ?? '';
         nodes.push(
            <a
               key={key}
               href={href}
               target="_blank"
               rel="noreferrer noopener"
               className="underline underline-offset-2"
            >
               {label}
            </a>
         );
      } else {
         nodes.push(
            <a
               key={key}
               href={token}
               target="_blank"
               rel="noreferrer noopener"
               className="underline underline-offset-2"
            >
               {token}
            </a>
         );
      }
      cursor = at + token.length;
   }
   if (cursor < text.length) nodes.push(text.slice(cursor));
   return nodes;
}

type Align = 'left' | 'center' | 'right';

interface Block {
   kind: 'code' | 'heading' | 'list' | 'ordered' | 'quote' | 'paragraph' | 'table';
   lines: string[];
   level?: number;
   header?: string[];
   rows?: string[][];
   align?: Array<Align | undefined>;
}

/** Split a GFM table row. A `\|` in a cell stays a pipe. */
function tableCells(line: string): string[] {
   let inner = line.trim();
   if (inner.startsWith('|')) inner = inner.slice(1);
   if (inner.endsWith('|')) inner = inner.slice(0, -1);
   return inner.split(/(?<!\\)\|/).map((cell) => cell.replace(/\\\|/g, '|').trim());
}

function isTableDelimiter(line: string): boolean {
   if (!line.includes('|')) return false;
   const parts = tableCells(line);
   return parts.length > 0 && parts.every((part) => /^:?-+:?$/.test(part));
}

function alignOf(cell: string): Align | undefined {
   const left = cell.startsWith(':');
   const right = cell.endsWith(':');
   if (left && right) return 'center';
   if (right) return 'right';
   if (left) return 'left';
   return undefined;
}

function textAlign(align: Align | undefined): string {
   if (align === 'center') return 'text-center';
   if (align === 'right') return 'text-right';
   return 'text-left';
}

/** One pass over the lines, grouping them into the blocks above. */
function parse(source: string): Block[] {
   const blocks: Block[] = [];
   const lines = source.replace(/\r\n/g, '\n').split('\n');
   let fenced: Block | null = null;
   let i = 0;

   while (i < lines.length) {
      const line = lines[i] ?? '';
      if (fenced) {
         if (FENCE.test(line)) {
            blocks.push(fenced);
            fenced = null;
         } else {
            fenced.lines.push(line);
         }
         i += 1;
         continue;
      }
      if (FENCE.test(line)) {
         fenced = { kind: 'code', lines: [] };
         i += 1;
         continue;
      }

      const next = lines[i + 1];
      if (next !== undefined && line.includes('|') && isTableDelimiter(next)) {
         const header = tableCells(line);
         const align = tableCells(next).map(alignOf);
         i += 2;
         const rows: string[][] = [];
         while (i < lines.length) {
            const body = lines[i] ?? '';
            if (body.trim() === '' || !body.includes('|') || isTableDelimiter(body)) break;
            rows.push(tableCells(body));
            i += 1;
         }
         blocks.push({ kind: 'table', lines: [], header, rows, align });
         continue;
      }

      const heading = HEADING.exec(line);
      if (heading) {
         blocks.push({
            kind: 'heading',
            lines: [heading[2] ?? ''],
            level: heading[1]?.length ?? 1,
         });
         i += 1;
         continue;
      }

      const bullet = BULLET.exec(line);
      if (bullet) {
         const last = blocks.at(-1);
         if (last?.kind === 'list') last.lines.push(bullet[1] ?? '');
         else blocks.push({ kind: 'list', lines: [bullet[1] ?? ''] });
         i += 1;
         continue;
      }

      const numbered = NUMBERED.exec(line);
      if (numbered) {
         const last = blocks.at(-1);
         if (last?.kind === 'ordered') last.lines.push(numbered[1] ?? '');
         else blocks.push({ kind: 'ordered', lines: [numbered[1] ?? ''] });
         i += 1;
         continue;
      }

      const quote = QUOTE.exec(line);
      if (quote) {
         const last = blocks.at(-1);
         if (last?.kind === 'quote') last.lines.push(quote[1] ?? '');
         else blocks.push({ kind: 'quote', lines: [quote[1] ?? ''] });
         i += 1;
         continue;
      }

      if (line.trim() === '') {
         // A blank line ends whatever was open; the next line starts fresh.
         blocks.push({ kind: 'paragraph', lines: [] });
         i += 1;
         continue;
      }

      const last = blocks.at(-1);
      if (last?.kind === 'paragraph' && last.lines.length > 0) last.lines.push(line);
      else blocks.push({ kind: 'paragraph', lines: [line] });
      i += 1;
   }

   if (fenced) blocks.push(fenced);
   return blocks.filter(
      (block) => block.kind === 'code' || block.kind === 'table' || block.lines.length > 0
   );
}

/**
 * Which surface the text sits on. The chat panel lives on the always-dark
 * shell and reads the shell tokens; a review summary or a task comment sits on
 * the page and follows its theme, so code and quotes take the page tokens.
 */
export type MarkdownTone = 'shell' | 'page';

const TONE = {
   shell: {
      code: 'bg-[var(--shell-line)]',
      quote: 'border-[var(--shell-line-strong)] text-[var(--shell-text-dim)]',
      table: 'border-[var(--shell-line)]',
      tableHead: 'bg-[var(--shell-line)]',
   },
   page: {
      code: 'bg-muted',
      quote: 'border-border text-muted-foreground',
      table: 'border-border',
      tableHead: 'bg-muted',
   },
} as const;

export function ChatMarkdown({
   body,
   tone = 'shell',
   className,
}: {
   body: string;
   tone?: MarkdownTone;
   className?: string;
}) {
   const blocks = parse(body);
   const tones = TONE[tone];

   return (
      <div className={cn('flex flex-col gap-1', className)}>
         {blocks.map((block, index) => {
            const key = `block-${index}`;
            if (block.kind === 'code') {
               return (
                  <pre
                     key={key}
                     className={`w-full min-w-0 overflow-x-auto rounded-md px-2.5 py-1.5 font-mono leading-4 ${tones.code}`}
                  >
                     <code>{block.lines.join('\n')}</code>
                  </pre>
               );
            }
            if (block.kind === 'heading') {
               const text = inline(block.lines[0] ?? '', key);
               // Inside a message a heading is a section marker, not a page
               // title, so the scale tops out well below the page's own. The
               // text sits under an h2 section (Activity, Summary), so its
               // first two levels share h3 and deeper ones take h4: an agent
               // that opens with "## Summary" must not skip the outline a level.
               return (block.level ?? 1) <= 2 ? (
                  <h3 key={key} className="font-medium">
                     {text}
                  </h3>
               ) : (
                  <h4 key={key} className="font-medium">
                     {text}
                  </h4>
               );
            }
            if (block.kind === 'list' || block.kind === 'ordered') {
               const items = block.lines.map((line, at) => (
                  <li key={`${key}-${at}`}>{inline(line, `${key}-${at}`)}</li>
               ));
               return block.kind === 'list' ? (
                  <ul key={key} className="list-disc pl-5">
                     {items}
                  </ul>
               ) : (
                  <ol key={key} className="list-decimal pl-5">
                     {items}
                  </ol>
               );
            }
            if (block.kind === 'quote') {
               return (
                  <blockquote key={key} className={`border-l-2 pl-3 ${tones.quote}`}>
                     {block.lines.map((line, at) => (
                        <Fragment key={`${key}-${at}`}>
                           {inline(line, `${key}-${at}`)}
                           {at < block.lines.length - 1 ? <br /> : null}
                        </Fragment>
                     ))}
                  </blockquote>
               );
            }
            if (block.kind === 'table') {
               const header = block.header ?? [];
               const rows = block.rows ?? [];
               const align = block.align ?? [];
               const cell = `border px-2 py-1 ${tones.table}`;
               return (
                  <div key={key} className="w-full min-w-0 overflow-x-auto">
                     <table className="w-full border-collapse">
                        <thead>
                           <tr>
                              {header.map((item, at) => (
                                 <th
                                    key={`${key}-h-${at}`}
                                    className={`${cell} font-medium ${tones.tableHead} ${textAlign(align[at])}`}
                                 >
                                    {inline(item, `${key}-h-${at}`)}
                                 </th>
                              ))}
                           </tr>
                        </thead>
                        <tbody>
                           {rows.map((row, rowAt) => (
                              <tr key={`${key}-r-${rowAt}`}>
                                 {header.map((_, at) => (
                                    <td
                                       key={`${key}-${rowAt}-${at}`}
                                       className={`${cell} ${textAlign(align[at])}`}
                                    >
                                       {inline(row[at] ?? '', `${key}-${rowAt}-${at}`)}
                                    </td>
                                 ))}
                              </tr>
                           ))}
                        </tbody>
                     </table>
                  </div>
               );
            }
            return (
               <p key={key} className="whitespace-pre-wrap break-words">
                  {block.lines.map((line, at) => (
                     <Fragment key={`${key}-${at}`}>
                        {inline(line, `${key}-${at}`)}
                        {at < block.lines.length - 1 ? <br /> : null}
                     </Fragment>
                  ))}
               </p>
            );
         })}
      </div>
   );
}
