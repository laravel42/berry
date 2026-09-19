'use client';

import {
   autocompletion,
   closeBrackets,
   closeBracketsKeymap,
   completeAnyWord,
   completionKeymap,
} from '@codemirror/autocomplete';
import { history, historyKeymap, redoDepth, undoDepth } from '@codemirror/commands';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { json, jsonParseLinter } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { sql } from '@codemirror/lang-sql';
import { xml } from '@codemirror/lang-xml';
import { yaml } from '@codemirror/lang-yaml';
import { HighlightStyle, StreamLanguage, syntaxHighlighting } from '@codemirror/language';
import { lintGutter, lintKeymap, linter } from '@codemirror/lint';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { EditorState, type Extension } from '@codemirror/state';
import {
   EditorView,
   crosshairCursor,
   drawSelection,
   keymap,
   rectangularSelection,
} from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import CodeMirror from '@uiw/react-codemirror';
import { memo, useMemo, useRef, type MutableRefObject } from 'react';

import { cn } from '@/lib/utils';

export type { EditorView };

export type CodeEditorLanguage =
   | 'bash'
   | 'javascript'
   | 'typescript'
   | 'json'
   | 'css'
   | 'html'
   | 'xml'
   | 'yaml'
   | 'python'
   | 'sql'
   | 'markdown'
   | 'plain';

interface CodeEditorProps {
   value: string;
   /** Bash by default, which is what the run transcript shows; `plain` has no grammar. */
   language?: CodeEditorLanguage;
   className?: string;
   /** Cap the scroller, e.g. `10rem` / `18rem`. Omit for natural height. */
   maxHeight?: string;
   /**
    * When false, the surface accepts typing — for reviewing an agent's file
    * in place. Defaults to read-only so transcripts stay a display.
    */
   readOnly?: boolean;
   onChange?: (value: string) => void;
   /** Head of the primary selection as 1-based line and column. */
   onCursorChange?: (position: { line: number; column: number }) => void;
   /** Filled with the live editor view so a toolbar can undo / redo. */
   viewRef?: MutableRefObject<EditorView | null>;
   /** Whether the history stack has something to undo or redo. */
   onHistoryChange?: (state: { canUndo: boolean; canRedo: boolean }) => void;
}

/**
 * Per-filetype grammar, completion tables, and (where we have one) a linter.
 * Lezer languages ship their own keyword/property completion; stream modes
 * fall back to buffer-word completion via `completeAnyWord` below.
 */
function languageExtension(language: CodeEditorLanguage): Extension[] {
   switch (language) {
      case 'bash':
         return [StreamLanguage.define(shell)];
      case 'javascript':
         // Local names + JS snippets; JSX auto-closes tags.
         return [javascript({ jsx: true })];
      case 'typescript':
         return [javascript({ jsx: true, typescript: true })];
      case 'json':
         return [json(), linter(jsonParseLinter()), lintGutter()];
      case 'css':
         return [css()];
      case 'html':
         return [html({ autoCloseTags: true })];
      case 'xml':
         return [xml()];
      case 'yaml':
         return [yaml()];
      case 'python':
         return [python()];
      case 'sql':
         return [sql()];
      case 'markdown':
         return [markdown()];
      case 'plain':
         return [];
   }
}

/** The grammar for a file, from its extension; `plain` when there is none worth having. */
export function languageForPath(path: string): CodeEditorLanguage {
   const extension = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
   switch (extension) {
      case 'js':
      case 'mjs':
      case 'cjs':
      case 'jsx':
         return 'javascript';
      case 'ts':
      case 'tsx':
      case 'mts':
      case 'cts':
         return 'typescript';
      case 'json':
      case 'jsonc':
         return 'json';
      case 'css':
      case 'scss':
      case 'sass':
      case 'less':
         return 'css';
      case 'html':
      case 'htm':
         return 'html';
      case 'svg':
      case 'xml':
      case 'xsl':
         return 'xml';
      case 'yml':
      case 'yaml':
         return 'yaml';
      case 'py':
      case 'pyi':
         return 'python';
      case 'sql':
         return 'sql';
      case 'md':
      case 'mdx':
      case 'markdown':
         return 'markdown';
      case 'sh':
      case 'bash':
      case 'zsh':
         return 'bash';
      default:
         return 'plain';
   }
}

/** Token colours for void chrome — chalk body, soft accents, never light-theme reds. */
const berryDarkHighlight = HighlightStyle.define([
   { tag: t.comment, color: 'var(--brand-ash)', fontStyle: 'italic' },
   { tag: t.lineComment, color: 'var(--brand-ash)', fontStyle: 'italic' },
   { tag: t.blockComment, color: 'var(--brand-ash)', fontStyle: 'italic' },
   { tag: t.docComment, color: 'var(--brand-ash)', fontStyle: 'italic' },
   { tag: t.meta, color: 'var(--brand-ash)' },
   { tag: t.keyword, color: 'var(--brand-azure)' },
   { tag: t.moduleKeyword, color: 'var(--brand-azure)' },
   { tag: t.controlKeyword, color: 'var(--brand-azure)' },
   { tag: t.operatorKeyword, color: 'var(--brand-azure)' },
   { tag: t.definitionKeyword, color: 'var(--brand-azure)' },
   { tag: t.atom, color: 'var(--brand-amber)' },
   { tag: t.bool, color: 'var(--brand-amber)' },
   { tag: t.null, color: 'var(--brand-amber)' },
   { tag: t.number, color: 'var(--brand-amber)' },
   { tag: t.string, color: 'var(--brand-verdant)' },
   { tag: t.special(t.string), color: 'var(--brand-verdant)' },
   { tag: t.character, color: 'var(--brand-verdant)' },
   { tag: t.quote, color: 'var(--brand-verdant)' },
   { tag: t.regexp, color: 'var(--brand-verdant)' },
   { tag: t.operator, color: 'var(--brand-chalk)' },
   { tag: t.punctuation, color: 'var(--brand-ash)' },
   { tag: t.bracket, color: 'var(--brand-ash)' },
   { tag: t.angleBracket, color: 'var(--brand-ash)' },
   { tag: t.squareBracket, color: 'var(--brand-ash)' },
   { tag: t.paren, color: 'var(--brand-ash)' },
   { tag: t.attributeName, color: 'var(--brand-azure)' },
   { tag: t.attributeValue, color: 'var(--brand-verdant)' },
   { tag: t.propertyName, color: 'var(--brand-amber)' },
   { tag: t.definition(t.propertyName), color: 'var(--brand-amber)' },
   { tag: t.variableName, color: 'var(--brand-chalk)' },
   { tag: t.definition(t.variableName), color: 'var(--brand-chalk)' },
   { tag: t.local(t.variableName), color: 'var(--brand-chalk)' },
   { tag: t.function(t.variableName), color: 'var(--brand-azure)' },
   { tag: t.definition(t.function(t.variableName)), color: 'var(--brand-azure)' },
   { tag: t.className, color: 'var(--brand-amber)' },
   { tag: t.typeName, color: 'var(--brand-amber)' },
   { tag: t.namespace, color: 'var(--brand-amber)' },
   { tag: t.tagName, color: 'var(--brand-azure)' },
   { tag: t.name, color: 'var(--brand-chalk)' },
   { tag: t.literal, color: 'var(--brand-chalk)' },
   { tag: t.heading, color: 'var(--brand-azure)', fontWeight: 'bold' },
   { tag: t.heading1, color: 'var(--brand-azure)', fontWeight: 'bold' },
   { tag: t.heading2, color: 'var(--brand-azure)', fontWeight: 'bold' },
   { tag: t.link, color: 'var(--brand-azure)', textDecoration: 'underline' },
   { tag: t.url, color: 'var(--brand-verdant)' },
   { tag: t.emphasis, fontStyle: 'italic' },
   { tag: t.strong, fontWeight: 'bold' },
   { tag: t.strikethrough, textDecoration: 'line-through' },
   { tag: t.standard(t.name), color: 'var(--brand-azure)' },
   { tag: t.invalid, color: 'var(--status-danger)' },
]);

/**
 * Code surface with syntax colouring.
 *
 * Used where a plain `<pre>` was showing shell or tool output: the editor chrome
 * keeps the monospace measure and wrapping of those blocks, and bash tokens
 * make commands readable. Read-only by default so a transcript is not an
 * editable field; pass `readOnly={false}` when the caller wants typing.
 *
 * Memoised: a parent that only updates a cursor label must not reconfigure
 * CodeMirror mid-drag, or multi-line selection collapses.
 */
export const CodeEditor = memo(function CodeEditor({
   value,
   language = 'bash',
   className,
   maxHeight,
   readOnly = true,
   onChange,
   onCursorChange,
   viewRef,
   onHistoryChange,
}: CodeEditorProps) {
   const onCursorChangeRef = useRef(onCursorChange);
   onCursorChangeRef.current = onCursorChange;
   const onHistoryChangeRef = useRef(onHistoryChange);
   onHistoryChangeRef.current = onHistoryChange;
   const lastHistoryRef = useRef<{ canUndo: boolean; canRedo: boolean } | null>(null);
   const lastCursorRef = useRef<{ line: number; column: number } | null>(null);
   const pointerSelectingRef = useRef(false);

   // Stable object identity — @uiw/react-codemirror reconfigures the view
   // whenever `basicSetup` changes, which kills an in-progress selection.
   const basicSetup = useMemo(
      () => ({
         lineNumbers: true,
         foldGutter: false,
         highlightActiveLine: !readOnly,
         highlightActiveLineGutter: !readOnly,
         highlightSelectionMatches: false,
         bracketMatching: !readOnly,
         // We own history when editable so undo depth and keymaps stay in sync.
         history: false,
         drawSelection: true,
         allowMultipleSelections: !readOnly,
         rectangularSelection: !readOnly,
         // Light defaultHighlightStyle was colouring keywords red on void.
         syntaxHighlighting: false,
      }),
      [readOnly]
   );

   const extensions = useMemo(
      () => [
         ...languageExtension(language),
         syntaxHighlighting(berryDarkHighlight),
         EditorView.lineWrapping,
         EditorView.editable.of(!readOnly),
         EditorView.domEventHandlers({
            mousedown: (event) => {
               if (event.button !== 0) return false;
               pointerSelectingRef.current = true;
               const onUp = () => {
                  pointerSelectingRef.current = false;
                  window.removeEventListener('mouseup', onUp);
                  const pending = lastCursorRef.current;
                  if (pending) onCursorChangeRef.current?.(pending);
               };
               window.addEventListener('mouseup', onUp);
               return false;
            },
         }),
         EditorView.updateListener.of((update) => {
            const reportCursor = onCursorChangeRef.current;
            if (reportCursor && (update.selectionSet || update.docChanged || update.focusChanged)) {
               const head = update.state.selection.main.head;
               const line = update.state.doc.lineAt(head);
               const next = { line: line.number, column: head - line.from + 1 };
               const prev = lastCursorRef.current;
               if (!prev || prev.line !== next.line || prev.column !== next.column) {
                  lastCursorRef.current = next;
                  // Defer React state until the pointer is up so a status-bar
                  // re-render cannot reconfigure the editor mid-drag.
                  if (!pointerSelectingRef.current) reportCursor(next);
               }
            }
            // Depth only moves when the document does; reporting on every
            // transaction re-renders the parent and loops the update listener.
            const reportHistory = onHistoryChangeRef.current;
            if (reportHistory && update.docChanged) {
               const next = {
                  canUndo: undoDepth(update.state) > 0,
                  canRedo: redoDepth(update.state) > 0,
               };
               const prev = lastHistoryRef.current;
               if (!prev || prev.canUndo !== next.canUndo || prev.canRedo !== next.canRedo) {
                  lastHistoryRef.current = next;
                  reportHistory(next);
               }
            }
         }),
         // Language packages register their own completion sources; word
         // completion is a fallback for shell / plain, not an override.
         ...(readOnly
            ? []
            : [
                 EditorState.allowMultipleSelections.of(true),
                 drawSelection(),
                 rectangularSelection(),
                 crosshairCursor(),
                 history(),
                 closeBrackets(),
                 EditorState.languageData.of(() => [{ autocomplete: completeAnyWord }]),
                 autocompletion({
                    activateOnTyping: true,
                    icons: true,
                 }),
                 keymap.of([
                    ...closeBracketsKeymap,
                    ...completionKeymap,
                    ...lintKeymap,
                    ...historyKeymap,
                 ]),
              ]),
         EditorView.theme(
            {
               '&': {
                  backgroundColor: 'var(--brand-void)',
                  color: 'var(--brand-chalk)',
                  // Fixed metrics so gutters and lines share one box; `inherit`
                  // picked up the dialog's leading and drifted the numbers.
                  fontSize: '12px',
                  height: '100%',
               },
               '.cm-scroller': {
                  overflow: 'auto',
                  ...(maxHeight ? { maxHeight } : { height: '100%', maxHeight: 'none' }),
                  fontFamily: 'var(--font-mono)',
                  lineHeight: '20px',
                  fontSize: '12px',
               },
               '.cm-content': {
                  caretColor: readOnly ? 'transparent' : 'var(--brand-chalk)',
                  color: 'var(--brand-chalk)',
                  fontFamily: 'inherit',
                  fontSize: 'inherit',
                  lineHeight: 'inherit',
                  padding: '8px 0',
               },
               '.cm-line': {
                  padding: '0 12px 0 8px',
                  fontSize: 'inherit',
                  lineHeight: 'inherit',
                  color: 'var(--brand-chalk)',
               },
               '.cm-gutters': {
                  backgroundColor: 'var(--brand-void)',
                  color: 'var(--brand-ash)',
                  border: 'none',
                  borderRight: '1px solid var(--brand-hairline)',
                  fontFamily: 'inherit',
                  fontSize: 'inherit',
                  lineHeight: 'inherit',
               },
               '.cm-lineNumbers .cm-gutterElement': {
                  padding: '0 8px 0 12px',
                  minWidth: '2rem',
                  fontSize: 'inherit',
                  lineHeight: 'inherit',
                  // CodeMirror sets each element's height to the line's box;
                  // top-align the digit inside that box so wraps stay honest.
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'flex-end',
                  boxSizing: 'border-box',
               },
               '.cm-activeLineGutter': {
                  backgroundColor: 'transparent',
                  color: 'var(--brand-chalk)',
               },
               // Transparent so it does not cover the selection wash.
               '.cm-activeLine': {
                  backgroundColor: 'transparent',
               },
               '&.cm-focused': { outline: 'none' },
               ...(readOnly
                  ? { '.cm-cursor, .cm-dropCursor': { display: 'none' } }
                  : {
                       '.cm-cursor, .cm-dropCursor': {
                          borderLeftColor: 'var(--brand-chalk)',
                       },
                    }),
               // Force past CodeMirror's base theme — light gray on selected lines.
               '&.cm-focused > .cm-scroller > .cm-selectionLayer > .cm-selectionBackground': {
                  background: 'rgba(255, 255, 255, 0.14) !important',
               },
               '& > .cm-scroller > .cm-selectionLayer > .cm-selectionBackground': {
                  background: 'rgba(255, 255, 255, 0.1) !important',
               },
               // Native fallback when the drawSelection layer is not painted.
               '.cm-content ::selection': {
                  backgroundColor: 'rgba(255, 255, 255, 0.18)',
               },
               '.cm-content ::-moz-selection': {
                  backgroundColor: 'rgba(255, 255, 255, 0.18)',
               },
               '.cm-selectionMatch': {
                  backgroundColor: 'rgba(255, 255, 255, 0.08)',
               },
               '.cm-tooltip-autocomplete': {
                  backgroundColor: 'var(--brand-void)',
                  border: '1px solid var(--brand-hairline)',
                  color: 'var(--brand-chalk)',
               },
               '.cm-tooltip-autocomplete ul li[aria-selected]': {
                  backgroundColor: 'color-mix(in oklab, var(--brand-chalk) 18%, transparent)',
                  color: 'var(--brand-chalk)',
               },
               '.cm-tooltip.cm-tooltip-lint': {
                  backgroundColor: 'var(--brand-void)',
                  border: '1px solid var(--brand-hairline)',
                  color: 'var(--brand-chalk)',
               },
               '.cm-diagnostic-error': { borderLeftColor: 'var(--status-danger)' },
               '.cm-diagnostic-warning': { borderLeftColor: 'var(--status-warning)' },
               '.cm-diagnostic-info': { borderLeftColor: 'var(--status-info)' },
               '.cm-lintRange-error': {
                  backgroundImage:
                     "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='6' height='3'%3E%3Cpath d='M0 3 L3 0 L6 3' fill='none' stroke='%23e05a4e'/%3E%3C/svg%3E\")",
               },
            },
            { dark: true }
         ),
      ],
      [language, maxHeight, readOnly]
   );

   return (
      <CodeMirror
         value={value}
         editable={!readOnly}
         readOnly={readOnly}
         onChange={readOnly ? undefined : onChange}
         onCreateEditor={(view) => {
            if (viewRef) viewRef.current = view;
            const next = {
               canUndo: undoDepth(view.state) > 0,
               canRedo: redoDepth(view.state) > 0,
            };
            lastHistoryRef.current = next;
            onHistoryChangeRef.current?.(next);
         }}
         // Skip uiw's built-in light theme — it paints a white sheet over ours.
         theme="none"
         basicSetup={basicSetup}
         extensions={extensions}
         className={cn(
            'flex h-full min-h-0 flex-col overflow-hidden rounded bg-[var(--brand-void)] text-[var(--brand-chalk)]',
            '[&_.cm-editor]:h-full [&_.cm-editor]:bg-[var(--brand-void)] [&_.cm-editor]:text-[var(--brand-chalk)] [&_.cm-editor]:outline-none',
            '[&_.cm-scroller]:bg-[var(--brand-void)]',
            '[&_.cm-gutters]:bg-[var(--brand-void)]',
            '[&_.cm-content]:bg-[var(--brand-void)] [&_.cm-content]:text-[var(--brand-chalk)]',
            '[&_.cm-selectionBackground]:!bg-white/15',
            readOnly
               ? '[&_.cm-content]:caret-transparent'
               : '[&_.cm-content]:caret-[var(--brand-chalk)]',
            className
         )}
      />
   );
});
