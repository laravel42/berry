'use client';

import { Issue } from '@/data/issues';
import { useDisplaySettingsStore } from '@/store/display-settings-store';
import { format } from 'date-fns';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useRef, type Ref } from 'react';
import { useDrag } from 'react-dnd';
import { ActorLiveMark, useIssueLiveRun } from './actor-avatar';
import { AssigneeUser } from './assignee-user';
import { IssueDragType } from './issue-grid';
import { LabelBadge } from './label-badge';
import { PrioritySelector } from './priority-selector';
import { ProjectBadge } from './project-badge';
import { SelectionCheckbox } from './selection-checkbox';
import { StatusSelector } from './status-selector';
import { motion } from 'motion/react';

import { ContextMenu, ContextMenuTrigger } from '@/components/ui/context-menu';
import { cn } from '@/lib/utils';
import { IssueContextMenu } from './issue-context-menu';
import { WORKSPACE_SLUG } from '@/lib/config';

interface IssueLineProps {
   issue: Issue;
   layoutId?: boolean;
   /** Ids of the rows around this one, so a shift-click knows what "between" means. */
   order?: string[];
   /**
    * List views that move tasks between groups wrap a DndProvider; read-only
    * surfaces (goal overview, project tasks, search) do not, so drag stays off
    * unless asked for.
    */
   draggable?: boolean;
}

/**
 * The controls on a row sit above the link that covers it, so a click on the
 * status pill changes the status rather than opening the task. Each keeps its
 * own focus ring; the row's ring is the link's.
 *
 * One step is all it takes: the link's cover is a `before:absolute` at the
 * default z, so `z-[1]` clears it. A full `z-10` would also clear the sticky
 * group header, which sits at `z-10` and comes earlier in the document, and
 * the row's controls would paint over the header they scroll under.
 */
const CONTROL = 'relative z-[1]';

function IssueLineView({
   issue,
   layoutId = false,
   order = [],
   rowRef,
   isDragging,
}: IssueLineProps & {
   rowRef: Ref<HTMLDivElement>;
   isDragging: boolean;
}) {
   const { orgId } = useParams<{ orgId: string }>();
   const { displayProperties } = useDisplaySettingsStore();
   const liveRun = useIssueLiveRun(issue);

   return (
      <ContextMenu>
         <ContextMenuTrigger asChild>
            <motion.div
               ref={rowRef}
               style={{ opacity: isDragging ? 0.45 : 1 }}
               {...(layoutId && { layoutId: `issue-line-${issue.identifier}` })}
               className={cn(
                  'group relative flex min-h-11 w-full items-center justify-start border-b border-border/45 px-4 transition-colors sm:px-6',
                  'hover:bg-accent/45 focus-within:bg-accent/45',
                  issue.status.category === 'started' && 'bg-status-info/[0.025]',
                  issue.status.category === 'completed' && 'bg-status-success/[0.025]',
                  issue.status.id === 'blocked' && 'bg-status-warning/[0.035]'
               )}
            >
               <div className={cn('flex items-center gap-0.5', CONTROL)}>
                  <SelectionCheckbox issueId={issue.id} order={order} className="mr-1.5" />
                  {displayProperties.priority && (
                     <PrioritySelector priority={issue.priority} issueId={issue.id} />
                  )}
               </div>
               {displayProperties.id && (
                  <span className="mr-1 hidden w-[72px] shrink-0 truncate text-subtle-foreground sm:inline-block">
                     {issue.identifier}
                  </span>
               )}
               {displayProperties.status && (
                  <span className={cn('flex items-center', CONTROL)}>
                     <StatusSelector status={issue.status} issueId={issue.id} />
                  </span>
               )}
               {/* The link covers the whole row through its pseudo-element:
                   the key, the title and the dates are one target, which is
                   what the hover highlight has been promising. The controls
                   above are lifted over it. */}
               <Link
                  href={`/${orgId ?? WORKSPACE_SLUG}/issue/${issue.identifier}`}
                  draggable={false}
                  onClick={(event) => {
                     if (isDragging) event.preventDefault();
                  }}
                  className="mr-1 ml-1 flex min-w-0 items-center justify-start gap-1.5 outline-none before:absolute before:inset-0 before:rounded-sm focus-visible:before:ring-[3px] focus-visible:before:ring-ring/50"
               >
                  {liveRun ? (
                     <ActorLiveMark run={liveRun} fallbackName={issue.assignee?.name} />
                  ) : null}
                  <span className="truncate font-normal">{issue.title}</span>
                  <span className="sr-only"> {issue.identifier}</span>
               </Link>
               <div className="ml-auto flex items-center justify-end gap-2 sm:w-fit">
                  <div className="w-3 shrink-0"></div>
                  <div
                     className={cn(
                        'hidden items-center justify-end -space-x-5 transition-all duration-200 hover:space-x-1 sm:flex lg:space-x-1',
                        CONTROL
                     )}
                  >
                     {displayProperties.labels && <LabelBadge label={issue.labels} />}
                     {displayProperties.project && issue.project && (
                        <ProjectBadge project={issue.project} />
                     )}
                  </div>
                  {displayProperties.dueDate && issue.dueDate && (
                     <span className="hidden shrink-0 text-status-warning sm:inline-block">
                        due {format(new Date(issue.dueDate), 'MMM dd')}
                     </span>
                  )}
                  {displayProperties.created && (
                     <span className="hidden shrink-0 text-muted-foreground sm:inline-block">
                        {format(new Date(issue.createdAt), 'MMM dd')}
                     </span>
                  )}
                  {displayProperties.assignee && (
                     <span className={cn('flex items-center', CONTROL)}>
                        <AssigneeUser user={issue.assignee} issueId={issue.id} />
                     </span>
                  )}
               </div>
            </motion.div>
         </ContextMenuTrigger>
         <IssueContextMenu issueId={issue.id} />
      </ContextMenu>
   );
}

function DraggableIssueLine({ issue, layoutId = false, order = [] }: IssueLineProps) {
   const rowRef = useRef<HTMLDivElement>(null);

   // Rows drag for the same reason cards do: on the list layout, moving a task
   // between groups is the quickest way to change what it is grouped by.
   const [{ isDragging }, drag] = useDrag(
      () => ({
         type: IssueDragType,
         item: () => issue,
         collect: (monitor) => ({ isDragging: monitor.isDragging() }),
      }),
      [issue]
   );
   drag(rowRef);

   return (
      <IssueLineView
         issue={issue}
         layoutId={layoutId}
         order={order}
         rowRef={rowRef}
         isDragging={isDragging}
      />
   );
}

export function IssueLine({
   issue,
   layoutId = false,
   order = [],
   draggable = false,
}: IssueLineProps) {
   if (draggable) {
      return <DraggableIssueLine issue={issue} layoutId={layoutId} order={order} />;
   }
   return (
      <IssueLineView
         issue={issue}
         layoutId={layoutId}
         order={order}
         rowRef={null}
         isDragging={false}
      />
   );
}
