'use client';

import { IssueDetail } from '@/data/issue-details';
import { Issue } from '@/data/issues';
import { describePatchFailure, patchBoardIssue } from '@/lib/issues';
import { useIssuesStore } from '@/store/issues-store';
import { cn } from '@/lib/utils';
import { format, parseISO } from 'date-fns';
import { CalendarClock, GitPullRequestArrow } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRef } from 'react';
import { toast } from 'sonner';
import { AssigneeUser } from '../assignee-user';
import { PrioritySelector } from '../priority-selector';
import { StatusSelector } from '../status-selector';
import { IssueRefRow } from './content-blocks';
import { CustomStatusSelect } from './custom-status-select';
import { IssueCustomProperties } from './issue-custom-properties';
import { IssueDetailsSection } from './issue-details-section';
import { IssueLabelPicker } from './issue-label-picker';
import { IssueLinkedPullRequests } from './issue-linked-pull-requests';
import { IssueParentSection } from './issue-parent-section';
import { IssueProjectProperty } from './issue-project-property';
import { IssueQuickActions } from './issue-quick-actions';
import { IssueDependenciesSection, IssueGoalSection } from './issue-relations';
import { Section } from './panel-section';
import { ReviewerProperty } from './reviewer-property';
import { IssueUsageSection } from '@/components/common/usage/issue-usage-section';

interface IssuePropertiesPanelProps {
   issue: Issue;
   detail: IssueDetail;
}

/**
 * Everything about this task that is not its text.
 *
 * The order is the order a person asks: what state is it in and who has it,
 * then what it belongs to, then what it relates to, and finally where it came
 * from.
 */
export function IssuePropertiesPanel({ issue, detail }: IssuePropertiesPanelProps) {
   const t = useTranslations('issueDetail.properties');
   const updateIssue = useIssuesStore((state) => state.updateIssue);
   const duePicker = useRef<HTMLInputElement>(null);
   const dueValue = issue.dueDate ? issue.dueDate.slice(0, 10) : '';
   const dueLabel = (() => {
      if (!issue.dueDate) return null;
      try {
         return format(parseISO(issue.dueDate), 'd MMM yyyy');
      } catch {
         return dueValue;
      }
   })();

   const openDuePicker = () => {
      const element = duePicker.current;
      if (!element) return;
      try {
         element.showPicker();
      } catch {
         element.focus();
         element.click();
      }
   };

   const saveDueDate = (value: string) => {
      // The date input yields YYYY-MM-DD; the API insists on RFC 3339.
      const dueDate = value === '' ? null : new Date(`${value}T12:00:00.000Z`).toISOString();
      const previous = issue.dueDate;
      updateIssue(issue.id, { dueDate: dueDate ?? undefined });
      void patchBoardIssue(issue.id, { dueDate }).catch((cause: unknown) => {
         updateIssue(issue.id, { dueDate: previous });
         toast.error(describePatchFailure(cause) || t('saveFailed'));
      });
   };

   return (
      <div className="flex h-full min-h-0 flex-col">
         <div className="no-scrollbar flex min-h-0 flex-1 flex-col gap-6 overflow-x-hidden overflow-y-auto">
            <Section title={t('title')}>
               <div className="flex flex-col gap-1.5">
                  <div className="flex items-center gap-2">
                     <div className="flex size-7 shrink-0 items-center justify-center">
                        <StatusSelector status={issue.status} issueId={issue.id} />
                     </div>
                     <span className="min-w-0 truncate">{issue.status.name}</span>
                  </div>
                  <CustomStatusSelect issue={issue} />
                  <div className="flex items-center gap-2">
                     <div className="flex size-7 shrink-0 items-center justify-center">
                        <PrioritySelector priority={issue.priority} issueId={issue.id} />
                     </div>
                     <span className="min-w-0 truncate">{issue.priority.name}</span>
                  </div>
                  <div className="flex items-center gap-2">
                     {issue.assignee ? (
                        <AssigneeUser
                           user={issue.assignee}
                           issueId={issue.id}
                           monogram={false}
                           showName
                        />
                     ) : (
                        <>
                           <div className="flex size-7 shrink-0 items-center justify-center">
                              <AssigneeUser user={null} issueId={issue.id} monogram={false} />
                           </div>
                           <span className="min-w-0 truncate">{t('assign')}</span>
                        </>
                     )}
                  </div>
                  <ReviewerProperty issueRef={issue.identifier} />

                  <div className="flex items-center gap-2">
                     <button
                        type="button"
                        className="flex size-7 shrink-0 items-center justify-center rounded-sm outline-none hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
                        aria-label={t('dueDate')}
                        onClick={openDuePicker}
                     >
                        <CalendarClock className="size-4 text-status-info" aria-hidden />
                     </button>
                     <button
                        type="button"
                        className={cn(
                           'outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                           dueLabel
                              ? 'h-7 tabular-nums hover:bg-accent/40'
                              : 'border-b border-dashed border-muted-foreground/50 pb-px text-muted-foreground'
                        )}
                        onClick={openDuePicker}
                     >
                        {dueLabel ?? t('setDate')}
                     </button>
                     <input
                        ref={duePicker}
                        type="date"
                        aria-label={t('dueDate')}
                        value={dueValue}
                        onChange={(event) => saveDueDate(event.target.value)}
                        className="sr-only"
                     />
                  </div>

                  <IssueProjectProperty issue={issue} />
                  {issue.project && detail.milestone ? (
                     <div className="flex items-center gap-2 pl-9 text-muted-foreground">
                        <span className="size-2 shrink-0 rotate-45 border border-status-warning" />
                        <span className="truncate">{detail.milestone}</span>
                     </div>
                  ) : null}
               </div>
            </Section>

            <IssueLabelPicker issueRef={issue.identifier} />
            <IssueCustomProperties issueRef={issue.identifier} />

            <IssueParentSection issue={issue} />
            <IssueQuickActions issueRef={issue.identifier} />
            <IssueGoalSection issue={issue} />
            <IssueDependenciesSection issue={issue} />
            <IssueLinkedPullRequests issueRef={issue.identifier} />

            {detail.relatedIds && detail.relatedIds.length > 0 && (
               <Section title="Related">
                  <div className="flex flex-col">
                     {detail.relatedIds.map((identifier) => (
                        <IssueRefRow key={identifier} identifier={identifier} />
                     ))}
                  </div>
               </Section>
            )}

            {detail.prLinks && detail.prLinks.length > 0 && (
               <Section title="Diffs">
                  <div className="flex flex-col gap-1">
                     {detail.prLinks.map((pr) => (
                        <div key={pr.id} className="flex min-w-0 items-center gap-2">
                           <GitPullRequestArrow
                              className={
                                 'size-3.5 shrink-0 ' +
                                 (pr.status === 'merged'
                                    ? 'text-review-approved'
                                    : 'text-status-info')
                              }
                           />
                           <span className="shrink-0 text-muted-foreground">{pr.id}</span>
                           <span className="truncate">{pr.title}</span>
                           <span className="ml-auto shrink-0 rounded bg-accent px-1.5 py-0.5 uppercase tracking-wide text-muted-foreground">
                              {pr.status}
                           </span>
                        </div>
                     ))}
                  </div>
               </Section>
            )}

            <IssueDetailsSection issue={issue} />
            <IssueUsageSection issueId={issue.id} />
         </div>
      </div>
   );
}
