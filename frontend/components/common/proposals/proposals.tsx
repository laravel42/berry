'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';

import {
   EmptyState,
   EmptyStateLoading,
   EmptyStateMark,
   EmptyStateText,
   EmptyStateTitle,
} from '@/components/common/empty-state';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { decideProposal, listProposals, type WorkProposal } from '@/lib/organization';
import { useSessionStore } from '@/store/session-store';

const SEVERITY_VARIANT: Record<
   WorkProposal['severity'],
   'destructive' | 'default' | 'secondary' | 'outline'
> = {
   critical: 'destructive',
   high: 'destructive',
   medium: 'default',
   low: 'secondary',
};

function ProposalCard({
   proposal,
   orgId,
   onDecided,
}: {
   proposal: WorkProposal;
   orgId: string;
   onDecided: () => void;
}) {
   const t = useTranslations('organization.proposals');
   const [deciding, setDeciding] = useState<'approve' | 'reject' | null>(null);
   // A proposal decision is requested from admins, so only they are offered one.
   const workspaceRole = useSessionStore((state) => state.workspace?.role);
   const canDecide = workspaceRole === 'owner' || workspaceRole === 'admin';

   const decide = async (decision: 'approve' | 'reject') => {
      if (!proposal.approvalId || !canDecide) return;
      setDeciding(decision);
      try {
         await decideProposal(proposal.approvalId, decision);
         toast.success(t('decided'));
         onDecided();
      } catch (error) {
         toast.error(error instanceof Error ? error.message : String(error));
      } finally {
         setDeciding(null);
      }
   };

   return (
      <div className="flex flex-col gap-3 rounded-lg border bg-container p-4">
         <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
               <Badge variant={SEVERITY_VARIANT[proposal.severity]}>{proposal.severity}</Badge>
               <Link
                  href={`/${orgId}/issue/${proposal.identifier}`}
                  className="text-muted-foreground underline-offset-2 hover:underline"
               >
                  {proposal.identifier}
               </Link>
            </div>
            <span className="text-muted-foreground">
               {t('effort', { effort: proposal.effort })}
            </span>
         </div>

         <p className="font-medium">{proposal.problem}</p>

         {proposal.evidence.length ? (
            <div>
               <div className="text-muted-foreground">{t('evidence')}</div>
               <ul className="mt-1 list-disc space-y-1 pl-5">
                  {proposal.evidence.map((item, index) => (
                     <li key={`${item.kind}-${item.ref}-${index}`}>
                        {item.kind}: {item.ref}
                        {item.excerpt ? ` — ${item.excerpt}` : ''}
                     </li>
                  ))}
               </ul>
            </div>
         ) : null}

         <div>
            <div className="text-muted-foreground">{t('impact')}</div>
            <p>{proposal.impact}</p>
         </div>

         <div>
            <div className="text-muted-foreground">{t('action')}</div>
            <p>{proposal.proposedAction}</p>
         </div>

         <div className="flex flex-wrap items-center gap-3 text-muted-foreground">
            <span>{t('owner', { role: proposal.responsibleRole })}</span>
            {proposal.requiredReviewers.length ? (
               <span>{t('reviewers', { roles: proposal.requiredReviewers.join(', ') })}</span>
            ) : null}
         </div>

         {proposal.approvalId && !canDecide ? (
            <p className="text-right text-muted-foreground">{t('adminOnly')}</p>
         ) : null}

         {proposal.approvalId && canDecide ? (
            <div className="flex justify-end gap-2">
               <Button
                  size="sm"
                  variant="outline"
                  disabled={deciding !== null}
                  onClick={() => void decide('reject')}
               >
                  {t('reject')}
               </Button>
               <Button
                  size="sm"
                  disabled={deciding !== null}
                  onClick={() => void decide('approve')}
               >
                  {t('accept')}
               </Button>
            </div>
         ) : null}
      </div>
   );
}

function EmptyProposals() {
   const t = useTranslations('organization.proposals.empty');

   return (
      <EmptyState icon={<EmptyStateMark label={t('mark')} />}>
         <EmptyStateTitle>{t('title')}</EmptyStateTitle>
         <EmptyStateText>{t('body')}</EmptyStateText>
      </EmptyState>
   );
}

/**
 * Proposed work, filed by roles as they inspect the workspace on their own.
 *
 * Only `status: 'proposed'` proposals are loaded — decided ones move on and
 * have nothing left to do here.
 */
export default function Proposals() {
   const t = useTranslations('organization.proposals');
   const { orgId } = useParams<{ orgId: string }>();
   const [proposals, setProposals] = useState<WorkProposal[] | null>(null);
   const [error, setError] = useState<string | null>(null);

   const load = useCallback(async () => {
      try {
         const nodes = await listProposals({ status: 'proposed' });
         setProposals(nodes);
         setError(null);
      } catch (cause) {
         setError(cause instanceof Error ? cause.message : 'This could not be loaded.');
      }
   }, []);

   useEffect(() => {
      void load();
   }, [load]);

   if (proposals !== null && proposals.length === 0 && !error) {
      return (
         <div className="flex h-full w-full items-center justify-center overflow-y-auto">
            <EmptyProposals />
         </div>
      );
   }

   return (
      <div className="h-full w-full overflow-y-auto">
         <div className={cn('mx-auto flex w-full max-w-2xl flex-col gap-4 px-6 py-10 pb-20')}>
            <h1 className="font-display tracking-[-0.025em]">{t('title')}</h1>

            {error ? <p className="text-destructive">{error}</p> : null}

            {proposals === null && !error ? <EmptyStateLoading label={t('loading')} /> : null}

            {proposals?.map((proposal) => (
               <ProposalCard
                  key={proposal.id}
                  proposal={proposal}
                  orgId={orgId}
                  onDecided={() => void load()}
               />
            ))}
         </div>
      </div>
   );
}
