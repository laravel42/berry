import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, within } from 'storybook/test';
import { liveAgents, skills, storyHandlers } from '@/components/common/agents/stories-fixtures';
import SkillBulkBar from './skill-bulk-bar';

const meta = {
   component: SkillBulkBar,
   tags: ['ai-generated', 'needs-work'],
   args: {
      selected: skills.slice(0, 2),
      agents: liveAgents,
      onClear: fn(),
      onChanged: fn(),
   },
   beforeEach: ({ msw }) => {
      msw.use(...storyHandlers);
   },
   decorators: [
      (Story) => (
         <div className="w-[900px] border">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof SkillBulkBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const TwoSelected: Story = {
   play: async ({ args, canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Add to agents' }));
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.click(await body.findByText('release-notes'));
      // One PUT per skill (MSW), then the tally and a re-read.
      await expect(await body.findByText('2 skills added to release-notes')).toBeVisible();
      await expect(args.onClear).toHaveBeenCalled();
      await expect(args.onChanged).toHaveBeenCalled();
   },
};

/** No GitHub import in the selection, so there is nothing to update from source. */
export const NothingToUpdate: Story = {
   args: { selected: [skills[0]!, skills[2]!] },
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('button', { name: 'Update from source' })).toBeDisabled();
   },
};

export const ConfirmDelete: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Delete' }));
      const body = within(canvasElement.ownerDocument.body);
      await expect(
         await body.findByRole('alertdialog', { name: '2 skills will be deleted' })
      ).toBeVisible();
   },
};

/** With nothing selected the bar is not there at all. */
export const NoneSelected: Story = {
   args: { selected: [] },
   play: async ({ canvasElement }) => {
      await expect(within(canvasElement).queryByRole('button')).toBeNull();
   },
};
