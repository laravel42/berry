import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { NuqsTestingAdapter } from 'nuqs/adapters/testing';
import { expect } from 'storybook/test';
import { approvals, seedSession, workspaceRoute } from '@/components/layout/stories-fixtures';
import { useApprovalsStore } from '@/store/approvals-store';
import Approvals from './approvals';

const meta = {
   component: Approvals,
   tags: ['ai-generated', 'needs-work'],
   parameters: {
      layout: 'fullscreen',
      nextjs: { navigation: workspaceRoute('/elian/approvals') },
   },
   decorators: [
      (Story) => (
         <div className="h-[640px] border">
            <Story />
         </div>
      ),
   ],
   beforeEach: () => {
      seedSession();
      useApprovalsStore.setState({ approvals, loaded: true, error: null });
   },
} satisfies Meta<typeof Approvals>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Pending: Story = {
   play: async ({ canvas, userEvent }) => {
      await expect(canvas.getByRole('button', { name: /BERR-42/ })).toBeVisible();
      // `?approval=` is the selection; choosing a row marks it current.
      const row = canvas.getByRole('button', { name: /BERR-70/ });
      await userEvent.click(row);
      await expect(canvas.getByRole('button', { name: /BERR-70/, hidden: true })).toHaveAttribute(
         'aria-current',
         'true'
      );
   },
};

/** The `?status=all` view: pending first, then what has been decided. */
export const All: Story = {
   decorators: [
      (Story) => (
         <NuqsTestingAdapter searchParams="?status=all">
            <Story />
         </NuqsTestingAdapter>
      ),
   ],
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('button', { name: /BERR-17/ })).toBeVisible();
   },
};

export const FirstUse: Story = {
   beforeEach: () => {
      useApprovalsStore.setState({ approvals: [], loaded: true, error: null });
   },
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('heading', { name: 'Nothing to decide yet' })).toBeVisible();
   },
};

export const Loading: Story = {
   beforeEach: () => {
      useApprovalsStore.setState({ approvals: [], loaded: false, error: null });
   },
};

export const Failed: Story = {
   beforeEach: () => {
      useApprovalsStore.setState({
         approvals: [],
         loaded: true,
         error: 'Approvals could not be loaded.',
      });
   },
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('alert')).toHaveTextContent('Approvals could not be loaded.');
   },
};
