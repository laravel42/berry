'use client';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { BerryMark } from '@/components/brand/berry-mark';
import { colorForAgent } from '@/lib/agent-color';
import {
   ContextMenuCheckboxItem,
   ContextMenuContent,
   ContextMenuGroup,
   ContextMenuItem,
   ContextMenuRadioGroup,
   ContextMenuRadioItem,
   ContextMenuSeparator,
   ContextMenuShortcut,
   ContextMenuSub,
   ContextMenuSubContent,
   ContextMenuSubTrigger,
} from '@/components/ui/context-menu';
import { DeleteIssueDialog, useIssueDeletion } from '@/components/common/issues/delete-issue';
import { useIssueActions } from '@/components/common/issues/use-issue-actions';
import { priorities } from '@/data/priorities';
import { status } from '@/data/status';
import { agentToUser } from '@/lib/agents';
import { useAgentsStore } from '@/store/agents-store';
import { useIssuesStore } from '@/store/issues-store';
import {
   BarChart3,
   CalendarClock,
   CircleCheck,
   ExternalLink,
   Folder,
   Link as LinkIcon,
   Link2,
   Pin,
   PinOff,
   Tag,
   Trash2,
   User,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';

interface IssueContextMenuProps {
   issueId?: string;
}

/** How many sibling tasks a relation submenu offers before it stops listing. */
const RELATION_CHOICES = 8;

const NO_ASSIGNEE = 'none';
const NO_PROJECT = 'none';

/** Which due-date preset matches the stored day, if any. */
function dueDatePreset(dueDate?: string): 'today' | 'tomorrow' | 'next-week' | 'none' | '' {
   if (!dueDate) return 'none';
   const due = new Date(dueDate);
   const matches = (offset: number) => {
      const day = new Date();
      day.setHours(0, 0, 0, 0);
      day.setDate(day.getDate() + offset);
      return (
         due.getFullYear() === day.getFullYear() &&
         due.getMonth() === day.getMonth() &&
         due.getDate() === day.getDate()
      );
   };
   if (matches(0)) return 'today';
   if (matches(1)) return 'tomorrow';
   if (matches(7)) return 'next-week';
   return '';
}

/**
 * The right-click menu on a row or a card: the fields people change without
 * opening anything, the ways out of the list, the relations, and delete.
 */
export function IssueContextMenu({ issueId }: IssueContextMenuProps) {
   const t = useTranslations('issueLists');
   const actions = useIssueActions(issueId);
   const issue = actions.issue;
   const deletion = useIssueDeletion();
   const { projects, members, labels } = actions;
   const agents = useAgentsStore((state) => state.agents);
   const issues = useIssuesStore((state) => state.issues);

   const agentPeople = useMemo(() => agents.map(agentToUser), [agents]);

   /* Candidates for a parent or an adopted sub-task: other tasks, nearest
      first. A full picker belongs on the task page; this is the quick path. */
   const relatives = useMemo(
      () => issues.filter((candidate) => candidate.id !== issue?.id).slice(0, RELATION_CHOICES),
      [issues, issue?.id]
   );

   return (
      <ContextMenuContent className="w-64">
         <ContextMenuGroup>
            <ContextMenuSub>
               <ContextMenuSubTrigger>
                  <CircleCheck className="mr-2 size-4" /> {t('display.status')}
               </ContextMenuSubTrigger>
               <ContextMenuSubContent className="w-48">
                  <ContextMenuRadioGroup value={issue?.status.id} onValueChange={actions.setStatus}>
                     {status.map((entry) => {
                        const Icon = entry.icon;
                        return (
                           <ContextMenuRadioItem key={entry.id} value={entry.id}>
                              <Icon /> {entry.name}
                           </ContextMenuRadioItem>
                        );
                     })}
                  </ContextMenuRadioGroup>
               </ContextMenuSubContent>
            </ContextMenuSub>

            <ContextMenuSub>
               <ContextMenuSubTrigger>
                  <User className="mr-2 size-4" /> {t('display.assignee')}
               </ContextMenuSubTrigger>
               <ContextMenuSubContent className="w-48">
                  <ContextMenuRadioGroup
                     value={issue?.assignee?.id ?? NO_ASSIGNEE}
                     onValueChange={(id) => actions.setAssignee(id === NO_ASSIGNEE ? null : id)}
                  >
                     <ContextMenuRadioItem value={NO_ASSIGNEE}>
                        <User className="size-4" /> {t('filters.noAssignee')}
                     </ContextMenuRadioItem>
                     {members.map((user) => (
                        <ContextMenuRadioItem key={user.id} value={user.id}>
                           <Avatar className="size-4">
                              <AvatarImage src={user.avatarUrl} alt={user.name} />
                              <AvatarFallback>{user.name[0]}</AvatarFallback>
                           </Avatar>
                           {user.name}
                        </ContextMenuRadioItem>
                     ))}
                     {agentPeople.map((agent) => (
                        <ContextMenuRadioItem key={agent.id} value={agent.id}>
                           <BerryMark
                              size="sm"
                              tone="working"
                              dotColor={colorForAgent(agent.id)}
                              label={`${agent.name}, agent`}
                           />
                           {agent.name}
                        </ContextMenuRadioItem>
                     ))}
                  </ContextMenuRadioGroup>
               </ContextMenuSubContent>
            </ContextMenuSub>

            <ContextMenuSub>
               <ContextMenuSubTrigger>
                  <BarChart3 className="mr-2 size-4" /> {t('display.priority')}
               </ContextMenuSubTrigger>
               <ContextMenuSubContent className="w-48">
                  <ContextMenuRadioGroup
                     value={issue?.priority.id}
                     onValueChange={actions.setPriority}
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
                  <CalendarClock className="mr-2 size-4" /> {t('menu.dueDate')}
               </ContextMenuSubTrigger>
               <ContextMenuSubContent className="w-48">
                  <ContextMenuRadioGroup
                     value={dueDatePreset(issue?.dueDate)}
                     onValueChange={(preset) => {
                        if (preset === 'today') actions.setDueDateToday();
                        else if (preset === 'tomorrow') actions.setDueDateTomorrow();
                        else if (preset === 'next-week') actions.setDueDateNextWeek();
                        else if (preset === 'none') actions.clearDueDate();
                     }}
                  >
                     <ContextMenuRadioItem value="today">{t('menu.today')}</ContextMenuRadioItem>
                     <ContextMenuRadioItem value="tomorrow">
                        {t('menu.tomorrow')}
                     </ContextMenuRadioItem>
                     <ContextMenuRadioItem value="next-week">
                        {t('menu.nextWeek')}
                     </ContextMenuRadioItem>
                     <ContextMenuRadioItem value="none">{t('menu.clearDate')}</ContextMenuRadioItem>
                  </ContextMenuRadioGroup>
               </ContextMenuSubContent>
            </ContextMenuSub>

            <ContextMenuSub>
               <ContextMenuSubTrigger>
                  <Tag className="mr-2 size-4" /> {t('menu.labels')}
               </ContextMenuSubTrigger>
               <ContextMenuSubContent className="w-48">
                  {labels.map((label) => (
                     <ContextMenuCheckboxItem
                        key={label.id}
                        checked={issue?.labels.some((current) => current.id === label.id) ?? false}
                        onCheckedChange={() => actions.toggleLabel(label.id)}
                     >
                        <span
                           className="inline-block size-3 rounded-full"
                           style={{ backgroundColor: label.color }}
                           aria-hidden="true"
                        />
                        {label.name}
                     </ContextMenuCheckboxItem>
                  ))}
               </ContextMenuSubContent>
            </ContextMenuSub>

            <ContextMenuSub>
               <ContextMenuSubTrigger>
                  <Folder className="mr-2 size-4" /> {t('display.project')}
               </ContextMenuSubTrigger>
               <ContextMenuSubContent className="w-64">
                  <ContextMenuRadioGroup
                     value={issue?.project?.id ?? NO_PROJECT}
                     onValueChange={(id) => actions.setProject(id === NO_PROJECT ? null : id)}
                  >
                     <ContextMenuRadioItem value={NO_PROJECT}>
                        <Folder className="size-4" /> {t('filters.noProject')}
                     </ContextMenuRadioItem>
                     {projects.slice(0, 8).map((project) => (
                        <ContextMenuRadioItem key={project.id} value={project.id}>
                           <project.icon className="size-4" /> {project.name}
                        </ContextMenuRadioItem>
                     ))}
                  </ContextMenuRadioGroup>
               </ContextMenuSubContent>
            </ContextMenuSub>
         </ContextMenuGroup>

         <ContextMenuSeparator />

         <ContextMenuItem onClick={actions.openInNewTab}>
            <ExternalLink className="size-4" /> {t('menu.openInNewTab')}
         </ContextMenuItem>
         <ContextMenuItem onClick={actions.togglePin}>
            {actions.isPinned ? <PinOff className="size-4" /> : <Pin className="size-4" />}
            {actions.isPinned ? t('menu.unpin') : t('menu.pin')}
         </ContextMenuItem>
         <ContextMenuItem onClick={actions.copyLink}>
            <LinkIcon className="size-4" /> {t('menu.copyLink')}
            <ContextMenuShortcut>⌘L</ContextMenuShortcut>
         </ContextMenuItem>

         <ContextMenuSeparator />

         <ContextMenuSub>
            <ContextMenuSubTrigger>
               <Link2 className="mr-2 size-4" /> {t('menu.relations')}
            </ContextMenuSubTrigger>
            <ContextMenuSubContent className="w-64">
               <ContextMenuItem onClick={() => actions.createSubIssue()}>
                  {t('menu.subIssue')}
               </ContextMenuItem>
               <ContextMenuSub>
                  <ContextMenuSubTrigger>{t('menu.setParent')}</ContextMenuSubTrigger>
                  <ContextMenuSubContent className="w-64">
                     <ContextMenuRadioGroup
                        value={issue?.parentId ?? ''}
                        onValueChange={actions.setParentIssue}
                     >
                        {relatives.map((candidate) => (
                           <ContextMenuRadioItem key={candidate.id} value={candidate.id}>
                              <span className="text-muted-foreground">{candidate.identifier}</span>
                              <span className="truncate">{candidate.title}</span>
                           </ContextMenuRadioItem>
                        ))}
                     </ContextMenuRadioGroup>
                  </ContextMenuSubContent>
               </ContextMenuSub>
               <ContextMenuItem disabled={!issue?.parentId} onClick={() => actions.removeParent()}>
                  {t('menu.removeParent')}
               </ContextMenuItem>
               <ContextMenuSub>
                  <ContextMenuSubTrigger>{t('menu.addExisting')}</ContextMenuSubTrigger>
                  <ContextMenuSubContent className="w-64">
                     {relatives.map((candidate) => (
                        <ContextMenuCheckboxItem
                           key={candidate.id}
                           checked={candidate.parentId === issue?.id}
                           onCheckedChange={() => actions.addExistingSubIssue(candidate.id)}
                        >
                           <span className="text-muted-foreground">{candidate.identifier}</span>
                           <span className="truncate">{candidate.title}</span>
                        </ContextMenuCheckboxItem>
                     ))}
                  </ContextMenuSubContent>
               </ContextMenuSub>
            </ContextMenuSubContent>
         </ContextMenuSub>

         <ContextMenuSeparator />

         <ContextMenuItem
            variant="destructive"
            onSelect={(event) => {
               // The menu closes on select and would unmount the dialog with
               // it, so the default is prevented and the dialog opened instead.
               event.preventDefault();
               if (issue) deletion.request(issue);
            }}
         >
            <Trash2 className="size-4" /> {t('menu.delete')}
            <ContextMenuShortcut>⌘⌫</ContextMenuShortcut>
         </ContextMenuItem>

         <DeleteIssueDialog deletion={deletion} />
      </ContextMenuContent>
   );
}
