import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Separator } from './separator';

const meta = {
   component: Separator,
   tags: ['ai-generated', 'needs-work'],
} satisfies Meta<typeof Separator>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Horizontal: Story = {
   render: (args) => (
      <div className="w-[320px]">
         <p>Activity</p>
         <Separator {...args} className="my-2" />
         <p className="text-muted-foreground">Backend Engineer moved BERR-42 to In review</p>
      </div>
   ),
};

export const Vertical: Story = {
   args: { orientation: 'vertical' },
   render: (args) => (
      <div className="flex h-6 items-center gap-2">
         <span>Status</span>
         <Separator {...args} />
         <span className="text-muted-foreground">is</span>
         <Separator {...args} />
         <span>In progress</span>
      </div>
   ),
};
