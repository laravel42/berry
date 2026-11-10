'use client';

import { ChevronDown } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

/** Height a long description is cut to, in pixels. */
const COLLAPSED_HEIGHT = 640;

/**
 * Only cut when it hides a real amount. A description a few lines over the
 * limit reads better whole than behind a button that reveals three lines.
 */
const SLACK = 160;

/**
 * A task's or project's description, cut to a fixed height when it is long,
 * with Show more / Show less under it.
 *
 * The content is measured unclipped, so the toggle appears and disappears as
 * the text grows or shrinks while it is edited. Focusing anything inside (the
 * editor, a link) opens it: nobody should type into text they cannot see.
 */
export function CollapsibleDescription({ children }: { children: ReactNode }) {
   const t = useTranslations('common.collapsible');
   const block = useRef<HTMLDivElement>(null);
   const content = useRef<HTMLDivElement>(null);
   const [long, setLong] = useState(false);
   const [expanded, setExpanded] = useState(false);

   useEffect(() => {
      const element = content.current;
      if (!element) return;
      const measure = () => setLong(element.offsetHeight > COLLAPSED_HEIGHT + SLACK);
      measure();
      const observer = new ResizeObserver(measure);
      observer.observe(element);
      return () => observer.disconnect();
   }, []);

   const collapsed = long && !expanded;

   const toggle = () => {
      if (expanded) {
         setExpanded(false);
         // Collapsing from far down would leave the reader below the text
         // they just closed; bring its top back into view.
         block.current?.scrollIntoView({ block: 'nearest' });
         return;
      }
      setExpanded(true);
   };

   return (
      <div ref={block}>
         <div
            className={cn('relative', collapsed && 'overflow-hidden')}
            style={collapsed ? { maxHeight: COLLAPSED_HEIGHT } : undefined}
            onFocusCapture={() => {
               if (long) setExpanded(true);
            }}
         >
            <div ref={content}>{children}</div>
            {collapsed ? (
               <div
                  aria-hidden
                  className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-container to-transparent"
               />
            ) : null}
         </div>
         {long ? (
            <button
               type="button"
               aria-expanded={expanded}
               onClick={toggle}
               className="mt-1 inline-flex items-center gap-1 rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
               {expanded ? t('showLess') : t('showMore')}
               <ChevronDown
                  className={cn('size-3.5 transition-transform', expanded && 'rotate-180')}
                  aria-hidden
               />
            </button>
         ) : null}
      </div>
   );
}
