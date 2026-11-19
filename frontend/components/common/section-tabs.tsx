'use client';

import * as TabsPrimitive from '@radix-ui/react-tabs';
import { useState, type ReactNode } from 'react';

import { cn } from '@/lib/utils';

export interface Section {
   key: string;
   /** The section's name: the tab on the left and the title on the right. */
   label: string;
   /** One line under the title saying what the section is for. */
   caption?: string;
   /** The control's id, so the title focuses it. */
   htmlFor?: string;
   /** The section holds an edit that is not saved yet: its tab shows a dot. */
   dirty?: boolean;
   content: ReactNode;
}

/**
 * A form too long for one column of rows: the sections as tabs on the left,
 * and the chosen one on the right as a title, its caption, then its control
 * at full width, so a long text gets the whole column. Below `md` the tabs
 * become a row that scrolls sideways above the section.
 *
 * Every section stays mounted and is only hidden, so a draft in one section
 * survives a visit to another.
 */
export function SectionTabs({
   sections,
   label,
   className,
}: {
   sections: Section[];
   /** Names the list of sections for assistive tech. */
   label: string;
   className?: string;
}) {
   const [value, setValue] = useState(sections[0]?.key ?? '');
   const current = sections.some((section) => section.key === value)
      ? value
      : (sections[0]?.key ?? '');

   return (
      <TabsPrimitive.Root
         value={current}
         onValueChange={setValue}
         orientation="vertical"
         className={cn('grid gap-6 md:grid-cols-[13rem_minmax(0,1fr)] md:gap-10', className)}
      >
         <TabsPrimitive.List
            aria-label={label}
            className="no-scrollbar -mx-8 flex gap-1 overflow-x-auto px-8 md:sticky md:top-16 md:mx-0 md:flex-col md:self-start md:overflow-visible md:px-0"
         >
            {sections.map((section) => (
               <TabsPrimitive.Trigger
                  key={section.key}
                  value={section.key}
                  className="flex min-h-(--field-h) shrink-0 items-center gap-2 rounded-[8px] px-3 text-left whitespace-nowrap text-muted-foreground transition-colors outline-none hover:bg-accent/50 hover:text-foreground focus-visible:ring-2 focus-visible:ring-foreground/20 data-[state=active]:bg-accent data-[state=active]:font-medium data-[state=active]:text-foreground md:whitespace-normal"
               >
                  <span className="min-w-0 flex-1">{section.label}</span>
                  {section.dirty ? (
                     <span
                        aria-hidden
                        className="size-1.5 shrink-0 rounded-full bg-status-warning"
                     />
                  ) : null}
               </TabsPrimitive.Trigger>
            ))}
         </TabsPrimitive.List>

         {sections.map((section) => (
            <TabsPrimitive.Content
               key={section.key}
               value={section.key}
               forceMount
               className="flex min-w-0 flex-col gap-4 outline-none data-[state=inactive]:hidden"
            >
               <div className="flex flex-col gap-1">
                  <h3>
                     {section.htmlFor ? (
                        <label htmlFor={section.htmlFor}>{section.label}</label>
                     ) : (
                        section.label
                     )}
                  </h3>
                  {section.caption ? (
                     <p className="text-pretty text-muted-foreground">{section.caption}</p>
                  ) : null}
               </div>
               {section.content}
            </TabsPrimitive.Content>
         ))}
      </TabsPrimitive.Root>
   );
}
