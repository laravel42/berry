import type { Issue } from '@/data/issues';
import { createContext } from 'react';
import type { BoardMoveColumn } from './issue-context-menu';

/**
 * The small drag-and-drop pieces the list, the board and the table share,
 * kept apart from the board's cards so the list does not load them.
 */

export const IssueDragType = 'ISSUE';

/**
 * What a card needs to offer Move to: the board's columns and the write a drop
 * onto one of them performs. Only a board provides it, and only for a grouping
 * where a column is a single value a card can be given.
 */
export interface BoardMove {
   columns: BoardMoveColumn[];
   replacesStatus: boolean;
   move: (columnId: string, issue: Issue) => void;
}

export const BoardMoveContext = createContext<BoardMove | null>(null);
