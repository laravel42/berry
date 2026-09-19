import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';
import { useSessionStore } from '@/store/session-store';
import { uiViews, viewHandlers, viewSession } from './view-fixtures';
import { ViewFacets } from './view-facets';

const meta = {
   component: ViewFacets,
   tags: ['ai-generated', 'needs-work'],
   args: { view: uiViews[0]! },
   beforeEach: ({ msw }) => {
      useSessionStore.setState(viewSession);
      msw.use(...viewHandlers);
   },
} satisfies Meta<typeof ViewFacets>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Counts come from the server over the whole workspace, not from what the board holds. */
export const InReview: Story = {
   play: async ({ canvas }) => {
      await expect(await canvas.findByText('2 tasks')).toBeVisible();
      await expect(canvas.getByText('inReview 2')).toBeVisible();
   },
};

/** No workspace yet: nothing is asked and nothing renders. */
export const NoWorkspace: Story = {
   beforeEach: () => {
      useSessionStore.setState({ workspace: null });
   },
   play: async ({ canvas }) => {
      await expect(canvas.queryByText(/tasks/)).toBeNull();
   },
};
