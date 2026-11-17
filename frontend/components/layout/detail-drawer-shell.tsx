'use client';

import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { type ReactNode, useCallback } from 'react';

import { DetailDrawerProvider } from '@/components/layout/detail-drawer-context';
import {
   RAIL_COLLAPSED_WIDTH,
   RAIL_OVERLAY_WIDTH,
   RAIL_WIDTH,
} from '@/components/layout/shell/shell-layout';
import { Sheet, SheetContent } from '@/components/ui/sheet';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';
import { useShellStore } from '@/store/shell-store';

interface DetailDrawerShellProps {
   header?: ReactNode;
   children: ReactNode;
   open?: boolean;
   onClose?: () => void;
   /**
    * Override the global drawer ceiling, in pixels. Rarely needed — the
    * default comes from `--drawer-max-width` so every drawer stays consistent
    * without each call site repeating a number.
    */
   maxWidth?: number;
}

/**
 * Wide right drawer for intercepted detail routes; dismiss via overlay, Esc,
 * or router.back().
 *
 * Width is capped globally by `--drawer-max-width` and additionally clamped to
 * the space left beside the rail, so the drawer never covers navigation on
 * a narrow viewport. The rail's width comes from the shell: 232px as a
 * column, 36px collapsed, and nothing below `lg`, where it is an overlay
 * and the drawer may take the whole screen. The cap is a token rather than a
 * prop default so changing it is one edit rather than an audit of every
 * call site.
 */
export default function DetailDrawerShell({
   header,
   children,
   open = true,
   onClose,
   maxWidth,
}: DetailDrawerShellProps) {
   const t = useTranslations('shell');
   const router = useRouter();
   const isMobile = useIsMobile();
   const railOpen = useShellStore((state) => state.railOpen);
   const railWidth = isMobile ? RAIL_OVERLAY_WIDTH : railOpen ? RAIL_WIDTH : RAIL_COLLAPSED_WIDTH;
   // One expression for both width and max-width so the Sheet's default
   // `w-3/4` / `sm:max-w-sm` cannot leave agents and tasks on different
   // used sizes if an inline width is ever dropped.
   const drawerWidth = `min(${
      maxWidth ? `${maxWidth}px` : 'var(--drawer-max-width)'
   }, calc(100vw - ${railWidth}px))`;

   const dismiss = useCallback(() => {
      if (onClose) {
         onClose();
         return;
      }
      router.back();
   }, [onClose, router]);

   const handleOpenChange = useCallback(
      (next: boolean) => {
         if (!next) {
            dismiss();
         }
      },
      [dismiss]
   );

   return (
      <Sheet open={open} onOpenChange={handleOpenChange}>
         <SheetContent
            side="right"
            hideClose
            className={cn(
               'flex h-full w-auto inset-y-0 right-0 left-auto flex-col gap-0 border-l bg-container p-0',
               'max-w-none sm:max-w-none',
               // The drawer appears in place; the Sheet's slide-in is for the
               // other sheets.
               'data-[state=open]:!animate-none'
            )}
            style={{
               width: drawerWidth,
               maxWidth: drawerWidth,
            }}
            // A file dialog moves focus out of the page. That is not the
            // reader leaving the drawer, and dismissing here drops the input
            // before the chosen file can upload.
            onFocusOutside={(event) => event.preventDefault()}
         >
            <DetailDrawerProvider onClose={dismiss}>
               {header ? (
                  // Below `lg` the drawer takes the whole screen, so the
                  // overlay is gone and Esc is not on a phone: this × is the
                  // way out. It leads the header row and draws the header's
                  // bottom rule under itself, so the line runs edge to edge.
                  // The target fills the row, up to the 52px header row, so a
                  // header with two rows keeps it on the first; the hover and
                  // focus mark stay a small circle that crosses no rule. From
                  // `lg` the wrapper is a plain block and the drawer is what
                  // it was.
                  <div className="flex lg:block">
                     <div className="flex shrink-0 items-start pl-1.5 shadow-[inset_0_-1px_0_var(--color-border)] lg:hidden">
                        <button
                           type="button"
                           onClick={dismiss}
                           aria-label={t('drawer.close')}
                           className="group flex max-h-[52px] min-h-10 w-11 cursor-pointer items-center justify-center self-stretch text-muted-foreground outline-none"
                        >
                           <span className="flex size-9 items-center justify-center rounded-pill transition-colors group-hover:bg-muted group-hover:text-foreground group-focus-visible:outline-2 group-focus-visible:outline-ring">
                              <X className="size-4" aria-hidden />
                           </span>
                        </button>
                     </div>
                     <div className="min-w-0 flex-1">{header}</div>
                  </div>
               ) : null}
               <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
            </DetailDrawerProvider>
         </SheetContent>
      </Sheet>
   );
}
