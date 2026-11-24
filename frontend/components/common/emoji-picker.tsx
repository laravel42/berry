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

/**
 * Height shared by the picker host and the <em-emoji-picker> element so the
 * flex column inside the shadow root always gets a bounded scroll viewport
 * and Radix Popper measures its true height to flip cleanly above/below.
 */
const PICKER_HEIGHT = 'min(26rem, 60dvh)';

/**
 * Injected into emoji-mart's open shadow root to fix mobile Safari touch
 * scrolling:
 * - Explicitly bounds `#root` and gives `.scroll` `flex: 1 1 0%; min-height: 0`
 *   so WebKit computes a real scrollable flex area inside `position: fixed`
 *   popovers.
 * - Sets `-webkit-overflow-scrolling: touch`, `overscroll-behavior: contain`,
 *   and `touch-action: pan-y` on both `.scroll` and its emoji `<button>` cells
 *   so vertical finger drags start native momentum scrolling immediately.
 * - Drops `-webkit-backdrop-filter` on sticky category headers (a known iOS
 *   Safari compositor glitch inside shadow-DOM fixed popovers).
 */
const SHADOW_SCROLL_FIX_CSS = `
:host {
   display: flex;
   height: 100%;
   max-height: 100%;
}
#root {
   height: 100%;
   max-height: 100%;
   min-height: 0;
   overflow: hidden;
}
.scroll {
   flex: 1 1 0%;
   min-height: 0;
   overflow-x: hidden;
   overflow-y: auto;
   -webkit-overflow-scrolling: touch;
   overscroll-behavior: contain;
   touch-action: pan-y;
}
.scroll button {
   touch-action: pan-y;
}
.sticky {
   background-color: rgb(var(--em-rgb-background));
   -webkit-backdrop-filter: none;
   backdrop-filter: none;
}
`;

/**
 * Parse a browser-computed CSS color (`rgb(...)`, `rgba(...)`, or `color(srgb ...)`)
 * into an `r, g, b` triplet without `<canvas>.getImageData()` — canvas readback
 * is blanked to pure white `(255, 255, 255)` by anti-fingerprinting protections,
 * which otherwise turns the entire dark-mode picker white-on-white.
 */
function parseRgbTriplet(computed: string): string | null {
   const rgb = computed.match(/^rgba?\(\s*([\d.]+%?)\s*[,\s]\s*([\d.]+%?)\s*[,\s]\s*([\d.]+%?)/i);
   if (rgb) {
      const toByte = (raw: string) => {
         const value = Number.parseFloat(raw);
         if (Number.isNaN(value)) return null;
         const scaled = raw.endsWith('%') ? (value / 100) * 255 : value;
         return Math.max(0, Math.min(255, Math.round(scaled)));
      };
      const r = toByte(rgb[1] ?? '');
      const g = toByte(rgb[2] ?? '');
      const b = toByte(rgb[3] ?? '');
      if (r !== null && g !== null && b !== null) return `${r}, ${g}, ${b}`;
   }

   const srgb = computed.match(/^color\(\s*srgb\s+([\d.eE+-]+)\s+([\d.eE+-]+)\s+([\d.eE+-]+)/i);
   if (srgb) {
      const toByte = (raw: string) => {
         const value = Number.parseFloat(raw);
         if (Number.isNaN(value)) return null;
         return Math.max(0, Math.min(255, Math.round(value * 255)));
      };
      const r = toByte(srgb[1] ?? '');
      const g = toByte(srgb[2] ?? '');
      const b = toByte(srgb[3] ?? '');
      if (r !== null && g !== null && b !== null) return `${r}, ${g}, ${b}`;
   }

   return null;
}

/** Resolve a CSS custom property into an `r, g, b` triplet via computed style. */
function rgbTriplet(probe: HTMLElement, token: string): string | null {
   probe.style.color = `var(${token})`;
   const computed = getComputedStyle(probe).color;
   return parseRgbTriplet(computed);
}

/** Sync emoji-mart's theme attribute and CSS custom properties with Berry's active theme. */
function applyPickerTheme(container: HTMLElement, picker: HTMLElement) {
   const dark = document.documentElement.classList.contains('dark');
   const theme = dark ? 'dark' : 'light';
   picker.setAttribute('data-theme', theme);
   picker.shadowRoot?.querySelector('#root')?.setAttribute('data-theme', theme);

   for (const [name, token] of Object.entries(TRIPLET_TOKENS)) {
      const triplet = rgbTriplet(container, token);
      if (triplet) picker.style.setProperty(name, triplet);
      else picker.style.removeProperty(name);
   }
   container.style.color = '';
   for (const [name, value] of Object.entries(PLAIN_TOKENS)) {
      picker.style.setProperty(name, value);
   }
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
      let themeObserver: MutationObserver | null = null;

      // Radix Sheet/Dialog uses react-remove-scroll, which listens for `wheel`
      // and `touchmove` on `document` and calls `preventDefault()` whenever the
      // target sits outside the dialog's shard or inside a shadow root whose
      // host isn't itself scrollable. Stopping propagation from the picker's
      // shadow `.scroll` container lets native scrolling work smoothly on both
      // desktop wheel and iOS Safari touch without leaking overscroll.
      const stopScrollEscape = (event: Event) => {
         const scroller = picker?.shadowRoot?.querySelector('.scroll');
         if (!scroller) return;
         if (event.composedPath().includes(scroller)) {
            event.stopPropagation();
         }
      };
      container.addEventListener('wheel', stopScrollEscape, { passive: true });
      container.addEventListener('touchmove', stopScrollEscape, { passive: true });

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

            if (picker.shadowRoot) {
               const scrollFix = document.createElement('style');
               scrollFix.textContent = SHADOW_SCROLL_FIX_CSS;
               picker.shadowRoot.appendChild(scrollFix);
            }

            applyPickerTheme(container, picker);
            picker.style.height = '100%';
            container.replaceChildren(picker);

            themeObserver = new MutationObserver(() => {
               if (picker) applyPickerTheme(container, picker);
            });
            themeObserver.observe(document.documentElement, {
               attributes: true,
               attributeFilter: ['class'],
            });

            setReady(true);
         }
      );

      return () => {
         cancelled = true;
         themeObserver?.disconnect();
         container.removeEventListener('wheel', stopScrollEscape);
         container.removeEventListener('touchmove', stopScrollEscape);
         picker?.remove();
      };
   }, []);

   return (
      <div
         className={cn('relative min-w-[18rem]', className)}
         style={{ height: PICKER_HEIGHT }}
         aria-busy={!ready}
      >
         <div ref={host} className="h-full" />
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
   keepOpen = false,
   onOpenChange,
   onAfterClose,
   align = 'start',
   side,
}: {
   onSelect: (emoji: string, from: 'quick' | 'catalogue') => void;
   /** The trigger: a button, given to the popover with `asChild`. */
   children: ReactNode;
   quick?: readonly string[];
   isActive?: (emoji: string) => boolean;
   returnFocusTo?: RefObject<HTMLElement | null>;
   /** Keep the popover open after choosing an emoji so several can be inserted in a row. */
   keepOpen?: boolean;
   onOpenChange?: (open: boolean) => void;
   /** Runs inside `onCloseAutoFocus` after focus returns to `returnFocusTo`. */
   onAfterClose?: () => void;
   align?: 'start' | 'center' | 'end';
   side?: 'top' | 'bottom';
}) {
   const t = useTranslations('common.emoji');
   const [open, setOpen] = useState(false);
   const [catalogue, setCatalogue] = useState(!quick);

   const choose = (emoji: string, from: 'quick' | 'catalogue') => {
      onSelect(emoji, from);
      if (!keepOpen) setOpen(false);
   };

   return (
      <Popover
         open={open}
         onOpenChange={(next) => {
            setOpen(next);
            if (!next) setCatalogue(!quick);
            onOpenChange?.(next);
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
               onAfterClose?.();
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
   iconClassName,
   compact = false,
   disabled = false,
   align,
   side,
}: {
   textareaRef: RefObject<HTMLTextAreaElement | null>;
   value: string;
   onChange: (value: string) => void;
   className?: string;
   iconClassName?: string;
   /** Tight flush button with no extra horizontal padding (used in single-line composers). */
   compact?: boolean;
   /** Off while the box itself is. */
   disabled?: boolean;
   align?: 'start' | 'center' | 'end';
   side?: 'top' | 'bottom';
}) {
   const t = useTranslations('common.emoji');
   // Track the latest text and insertion caret in refs so rapid multi-emoji
   // picks append in order while the popover stays open, without stealing focus
   // (or raising the mobile keyboard) on every tap.
   const valueRef = useRef(value);
   useEffect(() => {
      valueRef.current = value;
   }, [value]);
   const caretRef = useRef<{ start: number; end: number } | null>(null);

   const handleOpenChange = (next: boolean) => {
      if (next) {
         const box = textareaRef.current;
         const len = valueRef.current.length;
         caretRef.current = {
            start: box?.selectionStart ?? len,
            end: box?.selectionEnd ?? len,
         };
      }
   };

   const insert = (emoji: string) => {
      const box = textareaRef.current;
      const current = valueRef.current;
      const live =
         box && document.activeElement === box
            ? {
                 start: box.selectionStart ?? current.length,
                 end: box.selectionEnd ?? current.length,
              }
            : caretRef.current;
      const rawStart = live?.start ?? box?.selectionStart ?? current.length;
      const rawEnd = live?.end ?? box?.selectionEnd ?? current.length;
      const start = Math.max(0, Math.min(rawStart, current.length));
      const end = Math.max(start, Math.min(rawEnd, current.length));
      const next = current.slice(0, start) + emoji + current.slice(end);
      const caret = start + emoji.length;
      valueRef.current = next;
      caretRef.current = { start: caret, end: caret };
      onChange(next);
      if (box && document.activeElement === box) {
         requestAnimationFrame(() => box.setSelectionRange(caret, caret));
      }
   };

   const restoreCaret = () => {
      const box = textareaRef.current;
      const caret = caretRef.current;
      caretRef.current = null;
      if (box && caret) {
         box.setSelectionRange(caret.start, caret.end);
      }
   };

   return (
      <EmojiPickerPopover
         onSelect={insert}
         returnFocusTo={textareaRef}
         keepOpen
         onOpenChange={handleOpenChange}
         onAfterClose={restoreCaret}
         align={align}
         side={side}
      >
         {compact ? (
            <button
               type="button"
               className={cn(
                  'inline-flex size-6 flex-none cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-45',
                  className
               )}
               aria-label={t('insert')}
               title={t('insert')}
               disabled={disabled}
            >
               <Smile className={cn('size-[18px]', iconClassName)} aria-hidden />
            </button>
         ) : (
            <Button
               type="button"
               variant="ghost"
               size="icon-sm"
               className={cn('flex-none', className)}
               aria-label={t('insert')}
               title={t('insert')}
               disabled={disabled}
            >
               <Smile className={cn('size-4', iconClassName)} aria-hidden />
            </Button>
         )}
      </EmojiPickerPopover>
   );
}
