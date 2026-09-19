import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
import { Button } from './button';
import { Tooltip, TooltipContent, TooltipTrigger } from './tooltip';

const meta = {
   component: Tooltip,
   tags: ['ai-generated', 'needs-work'],
   render: (args) => (
      <div className="flex h-32 items-center justify-center">
         <Tooltip {...args}>
            <TooltipTrigger asChild>
               <Button size="xs" variant="secondary">
                  BERR-42
               </Button>
            </TooltipTrigger>
            <TooltipContent>Persist project health</TooltipContent>
         </Tooltip>
      </div>
   ),
} satisfies Meta<typeof Tooltip>;

export default meta;
type Story = StoryObj<typeof meta>;

export const OnHover: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.hover(canvas.getByRole('button', { name: 'BERR-42' }));
      // Content portals to the body; Radix also renders an sr-only copy with role=tooltip.
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByRole('tooltip')).toHaveTextContent('Persist project health');
   },
};

export const Open: Story = { args: { open: true } };
