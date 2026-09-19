import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import Link from 'next/link';
import { http, HttpResponse } from 'msw';
import { expect, within } from 'storybook/test';

import { MemberHoverCard } from './member-hover-card';
import { memberRoles, membersHandlers, WORKSPACE_ID } from './stories-fixtures';

const TOP_AGENTS = '*/api/v1/workspaces/:workspaceId/members/:userId/top-agents';

const meta = {
   component: MemberHoverCard,
   tags: ['ai-generated', 'needs-work'],
   args: {
      workspaceId: WORKSPACE_ID,
      member: memberRoles[2]!,
      role: 'member',
      children: (
         <Link href="/elian/members/user-3" className="hover:underline">
            Tomás Reyes
         </Link>
      ),
   },
   beforeEach: ({ msw }) => {
      msw.use(...membersHandlers);
   },
} satisfies Meta<typeof MemberHoverCard>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Resting on the name opens the card after a short delay, and only then asks
 * for the member's top agents; the card shows the first two.
 */
export const TopAgents: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.hover(canvas.getByRole('link', { name: 'Tomás Reyes' }));
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByText('Engineer')).toBeVisible();
      await expect(body.getByText('34 runs')).toBeVisible();
      await expect(body.queryByText('QA Analyst')).toBeNull();
      await expect(body.getByText('tomas@elian.dev')).toBeVisible();
   },
};

export const NoAgentsYet: Story = {
   args: {
      member: memberRoles[3]!,
      role: 'viewer',
      children: <Link href="/elian/members/user-4">Priya Nair</Link>,
   },
   beforeEach: ({ msw }) => {
      msw.use(
         http.get(TOP_AGENTS, () =>
            HttpResponse.json({ nodes: [], pageInfo: { hasNextPage: false, endCursor: null } })
         )
      );
   },
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.hover(canvas.getByRole('link', { name: 'Priya Nair' }));
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByText('No agent has run on their tasks yet.')).toBeVisible();
      await expect(body.getByText('Viewer')).toBeVisible();
   },
};

/** An owner whose top-agents read fails: the card says "none" rather than showing an error. */
export const ReadFailed: Story = {
   args: {
      member: memberRoles[0]!,
      role: 'owner',
      children: <Link href="/elian/members/user-1">Andrea Lunelio</Link>,
   },
   beforeEach: ({ msw }) => {
      msw.use(
         http.get(TOP_AGENTS, () =>
            HttpResponse.json(
               { error: { code: 'NOT_FOUND', message: 'Member not found.' } },
               { status: 404 }
            )
         )
      );
   },
};
