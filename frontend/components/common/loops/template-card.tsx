'use client';

import {
   Activity,
   ArrowRight,
   Bot,
   Bug,
   CalendarClock,
   GitPullRequest,
   ListFilter,
   Newspaper,
   ShieldCheck,
   type LucideIcon,
} from 'lucide-react';

import { loopTint } from '@/components/common/loops/loop-visuals';
import type { LoopTemplate } from '@/lib/autopilots';

/** A glyph per template category; the catalogue itself is the server's. */
export const TEMPLATE_ICON: Record<string, LucideIcon> = {
   triage: Bug,
   review: GitPullRequest,
   health: Activity,
   reporting: Newspaper,
   quality: ShieldCheck,
   schedule: CalendarClock,
};
export const FALLBACK_TEMPLATE_ICON: LucideIcon = ListFilter;

/** One template to start a Loop from: what it does, and when it would run. */
export function TemplateCard({
   template,
   onChoose,
}: {
   template: LoopTemplate;
   onChoose: (template: LoopTemplate) => void;
}) {
   const Icon = TEMPLATE_ICON[template.category] ?? FALLBACK_TEMPLATE_ICON;
   const tint = loopTint(template.key);
   return (
      <button
         type="button"
         onClick={() => onChoose(template)}
         className="group flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4 text-left shadow-xs transition-[box-shadow,border-color] hover:border-foreground/15 hover:shadow-md focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
         <span className="flex w-full items-start gap-3">
            <span
               className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-card"
               style={{
                  color: tint,
                  boxShadow: `0 0 0 1px color-mix(in oklab, ${tint} 45%, transparent)`,
               }}
               aria-hidden
            >
               <Icon className="size-4" />
            </span>
            <span className="min-w-0 flex-1 pt-1 font-medium">
               <span className="block truncate">{template.name}</span>
            </span>
            <ArrowRight
               className="mt-1.5 size-4 shrink-0 text-subtle-foreground opacity-0 transition-[opacity,transform] group-hover:translate-x-0.5 group-hover:opacity-100"
               aria-hidden
            />
         </span>
         <span className="line-clamp-2 min-h-[2lh] text-pretty text-muted-foreground">
            {template.description}
         </span>
         <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-subtle-foreground">
            <span className="inline-flex min-w-0 items-center gap-1.5">
               <CalendarClock className="size-3.5 shrink-0" aria-hidden />
               <span className="truncate">{template.trigger.description}</span>
            </span>
            {template.suggestedAgent ? (
               <span className="inline-flex min-w-0 items-center gap-1.5">
                  <Bot className="size-3.5 shrink-0" aria-hidden />
                  <span className="truncate">{template.suggestedAgent.name}</span>
               </span>
            ) : null}
         </span>
      </button>
   );
}
