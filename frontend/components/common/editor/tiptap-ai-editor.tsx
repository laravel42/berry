'use client';

import { EditorAiBar } from '@/components/common/editor/editor-ai-bar';
import { formatExtensions } from '@/components/common/editor/format-extensions';
import { Button } from '@/components/ui/button';
import {
   Select,
   SelectContent,
   SelectItem,
   SelectTrigger,
   SelectValue,
} from '@/components/ui/select';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { assistEditorText } from '@/lib/editor-ai';
import { formatCombo, isApplePlatform } from '@/lib/shortcuts';
import { BerryApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { EditorContent, useEditor } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import {
   Bold,
   Code,
   FoldVertical,
   Italic,
   Link2,
   List,
   ListOrdered,
   ListTodo,
   Quote,
   SquareCode,
   Strikethrough,
   Underline,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { toast } from 'sonner';
import { Markdown } from 'tiptap-markdown';

interface TiptapAiEditorProps {
   /** Markdown text stored by the form. */
   'value': string;
   /** Fired with markdown on every editor update. */
   'onChange': (markdown: string) => void;
   /**
    * Fired when the editor loses focus. Use for commit-on-blur surfaces that
    * should not PATCH on every keystroke.
    */
   'onBlur'?: (markdown: string) => void;
   'placeholder'?: string;
   'className'?: string;
   'aria-label'?: string;
   'data-heading'?: 'h1' | 'h2' | 'h3';
   /**
    * The AI assist bar under the text. On by default; a form that wants plain
    * prose turns it off, and the space the bar reserved goes with it.
    */
   'aiAssist'?: boolean;
   /**
    * Drops the top margin on the first block. Task descriptions use it so
    * the text sits against the field.
    */
   'formatting'?: boolean;
}

type TipTapEditor = NonNullable<ReturnType<typeof useEditor>>;

function readMarkdown(editor: TipTapEditor): string {
   // tiptap-markdown declares MarkdownStorage but does not augment @tiptap/core Storage.
   const storage = editor.storage as unknown as { markdown?: { getMarkdown(): string } };
   return storage.markdown?.getMarkdown() ?? editor.getText();
}

export function TiptapAiEditor({
   value,
   onChange,
   onBlur,
   placeholder,
   className,
   'aria-label': ariaLabel,
   'data-heading': dataHeading,
   aiAssist = true,
   formatting = false,
}: TiptapAiEditorProps) {
   const [aiPrompt, setAiPrompt] = useState('');
   const [aiPending, setAiPending] = useState(false);
   const [formatRevision, setFormatRevision] = useState(0);
   const focusedRef = useRef(false);
   const blockMenuOpen = useRef(false);
   const setLinkRef = useRef<() => void>(() => {});
   const onBlurRef = useRef(onBlur);
   onBlurRef.current = onBlur;

   const editor = useEditor({
      extensions: [
         StarterKit.configure({ underline: false }),
         ...formatExtensions,
         Placeholder.configure({ placeholder: placeholder ?? '' }),
         Link.configure({ openOnClick: false, autolink: true }),
         Markdown.configure({
            html: false,
            transformPastedText: true,
            transformCopiedText: true,
         }),
      ],
      content: value,
      immediatelyRender: false,
      editorProps: {
         attributes: {
            class: 'outline-none',
            ...(ariaLabel ? { 'aria-label': ariaLabel } : {}),
            ...(dataHeading ? { 'data-heading': dataHeading } : {}),
         },
      },
      onUpdate: ({ editor: current }) => {
         onChange(readMarkdown(current));
      },
      onSelectionUpdate: () => {
         setFormatRevision((current) => current + 1);
      },
      onFocus: () => {
         focusedRef.current = true;
      },
      onBlur: ({ editor: current }) => {
         focusedRef.current = false;
         onBlurRef.current?.(readMarkdown(current));
      },
   });

   useEffect(() => {
      if (!editor) return;
      const onBlur = (event: FocusEvent) => {
         if (!blockMenuOpen.current) return;
         event.stopImmediatePropagation();
      };
      editor.view.dom.addEventListener('blur', onBlur, true);
      return () => editor.view.dom.removeEventListener('blur', onBlur, true);
   }, [editor]);

   useEffect(() => {
      if (!editor) return;
      const onKeyDown = (event: KeyboardEvent) => {
         if (event.repeat || event.altKey || !event.shiftKey) return;
         const mod = isApplePlatform() ? event.metaKey : event.ctrlKey;
         if (!mod) return;
         if (event.key === 'Enter') {
            event.preventDefault();
            toggleCollapse(editor);
            return;
         }
         if (event.key.toLowerCase() === 'l') {
            event.preventDefault();
            setLinkRef.current();
         }
      };
      editor.view.dom.addEventListener('keydown', onKeyDown);
      return () => editor.view.dom.removeEventListener('keydown', onKeyDown);
   }, [editor]);

   useEffect(() => {
      if (!editor || focusedRef.current) return;
      const current = readMarkdown(editor);
      if (current !== value) {
         editor.commands.setContent(value);
      }
   }, [editor, value]);

   const runAssist = useCallback(
      async (instruction: string) => {
         if (!editor || aiPending) return;
         const trimmedInstruction = instruction.trim();
         if (!trimmedInstruction) return;

         const { from, to } = editor.state.selection;
         const selected = from !== to ? editor.state.doc.textBetween(from, to, '\n\n').trim() : '';
         const source = selected || readMarkdown(editor).trim();
         if (!source) {
            toast.error('Write something to rewrite');
            return;
         }

         setAiPending(true);
         try {
            const rewritten = await assistEditorText({
               text: source,
               instruction: `${trimmedInstruction}\n\nReturn Markdown only.`,
            });
            if (selected) {
               editor.chain().focus().deleteRange({ from, to }).insertContent(rewritten).run();
            } else {
               editor.commands.setContent(rewritten);
            }
            onChange(readMarkdown(editor));
         } catch (error) {
            toast.error(error instanceof BerryApiError ? error.message : 'Could not rewrite text');
         } finally {
            setAiPending(false);
         }
      },
      [aiPending, editor, onChange]
   );

   const setLink = useCallback(() => {
      if (!editor) return;
      const previousUrl = editor.getAttributes('link').href as string | undefined;
      const url = window.prompt('Link URL', previousUrl ?? 'https://');
      if (url === null) return;
      if (url.trim() === '') {
         editor.chain().focus().extendMarkRange('link').unsetLink().run();
         return;
      }
      editor.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run();
   }, [editor]);
   setLinkRef.current = setLink;

   if (!editor) {
      return (
         <div
            className={cn('tiptap-ai-editor text-muted-foreground min-h-24', className)}
            data-heading={dataHeading}
         >
            {placeholder}
         </div>
      );
   }

   return (
      <div
         className={cn(
            'tiptap-ai-editor relative flex min-h-0 flex-1 flex-col',
            formatting && 'formatting-editor',
            className
         )}
         onPointerDown={(event) => event.stopPropagation()}
      >
         <BubbleMenu
            editor={editor}
            options={{ offset: 8 }}
            shouldShow={({ editor: current, from, to }) => {
               if (blockMenuOpen.current) return true;
               return current.isEditable && from !== to && current.view.hasFocus();
            }}
            className="bg-popover text-popover-foreground border-border flex items-center gap-0.5 rounded-md border p-1 shadow-md"
         >
            <BlockTypeSelect editor={editor} openRef={blockMenuOpen} />
            {FORMAT_CONTROLS.map((control) => {
               const Icon = control.icon;
               const pressed = editor.isActive(control.name);
               return (
                  <FormatHint
                     key={`${control.label}-${formatRevision}`}
                     label={control.label}
                     shortcut={control.shortcut}
                  >
                     <Button
                        type="button"
                        variant={pressed ? 'secondary' : 'ghost'}
                        size="icon"
                        className="size-7"
                        aria-label={control.label}
                        aria-pressed={pressed}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => control.run(editor)}
                     >
                        <Icon className="size-3.5" />
                     </Button>
                  </FormatHint>
               );
            })}
            <FormatHint label="Insert link" shortcut="mod+shift+l">
               <Button
                  type="button"
                  variant={editor.isActive('link') ? 'secondary' : 'ghost'}
                  size="icon"
                  className="size-7"
                  aria-label="Insert link"
                  aria-pressed={editor.isActive('link')}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={setLink}
               >
                  <Link2 className="size-3.5" />
               </Button>
            </FormatHint>
         </BubbleMenu>
         <EditorContent
            editor={editor}
            className={cn(formatting ? 'min-h-24' : 'min-h-24 flex-1', aiAssist && 'pb-16')}
         />
         {aiAssist ? (
            <EditorAiBar
               prompt={aiPrompt}
               onPromptChange={setAiPrompt}
               onPreset={(instruction) => void runAssist(instruction)}
               onSubmit={() => {
                  const instruction = aiPrompt.trim();
                  if (!instruction) return;
                  void runAssist(instruction).then(() => setAiPrompt(''));
               }}
               pending={aiPending}
            />
         ) : null}
      </div>
   );
}

const BLOCK_TYPES = [
   { value: 'paragraph', label: 'Regular' },
   { value: '1', label: 'Heading 1' },
   { value: '2', label: 'Heading 2' },
   { value: '3', label: 'Heading 3' },
   { value: '4', label: 'Heading 4' },
] as const;

function currentBlock(editor: TipTapEditor): string {
   for (const level of [1, 2, 3, 4] as const) {
      if (editor.isActive('heading', { level })) return String(level);
   }
   return 'paragraph';
}

function applyBlock(editor: TipTapEditor, value: string) {
   const chain = editor.chain().focus();
   if (value === 'paragraph') {
      chain.setParagraph().run();
      return;
   }
   if (value === '1' || value === '2' || value === '3' || value === '4') {
      chain.setHeading({ level: Number(value) as 1 | 2 | 3 | 4 }).run();
   }
}

function BlockTypeSelect({
   editor,
   openRef,
}: {
   editor: TipTapEditor;
   openRef: { current: boolean };
}) {
   return (
      <Select
         value={currentBlock(editor)}
         onValueChange={(value) => applyBlock(editor, value)}
         onOpenChange={(open) => {
            openRef.current = open;
         }}
      >
         <FormatHint label="Font type" shortcut={headingShortcut()}>
            <SelectTrigger
               aria-label="Font type"
               className="mr-1 h-7 w-auto gap-1 px-2 py-0 shadow-none"
               onClick={(event) => event.preventDefault()}
            >
               <SelectValue />
            </SelectTrigger>
         </FormatHint>
         <SelectContent className="z-[60]" onCloseAutoFocus={(event) => event.preventDefault()}>
            {BLOCK_TYPES.map((type) => (
               <SelectItem key={type.value} value={type.value}>
                  {type.label}
               </SelectItem>
            ))}
         </SelectContent>
      </Select>
   );
}

type BlockJSON = {
   type: string;
   content?: BlockJSON[];
};

function toggleCollapse(editor: TipTapEditor) {
   if (editor.isActive('details')) {
      const { $from } = editor.state.selection;
      let depth = $from.depth;
      while (depth > 0 && $from.node(depth).type.name !== 'details') depth -= 1;
      if (depth === 0) return;
      const details = $from.node(depth);
      const summary = details.child(0).content.toJSON() as BlockJSON[] | null;
      const body = (details.child(1).content.toJSON() as BlockJSON[] | null) ?? [];
      const bodyBlocks = body.filter(
         (block, index, all) =>
            !(
               all.length === 1 &&
               block.type === 'paragraph' &&
               !block.content?.length &&
               index === 0
            )
      );
      editor
         .chain()
         .focus()
         .insertContentAt({ from: $from.before(depth), to: $from.after(depth) }, [
            {
               type: 'paragraph',
               ...(summary?.length ? { content: summary } : {}),
            },
            ...bodyBlocks,
         ])
         .run();
      return;
   }

   const range = editor.state.selection.$from.blockRange(editor.state.selection.$to);
   if (!range) return;
   const blocks = editor.state.doc.slice(range.start, range.end).content.toJSON() as
      BlockJSON[] | null;
   const first = blocks?.[0];
   if (!first) return;
   const inlineFirst = first.type === 'paragraph' || first.type === 'heading';
   const summary = inlineFirst ? (first.content ?? []) : [{ type: 'text', text: 'Details' }];
   const body = inlineFirst ? blocks.slice(1) : blocks;
   editor
      .chain()
      .focus()
      .insertContentAt(
         { from: range.start, to: range.end },
         {
            type: 'details',
            attrs: { open: false },
            content: [
               { type: 'detailsSummary', content: summary },
               {
                  type: 'detailsContent',
                  content: body.length > 0 ? body : [{ type: 'paragraph' }],
               },
            ],
         }
      )
      .run();
}

/** Headings are ⌘⌥1 through ⌘⌥4. The font control covers that whole range. */
function headingShortcut(): string {
   const first = formatCombo('mod+alt+1');
   return `${first.slice(0, -1)}1–4`;
}

function FormatHint({
   label,
   shortcut,
   children,
}: {
   label: string;
   shortcut: string;
   children: ReactElement;
}) {
   const keys = shortcut.startsWith('mod+') ? formatCombo(shortcut) : shortcut;
   return (
      <Tooltip>
         <TooltipTrigger asChild>{children}</TooltipTrigger>
         <TooltipContent side="top" className="z-[60] flex items-center gap-2 px-2 py-1">
            <span className="text-foreground">{label}</span>
            <kbd className="inline-flex items-center rounded border bg-muted/50 px-1 font-sans">
               {keys}
            </kbd>
         </TooltipContent>
      </Tooltip>
   );
}

const FORMAT_CONTROLS: {
   label: string;
   shortcut: string;
   icon: typeof Bold;
   name: string;
   run: (editor: TipTapEditor) => void;
}[] = [
   {
      label: 'Bold',
      shortcut: 'mod+b',
      icon: Bold,
      name: 'bold',
      run: (editor) => editor.chain().focus().toggleBold().run(),
   },
   {
      label: 'Italic',
      shortcut: 'mod+i',
      icon: Italic,
      name: 'italic',
      run: (editor) => editor.chain().focus().toggleItalic().run(),
   },
   {
      label: 'Underline',
      shortcut: 'mod+u',
      icon: Underline,
      name: 'underline',
      run: (editor) => editor.chain().focus().toggleUnderline().run(),
   },
   {
      label: 'Strikethrough',
      shortcut: 'mod+shift+s',
      icon: Strikethrough,
      name: 'strike',
      run: (editor) => editor.chain().focus().toggleStrike().run(),
   },
   {
      label: 'Text collapse',
      shortcut: 'mod+shift+enter',
      icon: FoldVertical,
      name: 'details',
      run: (editor) => toggleCollapse(editor),
   },
   {
      label: 'Bulleted list',
      shortcut: 'mod+shift+8',
      icon: List,
      name: 'bulletList',
      run: (editor) => editor.chain().focus().toggleBulletList().run(),
   },
   {
      label: 'Numbered list',
      shortcut: 'mod+shift+7',
      icon: ListOrdered,
      name: 'orderedList',
      run: (editor) => editor.chain().focus().toggleOrderedList().run(),
   },
   {
      label: 'Checkbox list',
      shortcut: 'mod+shift+9',
      icon: ListTodo,
      name: 'taskList',
      run: (editor) => editor.chain().focus().toggleTaskList().run(),
   },
   {
      label: 'Block quote',
      shortcut: 'mod+shift+b',
      icon: Quote,
      name: 'blockquote',
      run: (editor) => editor.chain().focus().toggleBlockquote().run(),
   },
   {
      label: 'Inline code',
      shortcut: 'mod+e',
      icon: Code,
      name: 'code',
      run: (editor) => editor.chain().focus().toggleCode().run(),
   },
   {
      label: 'Code block',
      shortcut: 'mod+alt+c',
      icon: SquareCode,
      name: 'codeBlock',
      run: (editor) => editor.chain().focus().toggleCodeBlock().run(),
   },
];
