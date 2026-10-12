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
      // Labels are accordions. sql-review sits under backend and database.
      await expect(canvas.getByRole('button', { name: /backend\s*1/ })).toBeVisible();
      await userEvent.click(canvas.getAllByRole('button', { name: /^sql-review/ })[0]!);
      await expect(args.onOpen).toHaveBeenCalledWith('skill-sql-review');
      // First group is backend, so the detail header starts on that skill.
      await expect(useSkillsCatalogueStore.getState().orderedIds).toEqual([
         'skill-sql-review',
         'skill-design-tokens',
         'skill-release-notes',
         'skill-conventional-commits',
      ]);
   },
};

/** Closing a label hides its rows and leaves the header, the way a task group does. */
export const LabelAccordion: Story = {
   play: async ({ canvas, userEvent }) => {
      await expect(canvas.getAllByRole('button', { name: /^conventional-commits/ })).toHaveLength(
         1
      );
      await userEvent.click(canvas.getByRole('button', { name: /git\s*1/ }));
      await expect(canvas.queryByRole('button', { name: /^conventional-commits/ })).toBeNull();
      await expect(canvas.getByRole('button', { name: /git\s*1/ })).toBeVisible();
   },
};

/** Every column on, sorted by how many agents carry each skill, one row open. */
export const AllColumns: Story = {
   args: {
      criteria: { sort: 'usage', columns: ['agents', 'files', 'creator', 'updated'] },
      openId: 'skill-design-tokens',
   },
};

export const Selection: Story = {
   play: async ({ canvas, userEvent }) => {
      // design-tokens is listed under both of its labels; either checkbox selects it once.
      await userEvent.click(canvas.getAllByRole('checkbox', { name: 'Select design-tokens' })[0]!);
      await userEvent.click(canvas.getByRole('checkbox', { name: 'Select release-notes' }));
      // The bulk bar appears with the selection.
      await expect(canvas.getByText('2 selected')).toBeVisible();
   },
};

export const RowMenu: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      const name = canvas.getByRole('button', { name: /^conventional-commits/ });
      const row = name.parentElement;
      if (!row) throw new Error('missing skill row');
      await userEvent.click(within(row).getByRole('button', { name: 'Skill actions' }));
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
      // Four skills, two of them listed under a second label.
      await expect(canvas.getAllByLabelText('Your role cannot change the catalogue')).toHaveLength(
         6
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
