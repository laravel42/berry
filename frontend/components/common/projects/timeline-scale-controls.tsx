'use client';

import { Button } from '@/components/ui/button';
import {
   DropdownMenu,
   DropdownMenuContent,
   DropdownMenuItem,
   DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { TIMELINE_ZOOM_LEVELS, useProjectsDisplayStore } from '@/store/projects-display-store';
import { Check, ChevronDown } from 'lucide-react';

/** Today + scale zoom for the projects timeline, shown in the filter bar. */
export function TimelineScaleControls() {
   const timelineZoom = useProjectsDisplayStore((state) => state.timelineZoom);
   const setTimelineZoom = useProjectsDisplayStore((state) => state.setTimelineZoom);
   const jumpTimelineToToday = useProjectsDisplayStore((state) => state.jumpTimelineToToday);
   const current =
      TIMELINE_ZOOM_LEVELS.find((level) => level.id === timelineZoom) ?? TIMELINE_ZOOM_LEVELS[0]!;

   return (
      <>
         <Button
            size="xs"
            variant="outline"
            className="border-muted-foreground/15"
            onClick={() => jumpTimelineToToday()}
         >
            Today
         </Button>
         <DropdownMenu>
            <DropdownMenuTrigger asChild>
               <Button
                  size="xs"
                  variant="outline"
                  className="border-muted-foreground/15 inline-flex items-center gap-1"
               >
                  {current.label}
                  <ChevronDown className="size-3 text-muted-foreground" />
               </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-40">
               {TIMELINE_ZOOM_LEVELS.map((level) => (
                  <DropdownMenuItem
                     key={level.id}
                     onClick={() => setTimelineZoom(level.id)}
                     className="flex items-center gap-2"
                  >
                     <span className="flex-1">{level.label}</span>
                     {timelineZoom === level.id && <Check className="size-3.5" />}
                     <span className="text-muted-foreground">{level.shortcut}</span>
                  </DropdownMenuItem>
               ))}
            </DropdownMenuContent>
         </DropdownMenu>
      </>
   );
}
