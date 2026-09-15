'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { ChatMarkdown } from '@/components/common/chat/chat-markdown';
import { cn } from '@/lib/utils';

interface Clamp {
   /** Visible lines before the text folds; the rest opens on request. */
   lines: number;
   /** Label of the control that reveals the rest, e.g. "Read the rest". */
   moreLabel: string;
   /** Label of the control that folds it again, e.g. "Show less". */
   lessLabel: string;
   /**
    * Read to assistive tech, after the visible part, while the text is
    * folded: the clipped remainder is still in the accessibility tree, so
    * without this a screen reader would not know anything was hidden.
    * Defaults to a sentence built from `moreLabel`.
    */
   hiddenNote?: string;
}

interface AgentMarkdownProps {
   body: string;
   className?: string;
   /** Fold long text after this many lines; omit to show everything. */
   clamp?: Clamp;
}

/**
 * Text an agent wrote back, rendered on a page surface.
 *
 * Run summaries, review notes and task comments arrive as Markdown, and until
 * now most surfaces printed the syntax verbatim. This wraps the chat parser —
 * the one place that turns model output into elements without ever touching
 * `innerHTML` — with the page's tokens and an optional fold, so a forty-line
 * delivery summary shows its first screen and opens on request rather than
 * pushing the decision it supports off the bottom of the pane.
 *
 * The fold measures the rendered box instead of counting source lines: a
 * bullet list of file names wraps very differently from a paragraph, and the
 * control should appear only when something is actually hidden.
 */
export function AgentMarkdown({ body, className, clamp }: AgentMarkdownProps) {
   const [open, setOpen] = useState(false);
   const [overflows, setOverflows] = useState(false);
   const boxRef = useRef<HTMLDivElement>(null);
   const id = useId();

   const lineHeight = 1.25; // rem, matches --text-sm--line-height
   const maxHeight = clamp ? `${clamp.lines * lineHeight}rem` : undefined;

   useEffect(() => {
      if (!clamp) return;
      const box = boxRef.current;
      if (!box) return;
      const measure = () => setOverflows(box.scrollHeight > box.clientHeight + 1);
      measure();
      const observer = new ResizeObserver(measure);
      observer.observe(box);
      return () => observer.disconnect();
   }, [clamp, body, open]);

   const folded = Boolean(clamp) && !open;
   const noteId = `${id}-note`;
   const hidden = folded && overflows;
   const hiddenNote =
      clamp?.hiddenNote ??
      (clamp ? `Text continues below. Use "${clamp.moreLabel}" to show it all.` : '');

   // 75ch keeps agent prose readable on a wide pane; callers that need the
   // full width can override through className.
   return (
      <div className={cn('min-w-0 max-w-[75ch]', className)}>
         <div
            ref={boxRef}
            id={id}
            aria-describedby={hidden ? noteId : undefined}
            className={cn('relative', folded && 'overflow-hidden')}
            style={folded ? { maxHeight } : undefined}
         >
            <ChatMarkdown body={body} tone="page" />
            {hidden ? (
               <div
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 bottom-0 h-10 bg-gradient-to-t from-container to-transparent"
               />
            ) : null}
         </div>
         {hidden ? (
            <p id={noteId} className="sr-only">
               {hiddenNote}
            </p>
         ) : null}
         {clamp && (overflows || open) ? (
            <button
               type="button"
               aria-expanded={open}
               aria-controls={id}
               onClick={() => setOpen((value) => !value)}
               className="mt-1 cursor-pointer text-muted-foreground underline-offset-2 hover:text-foreground hover:underline focus-visible:rounded-sm focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
            >
               {open ? clamp.lessLabel : clamp.moreLabel}
            </button>
         ) : null}
      </div>
   );
}
