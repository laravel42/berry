// Pure URL builders for the issues API. No imports, so the root layout (a server
// component) can use them without pulling client code in.

export const BOARD_ISSUES_PAGE_SIZE = 100;

/**
 * The path of a board's first page of tasks. The fetch in lib/issues.ts and the
 * <link rel="preload"> in app/layout.tsx both build it here, so the preload is
 * the same request byte for byte and cannot drift from it.
 */
export function boardIssuesFirstPagePath(boardId: string): string {
   const params = new URLSearchParams({
      boardId,
      first: String(BOARD_ISSUES_PAGE_SIZE),
   });
   return `/api/v1/issues?${params.toString()}`;
}
