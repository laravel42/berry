'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';

import {
   DetailHeaderSkeleton,
   IssueDetailSkeleton,
   ProjectOverviewSkeleton,
} from '@/components/common/details/detail-skeletons';
import DetailDrawerShell from '@/components/layout/detail-drawer-shell';

type Pending = { kind: 'issue' | 'project'; from: string };

/** `/<org>/issue/<id>` and `/<org>/project/<id>[/<tab>]`: the routes the drawer slot intercepts. */
const DRAWER_ROUTE = /^\/[^/]+\/(issue|project)\/[^/]+(?:\/[^/]+)?\/?$/;

/**
 * Opens the detail drawer, sketched in, the moment a task or project link is
 * clicked.
 *
 * The drawer itself is an intercepted route, and the router shows nothing
 * until that route's server response and code have arrived: about half a
 * second in production, two or more in development. A `loading.tsx` does not
 * help here, because the intercepted route is not prefetched to it. So this
 * listens for the click instead, from any list, board, card or search
 * result, and draws the same shell with skeletons until the route lands.
 *
 * It only draws while the address is still the one the click was made on:
 * when the route commits, the pathname changes in the same render and this
 * gives way to the real drawer without a frame of both.
 */
export function PendingDetailDrawer() {
   const pathname = usePathname() ?? '';
   const [pending, setPending] = useState<Pending | null>(null);

   useEffect(() => {
      const onClick = (event: MouseEvent) => {
         // A plain left click that a Link turned into a client navigation;
         // a new tab, a download or a modified click is left alone.
         if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
            return;
         const anchor = (event.target as Element | null)?.closest?.('a[href]');
         if (!(anchor instanceof HTMLAnchorElement)) return;
         if (anchor.target && anchor.target !== '_self') return;
         if (!event.defaultPrevented) return;
         const url = new URL(anchor.href, window.location.href);
         if (url.origin !== window.location.origin) return;
         const match = DRAWER_ROUTE.exec(url.pathname);
         if (!match) return;
         const here = window.location.pathname;
         // Already in a drawer: the next one replaces its content in place.
         if (DRAWER_ROUTE.test(here) || url.pathname === here) return;
         setPending({ kind: match[1] as Pending['kind'], from: here });
      };
      // Bubble phase on the document: runs after the Link's own handler has
      // called preventDefault, which is how a client navigation is told apart.
      document.addEventListener('click', onClick);
      return () => document.removeEventListener('click', onClick);
   }, []);

   // Landed: forget it, or closing the drawer (back to `from`) would bring
   // the sketch back.
   useEffect(() => {
      if (pending && pathname !== pending.from) setPending(null);
   }, [pathname, pending]);

   // A navigation that never lands (an error, a redirect) must not leave the
   // sketch up for good.
   useEffect(() => {
      if (!pending) return;
      const timer = window.setTimeout(() => setPending(null), 10_000);
      return () => window.clearTimeout(timer);
   }, [pending]);

   if (!pending || pending.from !== pathname) return null;

   return (
      <DetailDrawerShell header={<DetailHeaderSkeleton />} onClose={() => setPending(null)}>
         {pending.kind === 'issue' ? <IssueDetailSkeleton /> : <ProjectOverviewSkeleton />}
      </DetailDrawerShell>
   );
}
