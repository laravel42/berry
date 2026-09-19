import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { AlertTriangle } from 'lucide-react';
import { expect, fn } from 'storybook/test';
import { Button } from '@/components/ui/button';
import {
   EmptyState,
   EmptyStateActions,
   EmptyStateLoading,
   EmptyStateMark,
   EmptyStateText,
   EmptyStateTitle,
} from './empty-state';

const meta = {
   component: EmptyState,
   args: { icon: <EmptyStateMark label="No projects" />, children: null },
} satisfies Meta<typeof EmptyState>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A page with nothing in it yet: display title, one line, one primary action. */
export const Page: Story = {
   args: {
      children: (
         <>
            <EmptyStateTitle>No projects yet</EmptyStateTitle>
            <EmptyStateText>Projects group tasks toward one outcome.</EmptyStateText>
            <EmptyStateActions>
               <Button className="h-10 px-5">Create project</Button>
            </EmptyStateActions>
         </>
      ),
   },
   play: async ({ canvas }) => {
      const title = canvas.getByRole('heading', { level: 2, name: 'No projects yet' });
      await expect(title).toHaveClass('font-display', 'mt-5');
      await expect(canvas.getByRole('img', { name: 'No projects' })).toBeVisible();
      // 8px from a title to its text.
      await expect(
         getComputedStyle(canvas.getByText('Projects group tasks toward one outcome.')).marginTop
      ).toBe('8px');
   },
};

/** Inside a list: the plain h2 scale, and a second line that stacks tight. */
export const InList: Story = {
   args: {
      icon: <EmptyStateMark label="Empty queue" />,
      children: (
         <>
            <EmptyStateTitle variant="plain">Nothing in the queue</EmptyStateTitle>
            <EmptyStateText>Tasks you create land here.</EmptyStateText>
            <EmptyStateText>Hand one to an agent to start.</EmptyStateText>
         </>
      ),
   },
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('heading', { name: 'Nothing in the queue' })).not.toHaveClass(
         'font-display'
      );
      // 4px between lines of text.
      await expect(
         getComputedStyle(canvas.getByText('Hand one to an agent to start.')).marginTop
      ).toBe('4px');
   },
};

/** No title: the text sits a full step under the glyph. */
export const NoMatches: Story = {
   args: {
      icon: <EmptyStateMark label="No matches" />,
      children: (
         <>
            <EmptyStateText>No tasks match these filters.</EmptyStateText>
            <EmptyStateActions>
               <Button variant="secondary" onClick={fn()}>
                  Clear filters
               </Button>
            </EmptyStateActions>
         </>
      ),
   },
   play: async ({ canvas }) => {
      await expect(canvas.queryByRole('heading')).toBeNull();
      // 20px from the glyph.
      await expect(
         getComputedStyle(canvas.getByText('No tasks match these filters.')).marginTop
      ).toBe('20px');
   },
};

/** First paint of a list section: the same mark + line Logs uses. */
export const Loading: Story = {
   render: () => <EmptyStateLoading label="Loading logs…" />,
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('img', { name: 'Loading logs…' })).toBeVisible();
      await expect(canvas.getByText('Loading logs…')).toBeVisible();
   },
};

/** A failed load swaps the mark for a warning glyph and offers a retry. */
export const Failed: Story = {
   args: {
      icon: <AlertTriangle className="size-5 text-status-warning" />,
      children: (
         <>
            <EmptyStateText>The list could not be loaded.</EmptyStateText>
            <EmptyStateActions>
               <Button variant="secondary">Retry</Button>
            </EmptyStateActions>
         </>
      ),
   },
   play: async ({ canvas, userEvent }) => {
      const retry = canvas.getByRole('button', { name: 'Retry' });
      await userEvent.tab();
      await expect(retry).toHaveFocus();
   },
};
