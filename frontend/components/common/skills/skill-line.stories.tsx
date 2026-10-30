import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, within } from 'storybook/test';

import { liveAgents, skills } from '../agents/stories-fixtures';
import SkillLine from './skill-line';

const meta = {
   component: SkillLine,
   tags: ['ai-generated'],
   args: {
      skill: skills[0]!,
      columns: ['agents', 'files', 'creator', 'updated'],
      agents: liveAgents,
      canEdit: true,
      selected: false,
      open: false,
      onToggleSelected: fn(),
      onOpen: fn(),
      onChanged: fn(),
      refreshing: false,
      onRefreshing: fn(),
      onConfirmDelete: fn(),
      onRestore: fn(),
   },
} satisfies Meta<typeof SkillLine>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Carried by one agent: the name and the carry count both show. */
export const Editable: Story = {
   play: async ({ args, canvas, userEvent }) => {
      await expect(canvas.getByText('design-tokens')).toBeVisible();
      await expect(canvas.getByText('1 agent')).toBeVisible();
      await userEvent.click(canvas.getByRole('checkbox', { name: 'Select design-tokens' }));
      await expect(args.onToggleSelected).toHaveBeenCalledWith('skill-design-tokens');
   },
};

/** No agent carries it: the cell says so instead of "0 agents". */
export const Unused: Story = {
   args: { skill: skills[2]! },
   play: async ({ canvas }) => {
      await expect(canvas.getByText('Unused')).toBeVisible();
   },
};

/** A viewer's row has no checkbox and no menu, just a lock explaining why. */
export const LockedForViewers: Story = {
   args: { canEdit: false },
   play: async ({ canvas }) => {
      await expect(
         canvas.getByLabelText('Your role cannot change the catalogue')
      ).toBeInTheDocument();
      await expect(canvas.queryByRole('checkbox')).toBeNull();
   },
};

/** Archived: the menu offers Restore instead of Add, Update and Archive. */
export const Archived: Story = {
   args: { skill: { ...skills[0]!, archivedAt: '2026-09-01T00:00:00Z' } },
   play: async ({ args, canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Skill actions' }));
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.click(await body.findByRole('menuitem', { name: 'Restore' }));
      await expect(args.onRestore).toHaveBeenCalledWith(
         expect.objectContaining({ id: 'skill-design-tokens' })
      );
   },
};
