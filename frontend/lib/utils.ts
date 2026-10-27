import LexoRank from '@kayron013/lexorank';
import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

/**
 * `rounded-pill` and `rounded-card` are this project's own radii, so
 * tailwind-merge has to be told they belong to the border-radius group.
 * Without this it does not see them as conflicting with `rounded-lg` and
 * friends, keeps both classes, and which one wins falls to the order Tailwind
 * happened to emit them in -- so a component's radius could not be overridden
 * from a call site on purpose, only by accident.
 */
const twMerge = extendTailwindMerge({
   extend: { classGroups: { rounded: [{ rounded: ['pill', 'card'] }] } },
});

export function cn(...inputs: ClassValue[]) {
   return twMerge(clsx(inputs));
}

/**
 * Ordering system like JIRA's LexoRank algorithm.
 * @see https://youtu.be/OjQv9xMoFbg
 */
export { LexoRank };
