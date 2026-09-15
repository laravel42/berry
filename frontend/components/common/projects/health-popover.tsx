'use client';

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { CircleCheck, CircleX, AlertCircle, CircleDashed, Bell } from 'lucide-react';
import { Project } from '@/data/projects';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';

interface HealthPopoverProps {
   project: Project;
}

function HealthIcon({ healthId }: { healthId: string }) {
   switch (healthId) {
      case 'on-track':
         return <CircleCheck className="size-4 text-status-success" aria-hidden />;
      case 'off-track':
         return <CircleX className="size-4 text-status-danger" aria-hidden />;
      case 'at-risk':
         return <AlertCircle className="size-4 text-status-warning" aria-hidden />;
      case 'no-update':
      default:
         // Neutral, not alarmed: no update is a fact, not a warning.
         return <CircleDashed className="size-4 text-status-neutral" aria-hidden />;
   }
}

export function HealthPopover({ project }: HealthPopoverProps) {
   const isMobile = useIsMobile();
   const label = project.health.name;

   return (
      <Popover>
         <PopoverTrigger asChild>
            <Button
               className="flex h-7 items-center justify-start gap-1 px-2 has-[>svg]:px-2"
               size="sm"
               variant="ghost"
               aria-label={`Health: ${label}`}
               title={label}
            >
               <HealthIcon healthId={project.health.id} />
               <span className="mt-[1px] ml-0.5 hidden xl:inline">{label}</span>
            </Button>
         </PopoverTrigger>
         <PopoverContent
            side={isMobile ? 'bottom' : 'left'}
            className={cn('p-0 w-[480px]', isMobile ? 'w-full' : '')}
         >
            <div className="flex items-center justify-between border-b p-3">
               <div className="flex items-center gap-2">
                  {project.icon && (
                     <project.icon className="size-4 shrink-0 text-muted-foreground" />
                  )}
                  <h4 className="font-medium">{project.name}</h4>
               </div>
               <div className="flex items-center gap-2">
                  <Button variant="ghost" size="sm" className="h-7 px-2">
                     Subscribe
                  </Button>
                  <Button variant="outline" size="sm" className="h-7 px-2 flex items-center gap-1">
                     <Bell className="size-3" />
                     New update
                  </Button>
               </div>
            </div>
            <div className="p-3 space-y-3">
               <div className="flex items-center justify-start gap-3">
                  <div className="flex items-center gap-2">
                     <HealthIcon healthId={project.health.id} />
                     <span>{label}</span>
                  </div>
                  <div className="flex items-center gap-2">
                     <Avatar className="size-5">
                        <AvatarImage src={project.lead.avatarUrl} alt={project.lead.name} />
                        <AvatarFallback>{project.lead.name.charAt(0)}</AvatarFallback>
                     </Avatar>
                     <span className="text-muted-foreground">{project.lead.name}</span>
                     <span className="text-muted-foreground">·</span>
                     <span className="text-muted-foreground">
                        {new Date(project.startDate).toLocaleDateString()}
                     </span>
                  </div>
               </div>

               <div>
                  <p className="text-muted-foreground">{project.health.description}</p>
               </div>
            </div>
         </PopoverContent>
      </Popover>
   );
}
