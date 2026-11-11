import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';
import { SplitIndex } from './split-index';

/**
 * The Inbox layout: a rail and a detail pane. `useSelectFirst` is not storied
 * here — it has no DOM of its own, only a `select` side effect driven by the
 * URL and a media query, and it is already exercised through every caller
 * that uses it (`PlansList`, the inbox, reviews).
 */
const meta = {
   component: SplitIndex,
   tags: ['ai-generated'],
   args: {
      rail: <div>Rail content</div>,
      detail: <div>Detail content</div>,
   },
} satisfies Meta<typeof SplitIndex>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * At `lg` and above both panes show regardless of `selected`; the toggle only
 * matters below it, where `selected` picks which pane is not `hidden`. The
 * test viewport is desktop-sized, so the classes are asserted directly rather
 * than through visibility.
 */
export const NothingSelected: Story = {
   args: { selected: false },
   play: async ({ canvas }) => {
      const railWrapper = canvas.getByText('Rail content').parentElement;
      const detailWrapper = canvas.getByText('Detail content').parentElement;
      await expect(railWrapper).toHaveClass('flex');
      await expect(railWrapper).not.toHaveClass('hidden');
      await expect(detailWrapper).toHaveClass('hidden');
   },
};

/** `selected: true` swaps which pane is hidden below `lg`: the rail folds, the detail shows. */
export const Selected: Story = {
   args: { selected: true },
   play: async ({ canvas }) => {
      const railWrapper = canvas.getByText('Rail content').parentElement;
      const detailWrapper = canvas.getByText('Detail content').parentElement;
      await expect(railWrapper).toHaveClass('hidden');
      await expect(detailWrapper).toHaveClass('flex');
      await expect(detailWrapper).not.toHaveClass('hidden');
   },
};
