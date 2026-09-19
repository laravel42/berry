import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, within } from 'storybook/test';
import { DatePicker } from './date-picker';

const meta = {
   component: DatePicker,
   tags: ['ai-generated', 'needs-work'],
   args: { date: new Date('2026-10-30T00:00:00Z'), onDateChange: fn() },
   decorators: [
      (Story) => (
         // The label only shows from xl up, as in the projects list column.
         <div className="w-[110px]">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof DatePicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithDate: Story = {};

export const NoDate: Story = { args: { date: undefined } };

export const PickADay: Story = {
   args: { date: new Date('2026-09-18T00:00:00Z') },
   play: async ({ args, canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button'));
      const body = within(canvasElement.ownerDocument.body);
      const grid = await body.findByRole('grid');
      await userEvent.click(within(grid).getByText('25'));
      await expect(args.onDateChange).toHaveBeenCalledTimes(1);
      await expect(body.queryByRole('grid')).not.toBeInTheDocument();
   },
};
