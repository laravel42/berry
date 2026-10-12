/**
 * The commit a review may treat as this delivery.
 *
 * Delivery merges the base branch into the pull request before review, and
 * GitHub writes that as a merge commit: the first parent is the commit the
 * run pushed, the second is the base tip. That move is Berry's, so the new
 * head is still this delivery. Any other new head is someone else's commit.
 *
 * Returns null when `head` is not the delivered commit and not that merge.
 */
export function deliveredHead(
   delivered: string,
   head: string | null,
   parents: readonly string[],
   baseSha: string | null
): string | null {
   if (head === delivered) return delivered;
   const baseMerge =
      head !== null &&
      parents.length === 2 &&
      parents[0] === delivered &&
      baseSha !== null &&
      parents[1] === baseSha;
   return baseMerge ? head : null;
}
