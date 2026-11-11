'use client';

import type { CodeEditor as CodeEditorComponent } from '@/components/ui/code-editor';
import { cn } from '@/lib/utils';
import dynamic from 'next/dynamic';
import { createContext, memo, useContext, type ComponentProps } from 'react';

type CodeEditorProps = ComponentProps<typeof CodeEditorComponent>;

/**
 * The caller's props, handed to the placeholder: `loading` gets no props, and
 * the editor's height comes from its caller — the box `className` gives it, or
 * its text capped at `maxHeight`.
 */
const PlaceholderProps = createContext<CodeEditorProps | null>(null);

/**
 * Holds the editor's place until its chunk arrives, in the editor's own box.
 * With `maxHeight` the editor grows with its text, so the placeholder does
 * too: CodeMirror's 20px line height per line, plus 8px of padding above and
 * below, capped like the scroller. Without it the editor fills the box its
 * caller's `className` sets, and so does this.
 */
function EditorPlaceholder() {
   const props = useContext(PlaceholderProps);
   const lines = props ? props.value.split('\n').length : 1;
   return (
      <div
         aria-hidden
         className={cn(
            'h-full min-h-0 overflow-hidden rounded bg-[var(--brand-void)]',
            props?.className
         )}
         style={
            props?.maxHeight
               ? { height: `${lines * 20 + 16}px`, maxHeight: props.maxHeight }
               : undefined
         }
      />
   );
}

const DynamicCodeEditor = dynamic(
   () => import('@/components/ui/code-editor').then((m) => m.CodeEditor),
   { loading: EditorPlaceholder }
);

/**
 * The CodeMirror editor, loaded on first render rather than with the route.
 * Memoised like the editor itself, so a parent's re-render does not reach it.
 */
export const CodeEditor = memo(function CodeEditor(props: CodeEditorProps) {
   return (
      <PlaceholderProps.Provider value={props}>
         <DynamicCodeEditor {...props} />
      </PlaceholderProps.Provider>
   );
});
