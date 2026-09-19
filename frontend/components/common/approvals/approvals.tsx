'use client';

import { BerryMark } from '@/components/brand/berry-mark';
import {
   EmptyState,
   EmptyStateMark,
   EmptyStateText,
   EmptyStateTitle,
} from '@/components/common/empty-state';
import { Pill } from '@/components/common/plans/plan-sections';
import {
   approvalDecisionKind,
   describeApprovalKind,
   describeRequestedFrom,
   getApproval,
   listWorkspaceApprovals,
   summarizeApprovalTitle,
   type Approval,
} from '@/lib/approvals';
import { APPROVAL_STATUS, statusLook } from '@/lib/catalog';
import { cn } from '@/lib/utils';
import { useApprovalsFilterStore } from '@/store/approvals-filter-store';
import { useApprovalsStore } from '@/store/approvals-store';
import { useMembersStore } from '@/store/members-store';
import { useSessionStore } from '@/store/session-store';
import { formatDistanceToNowStrict, parseISO } from 'date-fns';
import { ArrowLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';
import { ApprovalCard, useApprovalOutcomeLabel } from './approval-card';

const RISK_TONE = { low: 'neutral', medium: 'attention', high: 'danger' } as const;

function relativeTime(iso: string): string {
   try {
      return formatDistanceToNowStrict(parseISO(iso), { addSuffix: true });
   } catch {
      return iso;
   }
}

/**
 * One decision in the list: the task key and a short summary of what is
 * asked, then the kind and risk as pills. The agent's full title is a
 * sentence or three; it stays in `title=` and in the request on the card.
 */
function ApprovalRow({
   approval,
   selected,
   onSelect,
}: {
   approval: Approval;
   selected: boolean;
   onSelect: () => void;
}) {
   const t = useTranslations('approvals');
   const outcomeLabel = useApprovalOutcomeLabel();
   const members = useMembersStore((state) => state.members);
   const look = statusLook(APPROVAL_STATUS, approval.status);
   const pending = approval.status === 'pending';
   const summary = summarizeApprovalTitle(approval.title);
   return (
      <li>
         <button
            type="button"
            onClick={onSelect}
            aria-current={selected ? 'true' : undefined}
            className={cn(
               'flex w-full cursor-pointer items-start gap-3 border-b border-border/60 px-4 py-3 text-left transition-colors hover:bg-accent/40 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset focus-visible:outline-none',
               selected && 'bg-accent/70 hover:bg-accent/70'
            )}
         >
            <BerryMark size="sm" tone={look.tone} state={look.state} className="mt-1" />
            <span className="min-w-0 flex-1">
               <span className="flex items-start gap-2">
                  {approval.issue && (
                     <span className="shrink-0 tabular-nums text-muted-foreground">
                        {approval.issue.identifier}
                     </span>
                  )}
                  <span
                     className="line-clamp-2 min-w-0 flex-1 break-words font-medium"
                     title={approval.title}
                  >
                     {summary}
                  </span>
                  <span className="shrink-0 text-muted-foreground">
                     {relativeTime(approval.requestedAt)}
                  </span>
               </span>
               <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">
                  <Pill>{describeApprovalKind(approval.kind)}</Pill>
                  <Pill tone={RISK_TONE[approval.risk]}>{t('risk', { risk: approval.risk })}</Pill>
                  {!pending && (
                     <Pill tone={approval.status === 'approved' ? 'complete' : 'danger'}>
                        {outcomeLabel(approvalDecisionKind(approval.kind), approval.status)}
                     </Pill>
                  )}
                  <span className="truncate">
                     {t('row.askedOf', {
                        who: describeRequestedFrom(approval.requestedFrom, members),
                     })}
                  </span>
               </span>
            </span>
         </button>
      </li>
   );
}

function Group({
   title,
   approvals,
   selectedId,
   onSelect,
}: {
   title: string;
   approvals: Approval[];
   selectedId: string;
   onSelect: (id: string) => void;
}) {
   if (approvals.length === 0) return null;
   return (
      <>
         <li className="sticky top-0 z-10 flex items-center gap-1.5 border-b bg-muted/50 px-4 py-1.5 backdrop-blur-sm">
            <span data-heading="label">{title}</span>
            <span className="ml-auto text-muted-foreground">{approvals.length}</span>
         </li>
         {approvals.map((approval) => (
            <ApprovalRow
               key={approval.id}
               approval={approval}
               selected={approval.id === selectedId}
               onSelect={() => onSelect(approval.id)}
            />
         ))}
      </>
   );
}

/**
 * Every decision in the workspace, pending first, with the selected one
 * ready to decide beside the list. "Mine" asks the server which pending
 * approvals this person may resolve — the addressee rule lives there.
 *
 * On a wide screen the first pending approval opens by itself. Below `md`
 * the panes take turns, as Reviews does: the list, then the approval a row
 * was tapped for, full height, with a way back.
 */
export default function Approvals() {
   const t = useTranslations('approvals');
   const approvals = useApprovalsStore((state) => state.approvals);
   const loaded = useApprovalsStore((state) => state.loaded);
   const error = useApprovalsStore((state) => state.error);
   const upsertApproval = useApprovalsStore((state) => state.upsertApproval);
   const workspaceId = useSessionStore((state) => state.workspace?.id);
   const userId = useSessionStore((state) => state.user?.id);
   const status = useSessionStore((state) => state.status);
   const { view, mine, selectedId, select } = useApprovalsFilterStore();
   const [mineIds, setMineIds] = useState<Set<string> | null>(null);

   useEffect(() => {
      if (!mine || !workspaceId || status !== 'ready') {
         setMineIds(null);
         return;
      }
      let cancelled = false;
      void listWorkspaceApprovals(workspaceId, { mine: true })
         .then((found) => {
            if (!cancelled) setMineIds(new Set(found.map((approval) => approval.id)));
         })
         .catch(() => {
            if (!cancelled) setMineIds(new Set());
         });
      return () => {
         cancelled = true;
      };
   }, [mine, workspaceId, status, approvals]);

   // A deep link (from the inbox, a run, a task) may name an approval the
   // list has not loaded — read it on its own rather than show nothing.
   useEffect(() => {
      if (status !== 'ready' || !selectedId) return;
      if (approvals.some((approval) => approval.id === selectedId)) return;
      let cancelled = false;
      void getApproval(selectedId)
         .then((approval) => {
            if (!cancelled) upsertApproval(approval);
         })
         .catch(() => undefined);
      return () => {
         cancelled = true;
      };
   }, [status, selectedId, approvals, upsertApproval]);

   const { pending, resolved } = useMemo(() => {
      const visible = approvals.filter((approval) => {
         if (!mine) return true;
         if (approval.status === 'pending') return mineIds?.has(approval.id) ?? false;
         return approval.resolvedBy === userId;
      });
      return {
         pending: visible.filter((approval) => approval.status === 'pending'),
         resolved: visible.filter((approval) => approval.status !== 'pending'),
      };
   }, [approvals, mine, mineIds, userId]);

   const chosen = approvals.find((approval) => approval.id === selectedId);
   const selected = chosen ?? (view !== 'resolved' ? pending[0] : resolved[0]);
   // A phone shows the detail only for a row that was tapped; the wide
   // layout's automatic first pick would otherwise hide the list.
   const detailOpen = Boolean(selectedId);
   const nothingAtAll = loaded && !error && approvals.length === 0;
   const empty =
      (view === 'pending' && pending.length === 0) ||
      (view === 'resolved' && resolved.length === 0) ||
      (view === 'all' && pending.length === 0 && resolved.length === 0);

   const emptyHeading = nothingAtAll
      ? t('empty.firstUse')
      : view === 'resolved'
        ? t('empty.resolved')
        : t('empty.pending');
   const emptyBody = nothingAtAll
      ? t('empty.intro')
      : mine
        ? t('empty.mine')
        : view === 'resolved'
          ? t('empty.resolvedBody')
          : t('empty.pendingBody');

   return (
      <div className="flex h-full min-h-0 w-full overflow-hidden bg-container">
         <div
            className={cn(
               'flex h-full w-full min-w-0 shrink-0 flex-col md:w-[420px] md:border-r',
               detailOpen && 'hidden md:flex'
            )}
         >
            <div className="min-h-0 flex-1 overflow-y-auto">
               {!loaded && !error ? (
                  <p className="px-4 py-10 text-muted-foreground">{t('loading')}</p>
               ) : error ? (
                  <p className="px-4 py-10 text-status-danger" role="alert">
                     {error}
                  </p>
               ) : empty ? (
                  <EmptyState icon={<EmptyStateMark label={emptyHeading} />}>
                     <EmptyStateTitle variant="plain">{emptyHeading}</EmptyStateTitle>
                     <EmptyStateText>{emptyBody}</EmptyStateText>
                  </EmptyState>
               ) : (
                  <ul>
                     {view !== 'resolved' && (
                        <Group
                           title={t('groups.pending')}
                           approvals={pending}
                           selectedId={selected?.id ?? ''}
                           onSelect={select}
                        />
                     )}
                     {view !== 'pending' && (
                        <Group
                           title={t('groups.resolved')}
                           approvals={resolved}
                           selectedId={selected?.id ?? ''}
                           onSelect={select}
                        />
                     )}
                  </ul>
               )}
            </div>
         </div>
         <div
            className={cn(
               'flex h-full w-full min-w-0 flex-1 flex-col overflow-hidden',
               !detailOpen && 'hidden md:flex'
            )}
         >
            {selected && (
               <div className="flex h-10 shrink-0 items-center gap-2 border-b px-4 md:hidden">
                  <button
                     type="button"
                     onClick={() => select(null)}
                     className="-ml-1 inline-flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                     aria-label={t('backToList')}
                  >
                     <ArrowLeft className="size-4" aria-hidden />
                  </button>
                  <span className="min-w-0 truncate text-muted-foreground">
                     {selected.issue?.identifier ?? describeApprovalKind(selected.kind)}
                  </span>
               </div>
            )}
            <div className="min-h-0 flex-1 overflow-y-auto">
               <div className="mx-auto w-full max-w-3xl px-6 pt-6 sm:px-8">
                  {selected ? (
                     <ApprovalCard key={selected.id} approval={selected} layout="page" />
                  ) : (
                     <p className="pb-6 text-muted-foreground">{t('select')}</p>
                  )}
               </div>
            </div>
         </div>
      </div>
   );
}
