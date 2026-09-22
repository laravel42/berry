'use client';

import { cn } from '@/lib/utils';
import Link from 'next/link';
import type { CSSProperties, ReactNode } from 'react';
import { Fact, Figure } from '@/components/common/page/page-parts';

export { Fact, Figure };

/**
 * The chart primitives Berry's pages are drawn with (first built for Usage).
 *
 * A page is read from its shapes: how a day's spend rose and fell, who took
 * which share of it, how long a task takes. Each primitive is plain markup and
 * CSS, sized from the numbers it is given, and coloured only with the theme's
 * tokens, so it holds in both themes. None of them knows what it measures;
 * the tab that uses one says so in the label it passes, which is also what a
 * screen reader is given in place of the drawing.
 */

/** A panel: one chart, under the question it answers. */
export function ChartPanel({
   title,
   hint,
   className,
   children,
}: {
   title: string;
   hint?: string | undefined;
   className?: string | undefined;
   children: ReactNode;
}) {
   return (
      <section
         className={cn('flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-5', className)}
      >
         <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
            <h2 className="font-medium">{title}</h2>
            {hint ? <span className="text-muted-foreground">{hint}</span> : null}
         </div>
         {children}
      </section>
   );
}

/**
 * The top of a chart-led page: the one figure the page is about at poster
 * size, a line saying what it is, a few facts beside it, and the chart that
 * shows how it came about. Every such page opens this way, so the first glance
 * answers "how much, and is that good" before any list is read.
 */
export function PageHero({
   label,
   figure,
   tone,
   caption,
   facts,
   children,
}: {
   /** Small capitals above the figure: what is counted, and over what window. */
   label: string;
   figure: ReactNode;
   /** A text colour class for the figure, when its state matters (`text-status-success`). */
   tone?: string | undefined;
   caption?: ReactNode;
   facts?: Array<{ value: string; label: string }> | undefined;
   /** The chart. Omit it and the hero is the figure and its facts alone. */
   children?: ReactNode;
}) {
   // Split by the width of the place the hero is in, not the window's: the
   // same hero sits in a full page, a 60% pane and a drawer, and a window
   // breakpoint would put figure and chart side by side in all three.
   return (
      <section className="@container rounded-xl border bg-card p-6">
         <div className="grid gap-x-10 gap-y-6 @3xl:grid-cols-12">
            <div
               className={cn(
                  'flex flex-col justify-between gap-6',
                  children ? '@3xl:col-span-5' : '@3xl:col-span-12'
               )}
            >
               <div className="flex flex-col gap-1">
                  <span className="font-medium tracking-wider text-muted-foreground uppercase">
                     {label}
                  </span>
                  <Figure size="hero" className={tone}>
                     {figure}
                  </Figure>
                  {caption ? <span className="text-muted-foreground">{caption}</span> : null}
               </div>
               {facts && facts.length > 0 ? (
                  <div
                     className={cn(
                        'grid gap-x-6 gap-y-4',
                        children
                           ? facts.length === 3
                              ? 'grid-cols-3'
                              : 'grid-cols-2'
                           : 'grid-cols-2 @xl:grid-cols-4'
                     )}
                  >
                     {facts.map((fact) => (
                        <Fact key={fact.label} value={fact.value} label={fact.label} />
                     ))}
                  </div>
               ) : null}
            </div>
            {children ? (
               <div className="flex min-w-0 flex-col justify-end gap-3 @3xl:col-span-7">
                  {children}
               </div>
            ) : null}
         </div>
      </section>
   );
}

/** A chart's key: a swatch and what it stands for. */
export function Legend({ items }: { items: Array<{ label: string; tone: string }> }) {
   return (
      <div className="flex flex-wrap justify-end gap-x-4 gap-y-1 text-muted-foreground">
         {items.map((item) => (
            <span key={item.label} className="flex items-center gap-1.5">
               <span aria-hidden className={cn('size-2.5 rounded-sm', item.tone)} />
               {item.label}
            </span>
         ))}
      </div>
   );
}

export interface SeriesBar {
   key: string;
   label: string;
   /** Drawn above the line. */
   top: number;
   topLabel?: string | undefined;
   /** Drawn below the line; omit for a chart with one side. */
   bottom?: number | undefined;
   bottomLabel?: string | undefined;
}

/**
 * Bars through time: one measure above the line and, optionally, a second
 * hanging below it, so two things that move together are read in one glance.
 * With many buckets the per-bar figures and most labels are dropped, since they
 * would only overprint each other.
 */
export function SeriesBars({
   bars,
   label,
   topTone = 'bg-foreground',
   bottomTone = 'bg-status-info',
   height = 200,
   bottomHeight = 84,
}: {
   bars: SeriesBar[];
   label: string;
   topTone?: string;
   bottomTone?: string;
   height?: number;
   bottomHeight?: number;
}) {
   const maxTop = Math.max(1, ...bars.map((bar) => bar.top));
   const maxBottom = Math.max(1, ...bars.map((bar) => bar.bottom ?? 0));
   const twoSided = bars.some((bar) => bar.bottom !== undefined);
   const dense = bars.length > 16;
   const every = bars.length > 60 ? 14 : bars.length > 31 ? 7 : dense ? 5 : 1;
   return (
      <div
         role="img"
         aria-label={label}
         className="grid items-stretch"
         style={{
            gridTemplateColumns: `repeat(${bars.length}, minmax(0, 1fr))`,
            columnGap: dense ? 3 : 12,
         }}
      >
         {bars.map((bar, index) => (
            <div key={bar.key} className="flex min-w-0 flex-col items-center">
               <div
                  className="flex w-full flex-col items-center justify-end gap-1"
                  style={{ height }}
               >
                  {!dense && bar.topLabel ? (
                     <span className="whitespace-nowrap tabular-nums">{bar.topLabel}</span>
                  ) : null}
                  <div
                     className={cn('w-full rounded-t', topTone)}
                     style={{
                        height: Math.round((bar.top / maxTop) * (height - 26)),
                        minHeight: bar.top > 0 ? 2 : 0,
                     }}
                  />
               </div>
               <div className="h-px w-full bg-border" />
               {twoSided ? (
                  <div
                     className="flex w-full flex-col items-center gap-1 pt-0.5"
                     style={{ height: bottomHeight }}
                  >
                     <div
                        className={cn('w-full rounded-b', bottomTone)}
                        style={{
                           height: Math.round(
                              ((bar.bottom ?? 0) / maxBottom) * (bottomHeight - 24)
                           ),
                           minHeight: (bar.bottom ?? 0) > 0 ? 2 : 0,
                        }}
                     />
                     {!dense && bar.bottomLabel ? (
                        <span className="text-muted-foreground tabular-nums">
                           {bar.bottomLabel}
                        </span>
                     ) : null}
                  </div>
               ) : null}
               <span className="pt-1 whitespace-nowrap text-muted-foreground tabular-nums">
                  {index % every === 0 ? bar.label : ''}
               </span>
            </div>
         ))}
      </div>
   );
}

export interface TreemapItem {
   id: string;
   label: string;
   value: number;
   /** The figure drawn in the tile. */
   figure: string;
   caption?: string | undefined;
   href?: string | undefined;
}

type TreemapNode = { items: TreemapItem[]; total: number };

/** Splits a value-sorted list into two groups with sums as equal as they can be. */
function halve(items: TreemapItem[]): [TreemapItem[], TreemapItem[]] {
   const total = items.reduce((sum, item) => sum + item.value, 0);
   let running = 0;
   let cut = 1;
   for (let index = 0; index < items.length - 1; index += 1) {
      running += items[index]!.value;
      cut = index + 1;
      if (running >= total / 2) break;
   }
   return [items.slice(0, cut), items.slice(cut)];
}

/**
 * Shares as areas. The list is halved by value again and again, the split
 * turning each time, which keeps the tiles near square and puts the largest at
 * the top left. A tile's shade follows its rank, so the order is readable even
 * where a tile is too small for its name.
 */
export function Treemap({ items, label }: { items: TreemapItem[]; label: string }) {
   const sorted = [...items].filter((item) => item.value > 0).sort((a, b) => b.value - a.value);
   const rank = new Map(sorted.map((item, index) => [item.id, index]));
   const count = Math.max(1, sorted.length - 1);

   const tile = (item: TreemapItem) => {
      const strength = Math.round(100 - ((rank.get(item.id) ?? 0) / count) * 78);
      const style: CSSProperties = {
         flexGrow: item.value,
         flexBasis: 0,
         background: `color-mix(in oklab, var(--foreground) ${strength}%, var(--card))`,
         color: strength >= 55 ? 'var(--background)' : 'var(--foreground)',
      };
      const body = (
         <>
            <span className="truncate font-medium">{item.label}</span>
            <span className="flex min-w-0 flex-col">
               <Figure
                  size={strength > 80 ? 'lg' : strength > 55 ? 'md' : 'sm'}
                  className="truncate"
               >
                  {item.figure}
               </Figure>
               {item.caption && strength > 55 ? (
                  <span className="truncate opacity-70">{item.caption}</span>
               ) : null}
            </span>
         </>
      );
      const className =
         'flex min-h-0 min-w-0 flex-col justify-between gap-1 overflow-hidden rounded-md p-2.5 no-underline outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50';
      return item.href ? (
         <Link
            key={item.id}
            href={item.href}
            className={className}
            style={style}
            title={`${item.label} · ${item.figure}`}
         >
            {body}
         </Link>
      ) : (
         <div
            key={item.id}
            className={className}
            style={style}
            title={`${item.label} · ${item.figure}`}
         >
            {body}
         </div>
      );
   };

   const render = (node: TreemapNode, horizontal: boolean): ReactNode => {
      if (node.items.length === 1) return tile(node.items[0]!);
      const [first, second] = halve(node.items);
      const sum = (list: TreemapItem[]) => list.reduce((total, item) => total + item.value, 0);
      return (
         <div
            key={node.items.map((item) => item.id).join('|')}
            className={cn('flex min-h-0 min-w-0 gap-1', horizontal ? 'flex-row' : 'flex-col')}
            style={{ flexGrow: node.total, flexBasis: 0 }}
         >
            {render({ items: first, total: sum(first) }, !horizontal)}
            {render({ items: second, total: sum(second) }, !horizontal)}
         </div>
      );
   };

   if (sorted.length === 0) return null;
   return (
      <div role="img" aria-label={label} className="flex min-h-0 flex-1">
         {render(
            { items: sorted, total: sorted.reduce((total, item) => total + item.value, 0) },
            true
         )}
      </div>
   );
}

export interface Slice {
   label: string;
   value: number;
   figure: string;
   color: string;
}

/** Shares of a whole as a ring, with the largest named in the middle. */
export function Donut({
   slices,
   label,
   center,
   centerLabel,
}: {
   slices: Slice[];
   label: string;
   center: string;
   centerLabel: string;
}) {
   const total = slices.reduce((sum, slice) => sum + slice.value, 0) || 1;
   let at = 0;
   const stops = slices.map((slice) => {
      const from = at;
      at += (slice.value / total) * 100;
      return `${slice.color} ${from.toFixed(2)}% ${at.toFixed(2)}%`;
   });
   return (
      <div className="flex flex-col items-center gap-4">
         <div
            role="img"
            aria-label={label}
            className="flex size-44 items-center justify-center rounded-full"
            style={{ background: `conic-gradient(${stops.join(', ')})` }}
         >
            <div className="flex size-28 flex-col items-center justify-center rounded-full bg-card">
               <Figure size="md">{center}</Figure>
               <span className="max-w-24 truncate text-muted-foreground">{centerLabel}</span>
            </div>
         </div>
         <ul className="flex w-full flex-col gap-1.5">
            {slices.map((slice) => (
               <li key={slice.label} className="flex min-w-0 items-center gap-2">
                  <span
                     aria-hidden
                     className="size-2.5 shrink-0 rounded-sm"
                     style={{ background: slice.color }}
                  />
                  <span className="min-w-0 flex-1 truncate">{slice.label}</span>
                  <span className="font-medium tabular-nums">{slice.figure}</span>
               </li>
            ))}
         </ul>
      </div>
   );
}

/** One ratio as a three-quarter dial. */
export function Gauge({
   ratio,
   label,
   figure,
   caption,
}: {
   ratio: number;
   label: string;
   figure: string;
   caption: string;
}) {
   const sweep = Math.max(0, Math.min(1, ratio)) * 75;
   return (
      <div
         role="img"
         aria-label={label}
         className="flex size-44 items-center justify-center rounded-full"
         style={{
            background: `conic-gradient(from 225deg, var(--status-info) 0 ${sweep.toFixed(2)}%, var(--muted) ${sweep.toFixed(2)}% 75%, transparent 75% 100%)`,
         }}
      >
         <div className="flex size-32 flex-col items-center justify-center rounded-full bg-card">
            <Figure size="md">{figure}</Figure>
            <span className="text-muted-foreground">{caption}</span>
         </div>
      </div>
   );
}

export interface LollipopRow {
   id: string;
   label: string;
   value: number;
   figure: string;
}

/** One value per row on a shared scale, with a marker for the value they are compared against. */
export function Lollipops({
   rows,
   label,
   reference,
}: {
   rows: LollipopRow[];
   label: string;
   reference?: number | undefined;
}) {
   const max = Math.max(reference ?? 0, ...rows.map((row) => row.value), 0.000001);
   return (
      <div role="img" aria-label={label} className="flex flex-1 flex-col justify-between gap-2">
         {rows.map((row) => (
            <div
               key={row.id}
               className="grid grid-cols-[minmax(6.5rem,14rem)_minmax(0,1fr)_3.5rem] items-center gap-2.5"
            >
               <span className="truncate" title={row.label}>
                  {row.label}
               </span>
               <span className="relative block h-3.5">
                  <span
                     className="absolute top-1.5 left-0 h-0.5 bg-muted-foreground/60"
                     style={{ width: `${(row.value / max) * 100}%` }}
                  />
                  <span
                     className="absolute top-px -ml-1.5 size-3 rounded-full bg-foreground"
                     style={{ left: `${(row.value / max) * 100}%` }}
                  />
                  {reference !== undefined ? (
                     <span
                        className="absolute -top-1 h-[22px] w-px bg-status-warning"
                        style={{ left: `${(reference / max) * 100}%` }}
                     />
                  ) : null}
               </span>
               <span className="text-right font-medium tabular-nums">{row.figure}</span>
            </div>
         ))}
      </div>
   );
}

export interface ScatterPoint {
   id: string;
   label: string;
   x: number;
   y: number;
   size: number;
}

/** Two measures against each other, with a third as the size of the mark. */
export function Scatter({
   points,
   label,
   xTicks,
   yTicks,
}: {
   points: ScatterPoint[];
   label: string;
   xTicks: (value: number) => string;
   yTicks: (value: number) => string;
}) {
   const maxX = Math.max(1, ...points.map((point) => point.x)) * 1.08;
   const maxY = Math.max(0.000001, ...points.map((point) => point.y)) * 1.08;
   const maxSize = Math.max(0.000001, ...points.map((point) => point.size));
   return (
      <div className="flex min-h-0 flex-1 gap-2">
         <div className="flex w-12 flex-col justify-between pb-6 text-right text-muted-foreground tabular-nums">
            {[1, 2 / 3, 1 / 3, 0].map((step) => (
               <span key={step}>{yTicks(maxY * step)}</span>
            ))}
         </div>
         <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div
               role="img"
               aria-label={label}
               className="relative min-h-40 flex-1 border-b border-l"
               style={{
                  backgroundImage:
                     'linear-gradient(var(--border), var(--border)), linear-gradient(var(--border), var(--border))',
                  backgroundSize: '100% 1px, 100% 1px',
                  backgroundPosition: '0 33.3%, 0 66.6%',
                  backgroundRepeat: 'no-repeat',
               }}
            >
               {points.map((point) => {
                  const diameter = Math.round(14 + Math.sqrt(point.size / maxSize) * 50);
                  return (
                     <div
                        key={point.id}
                        className="absolute flex items-center"
                        style={{
                           left: `${(point.x / maxX) * 100}%`,
                           bottom: `${(point.y / maxY) * 100}%`,
                           transform: 'translate(-50%, 50%)',
                        }}
                     >
                        <span
                           aria-hidden
                           className="block rounded-full border-2 border-foreground/60 bg-foreground/20"
                           style={{ width: diameter, height: diameter }}
                        />
                        <span className="absolute left-full ml-1.5 whitespace-nowrap">
                           {point.label}
                        </span>
                     </div>
                  );
               })}
            </div>
            <div className="flex justify-between text-muted-foreground tabular-nums">
               {[0, 0.25, 0.5, 0.75, 1].map((step) => (
                  <span key={step}>{xTicks(maxX * step)}</span>
               ))}
            </div>
         </div>
      </div>
   );
}

/** Where the middle and the bulk of a spread sit between its two ends. */
export function RangeStrip({
   min,
   median,
   p90,
   max,
   label,
   format,
   captions,
}: {
   min: number;
   median: number;
   p90: number;
   max: number;
   label: string;
   format: (value: number) => string;
   captions: { min: string; median: string; p90: string; max: string };
}) {
   const at = (value: number) => (max <= 0 ? 0 : Math.max(0, Math.min(100, (value / max) * 100)));
   return (
      <div className="flex flex-col gap-2">
         <div role="img" aria-label={label} className="relative h-14">
            <div className="absolute inset-x-0 top-6 h-2 rounded bg-muted" />
            <div
               className="absolute top-6 h-2 rounded bg-status-success/50"
               style={{ left: `${at(min)}%`, width: `${Math.max(0, at(p90) - at(min))}%` }}
            />
            <div
               className="absolute top-6 h-2 rounded bg-status-success"
               style={{ left: `${at(min)}%`, width: `${Math.max(0, at(median) - at(min))}%` }}
            />
            <div
               className="absolute top-3.5 h-7 w-0.5 bg-foreground"
               style={{ left: `${at(median)}%` }}
            />
            <div
               className="absolute top-4.5 h-5 w-0.5 bg-muted-foreground"
               style={{ left: `${at(p90)}%` }}
            />
         </div>
         <dl className="grid grid-cols-2 gap-x-6 gap-y-2 sm:grid-cols-4">
            {(
               [
                  [captions.min, min],
                  [captions.median, median],
                  [captions.p90, p90],
                  [captions.max, max],
               ] as const
            ).map(([caption, value]) => (
               <div key={caption} className="flex flex-col">
                  <dd className="font-medium tabular-nums">{format(value)}</dd>
                  <dt className="text-muted-foreground">{caption}</dt>
               </div>
            ))}
         </dl>
      </div>
   );
}

/** A count as that many squares, one per thing, so small numbers stay countable. */
export function Squares({
   count,
   tone = 'bg-status-success',
   cap = 60,
}: {
   count: number;
   tone?: string;
   cap?: number;
}) {
   return (
      <span aria-hidden className="flex flex-wrap gap-[3px]">
         {Array.from({ length: Math.min(count, cap) }, (_, index) => (
            <span key={index} className={cn('size-3.5 rounded-[3px]', tone)} />
         ))}
      </span>
   );
}

export interface Share {
   id: string;
   label: string;
   value: number;
   figure: string;
}

/** Shares of a whole as one strip of blocks, largest first, fading by rank. */
export function ShareStrip({
   shares,
   label,
   tone = 'var(--status-info)',
}: {
   shares: Share[];
   label: string;
   tone?: string;
}) {
   const sorted = [...shares].filter((share) => share.value > 0).sort((a, b) => b.value - a.value);
   const count = Math.max(1, sorted.length - 1);
   if (sorted.length === 0) return null;
   return (
      <div role="img" aria-label={label} className="flex h-24 gap-1">
         {sorted.map((share, index) => {
            const strength = Math.round(100 - (index / count) * 70);
            return (
               <div
                  key={share.id}
                  title={`${share.label} · ${share.figure}`}
                  className="flex min-w-0 flex-col justify-between overflow-hidden rounded-md p-2.5"
                  style={{
                     flexGrow: share.value,
                     flexBasis: 0,
                     background: `color-mix(in oklab, ${tone} ${strength}%, var(--card))`,
                     color: strength >= 60 ? 'var(--background)' : 'var(--foreground)',
                  }}
               >
                  <span className="truncate font-medium">{share.label}</span>
                  <span className="truncate font-medium tabular-nums">{share.figure}</span>
               </div>
            );
         })}
      </div>
   );
}
