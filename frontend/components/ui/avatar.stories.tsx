import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';
import { Avatar, AvatarFallback, AvatarImage } from './avatar';

const meta = {
   component: Avatar,
   tags: ['ai-generated', 'needs-work'],
} satisfies Meta<typeof Avatar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Initials: Story = {
   render: (args) => (
      <Avatar {...args}>
         <AvatarFallback>AL</AvatarFallback>
      </Avatar>
   ),
   play: async ({ canvas }) => {
      await expect(canvas.getByText('AL')).toBeVisible();
   },
};

export const BrokenImageFallsBack: Story = {
   render: (args) => (
      <Avatar {...args}>
         <AvatarImage src="/does-not-exist.png" alt="Andrea Lunelio" />
         <AvatarFallback>AL</AvatarFallback>
      </Avatar>
   ),
   play: async ({ canvas }) => {
      // Radix only swaps in the fallback once the image has failed to load.
      await expect(await canvas.findByText('AL')).toBeVisible();
      await expect(canvas.queryByRole('img')).toBeNull();
   },
};

/** The size the list filters draw a member at. */
export const Tiny: Story = {
   render: (args) => (
      <Avatar {...args} className="size-4">
         <AvatarFallback>A</AvatarFallback>
      </Avatar>
   ),
};

export const Stack: Story = {
   render: () => (
      <div className="flex -space-x-2">
         {['AL', 'MR', 'JK'].map((initials) => (
            <Avatar key={initials} className="border-2 border-background">
               <AvatarFallback>{initials}</AvatarFallback>
            </Avatar>
         ))}
      </div>
   ),
};
