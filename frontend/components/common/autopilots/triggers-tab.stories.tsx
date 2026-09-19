import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, fn, within } from 'storybook/test';
import { autopilotDetail, storyHandlers } from '@/components/common/agents/stories-fixtures';
import TriggersTab, { SecretsNotice } from './triggers-tab';

const secrets = {
   token: 'whk_4d1c9e0b7a',
   signingSecret: 'whsec_8f2a61c0d94e4b7fa1c3e5d7',
   ingressPath: '/api/v1/autopilot-hooks/whk_4d1c9e0b7a',
};

const meta = {
   component: TriggersTab,
   tags: ['ai-generated', 'needs-work'],
   args: { autopilot: autopilotDetail, canEdit: true, onChanged: fn() },
   beforeEach: ({ msw }) => {
      msw.use(
         ...storyHandlers,
         http.post('*/api/v1/autopilots/:id/triggers', () =>
            HttpResponse.json({
               trigger: {
                  ...autopilotDetail.triggers[1]!,
                  id: 'trg-new',
                  enabled: true,
                  tokenHint: '9e0b',
               },
               secrets,
            })
         )
      );
   },
   decorators: [
      (Story) => (
         <div className="w-[860px]">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof TriggersTab>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A weekday schedule and a disabled webhook filtered to two events. */
export const ScheduleAndWebhook: Story = {};

export const AddWebhook: Story = {
   play: async ({ args, canvas, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Add a webhook' }));
      await userEvent.type(canvas.getByLabelText(/Only these events/), 'release.published');
      await userEvent.click(canvas.getByRole('button', { name: 'Add a webhook' }));
      // The secrets come back once, and are masked until asked for.
      await expect(
         await canvas.findByText('Copy these now — Berry will not show them again.')
      ).toBeVisible();
      await expect(canvas.getAllByDisplayValue(/^•+$/)).toHaveLength(2);
      await expect(args.onChanged).toHaveBeenCalled();
   },
};

export const AddSchedule: Story = {
   play: async ({ canvas, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Add a schedule' }));
      await expect(canvas.getByText('When it runs')).toBeVisible();
   },
};

export const ConfirmRotate: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Rotate' }));
      const body = within(canvasElement.ownerDocument.body);
      await expect(
         await body.findByRole('alertdialog', { name: 'Rotate this webhook?' })
      ).toBeVisible();
   },
};

export const NoTriggers: Story = { args: { autopilot: { ...autopilotDetail, triggers: [] } } };

export const ReadOnly: Story = {
   args: { canEdit: false },
   play: async ({ canvas }) => {
      await expect(canvas.queryByRole('button')).toBeNull();
      for (const toggle of canvas.getAllByRole('switch')) await expect(toggle).toBeDisabled();
   },
};

/** The notice on its own, as the create dialog holds it open after a webhook is made. */
export const Secrets: Story = {
   render: () => <SecretsNotice secrets={secrets} onDismiss={fn()} />,
   play: async ({ canvas, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Show' }));
      await expect(canvas.getByDisplayValue(secrets.signingSecret)).toBeVisible();
   },
};
