'use client';

import { ApprovalCard } from '@/components/common/approvals/approval-card';
import IssueDetails from '@/components/common/issues/details/issue-details';
import { Button } from '@/components/ui/button';
import type { InboxItem } from '@/data/inbox';
import { getApproval, type Approval } from '@/lib/approvals';
import { createIssueRun } from '@/lib/runs';
import { getNotificationIcon } from '@/lib/notification-utils';
import { cn } from '@/lib/utils';
import { useApprovalsStore } from '@/store/approvals-store';
import { Archive, ArchiveRestore, ArrowLeft, ExternalLink, RotateCcw } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { timeAgo } from '@/lib/time-ago';
import { inboxHref, isAgentOutcome } from './inbox-format';
import { InboxPanel } from './inbox-states';

interface InboxDetailProps {
   item: InboxItem | null;
   /** True when the list beside this pane has no rows, so there is nothing to select. */
   listEmpty?: boolean;
   archived: boolean;
   orgId: string;
   onArchive: () => void;
   onUnarchive: () => void;
   /** Compact widths show one pane at a time; this returns to the list. */
   onBack: () => void;
}

/**
 * The right-hand pane.
 *
 * A notification about a task shows the task, because a notification is a
 * pointer and reading it without what it points at is half the story. One
 * about an approval shows the decision card itself — approvals and proposals
 * live here now, not on their own rail pages. Anything else shows what it
 * recorded, and an agent outcome also shows the instructions the agent was
 * given, with the offer to run them again.
 */
export function InboxDetail({
   item,
   listEmpty = false,
   archived,
   orgId,
   onArchive,
   onUnarchive,
   onBack,
}: InboxDetailProps) {
   const t = useTranslations('inbox');
   const [retrying, setRetrying] = useState(false);

   if (!item) {
      return listEmpty ? <div className="h-full" /> : <InboxPanel title={t('list.selectHint')} />;
   }

   if (item.issueDeleted) {
      return (
         <div className="flex h-full min-h-0 flex-col">
            <DetailBar
               item={item}
               archived={archived}
               href={null}
               onArchive={onArchive}
               onUnarchive={onUnarchive}
               onBack={onBack}
            />
            <div className="min-h-0 flex-1">
               <InboxPanel
                  state="crossed"
                  title={t('detail.issueDeleted')}
                  body={t('detail.issueDeletedBody')}
                  action={{ label: t('detail.backToInbox'), onClick: onBack }}
               />
            </div>
         </div>
      );
   }

   const href = inboxHref(item, orgId);
   const showPrompt = isAgentOutcome(item) && Boolean(item.prompt);
   const canRetry = isAgentOutcome(item) && Boolean(item.issueId);
   const approvalId = item.approval?.id;

   const retry = async () => {
      if (!item.issueId) return;
      setRetrying(true);
      try {
         await createIssueRun(item.issueId, {
            ...(item.prompt ? { instructions: item.prompt } : {}),
         });
         toast.success(t('toasts.retryStarted'));
      } catch {
         toast.error(t('toasts.retryFailed'));
      } finally {
         setRetrying(false);
      }
   };

   return (
      <div className="flex h-full min-h-0 flex-col">
         <DetailBar
            item={item}
            archived={archived}
            href={href}
            onArchive={onArchive}
            onUnarchive={onUnarchive}
            onBack={onBack}
         />

         {item.commentBody || item.commentId ? (
            <div className="shrink-0 border-b border-border/60 bg-muted/20 px-5 py-3">
               <p className="text-muted-foreground">{t('detail.comment')}</p>
               {item.commentBody ? (
                  <p className="mt-1 line-clamp-4 leading-relaxed">{item.commentBody}</p>
               ) : null}
            </div>
         ) : null}

         {showPrompt || canRetry ? (
            <div className="shrink-0 border-b border-border/60 px-5 py-3">
               {showPrompt ? (
                  <>
                     <p className="text-muted-foreground">{t('detail.prompt')}</p>
                     <p className="mt-1 whitespace-pre-wrap break-words">{item.prompt}</p>
                  </>
               ) : null}
               {canRetry ? (
                  <Button
                     variant="outline"
                     size="sm"
                     className={cn(showPrompt && 'mt-2.5')}
                     disabled={retrying}
                     onClick={() => void retry()}
                  >
                     <RotateCcw className="size-3.5" />
                     {t('actions.retryRun')}
                  </Button>
               ) : null}
            </div>
         ) : null}

         <div className="min-h-0 flex-1 overflow-hidden">
            {approvalId ? (
               <div className="h-full overflow-y-auto px-4 py-4 sm:px-6">
                  <ApprovalInboxBody approvalId={approvalId} />
               </div>
            ) : item.identifier ? (
               /* F2 owns the task detail. Until its component lands this is
                  the one already in the tree, addressed by task key rather
                  than by route. */
               <IssueDetails issueRef={item.identifier} />
            ) : (
               <div className="h-full overflow-y-auto px-6 py-6 sm:px-8">
                  <h2
                     data-heading="h1"
                     className="text-balance font-display leading-[1.08] tracking-[-0.025em]"
                  >
                     {item.title}
                  </h2>
                  <p className="mt-4 whitespace-pre-wrap break-words leading-relaxed">
                     {item.content && item.content !== item.title
                        ? item.content
                        : t('detail.noBody')}
                  </p>
               </div>
            )}
         </div>
      </div>
   );
}

/** The decision card for an approval inbox row, from the store or a fetch. */
function ApprovalInboxBody({ approvalId }: { approvalId: string }) {
   const t = useTranslations('inbox');
   const fromStore = useApprovalsStore((state) => state.getApprovalById(approvalId));
   const upsertApproval = useApprovalsStore((state) => state.upsertApproval);
   const [loaded, setLoaded] = useState<Approval | null>(null);
   const [failed, setFailed] = useState(false);

   useEffect(() => {
      if (fromStore) {
         setLoaded(null);
         setFailed(false);
         return;
      }
      const controller = new AbortController();
      setFailed(false);
      void getApproval(approvalId, controller.signal)
         .then((approval) => {
            setLoaded(approval);
            upsertApproval(approval);
         })
         .catch(() => {
            if (!controller.signal.aborted) setFailed(true);
         });
      return () => controller.abort();
   }, [approvalId, fromStore, upsertApproval]);

   const approval = fromStore ?? loaded;
   if (failed) {
      return (
         <InboxPanel
            state="crossed"
            title={t('detail.approvalMissing')}
            body={t('detail.approvalMissingBody')}
         />
      );
   }
   if (!approval) {
      return <div className="text-muted-foreground">{t('detail.loadingApproval')}</div>;
   }
   return <ApprovalCard approval={approval} compact />;
}

interface DetailBarProps {
   item: InboxItem;
   archived: boolean;
   href: string | null;
   onArchive: () => void;
   onUnarchive: () => void;
   onBack: () => void;
}

function DetailBar({ item, archived, href, onArchive, onUnarchive, onBack }: DetailBarProps) {
   const t = useTranslations('inbox');
   return (
      <div className="flex shrink-0 items-center gap-2 border-b px-4 py-2">
         <Button
            variant="ghost"
            size="xs"
            className="md:hidden"
            onClick={onBack}
            aria-label={t('actions.back')}
         >
            <ArrowLeft className="size-4" />
         </Button>
         <span className="shrink-0">{getNotificationIcon(item.type, 'size-4')}</span>
         <span className="min-w-0 truncate text-muted-foreground">
            {t(`types.${item.type}`)} · {timeAgo(item.timestamp)}
         </span>
         <div className="ml-auto flex items-center gap-1">
            {href ? (
               <Button variant="ghost" size="xs" asChild>
                  <a href={href} target="_blank" rel="noreferrer">
                     <ExternalLink className="size-3.5" />
                     <span className="sr-only">{t('actions.openInNewTab')}</span>
                  </a>
               </Button>
            ) : null}
            <Button variant="ghost" size="xs" onClick={archived ? onUnarchive : onArchive}>
               {archived ? (
                  <ArchiveRestore className="size-3.5" />
               ) : (
                  <Archive className="size-3.5" />
               )}
               {archived ? t('actions.unarchive') : t('actions.archive')}
            </Button>
         </div>
      </div>
   );
}
