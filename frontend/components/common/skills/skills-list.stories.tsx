import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn } from 'storybook/test';
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
      criteria: { sort: 'usage', columns: ['agents', 'creator', 'updated'] },
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

/** A member reads the catalogue: no checkboxes or row menus. */
export const ReadOnly: Story = {
   args: { canEdit: false },
   play: async ({ canvas }) => {
      await expect(canvas.queryByRole('checkbox')).toBeNull();
      await expect(canvas.queryByRole('button', { name: 'Skill actions' })).toBeNull();
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
