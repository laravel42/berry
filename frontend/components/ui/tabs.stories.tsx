import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs';

const meta = {
   component: Tabs,
   tags: ['ai-generated', 'needs-work'],
   args: { defaultValue: 'overview' },
   render: (args) => (
      <Tabs {...args} className="w-[420px]">
         <TabsList>
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="activity">Activity</TabsTrigger>
            <TabsTrigger value="runs" disabled>
               Runs
            </TabsTrigger>
         </TabsList>
         <TabsContent value="overview">
            Three of five tasks are done; the migration is in review.
         </TabsContent>
         <TabsContent value="activity">Backend Engineer opened a pull request.</TabsContent>
         <TabsContent value="runs">No runs yet.</TabsContent>
      </Tabs>
   ),
} satisfies Meta<typeof Tabs>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Overview: Story = {
   play: async ({ canvas, userEvent }) => {
      await userEvent.click(canvas.getByRole('tab', { name: 'Activity' }));
      await expect(canvas.getByRole('tab', { name: 'Activity' })).toHaveAttribute(
         'aria-selected',
         'true'
      );
      await expect(canvas.getByRole('tabpanel')).toHaveTextContent('opened a pull request');
   },
};

export const ActivitySelected: Story = { args: { defaultValue: 'activity' } };

export const DisabledTab: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('tab', { name: 'Runs' })).toBeDisabled();
   },
};
