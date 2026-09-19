import { z } from 'zod';
import { BerryApiError, apiFetch } from './api';
import { connectionSchema, newIdempotencyKey } from './api-schemas';
import type { User } from '@/data/users';

/**
 * Approvals: the human decisions that gate a plan, a task's start, or an
 * action an agent wants to take outside Berry. Who may decide is the
 * server's rule — the addressee, or anyone holding the addressed role or a
 * stronger one — so the client only words the refusal.
 */

export const approvalStatusSchema = z.enum(['pending', 'approved', 'rejected', 'expired']);
export const approvalRiskSchema = z.enum(['low', 'medium', 'high']);

export const approvalSchema = z.object({
   id: z.string(),
   workspaceId: z.string(),
   kind: z.string(),
   risk: approvalRiskSchema,
   title: z.string(),
   description: z.string().nullish(),
   goalId: z.string().nullish(),
   planId: z.string().nullish(),
   issueId: z.string().nullish(),
   issue: z.object({ id: z.string(), identifier: z.string(), title: z.string() }).nullish(),
   requestedFrom: z
      .object({ userId: z.string().nullish(), role: z.string().nullish() })
      .default({ userId: null, role: null }),
   requestedBy: z.object({ type: z.string(), id: z.string() }).nullish(),
   status: approvalStatusSchema,
   decisionNote: z.string().nullish(),
   resolvedBy: z.string().nullish(),
   requestedAt: z.string(),
   expiresAt: z.string().nullish(),
   resolvedAt: z.string().nullish(),
});

const approvalConnectionSchema = connectionSchema(approvalSchema);

export type ApprovalStatus = z.infer<typeof approvalStatusSchema>;
export type ApprovalRisk = z.infer<typeof approvalRiskSchema>;
export type Approval = z.infer<typeof approvalSchema>;

function parseApproval(json: unknown): Approval {
   const parsed = approvalSchema.safeParse(json);
   if (!parsed.success) {
      throw new Error('Approval response was not recognized');
   }
   const approval = parsed.data;
   return {
      ...approval,
      title: decodeApprovalText(approval.title),
      description: approval.description
         ? decodeApprovalText(approval.description)
         : approval.description,
      decisionNote: approval.decisionNote
         ? decodeApprovalText(approval.decisionNote)
         : approval.decisionNote,
   };
}

export interface ApprovalsQuery {
   status?: ApprovalStatus;
   kind?: string;
   goalId?: string;
   issueId?: string;
   /** Only the pending approvals the caller may resolve. */
   mine?: boolean;
   first?: number;
}

export async function listWorkspaceApprovals(
   workspaceId: string,
   query: ApprovalsQuery = {}
): Promise<Approval[]> {
   const collected: Approval[] = [];
   const limit = query.first ?? 200;
   let after: string | undefined;
   for (let page = 0; page < 20; page += 1) {
      const params = new URLSearchParams({ workspaceId, first: String(Math.min(limit, 100)) });
      if (query.status) params.set('status', query.status);
      if (query.kind) params.set('kind', query.kind);
      if (query.goalId) params.set('goalId', query.goalId);
      if (query.issueId) params.set('issueId', query.issueId);
      if (query.mine) params.set('mine', 'true');
      if (after) params.set('after', after);
      const json: unknown = await apiFetch(`/api/v1/approvals?${params.toString()}`);
      const parsed = approvalConnectionSchema.safeParse(json);
      if (!parsed.success) {
         throw new Error('Approval list was not recognized');
      }
      collected.push(...parsed.data.nodes);
      const { hasNextPage, endCursor } = parsed.data.pageInfo;
      if (!hasNextPage || !endCursor || parsed.data.nodes.length === 0) break;
      if (collected.length >= limit) break;
      after = endCursor;
   }
   return collected.slice(0, limit);
}

/** Approvals for the store; a failed read leaves the list empty. */
export async function loadWorkspaceApprovals(
   workspaceId: string,
   query: ApprovalsQuery = {}
): Promise<Approval[]> {
   if (!workspaceId) return [];
   try {
      return await listWorkspaceApprovals(workspaceId, query);
   } catch {
      return [];
   }
}

export async function getApproval(approvalId: string, signal?: AbortSignal): Promise<Approval> {
   const json: unknown = await apiFetch(
      `/api/v1/approvals/${encodeURIComponent(approvalId)}`,
      undefined,
      { signal }
   );
   return parseApproval(json);
}

async function decide(
   approvalId: string,
   decision: 'approve' | 'reject',
   note?: string
): Promise<Approval> {
   const json: unknown = await apiFetch(
      `/api/v1/approvals/${encodeURIComponent(approvalId)}/${decision}`,
      {
         method: 'POST',
         headers: { 'Idempotency-Key': newIdempotencyKey() },
         body: JSON.stringify(note?.trim() ? { note: note.trim() } : {}),
      }
   );
   return parseApproval(json);
}

/** Throws `FORBIDDEN` (`details.reason`), `APPROVAL_RESOLVED`, `APPROVAL_REQUIRED`. */
export function approveApproval(approvalId: string, note?: string): Promise<Approval> {
   return decide(approvalId, 'approve', note);
}

export function rejectApproval(approvalId: string, note?: string): Promise<Approval> {
   return decide(approvalId, 'reject', note);
}

export interface CreateIssueStartApprovalInput {
   workspaceId: string;
   issueId: string;
   title: string;
   description?: string;
   requestedFromUserId?: string;
   requestedFromRole?: 'owner' | 'admin' | 'member';
   risk?: ApprovalRisk;
   expiresAt?: string;
}

/** Opens a manual gate on a task; without an addressee it goes to admins. */
export async function createIssueStartApproval(
   input: CreateIssueStartApprovalInput
): Promise<Approval> {
   const body: Record<string, string> = {
      workspaceId: input.workspaceId,
      kind: 'issueStart',
      issueId: input.issueId,
      title: input.title,
   };
   if (input.description) body.description = input.description;
   if (input.requestedFromUserId) body.requestedFromUserId = input.requestedFromUserId;
   else if (input.requestedFromRole) body.requestedFromRole = input.requestedFromRole;
   if (input.risk) body.risk = input.risk;
   if (input.expiresAt) body.expiresAt = input.expiresAt;
   const json: unknown = await apiFetch('/api/v1/approvals', {
      method: 'POST',
      headers: { 'Idempotency-Key': newIdempotencyKey() },
      body: JSON.stringify(body),
   });
   return parseApproval(json);
}

// ---------------------------------------------------------------------------
// Reading an approval

export function isApprovalPending(approval: Pick<Approval, 'status'>): boolean {
   return approval.status === 'pending';
}

/**
 * `/api/v1/approvals` sends kinds camelCased (`workProposal`); the goal's
 * approval list sends the column spelling (`work_proposal`). Both read the same.
 */
export function describeApprovalKind(kind: string): string {
   switch (kind.replace(/_([a-z])/g, (_all, letter: string) => letter.toUpperCase())) {
      case 'plan':
         return 'Start a plan';
      case 'issueStart':
         return 'Start a task';
      case 'integrationAction':
         return 'External action';
      case 'workProposal':
         return 'Work proposal';
      case 'escalation':
         return 'Escalation';
      default:
         return kind;
   }
}

export function describeApprovalStatus(status: string): string {
   switch (status) {
      case 'pending':
         return 'Pending';
      case 'approved':
         return 'Approved';
      case 'rejected':
         return 'Rejected';
      case 'expired':
         return 'Expired';
      default:
         return status;
   }
}

/** "Andrea", "any admin", "anyone". */
export function describeRequestedFrom(
   requestedFrom: Approval['requestedFrom'],
   members: User[]
): string {
   if (requestedFrom.userId) {
      const member = members.find((candidate) => candidate.id === requestedFrom.userId);
      return member?.name ?? 'one person';
   }
   if (requestedFrom.role) return `any ${requestedFrom.role}`;
   return 'anyone';
}

/** "expires in 2 days", "expired", or null when open-ended. */
export function describeApprovalExpiry(
   expiresAt: string | null | undefined,
   now = Date.now()
): string | null {
   if (!expiresAt) return null;
   const then = new Date(expiresAt).getTime();
   if (Number.isNaN(then)) return null;
   const ms = then - now;
   if (ms <= 0) return 'expired';
   const minutes = Math.round(ms / 60_000);
   if (minutes < 60) return `expires in ${minutes}m`;
   const hours = Math.round(minutes / 60);
   if (hours < 48) return `expires in ${hours}h`;
   return `expires in ${Math.round(hours / 24)} days`;
}

/** Why a decision was refused, for the person who tried. */
export function describeApprovalFailure(error: unknown): string {
   if (error instanceof BerryApiError) {
      switch (error.code) {
         case 'FORBIDDEN': {
            const details = error.details as { reason?: string } | null;
            if (details?.reason === 'not_addressee') {
               return 'This approval is addressed to someone else.';
            }
            if (details?.reason === 'admin_required') {
               return 'An admin has to decide this one.';
            }
            return 'You are not allowed to decide this approval.';
         }
         case 'APPROVAL_RESOLVED':
            return 'This approval was already decided.';
         case 'APPROVAL_REQUIRED':
            return 'Another approval still holds this task.';
         case 'CONFLICT':
            return error.message;
         case 'NOT_FOUND':
            return 'The approval could not be found.';
         default:
            return error.message;
      }
   }
   return 'The approval request failed.';
}

/** The `details.reason` of a refused decision, when it was a permission refusal. */
export function approvalRefusalReason(error: unknown): 'not_addressee' | 'admin_required' | null {
   if (!(error instanceof BerryApiError) || error.code !== 'FORBIDDEN') return null;
   const details = error.details as { reason?: string } | null;
   if (details?.reason === 'not_addressee' || details?.reason === 'admin_required') {
      return details.reason;
   }
   return null;
}

// ---------------------------------------------------------------------------
// Reading an approval for the row and the decision it asks for

/**
 * The decision an approval asks for, by kind. `/api/v1/approvals` sends kinds
 * camelCased and the goal's approval list sends the column spelling, so both
 * are normalised before the switch.
 */
export type ApprovalDecisionKind = 'escalation' | 'issueStart' | 'workProposal' | 'default';

export function approvalDecisionKind(kind: string): ApprovalDecisionKind {
   switch (kind.replace(/_([a-z])/g, (_all, letter: string) => letter.toUpperCase())) {
      case 'escalation':
         return 'escalation';
      case 'issueStart':
         return 'issueStart';
      case 'workProposal':
         return 'workProposal';
      default:
         return 'default';
   }
}

/** True for a work-proposal gate, whichever spelling the payload used. */
export function isWorkProposalKind(kind: string): boolean {
   return approvalDecisionKind(kind) === 'workProposal';
}

const TITLE_PREFIX =
   /^\s*(?:decision needed|decision required|escalation|question|proposal|approval needed|approval)\s*:\s*/i;

/**
 * The approval title with the agent prefix dropped, kept in full so a wide
 * pane can wrap it instead of cutting at the first sentence.
 */
export function approvalHeadline(title: string): string {
   return decodeApprovalText(title).replace(/\s+/g, ' ').trim().replace(TITLE_PREFIX, '');
}

/** Sentence-initial agent phrasing, rewritten so the row reads as a fact. */
const FIRST_PERSON: [RegExp, string][] = [
   [
      /^(?:this task|the task|[A-Z][A-Z0-9]*-\d+)\s*(?:\([A-Z][A-Z0-9]*-\d+\)\s*)?asks me to\s+/i,
      '',
   ],
   [/^i need to\s+/i, ''],
   [/^i(?:'m| am) unable to\s+/i, 'Unable to '],
   [/^i (?:can't|cannot|can not)\s+/i, 'Cannot '],
   [/^i have no\s+/i, 'No '],
];

function capitalise(text: string): string {
   return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Agents sometimes escape quotes as `&quot;` (and similar) in titles they
 * write. The card shows plain text, so those must become real characters
 * before we summarise or put the string in `title=`.
 */
export function decodeApprovalText(text: string): string {
   if (!text.includes('&')) return text;
   return text
      .replace(/&quot;/gi, '"')
      .replace(/&#0*34;/g, '"')
      .replace(/&apos;/gi, "'")
      .replace(/&#0*39;/g, "'")
      .replace(/&lt;/gi, '<')
      .replace(/&#0*60;/g, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&#0*62;/g, '>')
      .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => {
         const code = Number.parseInt(hex, 16);
         return Number.isFinite(code) ? String.fromCodePoint(code) : _;
      })
      .replace(/&#(\d+);/g, (_, digits: string) => {
         const code = Number(digits);
         return Number.isFinite(code) ? String.fromCodePoint(code) : _;
      })
      .replace(/&amp;/gi, '&');
}

/**
 * The agent's title as one line for a list row: the "Decision needed:" prefix
 * and first-person framing dropped, the first sentence kept, and cut at a
 * word before `max` characters. The full title belongs in `title=`.
 */
export function summarizeApprovalTitle(title: string, max = 80): string {
   let text = decodeApprovalText(title).replace(/\s+/g, ' ').trim().replace(TITLE_PREFIX, '');
   for (const [pattern, replacement] of FIRST_PERSON) {
      if (pattern.test(text)) {
         text = capitalise(text.replace(pattern, replacement));
         break;
      }
   }
   // A sentence ends at a terminator followed by a capital, a quote, or the
   // end — "e.g." and "index.css" do not end one.
   const sentence = text.match(/^(.*?[.!?]["”’']?)(?=\s+["“(]?[A-Z]|\s*$)/);
   if (sentence?.[1]) text = sentence[1];
   if (text.length > max) {
      const bare = text
         .replace(/\s*\([^)]*\)/g, '')
         .replace(/\s+/g, ' ')
         .trim();
      if (bare.length > 0) text = bare;
   }
   if (text.length > max) {
      const cut = text.slice(0, max - 1);
      const space = cut.lastIndexOf(' ');
      text = `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:(]+$/, '')}…`;
   }
   return text;
}

export interface EscalationRequest {
   /** The request with the options list taken out. */
   body: string;
   /** The choices the agent offered, in its order; empty when it offered none. */
   options: string[];
}

/**
 * One labelled block of an approval request. Proposal bodies are written as
 * `**Heading**` sections; splitting them lets the inbox card render a tree
 * instead of one undifferentiated markdown slab.
 */
export interface ApprovalSection {
   /** Heading without the markdown stars; null for a lead-in with no label. */
   title: string | null;
   body: string;
}

/**
 * Split an approval description into labelled sections.
 *
 * A block that is only a bold sentence (`**Proposed by X.**`) becomes a
 * section whose title is that sentence and whose body is empty. Blocks that
 * start with `**Heading**` keep the rest as the body. Unlabelled leading text
 * becomes a section with no title.
 */
export function splitApprovalSections(text: string): ApprovalSection[] {
   const source = decodeApprovalText(text).replace(/\r\n/g, '\n').trim();
   if (!source) return [];

   const heading = /^\*\*([^*]+?)\*\*\s*/;
   const chunks = source.split(/\n(?=\*\*[^*\n]+\*\*)/);
   const sections: ApprovalSection[] = [];

   for (const chunk of chunks) {
      const trimmed = chunk.trim();
      if (!trimmed) continue;
      const match = trimmed.match(heading);
      if (!match) {
         sections.push({ title: null, body: trimmed });
         continue;
      }
      const title = match[1]!.replace(/[.：:]\s*$/, '').trim();
      const body = trimmed.slice(match[0].length).trim();
      sections.push({ title: title || null, body });
   }

   return sections.length > 0 ? sections : [{ title: null, body: source }];
}

const OPTIONS_HEADING = /^(.*?)\s*(?:\*\*|__)?options?(?:\*\*|__)?\s*:\s*(?:\*\*|__)?\s*$/i;
const LIST_ITEM = /^\s*(?:[-*•+]|\d+[.)])\s+(.+?)\s*$/;

function plainOption(text: string): string {
   return text
      .replace(/\*\*|__/g, '')
      .replace(/`([^`]*)`/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
}

/**
 * Lifts the "Options:" list an escalation ends its question with — bullets or
 * numbers, possibly followed by a recommendation — out of the body, so the
 * choices can be offered as a radio group instead of prose. A body with fewer
 * than two options comes back untouched.
 */
export function splitEscalationOptions(description: string | null | undefined): EscalationRequest {
   const text = description ?? '';
   const lines = text.split('\n');
   const headingAt = lines.findIndex((line) => OPTIONS_HEADING.test(line));
   if (headingAt < 0) return { body: text, options: [] };
   const options: string[] = [];
   let index = headingAt + 1;
   while (index < lines.length && lines[index]?.trim() === '') index += 1;
   while (index < lines.length) {
      const line = lines[index] ?? '';
      const item = line.match(LIST_ITEM);
      if (item?.[1]) {
         options.push(item[1]);
      } else if (options.length > 0 && /^\s+\S/.test(line)) {
         // An indented continuation belongs to the option above it.
         options[options.length - 1] = `${options[options.length - 1]} ${line.trim()}`;
      } else {
         break;
      }
      index += 1;
   }
   if (options.length < 2) return { body: text, options: [] };
   const lead = lines[headingAt]?.match(OPTIONS_HEADING)?.[1]?.trim() ?? '';
   const before = lines.slice(0, headingAt);
   if (lead) before.push(lead);
   const after = lines.slice(index);
   const body = [...before, ...after]
      .join('\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
   return { body, options: options.map(plainOption) };
}
