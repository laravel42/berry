'use client';

import type { TiptapAiEditor as TiptapAiEditorComponent } from '@/components/common/editor/tiptap-ai-editor';
import { cn } from '@/lib/utils';
import dynamic from 'next/dynamic';
import { createContext, useContext, type ComponentProps } from 'react';

type TiptapAiEditorProps = ComponentProps<typeof TiptapAiEditorComponent>;

/**
 * The caller's `className`, handed to the placeholder: `loading` gets no
 * props, and the height of every editor surface is set by its caller.
 */
const PlaceholderClassName = createContext<string | undefined>(undefined);

/**
 * Holds the editor's place until its chunk arrives. It takes the same box as
 * the editor's own pre-mount fallback, so nothing moves when the editor lands.
 */
function EditorPlaceholder() {
   const className = useContext(PlaceholderClassName);
   return <div aria-hidden className={cn('tiptap-ai-editor min-h-24', className)} />;
}

const DynamicTiptapAiEditor = dynamic(
   () => import('@/components/common/editor/tiptap-ai-editor').then((m) => m.TiptapAiEditor),
   { loading: EditorPlaceholder }
);

/** The Tiptap editor, loaded on first render rather than with the route. */
export function TiptapAiEditor(props: TiptapAiEditorProps) {
   return (
      <PlaceholderClassName.Provider value={props.className}>
         <DynamicTiptapAiEditor {...props} />
      </PlaceholderClassName.Provider>
   );
}
