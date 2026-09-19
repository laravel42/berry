import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { NuqsTestingAdapter } from 'nuqs/adapters/testing';
import { expect } from 'storybook/test';
import Header from './header';

const meta = {
   component: Header,
   tags: ['ai-generated', 'needs-work'],
   parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof Header>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Pending: Story = {
   play: async ({ canvas, userEvent }) => {
      await expect(canvas.getByRole('tab', { name: 'Pending' })).toHaveAttribute(
         'aria-selected',
         'true'
      );
      // Both filters are URL state (?mine=, ?status=).
      await userEvent.click(canvas.getByRole('switch', { name: 'Mine' }));
      await expect(canvas.getByRole('switch', { name: 'Mine' })).toBeChecked();
      await userEvent.click(canvas.getByRole('tab', { name: 'Resolved' }));
      await expect(canvas.getByRole('tab', { name: 'Resolved' })).toHaveAttribute(
         'aria-selected',
         'true'
      );
   },
};

export const MineResolved: Story = {
   decorators: [
      (Story) => (
         <NuqsTestingAdapter searchParams="?status=resolved&mine=true">
            <Story />
         </NuqsTestingAdapter>
      ),
   ],
};
