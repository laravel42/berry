import type { ReactNode } from 'react';

interface PageTitleBarProps {
   /** The page's name, as its one `<h1>`. Truncates rather than wraps. */
   title: string;
   /** A trailing action, usually one `size="xs"` create button. Omit for a title alone. */
   children?: ReactNode;
}

/**
 * The top row of a list page: the page title and, optionally, its one action,
 * over a bottom rule. Renders a `<header>`; pages sit inside the shell's
 * `<main>`, so it is not a banner landmark.
 *
 * Detail pages use a breadcrumb bar instead (see `headers/project/header.tsx`).
 */
export function PageTitleBar({ title, children }: PageTitleBarProps) {
   return (
      <header className="flex w-full items-center justify-between gap-4 border-b px-6 py-3">
         <h1 className="min-w-0 truncate">{title}</h1>
         {children}
      </header>
   );
}
