'use client';

import { Plus, Smile } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

/**
 * The page's theme tokens, as the picker wants them. emoji-mart draws inside
 * a shadow root and takes its colours as `r, g, b` triplets, so each token is
 * read off the page and converted when the picker opens. Nothing here is a
 * colour of its own: change the token and the picker follows.
 */
const TRIPLET_TOKENS = {
   '--rgb-background': '--popover',
   '--rgb-color': '--popover-foreground',
   '--rgb-accent': '--primary',
   '--rgb-input': '--background',
} as const;

/** Passed through as they are: these the picker reads as plain CSS values. */
const PLAIN_TOKENS = {
   '--color-border': 'var(--border)',
   '--color-border-over': 'var(--input)',
   '--font-family': 'var(--font-sans)',
   '--font-size': 'var(--text-sm)',
   // The popover around it draws the edge and the shadow.
   '--border-radius': '0',
   '--shadow': 'none',
} as const;

/** What emoji-mart hands back for a chosen emoji; only the character is kept. */
interface ChosenEmoji {
   native: string;
}

/** Any CSS colour (hex, oklab, a color-mix) as `r, g, b`, via the probe's computed colour. */
function rgbTriplet(probe: HTMLElement, token: string): string | null {
   probe.style.color = `var(${token})`;
   const computed = getComputedStyle(probe).color;
   const context = document.createElement('canvas').getContext('2d', {
      willReadFrequently: true,
   });
   if (!context) return null;
   context.fillStyle = computed;
   context.fillRect(0, 0, 1, 1);
   const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
   return `${r}, ${g}, ${b}`;
}

/**
 * The whole emoji catalogue: search, categories, skin tones and the ones used
 * lately, from emoji-mart. The catalogue and its data load only when a picker
 * first opens, so a page that never opens one never downloads them.
 *
 * Choosing an emoji calls `onSelect` with the character itself (skin tone
 * included), ready to put in a message or send as a reaction.
 */
export function EmojiPicker({
   onSelect,
   className,
}: {
   onSelect: (emoji: string) => void;
   className?: string;
}) {
   const t = useTranslations('common.emoji');
   const host = useRef<HTMLDivElement>(null);
   const [ready, setReady] = useState(false);
   // The latest handler, so the picker is built once and still calls the current one.
   const select = useRef(onSelect);
   useEffect(() => {
      select.current = onSelect;
   }, [onSelect]);

   useEffect(() => {
      const container = host.current;
      if (!container) return;
      let cancelled = false;
      let picker: HTMLElement | null = null;

      void Promise.all([import('emoji-mart'), import('@emoji-mart/data')]).then(
         ([{ Picker }, { default: data }]) => {
            if (cancelled) return;
            const dark = document.documentElement.classList.contains('dark');
            const wide = window.matchMedia('(min-width: 640px)').matches;
            const touch = window.matchMedia('(pointer: coarse)').matches;
            picker = new Picker({
               data,
               set: 'native',
               theme: dark ? 'dark' : 'light',
               locale: 'en',
               perLine: wide ? 9 : 8,
               emojiButtonSize: 36,
               emojiSize: 22,
               maxFrequentRows: 2,
               previewPosition: 'none',
               skinTonePosition: 'search',
               // On a phone a focused search field raises the keyboard over the grid.
               autoFocus: !touch,
               onEmojiSelect: (emoji: ChosenEmoji) => select.current(emoji.native),
            }) as unknown as HTMLElement;

            for (const [name, token] of Object.entries(TRIPLET_TOKENS)) {
               const triplet = rgbTriplet(container, token);
               if (triplet) picker.style.setProperty(name, triplet);
            }
            container.style.color = '';
            for (const [name, value] of Object.entries(PLAIN_TOKENS)) {
               picker.style.setProperty(name, value);
            }
            // Short enough to leave the page in sight on a phone.
            picker.style.height = 'min(26rem, 60dvh)';
            container.replaceChildren(picker);
            setReady(true);
         }
      );

      return () => {
         cancelled = true;
         picker?.remove();
      };
   }, []);

   return (
      <div
         className={cn('relative min-h-[min(26rem,60dvh)] min-w-[18rem]', className)}
         aria-busy={!ready}
      >
         <div ref={host} />
         {ready ? null : (
            <p className="absolute inset-0 flex items-center justify-center text-muted-foreground">
               {t('loading')}
            </p>
         )}
      </div>
   );
}

/**
 * A trigger that opens the emoji catalogue in a popover and closes it on a
 * choice.
 *
 * With `quick`, the popover first offers that short row (one tap for the
 * usual reactions) and a More button that opens the whole catalogue in its
 * place. `isActive` marks the ones already chosen, such as the viewer's own
 * reactions.
 *
 * `returnFocusTo` is where focus goes when the popover closes: the text box
 * an emoji was just put into, rather than the trigger.
 */
export function EmojiPickerPopover({
   onSelect,
   children,
   quick,
   isActive,
   returnFocusTo,
   align = 'start',
   side,
}: {
   onSelect: (emoji: string, from: 'quick' | 'catalogue') => void;
   /** The trigger: a button, given to the popover with `asChild`. */
   children: ReactNode;
   quick?: readonly string[];
   isActive?: (emoji: string) => boolean;
   returnFocusTo?: RefObject<HTMLElement | null>;
   align?: 'start' | 'center' | 'end';
   side?: 'top' | 'bottom';
}) {
   const t = useTranslations('common.emoji');
   const [open, setOpen] = useState(false);
   const [catalogue, setCatalogue] = useState(!quick);

   const choose = (emoji: string, from: 'quick' | 'catalogue') => {
      onSelect(emoji, from);
      setOpen(false);
   };

   return (
      <Popover
         open={open}
         onOpenChange={(next) => {
            setOpen(next);
            if (!next) setCatalogue(!quick);
         }}
      >
         <PopoverTrigger asChild>{children}</PopoverTrigger>
         <PopoverContent
            align={align}
            side={side}
            collisionPadding={16}
            className="w-auto overflow-hidden p-0"
            onCloseAutoFocus={(event) => {
               if (!returnFocusTo?.current) return;
               event.preventDefault();
               returnFocusTo.current.focus();
            }}
         >
            {catalogue ? (
               <EmojiPicker onSelect={(emoji) => choose(emoji, 'catalogue')} />
            ) : (
               <div role="group" aria-label={t('quick')} className="flex items-center gap-1 p-1.5">
                  {quick?.map((emoji) => (
                     <button
                        key={emoji}
                        type="button"
                        aria-pressed={isActive ? isActive(emoji) : undefined}
                        onClick={() => choose(emoji, 'quick')}
                        className="flex size-(--field-h) items-center justify-center rounded-md leading-none outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 aria-pressed:bg-accent"
                     >
                        {emoji}
                     </button>
                  ))}
                  <span aria-hidden className="mx-0.5 h-5 w-px bg-border" />
                  <Button
                     type="button"
                     variant="ghost"
                     size="icon-sm"
                     aria-label={t('more')}
                     title={t('more')}
                     onClick={() => setCatalogue(true)}
                  >
                     <Plus className="size-4" aria-hidden />
                  </Button>
               </div>
            )}
         </PopoverContent>
      </Popover>
   );
}

/**
 * The emoji button for a message box: puts the chosen emoji where the caret
 * was (over any selection) and hands focus back to the box after it.
 */
export function EmojiInsertButton({
   textareaRef,
   value,
   onChange,
   className,
   disabled = false,
   align,
   side,
}: {
   textareaRef: RefObject<HTMLTextAreaElement | null>;
   value: string;
   onChange: (value: string) => void;
   className?: string;
   /** Off while the box itself is. */
   disabled?: boolean;
   align?: 'start' | 'center' | 'end';
   side?: 'top' | 'bottom';
}) {
   const t = useTranslations('common.emoji');

   const insert = (emoji: string) => {
      const box = textareaRef.current;
      const start = box?.selectionStart ?? value.length;
      const end = box?.selectionEnd ?? value.length;
      onChange(value.slice(0, start) + emoji + value.slice(end));
      const caret = start + emoji.length;
      // After the new value renders, so the caret lands after the emoji.
      requestAnimationFrame(() => box?.setSelectionRange(caret, caret));
   };

   return (
      <EmojiPickerPopover onSelect={insert} returnFocusTo={textareaRef} align={align} side={side}>
         <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className={cn('flex-none', className)}
            aria-label={t('insert')}
            title={t('insert')}
            disabled={disabled}
         >
            <Smile className="size-4" aria-hidden />
         </Button>
      </EmojiPickerPopover>
   );
}
