import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect } from 'storybook/test';

import {
   emptyUsageErrors,
   errorEnvelope,
   seedAdminSession,
   usageHandlers,
} from './stories-fixtures';
import UsageErrors from './usage-errors';

const meta = {
   component: UsageErrors,
   tags: ['ai-generated', 'needs-work'],
   args: { query: { days: 30, timezone: 'UTC', projectId: null } },
   parameters: { nextjs: { navigation: { segments: [['orgId', 'elian']] } } },
   beforeEach: ({ msw }) => {
      seedAdminSession();
      msw.use(...usageHandlers);
   },
   decorators: [
      (Story) => (
         <div className="w-[1100px]">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof UsageErrors>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * Ranked by count the Engineer leads; ranked by rate the QA Analyst's 2 of 4
 * jumps ahead, and is starred as a low-sample rate.
 */
export const Loaded: Story = {
   play: async ({ canvas, userEvent }) => {
      await expect(await canvas.findByText('RUNTIME_TIMEOUT')).toBeVisible();
      const firstOffender = () => canvas.getAllByRole('link')[0];
      await expect(firstOffender()).toHaveTextContent('Engineer');
      await userEvent.click(canvas.getByRole('button', { name: 'By rate' }));
      await expect(firstOffender()).toHaveTextContent('QA Analyst');
      await expect(canvas.getByText(/fewer than ten runs/)).toBeVisible();
   },
};

/** The window's runs by outcome: failure band first, then secondary figures. */
export const Outcomes: Story = {
   play: async ({ canvas }) => {
      await expect(await canvas.findByText('Runs by day')).toBeVisible();
      await expect(canvas.getByRole('heading', { name: 'Failed runs' })).toBeVisible();
      for (const [label, value] of [
         ['Runs in window', '142'],
         ['Succeeded', '128'],
         ['Cancelled', '5'],
         ['Failure rate', '6%'],
      ] as const) {
         const figure = canvas.getByText(label);
         await expect(figure.nextElementSibling).toHaveTextContent(value);
      }
      // The legend names each bar and paints its swatch in that outcome's status tone.
      const heading = canvas.getByRole('heading', { name: 'Runs by day' });
      const legend = heading.parentElement!.querySelector('ul')!;
      const swatches = [...legend.querySelectorAll('li')].map((item) => [
         item.textContent,
         (item.firstElementChild as HTMLElement).style.backgroundColor,
      ]);
      await expect(swatches).toEqual([
         ['Succeeded', 'var(--status-success)'],
         ['Failed', 'var(--status-danger)'],
         ['Cancelled', 'var(--status-neutral)'],
      ]);
   },
};

export const NothingFailed: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/usage/:workspaceId/errors', () => HttpResponse.json(emptyUsageErrors))
      );
   },
   play: async ({ canvas }) => {
      await expect(await canvas.findByRole('heading', { name: 'Failed runs' })).toBeVisible();
      await expect(canvas.getAllByText('Nothing failed in this window.').length).toBeGreaterThan(0);
   },
};

export const Failed: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/usage/:workspaceId/errors', () =>
            errorEnvelope(500, 'INTERNAL', 'Failures could not be counted.')
         )
      );
   },
   play: async ({ canvas }) => {
      await expect(await canvas.findByText('Failures could not be counted.')).toBeVisible();
   },
};
