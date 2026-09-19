import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, within } from 'storybook/test';
import { liveAgents, skills } from '@/components/common/agents/stories-fixtures';
import { useSkillsCatalogueStore } from '@/store/skills-catalogue-store';
import SkillsList from './skills-list';
import { DEFAULT_CRITERIA } from './skills-filters';

const meta = {
   component: SkillsList,
   tags: ['ai-generated', 'needs-work'],
   args: {
      skills,
      error: null,
      criteria: DEFAULT_CRITERIA,
      agents: liveAgents,
      canEdit: true,
      openId: null,
      onOpen: fn(),
      onChanged: fn(),
      narrowed: false,
   },
   beforeEach: () => {
      useSkillsCatalogueStore.setState({ orderedIds: [] });
   },
   decorators: [
      (Story) => (
         <div className="flex h-[520px] w-[1100px] flex-col border">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof SkillsList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Catalogue: Story = {
   play: async ({ args, canvas, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: /^sql-review/ }));
      await expect(args.onOpen).toHaveBeenCalledWith('skill-sql-review');
      // The rows it shows become the order the detail header steps through.
      await expect(useSkillsCatalogueStore.getState().orderedIds[0]).toBe(
         'skill-conventional-commits'
      );
   },
};

/** Every column on, sorted by how many agents carry each skill, one row open. */
export const AllColumns: Story = {
   args: {
      criteria: { sort: 'usage', columns: ['labels', 'agents', 'files', 'creator', 'updated'] },
      openId: 'skill-design-tokens',
   },
};

export const Selection: Story = {
   play: async ({ canvas, userEvent }) => {
      await userEvent.click(canvas.getByRole('checkbox', { name: 'Select design-tokens' }));
      await userEvent.click(canvas.getByRole('checkbox', { name: 'Select release-notes' }));
      // The bulk bar appears with the selection.
      await expect(canvas.getByText('2 selected')).toBeVisible();
   },
};

export const RowMenu: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      const [firstMenu] = canvas.getAllByRole('button', { name: 'Skill actions' });
      await userEvent.click(firstMenu!);
      const body = within(canvasElement.ownerDocument.body);
      // Only a GitHub import can be updated from its source; the first row is one.
      await expect(
         await body.findByRole('menuitem', { name: 'Update from source' })
      ).not.toHaveAttribute('aria-disabled');
   },
};

/** A member reads the catalogue: no checkboxes, a lock instead of a menu. */
export const ReadOnly: Story = {
   args: { canEdit: false },
   play: async ({ canvas }) => {
      await expect(canvas.queryByRole('checkbox')).toBeNull();
      await expect(canvas.getAllByLabelText('Your role cannot change the catalogue')).toHaveLength(
         4
      );
   },
};

export const Loading: Story = { args: { skills: null } };

export const NoMatch: Story = { args: { skills: [], narrowed: true } };

export const Empty: Story = {
   args: { skills: [] },
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('heading', { name: 'No skills yet.' })).toBeVisible();
      await expect(canvas.queryByRole('button', { name: 'Create a skill' })).toBeNull();
   },
};

export const LoadFailed: Story = { args: { error: 'The skills catalogue could not be loaded.' } };
