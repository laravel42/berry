'use client';

import type { ReactNode } from 'react';
import DetailDrawerShell from '@/components/layout/detail-drawer-shell';
import Header from '@/components/layout/headers/issue/header';

/**
 * The task drawer's frame, kept above `[issueId]` so it outlives a switch.
 *
 * A layout survives navigation between its children; a page does not. With
 * the drawer here, the header's previous / next arrows swap only the task
 * inside, rather than closing one drawer and opening another, which showed
 * as the overlay fading out and back in.
 */
export default function IssueDrawerLayout({ children }: { children: ReactNode }) {
   return <DetailDrawerShell header={<Header />}>{children}</DetailDrawerShell>;
}
