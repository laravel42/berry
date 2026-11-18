'use client';

import * as React from 'react';
import * as DropdownMenuPrimitive from '@radix-ui/react-dropdown-menu';
import { CheckIcon, ChevronRightIcon, CircleIcon } from 'lucide-react';

import { cn } from '@/lib/utils';

// Radix opens a menu on pointerdown for every pointer type. On touch screens that opens it the
// moment the finger lands, locks the page scroll, and a swipe that starts on a trigger inside a
// list can no longer scroll it. So touch and pen open on the click that follows a tap instead.
// The trigger needs the open state to toggle from that click, which the root shares here.
const DropdownMenuToggleContext = React.createContext<(() => void) | null>(null);

function DropdownMenu({
   open: openProp,
   defaultOpen,
   onOpenChange,
   ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Root>) {
   const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen ?? false);
   const isControlled = openProp !== undefined;
   const open = isControlled ? openProp : uncontrolledOpen;
   const openRef = React.useRef(open);
   openRef.current = open;

   const handleOpenChange = React.useCallback(
      (next: boolean) => {
         if (!isControlled) setUncontrolledOpen(next);
         onOpenChange?.(next);
      },
      [isControlled, onOpenChange]
   );
   const toggle = React.useCallback(() => handleOpenChange(!openRef.current), [handleOpenChange]);

   return (
      <DropdownMenuToggleContext.Provider value={toggle}>
         <DropdownMenuPrimitive.Root
            data-slot="dropdown-menu"
            open={open}
            onOpenChange={handleOpenChange}
            {...props}
         />
      </DropdownMenuToggleContext.Provider>
   );
}

function DropdownMenuPortal({
   ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Portal>) {
   return <DropdownMenuPrimitive.Portal data-slot="dropdown-menu-portal" {...props} />;
}

function DropdownMenuTrigger({
   onPointerDown,
   onClick,
   ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Trigger>) {
   const toggle = React.useContext(DropdownMenuToggleContext);
   const tappedRef = React.useRef(false);

   return (
      <DropdownMenuPrimitive.Trigger
         data-slot="dropdown-menu-trigger"
         {...props}
         onPointerDown={(event) => {
            onPointerDown?.(event);
            tappedRef.current = false;
            if (event.defaultPrevented || !toggle || event.pointerType === 'mouse') return;
            // Stops Radix opening on touch-down; the click of a tap opens it instead.
            event.preventDefault();
            tappedRef.current = true;
         }}
         onClick={(event) => {
            onClick?.(event);
            const tapped = tappedRef.current;
            tappedRef.current = false;
            if (event.defaultPrevented || !tapped || !toggle || props.disabled) return;
            toggle();
         }}
      />
   );
}

function DropdownMenuContent({
   className,
   sideOffset = 4,
   collisionPadding = 8,
   ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Content>) {
   return (
      <DropdownMenuPrimitive.Portal>
         <DropdownMenuPrimitive.Content
            data-slot="dropdown-menu-content"
            sideOffset={sideOffset}
            collisionPadding={collisionPadding}
            className={cn(
               'bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 max-w-[min(calc(100vw-1rem),var(--radix-dropdown-menu-content-available-width))] min-w-[min(8rem,var(--radix-dropdown-menu-content-available-width))] overflow-hidden rounded-md border p-1 shadow-md',
               className
            )}
            {...props}
         />
      </DropdownMenuPrimitive.Portal>
   );
}

function DropdownMenuGroup({ ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Group>) {
   return <DropdownMenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />;
}

function DropdownMenuItem({
   className,
   inset,
   variant = 'default',
   ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Item> & {
   inset?: boolean;
   variant?: 'default' | 'destructive';
}) {
   return (
      <DropdownMenuPrimitive.Item
         data-slot="dropdown-menu-item"
         data-inset={inset}
         data-variant={variant}
         className={cn(
            "focus:bg-accent focus:text-accent-foreground data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 dark:data-[variant=destructive]:focus:bg-destructive/40 data-[variant=destructive]:focus:text-destructive data-[variant=destructive]:*:[svg]:!text-destructive [&_svg:not([class*='text-'])]:text-muted-foreground relative flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[inset]:pl-8 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
            className
         )}
         {...props}
      />
   );
}

function DropdownMenuCheckboxItem({
   className,
   children,
   checked,
   ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem>) {
   return (
      <DropdownMenuPrimitive.CheckboxItem
         data-slot="dropdown-menu-checkbox-item"
         className={cn(
            "focus:bg-accent focus:text-accent-foreground relative flex cursor-pointer items-center gap-2 rounded-sm py-1.5 pr-2 pl-8 outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
            className
         )}
         checked={checked}
         {...props}
      >
         <span className="pointer-events-none absolute left-2 flex size-3.5 items-center justify-center">
            <DropdownMenuPrimitive.ItemIndicator>
               <CheckIcon className="text-(--primary) size-4" />
            </DropdownMenuPrimitive.ItemIndicator>
         </span>
         {children}
      </DropdownMenuPrimitive.CheckboxItem>
   );
}

function DropdownMenuRadioGroup({
   ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioGroup>) {
   return <DropdownMenuPrimitive.RadioGroup data-slot="dropdown-menu-radio-group" {...props} />;
}

function DropdownMenuRadioItem({
   className,
   children,
   ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.RadioItem>) {
   return (
      <DropdownMenuPrimitive.RadioItem
         data-slot="dropdown-menu-radio-item"
         className={cn(
            "focus:bg-accent focus:text-accent-foreground relative flex cursor-pointer items-center gap-2 rounded-sm py-1.5 pr-2 pl-8 outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
            className
         )}
         {...props}
      >
         <span className="pointer-events-none absolute left-2 flex size-3.5 items-center justify-center">
            <DropdownMenuPrimitive.ItemIndicator>
               <CircleIcon className="size-2 fill-current" />
            </DropdownMenuPrimitive.ItemIndicator>
         </span>
         {children}
      </DropdownMenuPrimitive.RadioItem>
   );
}

function DropdownMenuLabel({
   className,
   inset,
   ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Label> & {
   inset?: boolean;
}) {
   return (
      <DropdownMenuPrimitive.Label
         data-slot="dropdown-menu-label"
         data-inset={inset}
         className={cn('px-2 py-1.5 font-medium data-[inset]:pl-8', className)}
         {...props}
      />
   );
}

function DropdownMenuSeparator({
   className,
   ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
   return (
      <DropdownMenuPrimitive.Separator
         data-slot="dropdown-menu-separator"
         className={cn('bg-border -mx-1 my-1 h-px', className)}
         {...props}
      />
   );
}

function DropdownMenuShortcut({ className, ...props }: React.ComponentProps<'span'>) {
   return (
      <span
         data-slot="dropdown-menu-shortcut"
         className={cn(
            'text-muted-foreground ml-auto tracking-widest [@media(hover:none)]:hidden',
            className
         )}
         {...props}
      />
   );
}

function DropdownMenuSub({ ...props }: React.ComponentProps<typeof DropdownMenuPrimitive.Sub>) {
   return <DropdownMenuPrimitive.Sub data-slot="dropdown-menu-sub" {...props} />;
}

function DropdownMenuSubTrigger({
   className,
   inset,
   children,
   ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubTrigger> & {
   inset?: boolean;
}) {
   return (
      <DropdownMenuPrimitive.SubTrigger
         data-slot="dropdown-menu-sub-trigger"
         data-inset={inset}
         className={cn(
            'focus:bg-accent focus:text-accent-foreground data-[state=open]:bg-accent data-[state=open]:text-accent-foreground flex cursor-pointer items-center rounded-sm px-2 py-1.5 outline-hidden select-none data-[inset]:pl-8',
            className
         )}
         {...props}
      >
         {children}
         <ChevronRightIcon className="ml-auto size-4" />
      </DropdownMenuPrimitive.SubTrigger>
   );
}

function DropdownMenuSubContent({
   className,
   collisionPadding = 8,
   ...props
}: React.ComponentProps<typeof DropdownMenuPrimitive.SubContent>) {
   return (
      <DropdownMenuPrimitive.SubContent
         data-slot="dropdown-menu-sub-content"
         collisionPadding={collisionPadding}
         className={cn(
            'bg-popover text-popover-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 max-w-[min(calc(100vw-1rem),var(--radix-dropdown-menu-content-available-width))] min-w-[min(8rem,var(--radix-dropdown-menu-content-available-width))] overflow-hidden rounded-md border p-1 shadow-lg',
            className
         )}
         {...props}
      />
   );
}

export {
   DropdownMenu,
   DropdownMenuPortal,
   DropdownMenuTrigger,
   DropdownMenuContent,
   DropdownMenuGroup,
   DropdownMenuLabel,
   DropdownMenuItem,
   DropdownMenuCheckboxItem,
   DropdownMenuRadioGroup,
   DropdownMenuRadioItem,
   DropdownMenuSeparator,
   DropdownMenuShortcut,
   DropdownMenuSub,
   DropdownMenuSubTrigger,
   DropdownMenuSubContent,
};
