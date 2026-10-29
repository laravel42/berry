import { Node } from '@tiptap/core';
import { TaskItem, TaskList } from '@tiptap/extension-list';
import Underline from '@tiptap/extension-underline';
import { Plugin, PluginKey } from '@tiptap/pm/state';

/**
 * Markdown stored with html off. Underline and collapsed sections round-trip
 * as the tags below; checkbox lists use the task-list markdown the markdown
 * extension already knows.
 */
type InlineState = {
   src: string;
   pos: number;
   posMax: number;
   md: { inline: { tokenize: (state: InlineState) => void } };
   push: (type: string, tag: string, nesting: number) => void;
};

type BlockState = {
   src: string;
   line: number;
   bMarks: number[];
   eMarks: number[];
   tShift: number[];
   push: (
      type: string,
      tag: string,
      nesting: number
   ) => { content: string; block: boolean; map: [number, number] };
};

type MarkdownItLike = {
   render: (source: string) => string;
   renderInline: (source: string) => string;
   inline: {
      ruler: {
         before: (
            before: string,
            name: string,
            fn: (state: InlineState, silent: boolean) => boolean
         ) => void;
      };
   };
   block: {
      ruler: {
         before: (
            before: string,
            name: string,
            fn: (state: BlockState, startLine: number, endLine: number, silent: boolean) => boolean
         ) => void;
      };
   };
   renderer: { rules: Record<string, (tokens: { content: string }[], index: number) => string> };
};

function underlinePlugin(markdown: MarkdownItLike) {
   markdown.inline.ruler.before('emphasis', 'underline', (state, silent) => {
      const start = state.pos;
      if (state.src.slice(start, start + 3) !== '<u>') return false;
      const close = state.src.indexOf('</u>', start + 3);
      if (close === -1) return false;
      if (silent) {
         state.pos = close + 4;
         return true;
      }
      const max = state.posMax;
      state.push('u_open', 'u', 1);
      state.pos = start + 3;
      state.posMax = close;
      state.md.inline.tokenize(state);
      state.pos = close + 4;
      state.posMax = max;
      state.push('u_close', 'u', -1);
      return true;
   });
}

function detailsPlugin(markdown: MarkdownItLike) {
   markdown.block.ruler.before('html_block', 'details', (state, startLine, endLine, silent) => {
      const open = state.src
         .slice(state.bMarks[startLine]! + state.tShift[startLine]!, state.eMarks[startLine]!)
         .trim();
      const opened = open.match(/^<details(\s+open)?>$/);
      if (!opened) return false;
      let closeLine = -1;
      for (let line = startLine + 1; line < endLine; line++) {
         const text = state.src
            .slice(state.bMarks[line]! + state.tShift[line]!, state.eMarks[line]!)
            .trim();
         if (text === '</details>') {
            closeLine = line;
            break;
         }
      }
      if (closeLine < 0) return false;
      if (silent) return true;

      let summary = '';
      let bodyStart = startLine + 1;
      if (bodyStart < closeLine) {
         const second = state.src
            .slice(state.bMarks[bodyStart]! + state.tShift[bodyStart]!, state.eMarks[bodyStart]!)
            .trim();
         const summaryMatch = second.match(/^<summary>([\s\S]*)<\/summary>$/);
         if (summaryMatch) {
            summary = summaryMatch[1] ?? '';
            bodyStart += 1;
         }
      }
      const body = state.src
         .slice(state.bMarks[bodyStart] ?? 0, state.bMarks[closeLine] ?? 0)
         .replace(/\n$/, '');
      const token = state.push('details_block', '', 0);
      token.block = true;
      token.map = [startLine, closeLine + 1];
      token.content = `<details${opened[1] ? ' open' : ''}><summary>${markdown.renderInline(summary)}</summary><div data-type="detailsContent">${body.trim() ? markdown.render(body) : '<p></p>'}</div></details>\n`;
      state.line = closeLine + 1;
      return true;
   });
   markdown.renderer.rules.details_block = (tokens, index) => tokens[index]?.content ?? '';
}

const PersistentUnderline = Underline.extend({
   addStorage() {
      return {
         markdown: {
            serialize: {
               open: '<u>',
               close: '</u>',
               expelEnclosingWhitespace: true,
            },
            parse: {
               setup(markdown: MarkdownItLike) {
                  underlinePlugin(markdown);
               },
            },
         },
      };
   },
});

const markerWidth = 22;

export const Details = Node.create({
   name: 'details',
   group: 'block',
   content: 'detailsSummary detailsContent',
   defining: true,
   addAttributes() {
      return {
         open: {
            default: false,
            parseHTML: (element: HTMLElement) => element.hasAttribute('open'),
            renderHTML: (attributes: { open?: boolean }) =>
               attributes.open ? { open: 'open' } : {},
         },
      };
   },
   parseHTML: () => [{ tag: 'details' }],
   renderHTML: ({ HTMLAttributes }) => ['details', HTMLAttributes, 0],
   addStorage() {
      return {
         markdown: {
            serialize(
               state: {
                  write: (text: string) => void;
                  renderContent: (node: unknown) => void;
                  closeBlock: (node: unknown) => void;
               },
               node: { attrs: { open?: boolean } }
            ) {
               state.write(node.attrs.open ? '<details open>\n' : '<details>\n');
               state.renderContent(node);
               state.write('</details>');
               state.closeBlock(node);
            },
            parse: {
               setup(markdown: MarkdownItLike) {
                  detailsPlugin(markdown);
               },
            },
         },
      };
   },
   addProseMirrorPlugins() {
      return [
         new Plugin({
            key: new PluginKey('detailsToggle'),
            props: {
               handleClick(view, _pos, event) {
                  if (!(event.target instanceof Element)) return false;
                  const summary = event.target.closest('summary');
                  if (!summary || !view.dom.contains(summary)) return false;
                  const details = summary.parentElement;
                  if (!(details instanceof HTMLDetailsElement)) return false;
                  const rect = summary.getBoundingClientRect();
                  if (event.clientX > rect.left + markerWidth) return false;
                  const inside = view.posAtDOM(details, 0);
                  const resolved = view.state.doc.resolve(inside);
                  for (let depth = resolved.depth; depth > 0; depth--) {
                     if (resolved.node(depth).type.name !== 'details') continue;
                     const node = resolved.node(depth);
                     view.dispatch(
                        view.state.tr.setNodeMarkup(resolved.before(depth), undefined, {
                           ...node.attrs,
                           open: node.attrs.open !== true,
                        })
                     );
                     event.preventDefault();
                     return true;
                  }
                  return false;
               },
            },
         }),
      ];
   },
});

export const DetailsSummary = Node.create({
   name: 'detailsSummary',
   content: 'inline*',
   defining: true,
   parseHTML: () => [{ tag: 'summary' }],
   renderHTML: () => ['summary', 0],
   addStorage() {
      return {
         markdown: {
            serialize(
               state: {
                  write: (text: string) => void;
                  renderInline: (node: unknown) => void;
                  closeBlock: (node: unknown) => void;
               },
               node: unknown
            ) {
               state.write('<summary>');
               state.renderInline(node);
               state.write('</summary>');
               state.closeBlock(node);
            },
            parse: {},
         },
      };
   },
});

export const DetailsContent = Node.create({
   name: 'detailsContent',
   content: 'block+',
   defining: true,
   parseHTML: () => [{ tag: 'div[data-type="detailsContent"]' }],
   renderHTML: () => ['div', { 'data-type': 'detailsContent' }, 0],
   addStorage() {
      return {
         markdown: {
            serialize(state: { renderContent: (node: unknown) => void }, node: unknown) {
               state.renderContent(node);
            },
            parse: {},
         },
      };
   },
});

export const formatExtensions = [
   PersistentUnderline,
   TaskList,
   TaskItem.configure({ nested: true }),
   Details,
   DetailsSummary,
   DetailsContent,
];
