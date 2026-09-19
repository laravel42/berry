import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { NuqsTestingAdapter } from 'nuqs/adapters/testing';
import { expect, within } from 'storybook/test';
import { Filter } from './filter';

const meta = {
   component: Filter,
   tags: ['ai-generated', 'needs-work'],
} satisfies Meta<typeof Filter>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ByRole: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Filter' }));
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.click(await body.findByRole('option', { name: /Role/ }));
      await userEvent.click(await body.findByRole('option', { name: 'Admin' }));
      // The count badge sits on the trigger once a role is chosen.
      await expect(canvas.getByRole('button', { name: /Filter/ })).toHaveTextContent('1');
   },
};

/** Arriving with `?role=owner&role=admin` in the URL. */
export const TwoRolesApplied: Story = {
   decorators: [
      (Story) => (
         <NuqsTestingAdapter searchParams="?role=owner,admin&sort=joined-desc">
            <Story />
         </NuqsTestingAdapter>
      ),
   ],
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('button', { name: /Filter/ })).toHaveTextContent('2');
   },
};

export const SortMenu: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Filter' }));
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.click(await body.findByRole('option', { name: /Sort by/ }));
      await expect(await body.findByRole('option', { name: /Z → A/ })).toBeVisible();
   },
};
