import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, fn } from 'storybook/test';
import { skills, storyHandlers } from '@/components/common/agents/stories-fixtures';
import SkillDetail from './skill-detail';

const meta = {
   component: SkillDetail,
   tags: ['ai-generated', 'needs-work'],
   args: { skillId: 'skill-design-tokens', canEdit: true, onChanged: fn() },
   beforeEach: ({ msw }) => {
      msw.use(...storyHandlers);
   },
   decorators: [
      (Story) => (
         <div className="flex h-[640px] w-[760px] flex-col border">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof SkillDetail>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Editing: Story = {
   play: async ({ canvas, userEvent }) => {
      // GET /api/v1/skills/:id (MSW) fills the form.
      const description = await canvas.findByDisplayValue(skills[0]!.description);
      await userEvent.type(description, ' Always.');
      // The save bar names what changed.
      await expect(await canvas.findByText(/name and description/)).toBeVisible();
   },
};

/** A member sees the instructions rendered, not an editor. */
export const ReadOnly: Story = {
   args: { canEdit: false },
   play: async ({ canvas }) => {
      await expect(await canvas.findByText('Design tokens')).toBeVisible();
      await expect(canvas.queryByRole('textbox', { name: 'Instructions' })).toBeNull();
   },
};

/** A skill with no body yet. */
export const NoInstructions: Story = {
   args: { skillId: 'skill-release-notes', canEdit: false },
};

export const Missing: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/skills/:id', () =>
            HttpResponse.json(
               { error: { code: 'NOT_FOUND', message: 'No such skill' } },
               { status: 404 }
            )
         )
      );
   },
   play: async ({ canvas }) => {
      await expect(await canvas.findByText('No such skill')).toBeVisible();
   },
};
