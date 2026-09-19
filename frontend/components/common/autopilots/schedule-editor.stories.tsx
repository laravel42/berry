import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useState } from 'react';
import { expect } from 'storybook/test';
import { storyHandlers } from '@/components/common/agents/stories-fixtures';
import ScheduleEditor from './schedule-editor';

/** The editor never changes the expression itself; the dialog holds it. */
function Controlled({ expression, timezone }: { expression: string; timezone: string }) {
   const [value, setValue] = useState({ expression, timezone });
   return (
      <div className="flex w-[560px] flex-col gap-3">
         <ScheduleEditor
            expression={value.expression}
            timezone={value.timezone}
            onChange={setValue}
         />
         <code data-testid="expression">{value.expression}</code>
      </div>
   );
}

const meta = {
   component: Controlled,
   tags: ['ai-generated', 'needs-work'],
   args: { expression: '0 9 * * 1-5', timezone: 'Europe/Rome' },
   beforeEach: ({ msw }) => {
      msw.use(...storyHandlers);
   },
} satisfies Meta<typeof Controlled>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Weekdays at nine, with the next firings previewed by the server. */
export const WeekdayMornings: Story = {
   play: async ({ canvas }) => {
      // GET /api/v1/autopilots/cron-preview answers after a short debounce (MSW).
      await expect(await canvas.findByText('in 67 h 0 min')).toBeVisible();
   },
};

/**
 * Weekdays written as a list, which the visual controls can draw. The range
 * form `1-5` (the dialog's own default) locks them: see `readDays` in
 * lib/cron-schedule.ts.
 */
export const SwitchToHourly: Story = {
   args: { expression: '0 9 * * 1,2,3,4,5' },
   play: async ({ canvas, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Every few hours' }));
      await expect(canvas.getByTestId('expression')).not.toHaveTextContent('0 9 * * 1,2,3,4,5');
      await expect(
         canvas.getByRole('switch', { name: 'Only between certain hours' })
      ).toBeVisible();
   },
};

export const EveryFifteenMinutesInHours: Story = {
   args: { expression: '*/15 9-17 * * *', timezone: 'UTC' },
};

export const MonthlyOnTheFirst: Story = {
   args: { expression: '30 6 1 * *', timezone: 'America/New_York' },
};

/** An expression the controls cannot draw locks them into raw cron. */
export const RawOnly: Story = {
   args: { expression: '0 9,13 * 1-6 1-5', timezone: 'UTC' },
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('status')).toHaveTextContent(/edited as cron/);
      await expect(canvas.getByRole('switch', { name: 'Write the cron' })).toBeDisabled();
   },
};
