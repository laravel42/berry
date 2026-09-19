import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, waitFor } from 'storybook/test';
import { useIssuesStore } from '@/store/issues-store';
import { AutoGateProperty } from './auto-gate-property';
import { issueApiHandlers, persistHealth, seedIssuesWorkspace } from '../stories-fixtures';

const sent: unknown[] = [];

const meta = {
   component: AutoGateProperty,
   tags: ['ai-generated'],
   args: { issue: { ...persistHealth, autoGate: false } },
   decorators: [
      (Story) => (
         <div className="w-[260px]">
            <Story />
         </div>
      ),
   ],
   beforeEach: ({ msw }) => {
      sent.length = 0;
      seedIssuesWorkspace();
      msw.use(...issueApiHandlers);
   },
} satisfies Meta<typeof AutoGateProperty>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Off by default: the task waits for a person. The control saves at once. */
export const TurnOn: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.patch('*/api/v1/issues/:ref', async ({ request }) => {
            sent.push(await request.json());
            return HttpResponse.json({});
         })
      );
   },
   play: async ({ canvas, userEvent }) => {
      const control = canvas.getByRole('button', { name: 'AutoGate' });
      await expect(control).toHaveAttribute('aria-pressed', 'false');
      await userEvent.click(control);
      await waitFor(() => expect(sent).toEqual([{ autoGate: true }]));
   },
};

/** A refused save puts the control back, so it never claims a state the task is not in. */
export const RefusedSaveReverts: Story = {
   args: { issue: { ...persistHealth, autoGate: true } },
   beforeEach: ({ msw }) => {
      useIssuesStore.getState().updateIssue(persistHealth.id, { autoGate: true });
      msw.use(
         http.patch('*/api/v1/issues/:ref', () =>
            HttpResponse.json({ error: { code: 'FORBIDDEN', message: 'No.' } }, { status: 403 })
         )
      );
   },
   play: async ({ args, userEvent, canvas }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'AutoGate' }));
      await waitFor(() =>
         expect(
            useIssuesStore.getState().issues.find((issue) => issue.id === args.issue.id)?.autoGate
         ).toBe(true)
      );
   },
};
