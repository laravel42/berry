'use client';

import { useShortcut } from '@/components/layout/shortcut-provider';
import { BerryMark } from '@/components/brand/berry-mark';
import { colorForAgent } from '@/lib/agent-color';
import { AgentMarkdown } from '@/components/common/agent-markdown';
import { ActorAvatar, ActorName } from '@/components/common/issues/actor-avatar';
import { ArtifactViewer } from '@/components/common/issues/details/artifact-viewer';
import { AttachedFileList } from '@/components/common/issues/details/file-list';
import { Button } from '@/components/ui/button';
import {
   Dialog,
   DialogContent,
   DialogFooter,
   DialogHeader,
   DialogTitle,
} from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { ActivityItem } from '@/data/issue-details';
import type { User } from '@/data/users';
import { describeActivity, loadIssueActivity } from '@/lib/activity';
import { BerryApiError } from '@/lib/api';
import {
   assignAttachmentToComment,
   loadIssueArtifacts,
   loadIssueAttachments,
   onIssueAttachment,
   publishCommentFilesRemoved,
   uploadIssueAttachment,
   type ApiAttachment,
   type RunArtifact,
} from '@/lib/attachments';
import { toUiUser } from '@/lib/catalog';
import {
   createIssueComment,
   loadIssueComments,
   mentionToken,
   previewCommentTriggers,
   setCommentResolved,
   splitMentions,
   type ApiComment,
   type TriggerPlan,
} from '@/lib/comments';
import { WORKSPACE_SLUG } from '@/lib/config';
import { type AutoReview, type RunRecord } from '@/lib/runs';
import { subscribeShellEvent } from '@/lib/shell-events';
import { cn } from '@/lib/utils';
import { useComposerPalette } from '@/components/common/composer-palette';
import { useAgentsStore } from '@/store/agents-store';
import { useSessionStore } from '@/store/session-store';
import { useCommentDraftStore } from '@/store/comment-draft-store';
import { useIssueRuns, useIssueRunsStore } from '@/store/issue-runs-store';
import { timeAgo } from '@/lib/time-ago';
import {
   Ban,
   Bot,
   ChevronDown,
   ChevronRight,
   CircleDot,
   GitPullRequestArrow,
   Link2,
   Loader2,
   Paperclip,
   PenLine,
   RefreshCcw,
   SendHorizonal,
   Tag,
   Unlock,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useParams } from 'next/navigation';
import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { CommentActions } from './comment-actions';
import { ReactionBar } from './issue-reactions';
import { IssueReviewCard, reviewTimestamp, useSettledAutoReviews } from './issue-reviews';

/**
 * What has happened to this task, and the place to add to it.
 *
 * The feed mixes two kinds of thing that deserve very different weight:
 * comments, which are people talking, and activity, which is bookkeeping. So
 * activity is coalesced — six status changes in a row become one line saying
 * so — and comments keep their full shape, including their replies and the
 * agent runs they set off.
 */

const EVENT_ICONS: Record<string, ReactNode> = {
   created: <PenLine className="size-3.5" />,
   status: <CircleDot className="size-3.5" />,
   label: <Tag className="size-3.5" />,
   priority: <CircleDot className="size-3.5" />,
   cycle: <RefreshCcw className="size-3.5" />,
   blocked: <Ban className="size-3.5" />,
   unblocked: <Unlock className="size-3.5" />,
   related: <Link2 className="size-3.5" />,
   pr: <GitPullRequestArrow className="size-3.5" />,
   run: <Bot className="size-3.5" />,
};

type EventItem = Extract<ActivityItem, { kind: 'event' }>;

/** A task key as typed: `BER-12`. Rendered as a link wherever it appears. */
const ISSUE_KEY = /\b([A-Z][A-Z0-9]{1,5}-\d+)\b/g;

/**
 * Tokens the decorator must leave alone: fenced and inline code, links the
 * writer already made, and bare URLs. A task key inside a URL is part of the
 * URL, and a mention inside a code span is an example, not a mention.
 */
const PROTECTED = /(```[\s\S]*?```|`[^`\n]+`|\[[^\]\n]+\]\([^)\n]+\)|https?:\/\/[^\s<)]+)/g;

/**
 * The body with its mentions and task keys turned into Markdown links, so the
 * Markdown renderer draws them as links. Absolute, because the renderer only
 * links `http(s)://`; until the origin is known (first paint) they are plain
 * names, which is still readable — never the raw `@[name](agent:id)` token.
 */
function decorateBody(body: string, origin: string, org: string): string {
   const linkTo = (label: string, path: string) =>
      origin ? `[${label}](${origin}/${org}${path})` : label;
   const transform = (text: string) =>
      splitMentions(text)
         .map((part) =>
            'text' in part
               ? part.text.replace(ISSUE_KEY, (key) => linkTo(key, `/issue/${key}`))
               : linkTo(`@${part.mention.name}`, `/agents/${part.mention.id}`)
         )
         .join('');
   return body
      .split(PROTECTED)
      .map((segment, index) => (index % 2 === 1 ? segment : transform(segment)))
      .join('');
}

/**
 * A comment as written, rendered.
 *
 * Agents write Markdown — a heading, a list of what they found, a fenced
 * diff — and people increasingly do too. Printing "## Summary" literally made
 * every agent reply look like a dump. A short report stays open. A long one
 * folds, and "Read the rest" opens the full transcript.
 */
function CommentBody({
   body,
   clamp,
   thin,
   className,
}: {
   body: string;
   clamp?: { lines: number; moreLabel: string; lessLabel: string };
   /** Agent replies are set at weight 100, lighter than the rest of the page. */
   thin?: boolean;
   className?: string;
}) {
   const { orgId } = useParams<{ orgId: string }>();
   const org = orgId ?? WORKSPACE_SLUG;
   const [origin, setOrigin] = useState('');
   useEffect(() => setOrigin(window.location.origin), []);
   const decorated = useMemo(() => decorateBody(body, origin, org), [body, origin, org]);
   return (
      <AgentMarkdown
         body={decorated}
         compact
         clamp={clamp}
         className={thin ? 'font-thin [&_*]:font-thin' : undefined}
      />
   );
}

function EventRow({ item }: { item: EventItem }) {
   return (
      <div className="flex items-center gap-2.5 py-1.5 text-muted-foreground">
         <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-accent p-0.5">
            {item.actor.role === 'Application' ? (
               <BerryMark
                  size="sm"
                  tone="working"
                  dotColor={colorForAgent(item.actor.id)}
                  label={`${item.actor.name}, agent`}
               />
            ) : (
               (EVENT_ICONS[item.event] ?? <CircleDot className="size-3.5" />)
            )}
         </span>
         <span className="min-w-0 truncate">
            <ActorName user={item.actor} /> {item.text}
         </span>
         <span className="shrink-0">· {item.timeAgo}</span>
      </div>
   );
}

/** A run of bookkeeping, folded into one line until someone asks for it. */
function EventGroup({ items }: { items: EventItem[] }) {
   const t = useTranslations('issueDetail.activity');
   const [expanded, setExpanded] = useState(false);
   const first = items[0];
   if (!first) return null;
   if (items.length === 1 || expanded) {
      return (
         <div className="flex flex-col">
            {items.map((item) => (
               <EventRow key={item.id} item={item} />
            ))}
            {items.length > 1 ? (
               <Button
                  variant="ghost"
                  size="xs"
                  className="-ml-2 self-start text-muted-foreground"
                  onClick={() => setExpanded(false)}
               >
                  {t('showLess')}
               </Button>
            ) : null}
         </div>
      );
   }
   return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
         <EventRow item={first} />
         <span className="shrink-0 rounded bg-accent px-1.5 text-muted-foreground">
            {t('repeated', { count: items.length })}
         </span>
         <Button
            variant="ghost"
            size="xs"
            className="shrink-0 text-muted-foreground"
            onClick={() => setExpanded(true)}
         >
            {t('showMore', { count: items.length - 1 })}
         </Button>
      </div>
   );
}

function CommentFiles({ files }: { files: ApiAttachment[] }) {
   const { orgId } = useParams<{ orgId: string }>();
   const org = orgId ?? WORKSPACE_SLUG;
   if (files.length === 0) return null;
   return (
      <AttachedFileList
         entries={files.map((file) => ({
            id: file.id,
            name: file.fileName,
            path: file.fileName,
            sizeBytes: file.sizeBytes,
            href: `/${org}/attachments/${file.id}/preview`,
         }))}
      />
   );
}

/** A handoff note Berry used to post beside the run's report. */
function handoffNote(body: string): boolean {
   const first = body.trimStart();
   return first.startsWith('.handoffs/') || first.startsWith('HANDOFF.md');
}

/** The run's handoff. It stays on the task and is not a file the comment lists. */
function handoffFile(file: RunArtifact): boolean {
   return (
      file.path === 'HANDOFF.md' ||
      file.path.startsWith('.handoffs/') ||
      file.directory === '.handoffs' ||
      file.directory.startsWith('.handoffs/')
   );
}

/** Files this comment's run saved, plus any the comment names by path. */
function artifactsOnComment(comment: ApiComment, artifacts: RunArtifact[]): RunArtifact[] {
   const seen = new Set<string>();
   const matched: RunArtifact[] = [];
   const add = (file: RunArtifact) => {
      if (seen.has(file.id) || handoffFile(file)) return;
      seen.add(file.id);
      matched.push(file);
   };
   if (comment.runId) {
      for (const file of artifacts) {
         if (file.runId === comment.runId) add(file);
      }
   }
   for (const file of artifacts) {
      if (comment.body.includes(file.path)) add(file);
   }
   return matched.sort((left, right) => {
      const tucked = (path: string) => (path.startsWith('.') ? 1 : 0);
      return tucked(left.path) - tucked(right.path) || left.path.localeCompare(right.path);
   });
}

function CommentArtifacts({
   files,
   onOpen,
}: {
   files: RunArtifact[];
   onOpen: (index: number) => void;
}) {
   if (files.length === 0) return null;
   return (
      <AttachedFileList
         entries={files.map((file) => ({
            id: file.id,
            name: file.name,
            path: file.path,
            directory: file.directory,
            sizeBytes: file.sizeBytes,
         }))}
         onOpen={onOpen}
      />
   );
}

function CommentCard({
   comment,
   issueRef,
   replies,
   attachments,
   artifacts,
   highlighted,
   onChanged,
   onDeleted,
   onRunChanged,
   onPosted,
   onOpenArtifact,
}: {
   comment: ApiComment;
   issueRef: string;
   replies: ApiComment[];
   attachments: ApiAttachment[];
   artifacts: RunArtifact[];
   highlighted: boolean;
   onChanged: (comment: ApiComment) => void;
   onDeleted: (commentId: string) => void;
   onRunChanged: (run: RunRecord) => void;
   onPosted: (comment: ApiComment) => void;
   onOpenArtifact: (files: RunArtifact[], index: number) => void;
}) {
   const t = useTranslations('issueDetail.activity');
   const [collapsed, setCollapsed] = useState(false);
   // The palette can fold or unfold every thread at once. It says what it did
   // rather than reaching in here, so each card decides for itself — which is
   // also what makes a thread opened afterwards stay opened.
   useEffect(
      () => subscribeShellEvent('berry:comments-fold', ({ folded }) => setCollapsed(folded)),
      []
   );
   const [replying, setReplying] = useState(false);
   const [resolving, setResolving] = useState(false);
   const [closingNote, setClosingNote] = useState('');
   const files = attachments.filter((file) => file.commentId === comment.id);
   const produced = artifactsOnComment(comment, artifacts);
   const actor: User = toUiUser(comment.author);
   const isAgent = comment.author.type === 'agent';

   const resolve = (resolved: boolean, note: string) => {
      const post = note.trim()
         ? createIssueComment(issueRef, note.trim(), comment.id).then(onPosted)
         : Promise.resolve();
      void post
         .then(() => setCommentResolved(comment.id, resolved))
         .then(onChanged)
         .then(() => {
            setResolving(false);
            setClosingNote('');
         })
         .catch(() => toast.error(t('resolveFailed')));
   };

   return (
      <div
         data-comment-id={comment.id}
         className={cn(
            'rounded-sm border border-border/60 bg-container px-2 py-1 transition-colors',
            isAgent && 'border-actor-agent/40',
            highlighted && 'border-status-warning bg-status-warning/5'
         )}
      >
         <div className="mb-0.5 flex items-center gap-1.5">
            <ActorAvatar user={actor} size="sm" />
            <ActorName user={actor} />
            <span className="text-muted-foreground">{timeAgo(comment.createdAt, 'recently')}</span>
            {comment.resolvedAt ? (
               <span className="rounded bg-accent px-1.5 text-muted-foreground">
                  {t('resolved')}
               </span>
            ) : null}
            <CommentActions
               comment={comment}
               issueRef={issueRef}
               replyCount={replies.length}
               onDeleted={onDeleted}
               onReply={() => setReplying(true)}
            />
         </div>

         <div className="flex flex-col gap-1">
            <div className="flex flex-col gap-1 px-1 mt-2">
               <CommentBody
                  body={comment.body}
                  thin={isAgent}
                  className="px-2"
                  clamp={{ lines: 16, moreLabel: t('readRest'), lessLabel: t('showLess') }}
               />
               <CommentFiles files={files} />
               <CommentArtifacts
                  files={produced}
                  onOpen={(index) => onOpenArtifact(produced, index)}
               />
            </div>

            <div className="mt-1 flex flex-wrap items-center gap-1">
               <ReactionBar target="comment" id={comment.id} />
               <Button
                  variant="ghost"
                  size="xxs"
                  className="text-muted-foreground"
                  onClick={() => setReplying((value) => !value)}
               >
                  {t('reply')}
               </Button>
               {!comment.parentId ? (
                  <Button
                     variant="ghost"
                     size="xxs"
                     className="text-muted-foreground"
                     onClick={() => (comment.resolvedAt ? resolve(false, '') : setResolving(true))}
                  >
                     {comment.resolvedAt ? t('unresolve') : t('resolve')}
                  </Button>
               ) : null}
               {replies.length > 0 ? (
                  <Button
                     variant="ghost"
                     size="xxs"
                     className="text-muted-foreground"
                     aria-expanded={!collapsed}
                     onClick={() => setCollapsed((value) => !value)}
                  >
                     {collapsed ? (
                        <ChevronRight className="mr-1 size-3" />
                     ) : (
                        <ChevronDown className="mr-1 size-3" />
                     )}
                     {t('replies', { count: replies.length })}
                  </Button>
               ) : null}
            </div>
         </div>

         {replies.length > 0 && !collapsed ? (
            <div className="mt-2 flex flex-col gap-2 border-l border-border/60 pl-3">
               {replies.map((reply) => (
                  <CommentCard
                     key={reply.id}
                     comment={reply}
                     issueRef={issueRef}
                     replies={[]}
                     attachments={attachments}
                     artifacts={artifacts}
                     highlighted={false}
                     onChanged={onChanged}
                     onDeleted={onDeleted}
                     onRunChanged={onRunChanged}
                     onPosted={onPosted}
                     onOpenArtifact={onOpenArtifact}
                  />
               ))}
            </div>
         ) : null}

         {replying ? (
            <div className="mt-2">
               <ActivityCommentComposer
                  issueRef={issueRef}
                  parentId={comment.parentId ?? comment.id}
                  onPosted={(posted) => {
                     onPosted(posted);
                     setReplying(false);
                  }}
               />
            </div>
         ) : null}

         <Dialog open={resolving} onOpenChange={setResolving}>
            <DialogContent>
               <DialogHeader>
                  <DialogTitle>{t('resolveTitle')}</DialogTitle>
               </DialogHeader>
               <Textarea
                  rows={3}
                  placeholder={t('resolveComment')}
                  value={closingNote}
                  onChange={(event) => setClosingNote(event.target.value)}
               />
               <DialogFooter>
                  <Button variant="ghost" onClick={() => setResolving(false)}>
                     {t('cancel')}
                  </Button>
                  <Button onClick={() => resolve(true, closingNote)}>{t('resolveConfirm')}</Button>
               </DialogFooter>
            </DialogContent>
         </Dialog>
      </div>
   );
}

// --------------------------------------------------------------------- data

export function useIssueActivity(issueRef: string, issueId?: string) {
   const [comments, setComments] = useState<ApiComment[]>([]);
   const [events, setEvents] = useState<EventItem[]>([]);
   const [error, setError] = useState<string | null>(null);
   // False while a task's comments are still being read, so the page does not
   // treat "not loaded" as "nobody has commented".
   const [commentsReady, setCommentsReady] = useState(false);
   const agents = useAgentsStore((state) => state.agents);
   const hydrateAgents = useAgentsStore((state) => state.hydrateAgents);
   const { runs, upsert } = useIssueRuns(issueId);

   // The feed names agents, and a reader arriving from an inbox link has never
   // opened the agents page, so the store would be empty and every agent would
   // be called "Agent".
   useEffect(() => {
      if (agents.length > 0) return;
      let cancelled = false;
      void import('@/lib/agents')
         .then(({ loadWorkspaceAgents }) => loadWorkspaceAgents())
         .then((loaded) => {
            if (!cancelled) hydrateAgents(loaded, null);
         })
         .catch(() => undefined);
      return () => {
         cancelled = true;
      };
   }, [agents.length, hydrateAgents]);

   useEffect(() => {
      if (!issueRef) {
         setComments([]);
         setEvents([]);
         setError(null);
         setCommentsReady(true);
         return;
      }
      let cancelled = false;
      setCommentsReady(false);
      void Promise.all([
         loadIssueComments(issueRef).catch((cause: unknown) => {
            if (cancelled) return [];
            // A deleted task has no activity, which is a fact rather than a
            // failure; anything else is worth saying out loud.
            const gone = cause instanceof BerryApiError && cause.status === 404;
            setError(gone ? null : 'Activity could not be loaded.');
            return [];
         }),
         loadIssueActivity(issueRef).catch(() => []),
      ]).then(([loadedComments, activity]) => {
         if (cancelled) return;
         setComments(loadedComments);
         setCommentsReady(true);
         setEvents(
            activity.flatMap((entry) => {
               const described = describeActivity(entry);
               if (!described || !entry.actor) return [];
               return [
                  {
                     kind: 'event' as const,
                     id: entry.id,
                     actor: toUiUser({
                        id: entry.actor.id,
                        name: entry.actor.name ?? 'Someone',
                        avatarUrl: entry.actor.avatarUrl ?? '',
                        type: entry.actor.type === 'agent' ? 'agent' : 'user',
                     }),
                     event: described.event,
                     text: described.text,
                     timeAgo: timeAgo(entry.occurredAt, 'recently'),
                     at: entry.occurredAt,
                  } as EventItem & { at: string },
               ];
            })
         );
      });
      setError(null);
      return () => {
         cancelled = true;
      };
   }, [issueRef, issueId]);

   const addComment = useCallback((comment: ApiComment) => {
      setComments((current) => [...current.filter((entry) => entry.id !== comment.id), comment]);
   }, []);
   const replaceComment = useCallback((comment: ApiComment) => {
      setComments((current) => current.map((entry) => (entry.id === comment.id ? comment : entry)));
   }, []);
   const removeComment = useCallback((commentId: string) => {
      setComments((current) =>
         current.filter((entry) => entry.id !== commentId && entry.parentId !== commentId)
      );
   }, []);

   return {
      comments,
      commentsReady,
      events,
      runs,
      error,
      addComment,
      replaceComment,
      removeComment,
      upsertRun: upsert,
   };
}

// ------------------------------------------------------------------ listing

export function ActivityFeedList({
   comments,
   events,
   error,
   issueRef,
   highlightedCommentId,
   onCommentChanged,
   onCommentDeleted,
   onCommentPosted,
   onRunChanged,
   inReview = false,
   autoGate = false,
}: {
   comments: ApiComment[];
   events: Array<EventItem & { at?: string }>;
   error?: string | null;
   issueRef: string;
   highlightedCommentId?: string | null;
   onCommentChanged: (comment: ApiComment) => void;
   onCommentDeleted: (commentId: string) => void;
   onCommentPosted: (comment: ApiComment) => void;
   onRunChanged: (run: RunRecord) => void;
   inReview?: boolean;
   autoGate?: boolean;
}) {
   const t = useTranslations('issueDetail.activity');
   const [showResolved, setShowResolved] = useState(false);
   const [attachments, setAttachments] = useState<ApiAttachment[]>([]);
   const [artifacts, setArtifacts] = useState<RunArtifact[]>([]);
   const [openArtifact, setOpenArtifact] = useState<{ files: RunArtifact[]; index: number } | null>(
      null
   );
   const reviews = useSettledAutoReviews(issueRef);

   useEffect(() => {
      if (!issueRef) {
         setAttachments([]);
         setArtifacts([]);
         return;
      }
      let cancelled = false;
      void loadIssueAttachments(issueRef)
         .then((loaded) => {
            if (!cancelled) setAttachments(loaded);
         })
         .catch(() => undefined);
      void loadIssueArtifacts(issueRef)
         .then((loaded) => {
            if (!cancelled) setArtifacts(loaded);
         })
         .catch(() => undefined);
      return () => {
         cancelled = true;
      };
   }, [issueRef]);

   useEffect(() => {
      return onIssueAttachment((ref, attachment) => {
         if (ref !== issueRef) return;
         setAttachments((current) => [
            attachment,
            ...current.filter((entry) => entry.id !== attachment.id),
         ]);
      });
   }, [issueRef]);

   const repliesByParent = useMemo(() => {
      const map = new Map<string, ApiComment[]>();
      for (const comment of comments) {
         if (!comment.parentId) continue;
         map.set(comment.parentId, [...(map.get(comment.parentId) ?? []), comment]);
      }
      for (const list of map.values()) list.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      return map;
   }, [comments]);

   const roots = useMemo(() => {
      const top = comments
         .filter((comment) => !comment.parentId)
         .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
      // A finished run used to post its report and then the same text again as
      // a handoff note. The report is the comment; the note stays on the task
      // as a file.
      const hasReport = top.some((comment) => comment.runId && !handoffNote(comment.body));
      return hasReport ? top.filter((comment) => !handoffNote(comment.body)) : top;
   }, [comments]);

   const timeline = useMemo(() => {
      type Row =
         | { kind: 'comment'; at: string; comment: ApiComment }
         | { kind: 'events'; at: string; items: EventItem[] }
         | { kind: 'review'; at: string; review: AutoReview };
      const rows: Row[] = [
         // Agent runs are not listed here: the task's console shows them, and
         // each run's result comment reads as the comment it is. AutoGate
         // reviews sit on this feed as the verdict and reason.
         ...roots.map((comment) => ({ kind: 'comment' as const, at: comment.createdAt, comment })),
         ...events.map((event) => ({
            kind: 'events' as const,
            at: event.at ?? '',
            items: [event],
         })),
         ...reviews.map((review) => ({
            kind: 'review' as const,
            at: reviewTimestamp(review),
            review,
         })),
      ].sort((left, right) => left.at.localeCompare(right.at));

      // Consecutive bookkeeping folds together; a comment between two runs of
      // it keeps them apart, which is what makes the fold readable.
      const folded: Row[] = [];
      for (const row of rows) {
         const last = folded[folded.length - 1];
         if (row.kind === 'events' && last && last.kind === 'events') {
            last.items = [...last.items, ...row.items];
            continue;
         }
         folded.push(row.kind === 'events' ? { ...row, items: [...row.items] } : row);
      }
      return folded;
   }, [roots, events, reviews]);

   const resolvedRoots = roots.filter((comment) => comment.resolvedAt);

   return (
      <div>
         <h2 data-heading="label" className="mb-2 pb-[7px] text-muted-foreground">
            {t('title')}
         </h2>

         {error && (
            <p className="mb-2 text-muted-foreground" role="alert">
               {error}
            </p>
         )}

         {resolvedRoots.length > 0 ? (
            <div className="mb-2 flex items-center gap-2 rounded-sm bg-muted/30 px-2 py-1">
               <span className="text-muted-foreground">
                  {t('resolvedSummary', { count: resolvedRoots.length })}
               </span>
               <Button
                  variant="ghost"
                  size="xs"
                  className="ml-auto"
                  onClick={() => setShowResolved((value) => !value)}
               >
                  {showResolved ? t('hideResolved') : t('showResolved')}
               </Button>
            </div>
         ) : null}

         <div className="flex flex-col gap-1">
            {timeline.map((row, index) =>
               row.kind === 'events' ? (
                  <EventGroup key={`events-${row.items[0]?.id ?? index}`} items={row.items} />
               ) : row.kind === 'review' ? (
                  <IssueReviewCard
                     key={row.review.id}
                     review={row.review}
                     inReview={inReview}
                     autoGate={autoGate}
                  />
               ) : row.comment.resolvedAt && !showResolved ? null : (
                  <CommentCard
                     key={row.comment.id}
                     comment={row.comment}
                     issueRef={issueRef}
                     replies={repliesByParent.get(row.comment.id) ?? []}
                     attachments={attachments}
                     artifacts={artifacts}
                     highlighted={highlightedCommentId === row.comment.id}
                     onChanged={onCommentChanged}
                     onDeleted={(commentId) => {
                        const gone = [
                           commentId,
                           ...comments
                              .filter((entry) => entry.parentId === commentId)
                              .map((entry) => entry.id),
                        ];
                        const removed = new Set(gone);
                        const fileIds = attachments
                           .filter((file) => file.commentId && removed.has(file.commentId))
                           .map((file) => file.id);
                        setAttachments((current) =>
                           current.filter((file) => !file.commentId || !removed.has(file.commentId))
                        );
                        publishCommentFilesRemoved(gone, fileIds);
                        onCommentDeleted(commentId);
                     }}
                     onRunChanged={onRunChanged}
                     onPosted={onCommentPosted}
                     onOpenArtifact={(files, index) => setOpenArtifact({ files, index })}
                  />
               )
            )}
         </div>
         <ArtifactViewer
            issueRef={issueRef}
            artifacts={openArtifact?.files ?? []}
            index={openArtifact?.index ?? null}
            onIndexChange={(index) =>
               setOpenArtifact((current) =>
                  current && index !== null ? { ...current, index } : null
               )
            }
         />
      </div>
   );
}

// ----------------------------------------------------------------- composer

/** The body as it will be sent, with the named agents demoted to plain text. */
function withoutMentions(body: string, agentIds: Set<string>): string {
   return splitMentions(body)
      .map((part) =>
         'text' in part
            ? part.text
            : agentIds.has(part.mention.id)
              ? `@${part.mention.name}`
              : `@[${part.mention.name}](${part.mention.kind}:${part.mention.id})`
      )
      .join('');
}

export function ActivityCommentComposer({
   issueRef,
   parentId,
   onPosted,
   className,
}: {
   issueRef: string;
   /** Set on a reply; the root composer leaves it undefined. */
   parentId?: string;
   onPosted: (comment: ApiComment) => void;
   className?: string;
}) {
   const t = useTranslations('issueDetail.composer');
   const drafts = useCommentDraftStore((state) => state.drafts);
   const setStoredDraft = useCommentDraftStore((state) => state.setDraft);
   const clearStoredDraft = useCommentDraftStore((state) => state.clearDraft);

   const isReply = parentId !== undefined;
   const [replyDraft, setReplyDraft] = useState('');
   const draft = isReply ? replyDraft : (drafts[issueRef] ?? '');
   const setDraft = useCallback(
      (value: string) => {
         if (isReply) setReplyDraft(value);
         else setStoredDraft(issueRef, value);
      },
      [isReply, issueRef, setStoredDraft]
   );

   const textareaRef = useRef<HTMLTextAreaElement>(null);
   const workspaceId = useSessionStore((state) => state.workspace?.id);
   const [plan, setPlan] = useState<TriggerPlan | null>(null);
   const [skipped, setSkipped] = useState<string[]>([]);
   const [note, setNote] = useState(false);
   const [sending, setSending] = useState(false);
   const [uploading, setUploading] = useState(0);
   const [attached, setAttached] = useState<ApiAttachment[]>([]);
   const [focused, setFocused] = useState(false);
   const filePicker = useRef<HTMLInputElement>(null);
   const slashExtras = useMemo(
      () => [
         {
            key: 'note',
            name: t('note'),
            detail: t('noteHint'),
            onChoose: () => setNote(true),
         },
      ],
      [t]
   );
   const palette = useComposerPalette({
      textareaRef,
      value: draft,
      onChange: setDraft,
      workspaceId,
      agentMention: (agent) => mentionToken('agent', agent.id, agent.name),
      slashExtras,
   });

   // Debounced: the preview is advice, and a request per keystroke is not.
   useEffect(() => {
      if (note || !issueRef || !draft.trim()) {
         setPlan(null);
         return;
      }
      let cancelled = false;
      const timer = setTimeout(() => {
         previewCommentTriggers(issueRef, draft).then(
            (next) => {
               if (!cancelled) setPlan(next);
            },
            () => {
               if (!cancelled) setPlan(null);
            }
         );
      }, 400);
      return () => {
         cancelled = true;
         clearTimeout(timer);
      };
   }, [issueRef, draft, note]);

   // Grow with the message, up to the same max the className allows.
   useEffect(() => {
      const element = textareaRef.current;
      if (!element) return;
      element.style.height = '0px';
      element.style.height = `${Math.min(element.scrollHeight, 160)}px`;
   }, [draft]);

   const upload = async (files: FileList | null) => {
      const list = files ? Array.from(files) : [];
      if (list.length === 0) return;
      setUploading((count) => count + list.length);
      for (const file of list) {
         try {
            const saved = await uploadIssueAttachment(issueRef, file);
            setAttached((current) => [saved, ...current.filter((entry) => entry.id !== saved.id)]);
         } catch (cause) {
            toast.error(cause instanceof BerryApiError ? cause.message : t('uploadFailed'));
         }
         setUploading((count) => Math.max(0, count - 1));
      }
      if (filePicker.current) filePicker.current.value = '';
   };

   const send = () => {
      const text = draft.trim();
      if (!text || sending) return;
      if (uploading > 0) {
         toast.error(t('uploadsPending'));
         return;
      }
      // A note starts nothing, so every mention in it is demoted; otherwise
      // only the agents the writer clicked off are.
      const removed = note
         ? new Set((plan?.targets ?? []).map((target) => target.agentId))
         : new Set(skipped);
      const body = note
         ? withoutMentions(text, new Set(collectMentionIds(text)))
         : withoutMentions(text, removed);

      setSending(true);
      const pending = attached;
      void createIssueComment(issueRef, body, parentId)
         .then(async (comment) => {
            const linked = await Promise.all(
               pending.map((file) =>
                  assignAttachmentToComment(issueRef, file.id, comment.id).then(
                     () => true,
                     () => false
                  )
               )
            );
            setAttached(pending.filter((_, index) => !linked[index]));
            onPosted(comment);
            if (isReply) setReplyDraft('');
            else clearStoredDraft(issueRef);
            setSkipped([]);
            setNote(false);
            const planned = plan?.targets.length ?? 0;
            const started = note ? 0 : planned - skipped.length;
            if (planned > 0 && started < planned) {
               toast.message(t('partial', { started, total: planned }));
            }
            // The mention started runs the execution log is already showing
            // the absence of. Nothing else tells it, so it would keep saying
            // "no runs yet" until the page was reloaded.
            if (started > 0) useIssueRunsStore.getState().load(comment.issueId);
            setPlan(null);
         })
         .catch(() => toast.error(t('sendFailed')))
         .finally(() => setSending(false));
   };

   // mod+Enter, through the shell's registry rather than a key handler on the
   // textarea, so one rebindable row in settings covers every composer. Only
   // while this box has focus: the action belongs to whichever composer the
   // writer is actually typing in, and the last claim wins.
   useShortcut('composer.send', send, { enabled: focused });

   const canSend = Boolean(draft.trim()) && !sending && uploading === 0;
   const sendLabel = sending ? t('sending') : t('send');

   return (
      <div className={cn('flex flex-col', className)}>
         <div className="flex flex-col gap-1.5 rounded-lg border border-border bg-muted/15 px-2.5 py-1.5">
            <div className="flex items-end gap-2">
               <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="mb-0.5 size-8 flex-none"
                  aria-label={t('attach')}
                  onClick={() => filePicker.current?.click()}
               >
                  {uploading > 0 ? (
                     <Loader2 className="size-4 animate-spin" />
                  ) : (
                     <Paperclip className="size-4" />
                  )}
               </Button>
               <input
                  ref={filePicker}
                  type="file"
                  multiple
                  tabIndex={-1}
                  className="sr-only"
                  onChange={(event) => void upload(event.target.files)}
               />
               <div className="relative min-w-0 flex-1">
                  {palette.list}
                  <textarea
                     ref={textareaRef}
                     value={draft}
                     rows={1}
                     aria-label={t('placeholder')}
                     aria-autocomplete="list"
                     onChange={(event) => {
                        setDraft(event.target.value);
                        palette.sync(event.target.value, event.target.selectionStart ?? 0);
                     }}
                     onKeyUp={(event) => {
                        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                           palette.sync(
                              event.currentTarget.value,
                              event.currentTarget.selectionStart ?? 0
                           );
                        }
                     }}
                     onClick={(event) =>
                        palette.sync(
                           event.currentTarget.value,
                           event.currentTarget.selectionStart ?? 0
                        )
                     }
                     onKeyDown={(event) => {
                        palette.onKeyDown(event);
                     }}
                     onFocus={() => setFocused(true)}
                     onBlur={() => setFocused(false)}
                     onPointerDown={(event) => event.stopPropagation()}
                     placeholder={t('placeholder')}
                     className="max-h-40 min-h-8 w-full resize-none overflow-y-auto bg-transparent py-1.5 leading-5 text-foreground outline-none placeholder:text-muted-foreground"
                  />
               </div>
               <Button
                  size="icon"
                  // Secondary: on a task in review the decision bar holds the
                  // page's one primary action, and a comment is not it.
                  className="mb-0.5 size-8 flex-none bg-secondary text-secondary-foreground hover:bg-secondary/80 disabled:opacity-40"
                  aria-label={sendLabel}
                  title={sendLabel}
                  onClick={send}
                  disabled={!canSend}
               >
                  <SendHorizonal className="size-3.5" aria-hidden />
               </Button>
            </div>

            {attached.length > 0 ? (
               <ul className="flex flex-wrap gap-1.5">
                  {attached.map((file) => (
                     <li
                        key={file.id}
                        className="max-w-full truncate rounded-full border border-border/60 px-2 py-0.5 text-muted-foreground"
                     >
                        {file.fileName}
                     </li>
                  ))}
               </ul>
            ) : null}

            {note ? (
               <p className="text-muted-foreground">
                  {t('note')} · {t('noteHint')}
               </p>
            ) : plan && (plan.targets.length > 0 || plan.refused.length > 0) ? (
               <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-muted-foreground">{t('triggerTitle')}</span>
                  {plan.targets.map((target) => {
                     const off = skipped.includes(target.agentId);
                     return (
                        <button
                           key={target.agentId}
                           type="button"
                           aria-pressed={!off}
                           title={off ? t('restore') : t('skip')}
                           onClick={() =>
                              setSkipped((current) =>
                                 off
                                    ? current.filter((id) => id !== target.agentId)
                                    : [...current, target.agentId]
                              )
                           }
                           className={cn(
                              'rounded-full border px-2 py-0.5',
                              off
                                 ? 'border-border/60 text-muted-foreground line-through'
                                 : 'border-status-info text-status-info'
                           )}
                        >
                           {target.agentName}
                           {off ? ` · ${t('skipped')}` : ''}
                        </button>
                     );
                  })}
                  {plan.refused.map((entry) => (
                     <span
                        key={entry.agentId}
                        title={t('blockedReason')}
                        className="rounded-full border border-status-danger/50 px-2 py-0.5 text-status-danger"
                     >
                        {entry.agentName} · {t('blockedReason')}
                     </span>
                  ))}
               </div>
            ) : null}

            {!isReply && draft.trim() ? (
               <span className="text-muted-foreground">{t('draft')}</span>
            ) : null}
         </div>
      </div>
   );
}

/** Every agent id named in the text. */
function collectMentionIds(body: string): string[] {
   return splitMentions(body).flatMap((part) => ('text' in part ? [] : [part.mention.id]));
}
