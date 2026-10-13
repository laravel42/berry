import { applyFileEdit } from '../edit-file.ts';
import { insideDirectory, protectedPathReason } from '../workspace-files.ts';

/**
 * Codex's patch format, applied through Berry's file tools.
 *
 * A patch is checked whole before anything is written: every file it reads
 * must be there, every hunk must find its lines, every path must be one the
 * tools accept. Only then is it applied, one Berry tool call per change:
 * write_file for an added file, edit_file for each hunk, delete_file and
 * move_file for the rest. A patch that fails the check changes nothing.
 */

export interface PatchHunk {
   /** Text after `@@`, which places the hunk below the first line containing it. */
   anchor: string | null;
   old: string[];
   new: string[];
   endOfFile: boolean;
}

export type PatchOperation =
   | { kind: 'add'; path: string; content: string }
   | { kind: 'delete'; path: string }
   | { kind: 'update'; path: string; moveTo: string | null; hunks: PatchHunk[] };

/** One Berry tool call the patch makes, in order. */
export interface PatchStep {
   tool: 'write_file' | 'edit_file' | 'delete_file' | 'move_file';
   input: Record<string, string>;
   /** The file this step changes, for the report. */
   path: string;
}

const BEGIN = '*** Begin Patch';
const END = '*** End Patch';
const ADD = '*** Add File: ';
const DELETE = '*** Delete File: ';
const UPDATE = '*** Update File: ';
const MOVE = '*** Move to: ';
const END_OF_FILE = '*** End of File';

export function parsePatch(text: string): { operations: PatchOperation[] } | { error: string } {
   const lines = text.replace(/\r\n/g, '\n').split('\n');
   while (lines.length > 0 && lines[lines.length - 1]!.trim() === '') lines.pop();
   const start = lines.findIndex((line) => line.trim() !== '');
   if (start === -1 || lines[start]!.trim() !== BEGIN) return { error: `a patch starts with "${BEGIN}"` };
   if (lines[lines.length - 1]!.trim() !== END) return { error: `a patch ends with "${END}"` };
   const body = lines.slice(start + 1, lines.length - 1);
   const operations: PatchOperation[] = [];
   let i = 0;
   while (i < body.length) {
      const line = body[i]!;
      if (line.trim() === '') {
         i += 1;
         continue;
      }
      if (line.startsWith(ADD)) {
         const path = line.slice(ADD.length).trim();
         const added: string[] = [];
         i += 1;
         while (i < body.length && !body[i]!.startsWith('*** ')) {
            const content = body[i]!;
            if (!content.startsWith('+')) return { error: `${path}: every line of an added file starts with "+"` };
            added.push(content.slice(1));
            i += 1;
         }
         operations.push({ kind: 'add', path, content: added.length === 0 ? '' : `${added.join('\n')}\n` });
         continue;
      }
      if (line.startsWith(DELETE)) {
         operations.push({ kind: 'delete', path: line.slice(DELETE.length).trim() });
         i += 1;
         continue;
      }
      if (line.startsWith(UPDATE)) {
         const path = line.slice(UPDATE.length).trim();
         i += 1;
         let moveTo: string | null = null;
         if (i < body.length && body[i]!.startsWith(MOVE)) {
            moveTo = body[i]!.slice(MOVE.length).trim();
            i += 1;
         }
         const hunks: PatchHunk[] = [];
         let hunk: PatchHunk | null = null;
         while (i < body.length && (!body[i]!.startsWith('*** ') || body[i]!.trim() === END_OF_FILE)) {
            const content = body[i]!;
            i += 1;
            if (content.trim() === END_OF_FILE) {
               if (hunk) hunk.endOfFile = true;
               continue;
            }
            if (content.startsWith('@@')) {
               const anchor = content.slice(2).trim();
               hunk = { anchor: anchor === '' ? null : anchor, old: [], new: [], endOfFile: false };
               hunks.push(hunk);
               continue;
            }
            if (!hunk) {
               hunk = { anchor: null, old: [], new: [], endOfFile: false };
               hunks.push(hunk);
            }
            const mark = content[0];
            const rest = content.slice(1);
            if (mark === ' ' || content === '') {
               hunk.old.push(rest);
               hunk.new.push(rest);
            } else if (mark === '-') {
               hunk.old.push(rest);
            } else if (mark === '+') {
               hunk.new.push(rest);
            } else {
               return { error: `${path}, hunk ${hunks.length}: a line starts with " ", "-" or "+", not ${JSON.stringify(content.slice(0, 20))}` };
            }
         }
         const changes = hunks.filter((entry) => entry.old.join('\n') !== entry.new.join('\n') || entry.old.length !== entry.new.length);
         if (changes.length === 0 && moveTo === null) return { error: `${path}: an update needs at least one hunk that changes a line` };
         operations.push({ kind: 'update', path, moveTo, hunks: changes });
         continue;
      }
      return { error: `unexpected line in the patch: ${JSON.stringify(line.slice(0, 60))}` };
   }
   if (operations.length === 0) return { error: 'the patch changes no file' };
   return { operations };
}

/** The Berry tools a patch would call, in the order its operations name them. */
export function patchTools(text: string): string[] {
   const parsed = parsePatch(text);
   if ('error' in parsed) return [];
   const tools: string[] = [];
   const add = (name: string) => {
      if (!tools.includes(name)) tools.push(name);
   };
   for (const operation of parsed.operations) {
      if (operation.kind === 'add') add('write_file');
      else if (operation.kind === 'delete') add('delete_file');
      else {
         if (operation.moveTo !== null) add('move_file');
         if (operation.hunks.length > 0) add('edit_file');
      }
   }
   return tools;
}

/**
 * Checks the whole patch against the files as they are, and returns the tool
 * calls that apply it. `read` returns a file's text, or null when there is no
 * file at that path. Nothing is written here.
 */
export async function planPatch(
   operations: readonly PatchOperation[],
   read: (path: string) => Promise<string | null>,
   available: ReadonlySet<string>
): Promise<{ steps: PatchStep[] } | { error: string }> {
   const files = new Map<string, string | null>();
   const current = async (path: string): Promise<string | null> => {
      if (!files.has(path)) files.set(path, await read(path));
      return files.get(path) ?? null;
   };
   const steps: PatchStep[] = [];
   const need = (tool: PatchStep['tool'], path: string): string | null =>
      available.has(tool) ? null : `${path}: this patch needs ${tool}, which is not on this run`;

   for (const operation of operations) {
      const path = insideDirectory(operation.path);
      if (path === null) return { error: `${operation.path} is outside the workspace` };
      if (operation.kind === 'add') {
         const missing = need('write_file', path);
         if (missing) return { error: missing };
         files.set(path, operation.content);
         steps.push({ tool: 'write_file', input: { path, content: operation.content }, path });
         continue;
      }
      if (operation.kind === 'delete') {
         const missing = need('delete_file', path);
         if (missing) return { error: missing };
         const reason = protectedPathReason(path);
         if (reason) return { error: reason };
         if ((await current(path)) === null) return { error: `${path}: there is no file to delete` };
         files.set(path, null);
         steps.push({ tool: 'delete_file', input: { path }, path });
         continue;
      }
      let content = await current(path);
      if (content === null) return { error: `${path}: there is no file to update` };
      let target = path;
      if (operation.moveTo !== null) {
         const destination = insideDirectory(operation.moveTo);
         if (destination === null) return { error: `${operation.moveTo} is outside the workspace` };
         if (destination !== path) {
            const missing = need('move_file', path);
            if (missing) return { error: missing };
            const reason = protectedPathReason(path) ?? protectedPathReason(destination);
            if (reason) return { error: reason };
            if ((await current(destination)) !== null) return { error: `${path}: cannot move to ${destination}, which already exists` };
            files.set(path, null);
            files.set(destination, content);
            steps.push({ tool: 'move_file', input: { from: path, to: destination }, path });
            target = destination;
         }
      }
      let cursor = 0;
      for (const [index, hunk] of operation.hunks.entries()) {
         const label = `${path}, hunk ${index + 1}${hunk.anchor ? ` (@@ ${hunk.anchor})` : ''}`;
         const planned = planHunk(content, hunk, cursor);
         if ('error' in planned) return { error: `${label}: ${planned.error}` };
         if ('whole' in planned) {
            const missing = need('write_file', target);
            if (missing) return { error: missing };
            steps.push({ tool: 'write_file', input: { path: target, content: planned.whole }, path: target });
            content = planned.whole;
            cursor = planned.cursor;
            continue;
         }
         const missing = need('edit_file', target);
         if (missing) return { error: missing };
         const edited = applyFileEdit(content, planned.old, planned.new);
         if ('error' in edited) return { error: `${label}: ${edited.error}` };
         steps.push({ tool: 'edit_file', input: { path: target, old: planned.old, new: planned.new }, path: target });
         content = edited.content;
         cursor = planned.cursor;
      }
      files.set(target, content);
   }
   return { steps };
}

type PlannedHunk = { old: string; new: string; cursor: number } | { whole: string; cursor: number } | { error: string };

/**
 * Where one hunk lands, as a span edit_file accepts: text that appears once
 * in the file and what replaces it. Lines are matched exactly first, then
 * ignoring trailing spaces, then ignoring surrounding spaces, the first match
 * at or after `cursor` (where the previous hunk ended) and below the anchor.
 */
function planHunk(content: string, hunk: PatchHunk, cursor: number): PlannedHunk {
   const lines = content.split('\n');
   const starts: number[] = [];
   let offset = 0;
   for (const line of lines) {
      starts.push(offset);
      offset += line.length + 1;
   }
   // A final newline leaves an empty last element that is not a line.
   const count = content.endsWith('\n') ? lines.length - 1 : content === '' ? 0 : lines.length;
   const lineAt = (position: number) => {
      let index = 0;
      while (index + 1 < count && starts[index + 1]! <= position) index += 1;
      return index;
   };
   let from = count === 0 ? 0 : Math.min(lineAt(cursor), count);
   if (cursor >= content.length) from = count;
   if (hunk.anchor !== null) {
      const anchor = hunk.anchor.trim();
      let found = -1;
      for (const start of [from, 0]) {
         for (let index = start; index < count; index += 1) {
            if (lines[index]!.includes(anchor)) {
               found = index;
               break;
            }
         }
         if (found !== -1) break;
      }
      if (found === -1) return { error: `no line contains ${JSON.stringify(anchor)}` };
      from = hunk.old.length === 0 ? found + 1 : found;
   }

   const replacement = (endsWithNewline: boolean) =>
      hunk.new.length === 0 ? '' : `${hunk.new.join('\n')}${endsWithNewline ? '\n' : ''}`;

   if (hunk.old.length === 0) {
      const at = hunk.anchor === null || hunk.endOfFile ? count : from;
      const position = at >= count ? content.length : starts[at]!;
      const prefix = position === content.length && content !== '' && !content.endsWith('\n') ? '\n' : '';
      const inserted = `${prefix}${hunk.new.join('\n')}\n`;
      if (at === 0) return { whole: inserted + content, cursor: inserted.length };
      const before = starts[at - 1]!;
      return unique(content, before, position, content.slice(before, position) + inserted, position + inserted.length);
   }

   const comparisons: Array<(a: string, b: string) => boolean> = [
      (a, b) => a === b,
      (a, b) => a.trimEnd() === b.trimEnd(),
      (a, b) => a.trim() === b.trim(),
   ];
   const m = hunk.old.length;
   for (const same of comparisons) {
      const matches: number[] = [];
      for (let index = 0; index + m <= count; index += 1) {
         let ok = true;
         for (let j = 0; j < m; j += 1) {
            if (!same(lines[index + j]!, hunk.old[j]!)) {
               ok = false;
               break;
            }
         }
         if (ok) matches.push(index);
      }
      if (matches.length === 0) continue;
      const after = matches.filter((index) => index >= from);
      const chosen = hunk.endOfFile ? matches[matches.length - 1]! : after[0];
      if (chosen === undefined) return { error: 'its lines are only above an earlier hunk; order the hunks as they appear in the file' };
      const start = starts[chosen]!;
      const end = chosen + m < lines.length ? starts[chosen + m]! : content.length;
      const endsWithNewline = content.slice(start, end).endsWith('\n');
      const replaced = replacement(endsWithNewline);
      return unique(content, start, end, replaced, start + replaced.length);
   }
   return { error: `these lines are not in the file:\n${hunk.old.join('\n')}` };
}

/**
 * Widens content[start, end) by whole lines until it appears once, so
 * edit_file can find it. The widened text is carried into the replacement.
 */
function unique(content: string, start: number, end: number, replacement: string, cursor: number): PlannedHunk {
   let from = start;
   let to = end;
   for (;;) {
      const span = content.slice(from, to);
      if (span !== '' && occurrences(content, span) === 1) {
         return { old: span, new: content.slice(from, start) + replacement + content.slice(end, to), cursor };
      }
      if (from > 0) {
         from = content.lastIndexOf('\n', from - 2) + 1;
         continue;
      }
      if (to < content.length) {
         const next = content.indexOf('\n', to);
         to = next === -1 ? content.length : next + 1;
         continue;
      }
      return { whole: content.slice(0, start) + replacement + content.slice(end), cursor };
   }
}

function occurrences(content: string, span: string): number {
   let total = 0;
   let at = content.indexOf(span);
   while (at !== -1) {
      total += 1;
      if (total > 1) return total;
      at = content.indexOf(span, at + 1);
   }
   return total;
}
