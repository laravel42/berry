import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';
import { LabelBadge } from './label-badge';

const meta = {
   component: LabelBadge,
   tags: ['ai-generated'],
   args: {
      label: [
         { id: 'l1', name: 'Bug', color: '#e5484d' },
         { id: 'l2', name: 'Frontend', color: '#3e63dd' },
      ],
   },
   decorators: [
      (Story) => (
         <div className="flex gap-1.5">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof LabelBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Several: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.getByText('Bug')).toBeInTheDocument();
      await expect(canvas.getByText('Frontend')).toBeInTheDocument();
   },
};

export const Single: Story = {
   args: { label: [{ id: 'l3', name: 'Security', color: '#f5a524' }] },
};
