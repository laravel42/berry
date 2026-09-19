import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, within } from 'storybook/test';
import { proposals, seedSession, workspaceRoute } from '@/components/layout/stories-fixtures';
import Proposals from './proposals';

const listHandler = (nodes: unknown[]) =>
   http.get('*/api/v1/work-proposals', () => HttpResponse.json({ nodes }));

const meta = {
   component: Proposals,
   tags: ['ai-generated', 'needs-work'],
   parameters: {
      layout: 'fullscreen',
      nextjs: { navigation: workspaceRoute('/elian/proposals') },
   },
   decorators: [
      (Story) => (
         <div className="h-[720px]">
            <Story />
         </div>
      ),
   ],
   beforeEach: ({ msw }) => {
      seedSession('admin');
      msw.use(listHandler(proposals));
   },
} satisfies Meta<typeof Proposals>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ForAnAdmin: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await expect(
         await canvas.findByText('The integration encryption key has never been rotated.')
      ).toBeVisible();
      // Accepting goes through POST /api/v1/approvals/:id/approve (shared MSW handler).
      const [accept] = canvas.getAllByRole('button', { name: 'Accept' });
      await userEvent.click(accept);
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByText('Decision recorded')).toBeVisible();
   },
};

/** A member sees the work but not the decision. */
export const ForAMember: Story = {
   beforeEach: () => {
      seedSession('member');
   },
   play: async ({ canvas }) => {
      const notes = await canvas.findAllByText(
         'Only workspace owners and admins can accept or reject a proposal.'
      );
      await expect(notes).toHaveLength(2);
      await expect(canvas.queryByRole('button', { name: 'Accept' })).toBeNull();
   },
};

export const Empty: Story = {
   beforeEach: ({ msw }) => {
      msw.use(listHandler([]));
   },
   play: async ({ canvas }) => {
      await expect(await canvas.findByRole('heading', { name: 'No proposals yet.' })).toBeVisible();
      await expect(canvas.getByRole('link', { name: 'Go to autopilots' })).toHaveAttribute(
         'href',
         '/elian/autopilots'
      );
   },
};

export const Loading: Story = {
   beforeEach: ({ msw }) => {
      msw.use(http.get('*/api/v1/work-proposals', () => new Promise<Response>(() => undefined)));
   },
};

export const Failed: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/work-proposals', () =>
            HttpResponse.json({ nodes: 'unexpected' }, { status: 200 })
         )
      );
   },
   play: async ({ canvas }) => {
      await expect(await canvas.findByText('Proposals was not recognized')).toBeVisible();
   },
};
