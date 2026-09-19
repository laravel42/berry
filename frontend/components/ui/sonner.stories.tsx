import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { toast } from 'sonner';
import { expect, within } from 'storybook/test';
import { Button } from './button';
import { Toaster } from './sonner';

/**
 * The preview already mounts the app's <Toaster/>, so these stories only
 * raise toasts into it; rendering a second one would show every toast twice.
 */
const meta = {
   component: Toaster,
   tags: ['ai-generated', 'needs-work'],
   render: () => (
      <div className="flex gap-2">
         <Button size="xs" onClick={() => toast('Started')}>
            Plain
         </Button>
         <Button
            size="xs"
            variant="secondary"
            onClick={() =>
               toast.success('Task moved', { description: 'BERR-42 is now in review.' })
            }
         >
            With description
         </Button>
         <Button
            size="xs"
            variant="outline"
            onClick={() =>
               toast('Task deleted', { action: { label: 'Undo', onClick: () => undefined } })
            }
         >
            With action
         </Button>
      </div>
   ),
} satisfies Meta<typeof Toaster>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Plain: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Plain' }));
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByText('Started')).toBeVisible();
   },
};

export const WithDescription: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'With description' }));
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByText('BERR-42 is now in review.')).toBeVisible();
   },
};

export const WithAction: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'With action' }));
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByRole('button', { name: 'Undo' })).toBeVisible();
   },
};
