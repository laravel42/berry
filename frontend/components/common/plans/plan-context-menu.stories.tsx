import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, fn, waitFor, within } from 'storybook/test';
import type { PlanSummary } from '@/lib/plans';
import { seedProjectStores } from '../projects/stories-fixtures';
import { PlanContextMenu } from './plan-context-menu';

const plan: PlanSummary = {
   id: 'plan-1',
   status: 'draft',
   title: 'Persist project health and weekly updates',
   projectId: 'proj-health',
   projectName: 'Persist project health',
   goalId: null,
   generation: { status: 'succeeded', error: null, stage: 'finalize' },
   validationStatus: 'valid',
   compileStatus: 'idle',
   routingStatus: null,
   plannedTasks: 4,
   createdTasks: 0,
   finishedTasks: 0,
   autoGate: false,
   archived: false,
   createdAt: '2026-09-18T11:40:00Z',
   updatedAt: '2026-09-18T11:42:00Z',
};

const meta = {
   component: PlanContextMenu,
   tags: ['ai-generated'],
   args: { plan, onChanged: fn() },
   render: (args) => (
      <PlanContextMenu {...args}>
         <div className="flex h-10 w-[420px] items-center border px-3">
            <span>{plan.title}</span>
         </div>
      </PlanContextMenu>
   ),
   beforeEach: ({ msw }) => {
      seedProjectStores();
      msw.use(
         http.get('*/api/v1/plans/:id/subscription', () =>
            HttpResponse.json({ subscribed: false })
         ),
         http.put('*/api/v1/plans/:id/subscription', async ({ request }) =>
            HttpResponse.json(await request.json())
         ),
         http.post('*/api/v1/plans/:id/archive', () => HttpResponse.json({})),
         http.delete('*/api/v1/plans/:id', () => new HttpResponse(null, { status: 204 }))
      );
   },
} satisfies Meta<typeof PlanContextMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Closed: Story = {};

/** Right-click opens: subscribe, pin, archive and delete, in that order. */
export const Open: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.pointer({ keys: '[MouseRight]', target: canvas.getByText(plan.title) });
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByRole('menuitem', { name: /Subscribe/ })).toBeVisible();
      await expect(body.getByRole('menuitem', { name: /Pin/ })).toBeVisible();
      await expect(body.getByRole('menuitem', { name: /Archive/ })).toBeVisible();
      await expect(body.getByRole('menuitem', { name: /Delete/ })).toBeVisible();
   },
};

/** Archiving asks the server first, then calls back so the list can drop it. */
export const Archive: Story = {
   play: async ({ args, canvas, canvasElement, userEvent }) => {
      await userEvent.pointer({ keys: '[MouseRight]', target: canvas.getByText(plan.title) });
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.click(await body.findByRole('menuitem', { name: /Archive/ }));
      await waitFor(() => expect(args.onChanged).toHaveBeenCalledTimes(1));
   },
};

/** Delete asks first; confirming calls back the same way archiving does. */
export const DeleteConfirmed: Story = {
   play: async ({ args, canvas, canvasElement, userEvent }) => {
      await userEvent.pointer({ keys: '[MouseRight]', target: canvas.getByText(plan.title) });
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.click(await body.findByRole('menuitem', { name: /Delete/ }));
      const dialog = await body.findByRole('alertdialog');
      await expect(dialog).toHaveTextContent('Delete this plan?');
      await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
      await waitFor(() => expect(args.onChanged).toHaveBeenCalledTimes(1));
   },
};
