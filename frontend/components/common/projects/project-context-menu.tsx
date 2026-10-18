'use client';

import { ActorAvatar } from '@/components/common/issues/actor-avatar';
import {
   DeleteProjectDialog,
   useProjectDeletion,
} from '@/components/common/projects/delete-project';
import { HealthIcon } from '@/components/common/projects/health-popover';
import { leadCandidates } from '@/components/common/projects/lead-picker';
import { projectCreateStatusOptions } from '@/components/common/projects/create-project/project-status-options';
import {
   ContextMenuContent,
   ContextMenuItem,
   ContextMenuRadioGroup,
   ContextMenuRadioItem,
   ContextMenuSeparator,
   ContextMenuSub,
   ContextMenuSubContent,
   ContextMenuSubTrigger,
} from '@/components/ui/context-menu';
import { health as healthOptions, type Project } from '@/data/projects';
import { priorities } from '@/data/priorities';
import { WORKSPACE_SLUG } from '@/lib/config';
import { pinTarget, unpinTarget } from '@/lib/pins';
import { useMembersStore } from '@/store/members-store';
import { usePinsStore } from '@/store/pins-store';
import { useProjectsStore } from '@/store/projects-store';
import { useSessionStore } from '@/store/session-store';
import { format } from 'date-fns';
import type { MouseEvent } from 'react';
import {
   Activity,
   BarChart3,
   CalendarClock,
   CircleCheck,
   ExternalLink,
   Link as LinkIcon,
   Pin,
   PinOff,
   Trash2,
   User,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { toast } from 'sonner';

/** Left click on a project row or card opens the same menu as a right click. */
export function openContextMenuOnClick(event: MouseEvent<HTMLElement>) {
   const target = event.target;
   if (!(target instanceof Element)) return;
   if (target.closest('a, button, input, [role="checkbox"], [role="combobox"]')) return;
   event.currentTarget.dispatchEvent(
      new MouseEvent('contextmenu', {
         bubbles: true,
         cancelable: true,
         view: window,
         clientX: event.clientX,
         clientY: event.clientY,
      })
   );
}

function dayFromNow(offset: number): string {
   const day = new Date();
   day.setHours(0, 0, 0, 0);
   day.setDate(day.getDate() + offset);
   return format(day, 'yyyy-MM-dd');
}

function datePreset(targetDate: string | undefined): string {
   if (!targetDate) return 'none';
   const day = targetDate.slice(0, 10);
   if (day === dayFromNow(0)) return 'today';
   if (day === dayFromNow(1)) return 'tomorrow';
   if (day === dayFromNow(7)) return 'next-week';
   return '';
}

/** Status, priority, lead, health, target date, then pin, copy and delete. */
export function ProjectContextMenuContent({ project }: { project: Project }) {
   const t = useTranslations('issueLists.projects');
   const menu = useTranslations('issueLists.menu');
   const { orgId } = useParams<{ orgId: string }>();
   const members = useMembersStore((state) => state.members);
   const updateProjectStatus = useProjectsStore((state) => state.updateProjectStatus);
   const updateProjectPriority = useProjectsStore((state) => state.updateProjectPriority);
   const updateProjectLead = useProjectsStore((state) => state.updateProjectLead);
   const updateProjectHealth = useProjectsStore((state) => state.updateProjectHealth);
   const updateProjectTargetDate = useProjectsStore((state) => state.updateProjectTargetDate);
   const workspaceId = useSessionStore((state) => state.workspace?.id ?? '');
   const pins = usePinsStore((state) => state.pins);
   const addPin = usePinsStore((state) => state.add);
   const removePin = usePinsStore((state) => state.remove);
   const deletion = useProjectDeletion();

   const href = `/${orgId ?? WORKSPACE_SLUG}/project/${project.id}/overview`;
   const pin = pins.find(
      (entry) => entry.targetType === 'project' && entry.targetId === project.id
   );
   const leads = leadCandidates(members, project.lead);

   const togglePin = () => {
      const write = pin
         ? unpinTarget(workspaceId, pin.id).then(() => removePin(pin.id))
         : pinTarget(workspaceId, 'project', project.id).then(addPin);
      void write.catch(() => toast.error(t('pinFailed')));
   };

   const copyLink = () => {
      void navigator.clipboard.writeText(`${window.location.origin}${href}`).then(
         () => toast.success(t('linkCopied')),
         () => toast.error(t('copyFailed'))
      );
   };

   return (
      <ContextMenuContent className="min-w-52">
         <ContextMenuSub>
            <ContextMenuSubTrigger>
               <CircleCheck className="mr-2 size-4" /> {t('status')}
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="min-w-44">
               <ContextMenuRadioGroup
                  value={project.status.id}
                  onValueChange={(id) => {
                     const match = projectCreateStatusOptions.find(
                        (option) => option.status.id === id
                     );
                     if (match) updateProjectStatus(project.id, match.status);
                  }}
               >
                  {projectCreateStatusOptions.map((option) => {
                     const Icon = option.status.icon;
                     return (
                        <ContextMenuRadioItem key={option.status.id} value={option.status.id}>
                           <Icon /> {option.label}
                        </ContextMenuRadioItem>
                     );
                  })}
               </ContextMenuRadioGroup>
            </ContextMenuSubContent>
         </ContextMenuSub>

         <ContextMenuSub>
            <ContextMenuSubTrigger>
               <BarChart3 className="mr-2 size-4" /> {t('priority')}
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="min-w-44">
               <ContextMenuRadioGroup
                  value={project.priority.id}
                  onValueChange={(id) => {
                     const match = priorities.find((priority) => priority.id === id);
                     if (match) updateProjectPriority(project.id, match);
                  }}
               >
                  {priorities.map((priority) => (
                     <ContextMenuRadioItem key={priority.id} value={priority.id}>
                        <priority.icon className="size-4" /> {priority.name}
                     </ContextMenuRadioItem>
                  ))}
               </ContextMenuRadioGroup>
            </ContextMenuSubContent>
         </ContextMenuSub>

         <ContextMenuSub>
            <ContextMenuSubTrigger>
               <User className="mr-2 size-4" /> {t('lead')}
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="min-w-48">
               <ContextMenuRadioGroup
                  value={project.lead?.id ?? ''}
                  onValueChange={(id) => {
                     const member = leads.find((candidate) => candidate.id === id);
                     if (member) updateProjectLead(project.id, member);
                  }}
               >
                  {leads.map((member) => (
                     <ContextMenuRadioItem key={member.id} value={member.id}>
                        <ActorAvatar user={member} size="sm" className="size-4" />
                        {member.name}
                     </ContextMenuRadioItem>
                  ))}
               </ContextMenuRadioGroup>
            </ContextMenuSubContent>
         </ContextMenuSub>

         <ContextMenuSub>
            <ContextMenuSubTrigger>
               <Activity className="mr-2 size-4" /> {t('health')}
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="min-w-44">
               <ContextMenuRadioGroup
                  value={project.health.id}
                  onValueChange={(id) => {
                     const match = healthOptions.find((entry) => entry.id === id);
                     if (match) updateProjectHealth(project.id, match.id);
                  }}
               >
                  {healthOptions.map((entry) => (
                     <ContextMenuRadioItem key={entry.id} value={entry.id}>
                        <HealthIcon healthId={entry.id} /> {entry.name}
                     </ContextMenuRadioItem>
                  ))}
               </ContextMenuRadioGroup>
            </ContextMenuSubContent>
         </ContextMenuSub>

         <ContextMenuSub>
            <ContextMenuSubTrigger>
               <CalendarClock className="mr-2 size-4" /> {t('targetDate')}
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="min-w-44">
               <ContextMenuRadioGroup
                  value={datePreset(project.targetDate)}
                  onValueChange={(preset) => {
                     if (preset === 'today') updateProjectTargetDate(project.id, dayFromNow(0));
                     else if (preset === 'tomorrow')
                        updateProjectTargetDate(project.id, dayFromNow(1));
                     else if (preset === 'next-week')
                        updateProjectTargetDate(project.id, dayFromNow(7));
                     else if (preset === 'none') updateProjectTargetDate(project.id, undefined);
                  }}
               >
                  <ContextMenuRadioItem value="today">{menu('today')}</ContextMenuRadioItem>
                  <ContextMenuRadioItem value="tomorrow">{menu('tomorrow')}</ContextMenuRadioItem>
                  <ContextMenuRadioItem value="next-week">{menu('nextWeek')}</ContextMenuRadioItem>
                  <ContextMenuRadioItem value="none">{t('clearTargetDate')}</ContextMenuRadioItem>
               </ContextMenuRadioGroup>
            </ContextMenuSubContent>
         </ContextMenuSub>

         <ContextMenuSeparator />

         <ContextMenuItem onSelect={() => window.open(href, '_blank', 'noopener')}>
            <ExternalLink className="size-4" /> {t('openInNewTab')}
         </ContextMenuItem>
         <ContextMenuItem onSelect={togglePin}>
            {pin ? <PinOff className="size-4" /> : <Pin className="size-4" />}
            {pin ? t('unpin') : t('pin')}
         </ContextMenuItem>
         <ContextMenuItem onSelect={copyLink}>
            <LinkIcon className="size-4" /> {t('copyLink')}
         </ContextMenuItem>

         <ContextMenuSeparator />

         <ContextMenuItem
            variant="destructive"
            onSelect={(event) => {
               event.preventDefault();
               deletion.request(project);
            }}
         >
            <Trash2 className="size-4" /> {t('delete')}
         </ContextMenuItem>
         <DeleteProjectDialog deletion={deletion} />
      </ContextMenuContent>
   );
}
