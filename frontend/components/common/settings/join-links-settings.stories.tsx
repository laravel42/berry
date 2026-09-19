import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect } from 'storybook/test';
import { JoinLinksPanel } from './join-links-settings';
import { apiError, joinLinks, page, seedSession } from './stories-fixtures';

const meta = {
   component: JoinLinksPanel,
   tags: ['ai-generated', 'needs-work'],
   decorators: [
      (Story) => (
         <div className="max-w-2xl">
            <Story />
         </div>
      ),
   ],
   beforeEach: ({ msw }) => {
      seedSession();
      msw.use(
         http.get('*/api/v1/catalogs/:ws/join-links', () => HttpResponse.json(page(joinLinks))),
         http.post('*/api/v1/catalogs/:ws/join-links', async ({ request }) => {
            const input = (await request.json()) as { role: string };
            return HttpResponse.json({
               ...joinLinks[0]!,
               id: 'jl-new',
               role: input.role,
               useCount: 0,
               token: 'jl_4hT9qWm2ZxR7',
            });
         })
      );
   },
} satisfies Meta<typeof JoinLinksPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Links: Story = {
   play: async ({ canvas }) => {
      // Each link says whether it still works, and only live ones can be revoked.
      await expect(await canvas.findByText('active · used 3')).toBeVisible();
      await expect(canvas.getByText('expired · used 0')).toBeVisible();
      await expect(canvas.getByText('used up · used 1')).toBeVisible();
      await expect(canvas.getByText('revoked · used 7')).toBeVisible();
      await expect(canvas.getAllByRole('button', { name: 'Revoke' })).toHaveLength(1);
   },
};

export const CreateShowsLinkOnce: Story = {
   play: async ({ canvas, userEvent }) => {
      await canvas.findByText('active · used 3');
      await userEvent.click(canvas.getByRole('button', { name: 'Create link' }));
      await expect(await canvas.findByText(/\/join\/jl_4hT9qWm2ZxR7$/)).toBeVisible();
      await expect(
         canvas.getByText('Copy this now — it is shown once. Berry kept only a hash of it.')
      ).toBeVisible();
   },
};

export const Empty: Story = {
   beforeEach: ({ msw }) => {
      msw.use(http.get('*/api/v1/catalogs/:ws/join-links', () => HttpResponse.json(page([]))));
   },
};

export const LoadFailed: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/catalogs/:ws/join-links', () =>
            apiError(403, 'Only admins can see join links.', 'FORBIDDEN')
         )
      );
   },
};
