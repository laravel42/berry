import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Button } from './button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from './card';

const meta = {
   component: Card,
   tags: ['ai-generated', 'needs-work'],
   decorators: [
      (Story) => (
         <div className="w-[380px]">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof Card>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Full: Story = {
   render: (args) => (
      <Card {...args}>
         <CardHeader>
            <CardTitle>Persist project health</CardTitle>
            <CardDescription>
               The health chip has only ever lived in the browser. This adds a column and a
               migration.
            </CardDescription>
         </CardHeader>
         <CardContent>
            <p className="text-muted-foreground">3 of 5 tasks done · updated 2 hours ago</p>
         </CardContent>
         <CardFooter className="gap-2">
            <Button size="xs" variant="secondary">
               Open project
            </Button>
            <Button size="xs">Post update</Button>
         </CardFooter>
      </Card>
   ),
};

export const HeaderOnly: Story = {
   render: (args) => (
      <Card {...args}>
         <CardHeader>
            <CardTitle>No runtime yet</CardTitle>
            <CardDescription>Agents cannot run until one is added in Settings.</CardDescription>
         </CardHeader>
      </Card>
   ),
};
