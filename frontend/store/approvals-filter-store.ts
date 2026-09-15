'use client';

import { parseAsBoolean, parseAsString, parseAsStringLiteral, useQueryStates } from 'nuqs';

export type ApprovalsView = 'pending' | 'all' | 'resolved';

const VIEWS: ApprovalsView[] = ['pending', 'all', 'resolved'];

const parsers = {
   status: parseAsStringLiteral(VIEWS).withDefault('pending'),
   mine: parseAsBoolean.withDefault(false),
   approval: parseAsString.withDefault(''),
};

export interface ApprovalsFilterState {
   view: ApprovalsView;
   mine: boolean;
   /** The approval open in the detail pane. */
   selectedId: string;
   setView: (view: ApprovalsView) => void;
   setMine: (mine: boolean) => void;
   select: (approvalId: string | null) => void;
}

/** Approvals page state, URL-synced (?status=…&mine=…&approval=…). */
export function useApprovalsFilterStore(): ApprovalsFilterState {
   const [state, setState] = useQueryStates(parsers, { history: 'replace' });
   return {
      view: state.status,
      mine: state.mine,
      selectedId: state.approval,
      setView: (view) => setState({ status: view === 'pending' ? null : view }),
      setMine: (mine) => setState({ mine: mine ? true : null }),
      select: (approvalId) => setState({ approval: approvalId || null }),
   };
}
