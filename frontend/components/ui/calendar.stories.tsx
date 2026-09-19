import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useState } from 'react';
import type { DateRange } from 'react-day-picker';
import { expect, fn } from 'storybook/test';
import { Calendar } from './calendar';

const onSelect = fn();

const meta = {
   component: Calendar,
   tags: ['ai-generated', 'needs-work'],
} satisfies Meta<typeof Calendar>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A due date picker; the preview pins "today" to 2026-09-18. */
export const Single: Story = {
   render: function Render() {
      const [selected, setSelected] = useState<Date | undefined>(new Date('2026-09-18T12:00:00Z'));
      return (
         <Calendar
            mode="single"
            selected={selected}
            onSelect={(date) => {
               setSelected(date);
               onSelect(date);
            }}
            className="w-fit rounded-md border"
         />
      );
   },
   play: async ({ canvas, userEvent }) => {
      onSelect.mockClear();
      await expect(canvas.getByText('September 2026')).toBeVisible();
      await userEvent.click(canvas.getByText('24'));
      await expect(onSelect).toHaveBeenCalledTimes(1);
      const picked = onSelect.mock.calls[0]?.[0] as Date;
      await expect(picked.getDate()).toBe(24);
   },
};

/** The "is between" date filter. */
export const Range: Story = {
   render: function Render() {
      const [range, setRange] = useState<DateRange | undefined>({
         from: new Date('2026-09-08T12:00:00Z'),
         to: new Date('2026-09-18T12:00:00Z'),
      });
      return (
         <Calendar
            mode="range"
            numberOfMonths={2}
            selected={range}
            onSelect={setRange}
            className="w-fit rounded-md border"
         />
      );
   },
};

export const WithDisabledPast: Story = {
   render: () => (
      <Calendar
         mode="single"
         disabled={{ before: new Date('2026-09-18T00:00:00Z') }}
         className="w-fit rounded-md border"
      />
   ),
};
