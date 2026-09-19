import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn } from 'storybook/test';
import { InboxPanel } from './inbox-states';

const meta = {
   component: InboxPanel,
   tags: ['ai-generated', 'needs-work'],
   args: { title: 'Loading your notifications…' },
   decorators: [
      (Story) => (
         <div className="h-[360px] w-[480px] border bg-container">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof InboxPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Loading: Story = {};

export const CaughtUp: Story = {
   args: {
      title: 'You’re caught up.',
      body: 'Everything you handled is in the archive. New mentions, assignments, comments, reviews, runs, approvals and proposals land here.',
   },
};

export const ArchiveFailed: Story = {
   args: {
      state: 'crossed',
      title: 'The archive could not be loaded.',
      body: 'The request did not come back. Nothing was lost.',
      action: { label: 'Try again', onClick: fn() },
   },
   play: async ({ canvas, args, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Try again' }));
      await expect(args.action?.onClick).toHaveBeenCalled();
   },
};
