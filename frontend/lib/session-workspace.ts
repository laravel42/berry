/**
 * How a ready session picks the workspace it opens.
 *
 * The server returns `currentId` as previous-if-valid-else-null, so a null
 * here means the earliest-joined membership (id breaks ties) rather than
 * trusting incoming array order. Shared by the session store, onboarding,
 * and the `/` server redirect so those three cannot drift.
 */
export function pickWorkspace<T extends { id: string; createdAt: string }>(
   workspaces: T[],
   currentId: string | null
): T | null {
   const current = workspaces.find((workspace) => workspace.id === currentId);
   if (current) return current;
   const earliest = [...workspaces].sort((a, b) => {
      if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? -1 : 1;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
   });
   return earliest[0] ?? null;
}
