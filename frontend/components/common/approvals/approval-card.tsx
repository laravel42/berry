'use client';

import { AgentMarkdown } from '@/components/common/agent-markdown';
import { BerryMark } from '@/components/brand/berry-mark';
import { Pill } from '@/components/common/plans/plan-sections';
import {
   AlertDialog,
   AlertDialogAction,
   AlertDialogCancel,
   AlertDialogContent,
   AlertDialogDescription,
   AlertDialogFooter,
   AlertDialogHeader,
   AlertDialogTitle,
   AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { Button, buttonVariants } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
   approvalDecisionKind,
   approvalRefusalReason,
   approveApproval,
   describeApprovalExpiry,
   describeApprovalFailure,
   describeApprovalKind,
   describeRequestedFrom,
   isApprovalPending,
   rejectApproval,
   splitEscalationOptions,
   summarizeApprovalTitle,
   approvalHeadline,
   decodeApprovalText,
   splitApprovalSections,
   type Approval,
   type ApprovalDecisionKind,
} from '@/lib/approvals';
import { APPROVAL_STATUS, statusLook } from '@/lib/catalog';
import { WORKSPACE_SLUG } from '@/lib/config';
import { cn } from '@/lib/utils';
import { useApprovalsStore } from '@/store/approvals-store';
import { useGoalsStore } from '@/store/goals-store';
import { useMembersStore } from '@/store/members-store';
import { format, parseISO } from 'date-fns';
import { CircleHelp } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useId, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { toast } from 'sonner';

const RISK_TONE = { low: 'neutral', medium: 'attention', high: 'danger' } as const;

type Decision = 'approve' | 'reject';

function whenText(iso: string | null | undefined): string {
   if (!iso) return '';
   try {
      return format(parseISO(iso), 'd MMM, HH:mm');
   } catch {
      return iso;
   }
}

/** One row of the essentials: a label in the margin, the fact beside it. */
function Fact({ label, children }: { label: string; children: ReactNode }) {
   return (
      <div className="contents">
         <dt className="text-muted-foreground">{label}</dt>
         <dd className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">{children}</dd>
      </div>
   );
}

/**
 * What a decision did, in the words of its kind: an escalation is answered
 * or declined, a task start is started or kept, a proposal accepted or
 * rejected. Expiry reads the same everywhere.
 */
export function useApprovalOutcomeLabel() {
   const t = useTranslations('approvals');
   return (kind: ApprovalDecisionKind, status: Approval['status']): string => {
      if (status === 'pending') return statusLook(APPROVAL_STATUS, status).label;
      if (status === 'expired') return t('outcome.expired');
      if (kind === 'default') return t(`outcome.${status}`);
      return t(`outcome.${kind}.${status}`);
   };
}

/**
 * The choices an escalation offers, as radios. Which one is checked is read
 * from the answer itself, so editing the answer text unchecks the option it
 * no longer matches instead of claiming an option that was not chosen.
 */
function AnswerOptions({
   options,
   value,
   onChange,
   disabled,
   compact,
   invalid,
   firstRef,
}: {
   options: string[];
   value: string;
   onChange: (option: string) => void;
   disabled: boolean;
   compact: boolean;
   invalid: boolean;
   firstRef?: RefObject<HTMLInputElement | null>;
}) {
   const t = useTranslations('approvals.decision.escalation');
   const name = useId();
   return (
      <fieldset
         className="flex min-w-0 flex-col gap-1"
         disabled={disabled}
         aria-invalid={invalid || undefined}
      >
         <legend className="font-medium">{t('answerLabel')}</legend>
         {!compact && <p className="mb-1 text-muted-foreground">{t('answerHint')}</p>}
         {options.map((option, index) => {
            const id = `${name}-${index}`;
            const checked = value === option;
            return (
               <label
                  key={id}
                  htmlFor={id}
                  className={cn(
                     '-mx-2 flex max-w-prose cursor-pointer items-start gap-2.5 rounded-md px-2 py-1.5 transition-colors',
                     'hover:bg-accent/40 has-[:focus-visible]:ring-[3px] has-[:focus-visible]:ring-ring/50 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-50',
                     checked && 'bg-accent/60'
                  )}
               >
                  <input
                     ref={index === 0 ? firstRef : undefined}
                     id={id}
                     type="radio"
                     name={name}
                     value={option}
                     checked={checked}
                     onChange={() => onChange(option)}
                     className="mt-1 size-3.5 shrink-0 cursor-pointer accent-primary outline-none disabled:cursor-not-allowed"
                  />
                  <span className="min-w-0 leading-5">{option}</span>
               </label>
            );
         })}
      </fieldset>
   );
}

interface ApprovalCardProps {
   approval: Approval;
   /** Tighter padding and no note field for the inbox pane. */
   compact?: boolean;
   /**
    * `card` is the bordered box a goal page or the inbox lists; `page` is the
    * Approvals pane's own surface, where the decision bar sticks to the
    * bottom so it stays in reach under a long request.
    */
   layout?: 'card' | 'page';
   className?: string;
}

/**
 * One approval and the decision it asks for. The essentials come first —
 * what is asked, who must decide, how risky, what it is linked to — then the
 * request itself, written by an agent and rendered as the Markdown it is.
 *
 * The instrument follows the kind. An escalation is a question: its options
 * become radios, the chosen one becomes the answer, and the buttons say
 * Answer or Decline. A task start says Start or Keep in backlog; a proposal
 * says Accept or Reject. All of them land on the same approve/reject calls.
 * Who may decide is the server's rule — the addressee, or anyone holding the
 * addressed role or a stronger one — so the buttons stay live until a
 * refusal comes back, and then the card says in words why this person
 * cannot decide it.
 */
export function ApprovalCard({
   approval,
   compact = false,
   layout = 'card',
   className,
}: ApprovalCardProps) {
   const t = useTranslations('approvals');
   const outcomeLabel = useApprovalOutcomeLabel();
   const params = useParams<{ orgId?: string }>();
   const orgId = params?.orgId || WORKSPACE_SLUG;
   const members = useMembersStore((state) => state.members);
   const upsertApproval = useApprovalsStore((state) => state.upsertApproval);
   const goalTitle = useGoalsStore((state) =>
      approval.goalId ? state.goals.find((goal) => goal.id === approval.goalId)?.title : undefined
   );
   const [busy, setBusy] = useState<Decision | null>(null);
   const [refusal, setRefusal] = useState<'not_addressee' | 'admin_required' | null>(null);
   const [failure, setFailure] = useState<{ decision: Decision; reason: string } | null>(null);
   const [note, setNote] = useState('');
   const [reason, setReason] = useState('');
   const [answerMissing, setAnswerMissing] = useState(false);
   const noteRef = useRef<HTMLTextAreaElement>(null);
   const firstOptionRef = useRef<HTMLInputElement>(null);
   const noteId = useId();
   const answerErrorId = useId();
   const helpId = useId();

   const kind = approvalDecisionKind(approval.kind);
   const escalation = kind === 'escalation';
   const pending = isApprovalPending(approval);
   const look = statusLook(APPROVAL_STATUS, approval.status);
   const expiry = describeApprovalExpiry(approval.expiresAt);
   const page = layout === 'page';
   const displayTitle = decodeApprovalText(approval.title);

   const request = useMemo(
      () =>
         escalation
            ? splitEscalationOptions(decodeApprovalText(approval.description ?? ''))
            : { body: decodeApprovalText(approval.description ?? ''), options: [] },
      [escalation, approval.description]
   );
   const sections = useMemo(
      () => (compact && request.body ? splitApprovalSections(request.body) : []),
      [compact, request.body]
   );
   const proposedBy = useMemo(() => {
      for (const section of sections) {
         if (section.body || !section.title) continue;
         const match = section.title.match(/^Proposed by\s+(.+)$/i);
         if (match?.[1]) return match[1].trim();
      }
      return null;
   }, [sections]);
   const contentSections = useMemo(
      () =>
         sections.filter((section) => {
            if (section.body || !section.title) return true;
            return !/^Proposed by\s+/i.test(section.title);
         }),
      [sections]
   );

   // An escalation's decline note is its own: the answer drafted above must
   // not travel into the "why not" of a decline.
   const negativeNote = escalation ? reason : note;

   const decide = async (decision: Decision) => {
      const sent = decision === 'approve' ? note : negativeNote;
      setBusy(decision);
      setFailure(null);
      try {
         const updated =
            decision === 'approve'
               ? await approveApproval(approval.id, sent)
               : await rejectApproval(approval.id, sent);
         upsertApproval(updated);
         toast.success(outcomeLabel(kind, updated.status));
         setNote('');
         setReason('');
      } catch (error) {
         const cause = approvalRefusalReason(error);
         if (cause) setRefusal(cause);
         else setFailure({ decision, reason: describeApprovalFailure(error) });
      } finally {
         setBusy(null);
      }
   };

   const positive = () => {
      if (escalation && note.trim() === '') {
         // An answer with nothing in it would start the agent on silence. The
         // button stays live so a keyboard user finds it; the field says what
         // is missing and takes focus.
         setAnswerMissing(true);
         (noteRef.current ?? firstOptionRef.current)?.focus();
         return;
      }
      setAnswerMissing(false);
      void decide('approve');
   };

   const refusalText =
      refusal === 'admin_required'
         ? t('refusal.adminRequired')
         : refusal === 'not_addressee'
           ? t('refusal.notAddressee')
           : null;

   const links: { href: string; label: string }[] = [];
   if (approval.issue) {
      const issueTitle = decodeApprovalText(approval.issue.title);
      links.push({
         href: `/${orgId}/issue/${approval.issue.identifier}`,
         // Compact inbox already shows the request; the chip is a jump target,
         // so the key alone is enough and a long title cannot blow the row.
         label: compact ? approval.issue.identifier : `${approval.issue.identifier} ${issueTitle}`,
      });
   }
   if (approval.goalId) {
      links.push({
         href: `/${orgId}/goal/${approval.goalId}/overview`,
         label: goalTitle ? decodeApprovalText(goalTitle) : 'goal',
      });
   }
   if (approval.planId) {
      links.push({ href: `/${orgId}/plan/${approval.planId}`, label: 'plan' });
   }

   // An escalation is never folded: the question and its options are the
   // decision. Full cards fold long proposals; the inbox pane shows the
   // whole request so a person can decide without expanding.
   const clamp =
      escalation || compact ? undefined : { lines: 12, moreLabel: t('more'), lessLabel: t('less') };
   const Title = page ? 'h2' : 'h3';
   const confirmTitle =
      kind === 'issueStart'
         ? t('decision.issueStart.confirmTitle', {
              title: approval.issue?.title ?? displayTitle,
           })
         : kind === 'default'
           ? t('decision.default.confirmTitle', { title: displayTitle })
           : t(`decision.${kind}.confirmTitle`);
   const size = compact ? 'xs' : 'sm';
   const locked = busy !== null || refusal !== null;
   const helpText = t(`decision.${kind}.explain`);

   const buttons = (
      <div className="flex flex-wrap items-center gap-2">
         <Button size={size} disabled={locked} onClick={positive}>
            {busy === 'approve'
               ? t(`decision.${kind}.positiveBusy`)
               : t(`decision.${kind}.positive`)}
         </Button>
         <AlertDialog>
            <AlertDialogTrigger asChild>
               <Button size={size} variant="secondary" disabled={locked}>
                  {busy === 'reject'
                     ? t(`decision.${kind}.negativeBusy`)
                     : t(`decision.${kind}.negative`)}
               </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
               <AlertDialogHeader>
                  <AlertDialogTitle>{confirmTitle}</AlertDialogTitle>
                  <AlertDialogDescription>
                     {t(`decision.${kind}.confirmBody`)}
                  </AlertDialogDescription>
               </AlertDialogHeader>
               <Textarea
                  value={negativeNote}
                  onChange={(event) =>
                     escalation ? setReason(event.target.value) : setNote(event.target.value)
                  }
                  placeholder={t('decision.confirmNotePlaceholder')}
                  rows={3}
                  aria-label={t('decision.noteLabel')}
               />
               <AlertDialogFooter>
                  <AlertDialogCancel>{t('decision.cancel')}</AlertDialogCancel>
                  <AlertDialogAction
                     className={buttonVariants({
                        variant: kind === 'issueStart' ? 'default' : 'destructive',
                     })}
                     onClick={() => void decide('reject')}
                  >
                     {t(`decision.${kind}.confirmAction`)}
                  </AlertDialogAction>
               </AlertDialogFooter>
            </AlertDialogContent>
         </AlertDialog>
         <Tooltip>
            <TooltipTrigger asChild>
               <button
                  type="button"
                  className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none"
                  aria-label={t('decision.help')}
                  aria-describedby={helpId}
               >
                  <CircleHelp className="size-4" aria-hidden />
               </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[75ch]">
               {helpText}
            </TooltipContent>
         </Tooltip>
         <p id={helpId} className="sr-only">
            {helpText}
         </p>
         {refusalText && (
            <span role="status" className="text-muted-foreground">
               {refusalText}
            </span>
         )}
      </div>
   );

   const failureLine = failure && (
      <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-status-danger">
         <span>{t('decision.failed', { reason: failure.reason })}</span>
         <Button
            size="xs"
            variant="outline"
            disabled={busy !== null}
            onClick={() => void decide(failure.decision)}
         >
            {t('decision.retry')}
         </Button>
      </div>
   );

   // The answer to an escalation lives with the request, not in the bar: the
   // options are read against the question, and the bar stays one row tall
   // on a phone.
   const answerBlock = pending && escalation && (
      <section className="mt-4 flex flex-col gap-3">
         {request.options.length > 0 && (
            <AnswerOptions
               options={request.options}
               value={note}
               onChange={(option) => {
                  setNote(option);
                  setAnswerMissing(false);
               }}
               disabled={locked}
               compact={compact}
               invalid={answerMissing}
               firstRef={firstOptionRef}
            />
         )}
         {!compact && (
            <>
               <label htmlFor={noteId} className="sr-only">
                  {t('decision.escalation.answerLabel')}
               </label>
               <Textarea
                  id={noteId}
                  ref={noteRef}
                  value={note}
                  onChange={(event) => {
                     setNote(event.target.value);
                     if (answerMissing && event.target.value.trim() !== '') setAnswerMissing(false);
                  }}
                  placeholder={
                     request.options.length > 0
                        ? t('decision.escalation.notePlaceholder')
                        : t('decision.escalation.answerLabel')
                  }
                  rows={3}
                  disabled={locked}
                  aria-invalid={answerMissing || undefined}
                  aria-describedby={answerMissing ? answerErrorId : undefined}
                  className="min-h-0 max-w-prose"
               />
            </>
         )}
      </section>
   );

   const decisionBlock = pending && (
      <div
         className={cn(
            'flex flex-col gap-2',
            page &&
               'sticky bottom-0 -mx-6 mt-2 border-t border-border/60 bg-container px-6 py-3 sm:-mx-8 sm:px-8',
            !page && 'mt-3'
         )}
      >
         {!compact && !escalation && (
            <>
               <label htmlFor={noteId} className="sr-only">
                  {t('decision.noteLabel')}
               </label>
               <Textarea
                  id={noteId}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder={t('decision.notePlaceholder')}
                  rows={2}
                  disabled={locked}
                  className="min-h-0 max-w-prose"
               />
            </>
         )}
         {answerMissing && (
            <p id={answerErrorId} role="alert" className="text-status-danger">
               {t('decision.escalation.noteRequired')}
            </p>
         )}
         {failureLine}
         {buttons}
      </div>
   );

   const essentials = (
      <dl className="grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1.5">
         {proposedBy ? (
            <Fact label={t('proposedBy')}>
               <span className="text-actor-agent">{proposedBy}</span>
            </Fact>
         ) : null}
         <Fact label={t('kind')}>{describeApprovalKind(approval.kind)}</Fact>
         <Fact label={t('riskLabel')}>
            <span
               className={cn(
                  approval.risk === 'high' && 'text-status-danger',
                  approval.risk === 'medium' && 'text-status-warning'
               )}
            >
               {t('risk', { risk: approval.risk })}
            </span>
         </Fact>
         {!pending && <Fact label={t('status')}>{outcomeLabel(kind, approval.status)}</Fact>}
         <Fact label={t('askedOf')}>{describeRequestedFrom(approval.requestedFrom, members)}</Fact>
         <Fact label={t('requestedAt')}>
            <time dateTime={approval.requestedAt}>{whenText(approval.requestedAt)}</time>
         </Fact>
         {pending && expiry && (
            <Fact label={t('expires')}>
               <span
                  className={expiry === 'expired' ? 'text-status-danger' : 'text-status-warning'}
               >
                  {expiry}
               </span>
            </Fact>
         )}
         {links.length > 0 && (
            <Fact label={t('linked')}>
               {links.map((link) => (
                  <Link
                     key={link.href}
                     href={link.href}
                     className="underline-offset-2 hover:underline"
                  >
                     {link.label}
                  </Link>
               ))}
            </Fact>
         )}
      </dl>
   );

   return (
      <article
         className={cn(
            page ? 'flex flex-col' : 'rounded-md border border-border/60 bg-background',
            !page && (compact ? 'w-full min-w-0 p-6' : 'px-4 py-3'),
            className
         )}
      >
         {compact ? (
            <div className="flex w-full min-w-0 flex-col gap-6">
               <p className="flex w-full min-w-0 items-start gap-2">
                  <BerryMark
                     size="sm"
                     tone={look.tone}
                     state={look.state}
                     className="mt-0.5 shrink-0"
                  />
                  <span className="min-w-0 flex-1 break-words">
                     {approvalHeadline(displayTitle)}
                  </span>
               </p>

               {essentials}

               {contentSections.length > 0 ? (
                  contentSections.map((section, index) =>
                     section.body ? (
                        <section
                           key={`${section.title ?? 'lead'}-${index}`}
                           className="flex min-w-0 flex-col gap-2"
                        >
                           {section.title ? <h3>{section.title}</h3> : null}
                           <AgentMarkdown
                              body={section.body}
                              className="w-full max-w-none text-muted-foreground"
                           />
                        </section>
                     ) : section.title ? (
                        <p key={`${section.title}-${index}`} className="text-muted-foreground">
                           {section.title}
                        </p>
                     ) : null
                  )
               ) : request.body ? (
                  <section className="flex min-w-0 flex-col gap-2">
                     <h3>{t('request')}</h3>
                     <AgentMarkdown
                        body={request.body}
                        className="w-full max-w-none text-muted-foreground"
                     />
                  </section>
               ) : null}

               {answerBlock}
               {!pending && (approval.resolvedAt || approval.decisionNote) && (
                  <p className="text-muted-foreground">
                     {outcomeLabel(kind, approval.status)}
                     {approval.resolvedAt && ` · ${whenText(approval.resolvedAt)}`}
                     {approval.decisionNote && ` · “${approval.decisionNote}”`}
                  </p>
               )}
               {decisionBlock}
            </div>
         ) : (
            <>
               <div className="flex items-start gap-3">
                  <BerryMark size="sm" tone={look.tone} state={look.state} className="mt-1" />
                  <div className="min-w-0 flex-1">
                     <Title className="line-clamp-3 text-balance" title={displayTitle}>
                        {summarizeApprovalTitle(displayTitle, 120)}
                     </Title>
                     <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
                        <Pill>{describeApprovalKind(approval.kind)}</Pill>
                        <Pill tone={RISK_TONE[approval.risk]}>
                           {t('risk', { risk: approval.risk })}
                        </Pill>
                        {!pending && (
                           <Pill tone={approval.status === 'approved' ? 'complete' : 'danger'}>
                              {outcomeLabel(kind, approval.status)}
                           </Pill>
                        )}
                     </div>
                     <div className="mt-3">{essentials}</div>
                     {request.body ? (
                        <section className="mt-4 flex flex-col gap-2">
                           <h3>{t('request')}</h3>
                           <AgentMarkdown
                              body={request.body}
                              className="max-w-prose"
                              clamp={clamp}
                           />
                        </section>
                     ) : null}
                     {answerBlock}
                     {!pending && (approval.resolvedAt || approval.decisionNote) && (
                        <p className="mt-3 max-w-prose text-muted-foreground">
                           {outcomeLabel(kind, approval.status)}
                           {approval.resolvedAt && ` · ${whenText(approval.resolvedAt)}`}
                           {approval.decisionNote && ` · “${approval.decisionNote}”`}
                        </p>
                     )}
                     {!page && decisionBlock}
                  </div>
               </div>
               {page && decisionBlock}
               {page && !pending && <div className="pb-6" />}
            </>
         )}
      </article>
   );
}
