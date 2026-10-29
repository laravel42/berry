import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, within } from 'storybook/test';
import {
   autopilotRuns,
   deliveries,
   storyHandlers,
} from '@/components/common/agents/stories-fixtures';
import { DeliveryRows, RunRows } from './history-tabs';

const meta = {
   component: RunRows,
   tags: ['ai-generated', 'needs-work'],
   args: { runs: autopilotRuns, orgId: 'berry' },
   beforeEach: ({ msw }) => {
      msw.use(...storyHandlers);
   },
   decorators: [
      (Story) => (
         <div className="w-[380px] rounded-[10px] bg-settings-group">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof RunRows>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Three quota skips in a row fold into one row that opens on click. */
export const Runs: Story = {
   play: async ({ canvas, userEvent }) => {
      await expect(canvas.getAllByRole('listitem')).toHaveLength(4);
      await userEvent.click(canvas.getByRole('button', { name: '3 firings skipped · Over quota' }));
      await expect(canvas.getAllByRole('listitem')).toHaveLength(4 + 3);
      await expect(canvas.getAllByRole('link', { name: 'Transcript' })[0]).toHaveAttribute(
         'href',
         '/berry/runs?run=run-7f3a91c2'
      );
   },
};

export const NoRuns: Story = { args: { runs: [] } };

export const Deliveries: Story = {
   render: () => (
      <DeliveryRows autopilotId="ap-triage" deliveries={deliveries} canReplay onReplayed={fn()} />
   ),
   play: async ({ canvas, canvasElement, userEvent }) => {
      const rows = canvas.getAllByRole('listitem');
      // A delivery refused on its signature cannot be replayed, and says why.
      const rejected = rows.find((row) => row.textContent?.includes('Signature mismatch'));
      await expect(within(rejected!).getByRole('button', { name: 'Replay' })).toBeDisabled();
      // The stored payload is fetched on demand (MSW) and shown in a dialog.
      await userEvent.click(within(rows[0]!).getByRole('button', { name: 'Payload' }));
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByText(/Goals list has no empty state/)).toBeVisible();
   },
};

/** A member reads the deliveries but cannot replay them. */
export const DeliveriesReadOnly: Story = {
   render: () => (
      <DeliveryRows
         autopilotId="ap-triage"
         deliveries={deliveries}
         canReplay={false}
         onReplayed={fn()}
      />
   ),
};

export const NoDeliveries: Story = {
   render: () => (
      <DeliveryRows autopilotId="ap-triage" deliveries={[]} canReplay onReplayed={fn()} />
   ),
};
