import { Status } from '@/data/status';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * The new-task dialog: what it was opened with, and what has been typed.
 *
 * Two different things, kept apart on purpose. The *context* is where the
 * dialog was opened from — a board column, a parent task, a project — and it
 * is thrown away when the dialog closes. The *draft* is what a person wrote,
 * and it survives, because closing a dialog by accident is not a decision to
 * discard a description someone spent five minutes on.
 *
 * The dialog has two modes — write the task yourself, or say what you want
 * and hand it to an agent — and the last one used is remembered, since a
 * person who hands work to agents all day should not have to switch every
 * time.
 */

export type CreateIssueMode = 'manual' | 'agent';

export interface CreateIssueContext {
   /** Pre-selected column, when opened from a board. */
   defaultStatus: Status | null;
   /** Pre-selected project, when opened from inside one. */
   projectId: string | null;
   /** Pre-filled parent; `parentLocked` when the caller means it as a rule. */
   parentRef: string | null;
   parentLocked: boolean;
}

export interface CreateIssueDraft {
   title: string;
   description: string;
   statusId: string | null;
   priorityId: string | null;
   assignee: { type: 'user' | 'agent'; id: string; name: string } | null;
   projectId: string | null;
   /** Sent as the issue due date. */
   targetDate: string;
   labelIds: string[];
   /** Custom property values, applied once the task exists. */
   properties: Record<string, unknown>;
   /** Agent mode: what the agent is asked to do. Becomes title and description. */
   prompt: string;
   /** Agent mode: who it is handed to. Separate from `assignee` so switching modes loses nothing. */
   agent: { id: string; name: string } | null;
}

export const EMPTY_DRAFT: CreateIssueDraft = {
   title: '',
   description: '',
   statusId: null,
   priorityId: null,
   assignee: null,
   projectId: null,
   targetDate: '',
   labelIds: [],
   properties: {},
   prompt: '',
   agent: null,
};

const EMPTY_CONTEXT: CreateIssueContext = {
   defaultStatus: null,
   projectId: null,
   parentRef: null,
   parentLocked: false,
};

interface CreateIssueState {
   isOpen: boolean;
   /** Kept as its own field for the callers that only set a column. */
   defaultStatus: Status | null;
   context: CreateIssueContext;
   draft: CreateIssueDraft;
   createAnother: boolean;
   mode: CreateIssueMode;

   openModal: (status?: Status) => void;
   openModalWith: (context: Partial<CreateIssueContext>) => void;
   closeModal: () => void;
   setDefaultStatus: (status: Status | null) => void;
   setDraft: (patch: Partial<CreateIssueDraft>) => void;
   resetDraft: () => void;
   setCreateAnother: (value: boolean) => void;
   setMode: (mode: CreateIssueMode) => void;
}

type PersistedCreateIssue = Partial<
   Pick<CreateIssueState, 'createAnother' | 'mode'> & { draft: Partial<CreateIssueDraft> }
>;

export const useCreateIssueStore = create<CreateIssueState>()(
   persist(
      (set) => ({
         isOpen: false,
         defaultStatus: null,
         context: EMPTY_CONTEXT,
         draft: EMPTY_DRAFT,
         createAnother: false,
         mode: 'manual',

         openModal: (status) =>
            set({
               isOpen: true,
               defaultStatus: status ?? null,
               context: { ...EMPTY_CONTEXT, defaultStatus: status ?? null },
            }),

         openModalWith: (context) =>
            set((state) => ({
               isOpen: true,
               defaultStatus: context.defaultStatus ?? state.defaultStatus,
               context: { ...EMPTY_CONTEXT, ...context },
            })),

         closeModal: () => set({ isOpen: false, context: EMPTY_CONTEXT }),
         setDefaultStatus: (defaultStatus) => set({ defaultStatus }),
         setDraft: (patch) => set((state) => ({ draft: { ...state.draft, ...patch } })),
         resetDraft: () => set({ draft: EMPTY_DRAFT }),
         setCreateAnother: (createAnother) => set({ createAnother }),
         setMode: (mode) => set({ mode }),
      }),
      {
         name: 'create-issue-v3',
         // Only what was typed. Whether the dialog is open, and what opened it,
         // belong to this visit.
         // Custom fields are per attempt: do not carry them into the next task.
         partialize: (state) => ({
            draft: { ...state.draft, properties: {} },
            createAnother: state.createAnother,
            mode: state.mode,
         }),
         // A draft saved before a field existed must not come back without it.
         merge: (persisted, current) => {
            const saved = (persisted ?? {}) as PersistedCreateIssue;
            return {
               ...current,
               createAnother: saved.createAnother ?? current.createAnother,
               mode: saved.mode === 'agent' || saved.mode === 'manual' ? saved.mode : current.mode,
               draft: { ...EMPTY_DRAFT, ...(saved.draft ?? {}), properties: {} },
            };
         },
      }
   )
);

/** True when there is unsent text waiting, which is what the rail's dot means. */
export function hasIssueDraft(draft: CreateIssueDraft | null): boolean {
   return Boolean(
      draft && (draft.title.trim() || draft.description.trim() || draft.prompt?.trim())
   );
}
