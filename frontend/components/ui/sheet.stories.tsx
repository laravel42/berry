import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, within } from 'storybook/test';
import { Button } from './button';
import {
   Sheet,
   SheetContent,
   SheetDescription,
   SheetFooter,
   SheetHeader,
   SheetTitle,
   SheetTrigger,
} from './sheet';

type Side = 'top' | 'right' | 'bottom' | 'left';

function Example({ side = 'right', open }: { side?: Side; open?: boolean }) {
   return (
      <Sheet open={open}>
         <SheetTrigger asChild>
            <Button variant="secondary">Open details</Button>
         </SheetTrigger>
         <SheetContent side={side}>
            <SheetHeader>
               <SheetTitle>BERR-42</SheetTitle>
               <SheetDescription>Persist project health</SheetDescription>
            </SheetHeader>
            <p className="px-4 text-muted-foreground">Assigned to Backend Engineer · In review</p>
            <SheetFooter>
               <Button>Approve</Button>
            </SheetFooter>
         </SheetContent>
      </Sheet>
   );
}

const meta = {
   component: Example,
   tags: ['ai-generated', 'needs-work'],
} satisfies Meta<typeof Example>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Right: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Open details' }));
      const body = within(canvasElement.ownerDocument.body);
      const sheet = await body.findByRole('dialog', { name: 'BERR-42' });
      await expect(sheet).toHaveAttribute('data-state', 'open');
      await userEvent.keyboard('{Escape}');
      await expect(body.queryByRole('dialog')).toBeNull();
   },
};

export const Left: Story = { args: { side: 'left', open: true } };
export const Bottom: Story = { args: { side: 'bottom', open: true } };
