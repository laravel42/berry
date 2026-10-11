declare module '@esbitan/codemirror-context-menu' {
   import type { Extension } from '@codemirror/state';
   import type { EditorView } from '@codemirror/view';

   export function contextMenuExtension(options?: {
      enableUndoRedo?: boolean | null;
      enableCopy?: boolean;
      enableCut?: boolean;
      enablePaste?: boolean;
      enableSelectAll?: boolean;
      theme?: 'dark' | 'light';
      customItems?: {
         label: string;
         shortcut?: string;
         command: (view: EditorView) => void;
      }[];
   }): Extension;
}
