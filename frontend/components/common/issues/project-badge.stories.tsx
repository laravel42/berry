import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';
import { ProjectBadge } from './project-badge';
import { healthProject, inboxProject } from './stories-fixtures';

const meta = {
   component: ProjectBadge,
   tags: ['ai-generated', 'needs-work'],
   args: { project: healthProject },
} satisfies Meta<typeof ProjectBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
   play: async ({ canvas }) => {
      // The badge is a link to the projects list, titled with the full name.
      const link = canvas.getByRole('link', { name: /project health/i });
      await expect(link).toHaveAttribute('href', expect.stringMatching(/\/projects$/));
      await expect(link).toHaveAttribute('title', 'Project health');
   },
};

export const OtherProject: Story = { args: { project: inboxProject } };

export const TruncatedInNarrowRow: Story = {
   args: {
      project: {
         ...healthProject,
         name: 'Migrate every workspace to the AgentCore runtime before the October freeze',
      },
   },
   decorators: [
      (Story) => (
         <div className="w-48">
            <Story />
         </div>
      ),
   ],
};
