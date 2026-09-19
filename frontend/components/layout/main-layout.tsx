import React from 'react';
import { SidebarProvider } from '@/components/ui/sidebar';
import { CreateIssueModalProvider } from '@/components/common/issues/create-issue-modal-provider';
import { IssuesHydrator } from '@/components/common/issues/issues-hydrator';
import { CreatePlanModalProvider } from '@/components/common/plans/create-plan-modal-provider';
import { CommandPalette } from '@/components/layout/command-palette';
import { cn } from '@/lib/utils';

interface MainLayoutProps {
   children: React.ReactNode;
   header?: React.ReactNode;
   headersNumber?: 1 | 2;
}

const isEmptyHeader = (header: React.ReactNode | undefined): boolean => {
   if (!header) return true;

   if (React.isValidElement(header) && header.type === React.Fragment) {
      const props = header.props as { children?: React.ReactNode };

      if (!props.children) return true;

      if (Array.isArray(props.children) && props.children.length === 0) {
         return true;
      }
   }

   return false;
};

export default function MainLayout({ children, header }: MainLayoutProps) {
   return (
      <SidebarProvider className="h-full min-h-0 max-h-full">
         <IssuesHydrator />
         <CreateIssueModalProvider />
         <CreatePlanModalProvider />
         <CommandPalette />
         {/* No sidebar here: BerryShell owns the rail and the tab strip. The
             provider stays because sidebar preference stores are still used
             across headers and settings. */}
         {/* `text-foreground` is the page boundary: the shell around this is
             dark chrome in both themes and sets its own text colour, and a
             page that inherited it would keep chalk text on a light theme.
             The theme is forced dark today; this is what makes light safe to
             turn on without auditing every page. The weight is reset for the
             same reason: the shell root is `font-light` (300) for its chrome,
             and pages that inherited it ran thinner than the 400 the body
             rule sets. */}
         <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-background text-foreground [font-weight:400]">
            <div className="flex h-full min-h-0 w-full flex-col items-center justify-start overflow-hidden bg-container">
               {header ? <div className="w-full shrink-0">{header}</div> : null}
               <div
                  className={cn(
                     'w-full min-h-0',
                     isEmptyHeader(header) ? 'h-full overflow-auto' : 'flex-1 overflow-auto'
                  )}
               >
                  {children}
               </div>
            </div>
         </div>
      </SidebarProvider>
   );
}
