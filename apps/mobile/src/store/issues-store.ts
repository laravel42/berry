import { create } from 'zustand';

import type { BerryClient } from '@/api/client';
import {
  approveIssueReview,
  listOpenReviews,
  listPendingApprovals,
  resolveApproval,
} from '@/api/decisions';
import {
  createIssueComment,
  getIssue,
  listAllBoardIssues,
  listIssueActivity,
  listIssueComments,
  listIssueLabels,
  patchIssue,
  restartIssueRun,
  sendBackIssue,
} from '@/api/issues';
import type {
  ApiActivityItem,
  ApiApproval,
  ApiComment,
  ApiIssue,
  ApiIssueLabel,
  ApiReviewItem,
} from '@/api/types';
import { useToastStore } from '@/store/toast-store';

export type MineTab = 'assigned' | 'created';

export type IssueDetailBundle = {
  issue: ApiIssue;
  labels: ApiIssueLabel[];
  comments: ApiComment[];
  activity: ApiActivityItem[];
  approvals: ApiApproval[];
  review: ApiReviewItem | null;
  loading: boolean;
  error: string | null;
};

type IssuesState = {
  issues: ApiIssue[];
  mineTab: MineTab;
  loading: boolean;
  refreshing: boolean;
  error: string | null;
  detailsById: Record<string, IssueDetailBundle>;
  busyAction: boolean;
  setMineTab: (tab: MineTab) => void;
  loadIssues: (
    client: BerryClient,
    boardIds: string[],
    options?: { silent?: boolean; userId?: string | null },
  ) => Promise<void>;
  loadIssueDetail: (client: BerryClient, workspaceId: string, issueRef: string) => Promise<void>;
  upsertIssue: (issue: ApiIssue) => void;
  updateIssue: (
    client: BerryClient,
    issueId: string,
    patch: Record<string, unknown>,
  ) => Promise<boolean>;
  addComment: (client: BerryClient, issueId: string, body: string) => Promise<boolean>;
  approveIssue: (client: BerryClient, workspaceId: string, issueId: string, mergeRunId?: string | null) => Promise<boolean>;
  sendBack: (client: BerryClient, workspaceId: string, issueId: string, note: string) => Promise<boolean>;
  decideApproval: (
    client: BerryClient,
    workspaceId: string,
    issueId: string,
    approvalId: string,
    decision: 'approve' | 'reject',
    note?: string,
  ) => Promise<boolean>;
  retryRun: (client: BerryClient, workspaceId: string, issueId: string) => Promise<boolean>;
  reset: () => void;
};

export const useIssuesStore = create<IssuesState>((set, get) => ({
  issues: [],
  mineTab: 'assigned',
  loading: false,
  refreshing: false,
  error: null,
  detailsById: {},
  busyAction: false,

  setMineTab: (mineTab) => set({ mineTab }),

  loadIssues: async (client, boardIds, options) => {
    if (boardIds.length === 0) {
      set({ issues: [], loading: false, refreshing: false, error: null });
      return;
    }
    set(options?.silent ? { refreshing: true, error: null } : { loading: true, error: null });
    try {
      const requests = boardIds.flatMap((boardId) => {
        const calls = [listAllBoardIssues(client, boardId)];
        if (options?.userId) {
          calls.push(
            listAllBoardIssues(client, boardId, {
              assigneeType: 'user',
              assigneeId: options.userId,
            }),
          );
        }
        return calls;
      });
      const pages = await Promise.all(requests);
      const map = new Map<string, ApiIssue>();
      for (const list of pages) {
        for (const issue of list) {
          map.set(issue.id, issue);
        }
      }
      const merged = Array.from(map.values()).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      set({ issues: merged, loading: false, refreshing: false, error: null });
    } catch (caught) {
      set({
        loading: false,
        refreshing: false,
        error: caught instanceof Error ? caught.message : 'Could not load tasks.',
      });
    }
  },

  loadIssueDetail: async (client, workspaceId, issueRef) => {
    const existing = get().detailsById[issueRef];
    if (existing) {
      set((state) => ({
        detailsById: {
          ...state.detailsById,
          [issueRef]: { ...existing, loading: true, error: null },
        },
      }));
    }
    try {
      const issue = await getIssue(client, issueRef);
      const [labels, comments, activity, approvals, reviews] = await Promise.all([
        listIssueLabels(client, issue.id).catch(() => []),
        listIssueComments(client, issue.id).catch(() => []),
        listIssueActivity(client, issue.id).catch(() => []),
        listPendingApprovals(client, workspaceId, issue.id).catch(() => []),
        listOpenReviews(client, workspaceId).catch(() => []),
      ]);
      const review = reviews.find((entry) => entry.issue.id === issue.id) ?? null;
      const bundle: IssueDetailBundle = {
        issue,
        labels,
        comments,
        activity,
        approvals,
        review,
        loading: false,
        error: null,
      };
      set((state) => ({
        issues: state.issues.some((x) => x.id === issue.id)
          ? state.issues.map((x) => (x.id === issue.id ? issue : x))
          : [issue, ...state.issues],
        detailsById: {
          ...state.detailsById,
          [issueRef]: bundle,
          [issue.id]: bundle,
        },
      }));
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : 'Could not load task details.';
      set((state) => ({
        detailsById: {
          ...state.detailsById,
          [issueRef]: {
            issue: existing?.issue ?? ({} as ApiIssue),
            labels: existing?.labels ?? [],
            comments: existing?.comments ?? [],
            activity: existing?.activity ?? [],
            approvals: existing?.approvals ?? [],
            review: existing?.review ?? null,
            loading: false,
            error: message,
          },
        },
      }));
    }
  },

  upsertIssue: (issue) =>
    set((state) => ({
      issues: state.issues.some((x) => x.id === issue.id)
        ? state.issues.map((x) => (x.id === issue.id ? issue : x))
        : [issue, ...state.issues],
    })),

  updateIssue: async (client, issueId, patch) => {
    set({ busyAction: true });
    try {
      const updated = await patchIssue(client, issueId, patch);
      set((state) => {
        const nextIssues = state.issues.some((x) => x.id === updated.id)
          ? state.issues.map((x) => (x.id === updated.id ? updated : x))
          : [updated, ...state.issues];
        const nextDetails = { ...state.detailsById };
        for (const [key, bundle] of Object.entries(nextDetails)) {
          if (key === issueId || key === updated.id || bundle.issue?.id === updated.id) {
            nextDetails[key] = { ...bundle, issue: updated };
          }
        }
        return {
          busyAction: false,
          issues: nextIssues,
          detailsById: nextDetails,
        };
      });
      return true;
    } catch (caught) {
      set({ busyAction: false });
      useToastStore
        .getState()
        .showToast(caught instanceof Error ? caught.message : 'Could not update task.', 'danger');
      return false;
    }
  },

  addComment: async (client, issueId, body) => {
    const trimmed = body.trim();
    if (!trimmed) return false;
    set({ busyAction: true });
    try {
      const created = await createIssueComment(client, issueId, trimmed);
      set((state) => {
        const current = state.detailsById[issueId];
        if (!current) return { busyAction: false };
        return {
          busyAction: false,
          detailsById: {
            ...state.detailsById,
            [issueId]: { ...current, comments: [...current.comments, created] },
          },
        };
      });
      return true;
    } catch (caught) {
      set({ busyAction: false });
      useToastStore
        .getState()
        .showToast(caught instanceof Error ? caught.message : 'Could not post comment.', 'danger');
      return false;
    }
  },

  approveIssue: async (client, workspaceId, issueId, mergeRunId) => {
    set({ busyAction: true });
    try {
      const updated = await approveIssueReview(client, { issueId, mergeRunId });
      get().upsertIssue(updated);
      await get().loadIssueDetail(client, workspaceId, issueId);
      set({ busyAction: false });
      useToastStore.getState().showToast(`${updated.identifier} approved · Done`);
      return true;
    } catch (caught) {
      set({ busyAction: false });
      useToastStore
        .getState()
        .showToast(caught instanceof Error ? caught.message : 'Could not approve task.', 'danger');
      await get().loadIssueDetail(client, workspaceId, issueId).catch(() => undefined);
      return false;
    }
  },

  sendBack: async (client, workspaceId, issueId, note) => {
    set({ busyAction: true });
    try {
      const updated = await sendBackIssue(client, issueId, note);
      get().upsertIssue(updated);
      await get().loadIssueDetail(client, workspaceId, issueId);
      set({ busyAction: false });
      useToastStore.getState().showToast(`${updated.identifier} sent back to Todo`);
      return true;
    } catch (caught) {
      set({ busyAction: false });
      useToastStore
        .getState()
        .showToast(caught instanceof Error ? caught.message : 'Could not send task back.', 'danger');
      return false;
    }
  },

  decideApproval: async (client, workspaceId, issueId, approvalId, decision, note) => {
    set({ busyAction: true });
    try {
      await resolveApproval(client, approvalId, decision, note);
      await get().loadIssueDetail(client, workspaceId, issueId);
      set({ busyAction: false });
      useToastStore
        .getState()
        .showToast(decision === 'approve' ? 'Approval granted' : 'Approval rejected');
      return true;
    } catch (caught) {
      set({ busyAction: false });
      useToastStore
        .getState()
        .showToast(caught instanceof Error ? caught.message : 'Could not resolve approval.', 'danger');
      return false;
    }
  },

  retryRun: async (client, workspaceId, issueId) => {
    set({ busyAction: true });
    try {
      await restartIssueRun(client, issueId);
      await get().loadIssueDetail(client, workspaceId, issueId);
      set({ busyAction: false });
      useToastStore.getState().showToast('Run restarted');
      return true;
    } catch (caught) {
      set({ busyAction: false });
      useToastStore
        .getState()
        .showToast(caught instanceof Error ? caught.message : 'Could not restart run.', 'danger');
      return false;
    }
  },

  reset: () =>
    set({
      issues: [],
      mineTab: 'assigned',
      loading: false,
      refreshing: false,
      error: null,
      detailsById: {},
      busyAction: false,
    }),
}));
