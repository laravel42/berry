'use client';

import { ProjectDateSelector } from '@/components/common/projects/create-project/date-selector';
import { IssueDetail } from '@/data/issue-details';
import { Issue } from '@/data/issues';
import { describePatchFailure, patchBoardIssue } from '@/lib/issues';
import { useIssuesStore } from '@/store/issues-store';
import { parseISO } from 'date-fns';
import { GitPullRequestArrow } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { AssigneeUser } from '../assignee-user';
import { AutoGateProperty } from './auto-gate-property';
import { IssuePriorityPicker, IssueStatusPicker } from '../issue-pickers';
import { IssueRefRow } from './content-blocks';
import { CustomStatusSelect } from './custom-status-select';
import { IssueCustomProperties } from './issue-custom-properties';
import { IssueDetailsSection } from './issue-details-section';
import { IssueLabelPicker } from './issue-label-picker';
import { IssueLinkedPullRequests } from './issue-linked-pull-requests';
import { IssueParentSection } from './issue-parent-section';
import { IssueCycleProperty } from './issue-cycle-property';
import { IssueProjectProperty } from './issue-project-property';
import { IssueQuickActions } from './issue-quick-actions';
import { IssueDependenciesSection, IssueMilestoneSection } from './issue-relations';
import { Section } from './panel-section';
import { ReviewerProperty } from './reviewer-property';

/** A stored instant as a local day, or nothing when it is absent or unreadable. */
function parseDay(value: string | undefined): Date | undefined {
   if (!value) return undefined;
   const parsed = parseISO(value);
   return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

interface IssuePropertiesPanelProps {
   issue: Issue;
   detail: IssueDetail;
}

/**
 * Everything about this task that is not its text.
 *
 * The order is the order a person asks: who has it, what state it is in,
 * then what it belongs to, then what it relates to, and finally where it came
 * from.
 */
export function IssuePropertiesPanel({ issue, detail }: IssuePropertiesPanelProps) {
   const t = useTranslations('issueDetail.properties');
   const updateIssue = useIssuesStore((state) => state.updateIssue);
   const startDate = parseDay(issue.startDate);
   const dueDate = parseDay(issue.dueDate);

   const saveDate = (key: 'startDate' | 'dueDate', date: Date | undefined) => {
      // Noon UTC keeps the calendar day the person picked. The API wants RFC 3339.
      const next = date
         ? new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), 12)).toISOString()
         : null;
      const previous = issue[key];
      updateIssue(issue.id, { [key]: next ?? undefined });
      void patchBoardIssue(issue.id, { [key]: next }).catch((cause: unknown) => {
         updateIssue(issue.id, { [key]: previous });
         toast.error(describePatchFailure(cause) || t('saveFailed'));
      });
   };

   return (
      <div className="flex h-full min-h-0 flex-col">
         <div className="no-scrollbar flex min-h-0 flex-1 flex-col gap-7 overflow-x-hidden overflow-y-auto">
            <Section title={t('title')}>
               <div className="flex flex-col [&>button]:pl-0!">
                  <AssigneeUser
                     user={issue.assignee}
                     issueId={issue.id}
                     monogram={false}
                     row
                     emptyLabel={t('assign')}
                  />
                  <IssueStatusPicker issue={issue} variant="row" />
                  <CustomStatusSelect issue={issue} />
                  <IssuePriorityPicker issue={issue} variant="row" />
                  <ReviewerProperty
                     issueRef={issue.identifier}
                     inReview={issue.status.id === 'in-review'}
                     autoGate={issue.autoGate}
                  />

                  <ProjectDateSelector
                     layout="row"
                     label={t('startDate')}
                     emptyLabel={t('setDate')}
                     date={startDate}
                     disabled={dueDate ? { after: dueDate } : undefined}
                     onChange={(date) => saveDate('startDate', date)}
                  />
                  <ProjectDateSelector
                     layout="row"
                     label={t('dueDate')}
                     emptyLabel={t('setDate')}
                     date={dueDate}
                     disabled={startDate ? { before: startDate } : undefined}
                     onChange={(date) => saveDate('dueDate', date)}
                  />

                  <IssueProjectProperty issue={issue} />
                  <IssueCycleProperty issue={issue} />
                  <AutoGateProperty issue={issue} />
               </div>
            </Section>

            <IssueLabelPicker issueRef={issue.identifier} />
            <IssueCustomProperties issueRef={issue.identifier} />

            <IssueParentSection issue={issue} />
            <IssueQuickActions issueRef={issue.identifier} />
            <IssueMilestoneSection issue={issue} />
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
         </div>
      </div>
   );
}
