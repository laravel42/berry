'use client';

import type { Editor } from '@tiptap/react';
import {
   FoldVertical,
   Heading1,
   Heading2,
   Heading3,
   List,
   ListOrdered,
   ListTodo,
   Minus,
   Pilcrow,
   Quote,
   SquareCode,
   type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { cn } from '@/lib/utils';

interface SlashCommand {
   id: string;
   label: string;
   hint: string;
   icon: LucideIcon;
   /** Extra words the filter matches, beside the label. */
   keywords: string[];
   run: (editor: Editor) => void;
}

/** Where the open menu is: the `/` and the cursor after what was typed. */
interface SlashState {
   from: number;
   to: number;
   query: string;
   left: number;
   top: number;
}

/** A `/` at the start of a block or after a space, then word characters. */
const TRIGGER = /(?:^|\s)\/([\w-]{0,24})$/;

function commands(toggleCollapse: (editor: Editor) => void): SlashCommand[] {
   return [
      {
         id: 'text',
         label: 'Text',
         hint: 'Plain paragraph',
         icon: Pilcrow,
         keywords: ['paragraph', 'plain'],
         run: (editor) => editor.chain().focus().setParagraph().run(),
      },
      {
         id: 'h1',
         label: 'Heading 1',
         hint: 'Big section heading',
         icon: Heading1,
         keywords: ['title', 'h1'],
         run: (editor) => editor.chain().focus().setHeading({ level: 1 }).run(),
      },
      {
         id: 'h2',
         label: 'Heading 2',
         hint: 'Medium section heading',
         icon: Heading2,
         keywords: ['subtitle', 'h2'],
         run: (editor) => editor.chain().focus().setHeading({ level: 2 }).run(),
      },
      {
         id: 'h3',
         label: 'Heading 3',
         hint: 'Small section heading',
         icon: Heading3,
         keywords: ['h3'],
         run: (editor) => editor.chain().focus().setHeading({ level: 3 }).run(),
      },
      {
         id: 'bullets',
         label: 'Bulleted list',
         hint: 'A simple list',
         icon: List,
         keywords: ['unordered', 'ul', 'list'],
         run: (editor) => editor.chain().focus().toggleBulletList().run(),
      },
      {
         id: 'numbers',
         label: 'Numbered list',
         hint: 'A list with numbers',
         icon: ListOrdered,
         keywords: ['ordered', 'ol', 'list'],
         run: (editor) => editor.chain().focus().toggleOrderedList().run(),
      },
      {
         id: 'todo',
         label: 'Checklist',
         hint: 'Track tasks with checkboxes',
         icon: ListTodo,
         keywords: ['todo', 'task', 'checkbox'],
         run: (editor) => editor.chain().focus().toggleTaskList().run(),
      },
      {
         id: 'quote',
         label: 'Quote',
         hint: 'Capture a quote',
         icon: Quote,
         keywords: ['blockquote', 'citation'],
         run: (editor) => editor.chain().focus().toggleBlockquote().run(),
      },
      {
         id: 'code',
         label: 'Code block',
         hint: 'Fenced code',
         icon: SquareCode,
         keywords: ['snippet', 'pre'],
         run: (editor) => editor.chain().focus().toggleCodeBlock().run(),
      },
      {
         id: 'divider',
         label: 'Divider',
         hint: 'A horizontal line',
         icon: Minus,
         keywords: ['separator', 'rule', 'hr', 'line'],
         run: (editor) => editor.chain().focus().setHorizontalRule().run(),
      },
      {
         id: 'toggle',
         label: 'Toggle',
         hint: 'A collapsible section',
         icon: FoldVertical,
         keywords: ['collapse', 'details', 'fold'],
         run: (editor) => toggleCollapse(editor),
      },
   ];
}

/**
 * Notion's "/" menu: typing `/` at the start of a block (or after a space)
 * opens a filtered list of blocks at the cursor. Arrow keys move, Enter or
 * Tab inserts, Escape dismisses until the text changes; the typed `/query`
 * is replaced by the block.
 */
export function SlashMenu({
   editor,
   toggleCollapse,
}: {
   editor: Editor;
   toggleCollapse: (editor: Editor) => void;
}) {
   const all = useMemo(() => commands(toggleCollapse), [toggleCollapse]);
   const [state, setState] = useState<SlashState | null>(null);
   const [active, setActive] = useState(0);
   /** The `/` position Escape dismissed; reopened only by a new `/`. */
   const dismissed = useRef<number | null>(null);

   const matches = useMemo(() => {
      if (!state) return [];
      const needle = state.query.toLowerCase();
      if (!needle) return all;
      return all.filter(
         (command) =>
            command.label.toLowerCase().includes(needle) ||
            command.keywords.some((word) => word.startsWith(needle))
      );
   }, [all, state]);

   const read = useCallback(() => {
      const { selection } = editor.state;
      if (!selection.empty || !editor.isEditable) return setState(null);
      const { $from } = selection;
      if (!$from.parent.isTextblock || $from.parent.type.name === 'codeBlock')
         return setState(null);
      const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '￼');
      const match = TRIGGER.exec(before);
      if (!match) {
         dismissed.current = null;
         return setState(null);
      }
      const query = match[1] ?? '';
      const from = $from.pos - query.length - 1;
      if (dismissed.current === from) return setState(null);
      const coords = editor.view.coordsAtPos(from);
      setState({ from, to: $from.pos, query, left: coords.left, top: coords.bottom + 6 });
   }, [editor]);

   useEffect(() => {
      const close = () => setState(null);
      editor.on('update', read);
      editor.on('selectionUpdate', read);
      editor.on('blur', close);
      return () => {
         editor.off('update', read);
         editor.off('selectionUpdate', read);
         editor.off('blur', close);
      };
   }, [editor, read]);

   useEffect(() => setActive(0), [state?.query]);

   const apply = useCallback(
      (command: SlashCommand) => {
         if (!state) return;
         editor.chain().focus().deleteRange({ from: state.from, to: state.to }).run();
         command.run(editor);
         setState(null);
      },
      [editor, state]
   );

   useEffect(() => {
      if (!state) return;
      const onKeyDown = (event: KeyboardEvent) => {
         if (event.key === 'Escape') {
            dismissed.current = state.from;
            setState(null);
         } else if (matches.length === 0) {
            return;
         } else if (event.key === 'ArrowDown') {
            setActive((index) => (index + 1) % matches.length);
         } else if (event.key === 'ArrowUp') {
            setActive((index) => (index - 1 + matches.length) % matches.length);
         } else if (event.key === 'Enter' || event.key === 'Tab') {
            const command = matches[Math.min(active, matches.length - 1)];
            if (command) apply(command);
         } else {
            return;
         }
         event.preventDefault();
         event.stopPropagation();
      };
      // Capture, so the editor never sees a key the menu used.
      const dom = editor.view.dom;
      dom.addEventListener('keydown', onKeyDown, true);
      return () => dom.removeEventListener('keydown', onKeyDown, true);
   }, [editor, state, matches, active, apply]);

   if (!state || matches.length === 0) return null;

   return createPortal(
      <div
         role="listbox"
         aria-label="Insert block"
         className="bg-popover text-popover-foreground fixed z-[70] max-h-80 w-64 overflow-y-auto rounded-md border p-1 shadow-md"
         style={{ left: state.left, top: state.top }}
         // Clicking an entry must not take focus from the editor.
         onMouseDown={(event) => event.preventDefault()}
      >
         {matches.map((command, index) => {
            const Icon = command.icon;
            return (
               <button
                  key={command.id}
                  type="button"
                  role="option"
                  aria-selected={index === active}
                  onMouseEnter={() => setActive(index)}
                  onClick={() => apply(command)}
                  className={cn(
                     'flex w-full items-center gap-2.5 rounded-sm px-2 py-1.5 text-left',
                     index === active && 'bg-accent text-accent-foreground'
                  )}
               >
                  <span className="bg-background flex size-7 flex-none items-center justify-center rounded border">
                     <Icon className="size-4" aria-hidden />
                  </span>
                  <span className="flex min-w-0 flex-col">
                     <span className="truncate">{command.label}</span>
                     <span className="text-muted-foreground truncate" data-caption="">
                        {command.hint}
                     </span>
                  </span>
               </button>
            );
         })}
      </div>,
      document.body
   );
}
