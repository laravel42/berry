'use client';

import { HighlightStyle, StreamLanguage, syntaxHighlighting } from '@codemirror/language';
import { css } from '@codemirror/legacy-modes/mode/css';
import { javascript, json, typescript } from '@codemirror/legacy-modes/mode/javascript';
import { python } from '@codemirror/legacy-modes/mode/python';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { standardSQL } from '@codemirror/legacy-modes/mode/sql';
import { html } from '@codemirror/legacy-modes/mode/xml';
import { yaml } from '@codemirror/legacy-modes/mode/yaml';
import { EditorView } from '@codemirror/view';
import { tags as t } from '@lezer/highlight';
import CodeMirror from '@uiw/react-codemirror';
import { useMemo } from 'react';

import { cn } from '@/lib/utils';

export type CodeEditorLanguage =
   | 'bash'
   | 'javascript'
   | 'typescript'
   | 'json'
   | 'css'
   | 'html'
   | 'yaml'
   | 'python'
   | 'sql'
   | 'plain';

interface CodeEditorProps {
   value: string;
   /** Bash by default, which is what the run transcript shows; `plain` has no grammar. */
   language?: CodeEditorLanguage;
   className?: string;
   /** Cap the scroller, e.g. `10rem` / `18rem`. Omit for natural height. */
   maxHeight?: string;
}

const languageExtension = (language: CodeEditorLanguage) => {
   switch (language) {
      case 'bash':
         return [StreamLanguage.define(shell)];
      case 'javascript':
         return [StreamLanguage.define(javascript)];
      case 'typescript':
         return [StreamLanguage.define(typescript)];
      case 'json':
         return [StreamLanguage.define(json)];
      case 'css':
         return [StreamLanguage.define(css)];
      case 'html':
         return [StreamLanguage.define(html)];
      case 'yaml':
         return [StreamLanguage.define(yaml)];
      case 'python':
         return [StreamLanguage.define(python)];
      case 'sql':
         return [StreamLanguage.define(standardSQL)];
      case 'plain':
         return [];
   }
};

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
         return 'typescript';
      case 'json':
         return 'json';
      case 'css':
         return 'css';
      case 'html':
      case 'htm':
      case 'svg':
      case 'xml':
         return 'html';
      case 'yml':
      case 'yaml':
         return 'yaml';
      case 'py':
         return 'python';
      case 'sql':
         return 'sql';
      case 'sh':
      case 'bash':
         return 'bash';
      default:
         return 'plain';
   }
}

/** Token colours for void chrome — chalk body, soft accents, never light-theme reds. */
const berryDarkHighlight = HighlightStyle.define([
   { tag: t.comment, color: 'var(--brand-ash)', fontStyle: 'italic' },
   { tag: t.lineComment, color: 'var(--brand-ash)', fontStyle: 'italic' },
   { tag: t.meta, color: 'var(--brand-ash)' },
   { tag: t.keyword, color: 'var(--brand-azure)' },
   { tag: t.atom, color: 'var(--brand-amber)' },
   { tag: t.bool, color: 'var(--brand-amber)' },
   { tag: t.number, color: 'var(--brand-amber)' },
   { tag: t.string, color: 'var(--brand-verdant)' },
   { tag: t.special(t.string), color: 'var(--brand-verdant)' },
   { tag: t.quote, color: 'var(--brand-verdant)' },
   { tag: t.operator, color: 'var(--brand-chalk)' },
   { tag: t.attributeName, color: 'var(--brand-azure)' },
   { tag: t.variableName, color: 'var(--brand-chalk)' },
   { tag: t.definition(t.variableName), color: 'var(--brand-chalk)' },
   { tag: t.name, color: 'var(--brand-chalk)' },
   { tag: t.literal, color: 'var(--brand-chalk)' },
   { tag: t.standard(t.name), color: 'var(--brand-azure)' },
]);

/**
 * Read-only code surface with syntax colouring.
 *
 * Used where a plain `<pre>` was showing shell or tool output: the editor chrome
 * keeps the monospace measure and wrapping of those blocks, and bash tokens
 * make commands readable without turning the transcript into an editable field.
 */
export function CodeEditor({ value, language = 'bash', className, maxHeight }: CodeEditorProps) {
   const extensions = useMemo(
      () => [
         ...languageExtension(language),
         syntaxHighlighting(berryDarkHighlight),
         EditorView.lineWrapping,
         EditorView.editable.of(false),
         EditorView.theme(
            {
               '&': {
                  backgroundColor: 'var(--brand-void)',
                  color: 'var(--brand-chalk)',
                  // Fixed metrics so gutters and lines share one box; `inherit`
                  // picked up the dialog's leading and drifted the numbers.
                  fontSize: '13px',
                  height: 'auto',
               },
               '.cm-scroller': {
                  overflow: 'auto',
                  maxHeight: maxHeight ?? 'none',
                  fontFamily: 'var(--font-mono)',
                  lineHeight: '20px',
                  fontSize: '13px',
               },
               '.cm-content': {
                  caretColor: 'transparent',
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
               '&.cm-focused': { outline: 'none' },
               '.cm-cursor, .cm-dropCursor': { display: 'none' },
               '&.cm-focused .cm-selectionBackground, .cm-selectionBackground': {
                  backgroundColor: 'color-mix(in oklab, var(--brand-chalk) 18%, transparent)',
               },
            },
            { dark: true }
         ),
      ],
      [language, maxHeight]
   );

   return (
      <CodeMirror
         value={value}
         editable={false}
         readOnly
         // Skip uiw's built-in light theme — it paints a white sheet over ours.
         theme="none"
         basicSetup={{
            lineNumbers: true,
            foldGutter: false,
            highlightActiveLine: false,
            highlightActiveLineGutter: false,
            highlightSelectionMatches: false,
            bracketMatching: false,
            // Light defaultHighlightStyle was colouring keywords red on void.
            syntaxHighlighting: false,
         }}
         extensions={extensions}
         className={cn(
            'overflow-hidden rounded bg-[var(--brand-void)] text-[var(--brand-chalk)]',
            '[&_.cm-editor]:bg-[var(--brand-void)] [&_.cm-editor]:text-[var(--brand-chalk)] [&_.cm-editor]:outline-none',
            '[&_.cm-scroller]:bg-[var(--brand-void)]',
            '[&_.cm-gutters]:bg-[var(--brand-void)]',
            '[&_.cm-content]:bg-[var(--brand-void)] [&_.cm-content]:text-[var(--brand-chalk)] [&_.cm-content]:caret-transparent',
            className
         )}
      />
   );
}
