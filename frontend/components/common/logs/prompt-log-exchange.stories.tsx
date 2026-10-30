import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';
import type { PromptLogExchange } from '@/lib/logs';
import {
   EventStreamView,
   RequestHeadersView,
   RequestPayloadView,
   ResponseView,
} from './prompt-log-exchange';

const exchange: PromptLogExchange = {
   request: {
      method: 'POST',
      url: 'https://api.anthropic.com/v1/messages',
      headers: { 'content-type': 'application/json', 'anthropic-version': '2026-05-01' },
   },
   payload: { model: 'claude-sonnet-5', messages: [{ role: 'user', content: 'Triage BERR-44.' }] },
   response: {
      status: 200,
      headers: { 'content-type': 'application/json', 'x-request-id': 'req-9c1d' },
   },
   events: [
      { at: '2026-09-18T08:02:10Z', event: { type: 'task.started' } },
      {
         at: '2026-09-18T08:02:12Z',
         event: {
            type: 'task.model',
            response: {
               stopReason: 'end_turn',
               truncated: false,
               messages: [{ role: 'assistant', content: 'Set to high priority, no project yet.' }],
            },
         },
      },
      {
         at: '2026-09-18T08:02:13Z',
         event: { type: 'task.completed', summary: 'Triaged BERR-44 to high priority.' },
      },
   ],
};

const meta = {
   component: ResponseView,
   tags: ['ai-generated'],
   args: { exchange, kind: 'completion' },
} satisfies Meta<typeof ResponseView>;

export default meta;
type Story = StoryObj<typeof meta>;

/** What went over the wire, nothing redacted a second time: a completion's request line and headers. */
export const Headers: Story = {
   render: () => <RequestHeadersView exchange={exchange} />,
   play: async ({ canvas }) => {
      await expect(canvas.getByText('https://api.anthropic.com/v1/messages')).toBeVisible();
      await expect(canvas.getByText('200')).toBeVisible();
      await expect(canvas.getByText('2026-05-01')).toBeVisible();
   },
};

/** The exact body Berry sent the model. */
export const Payload: Story = {
   render: () => <RequestPayloadView exchange={exchange} />,
   play: async ({ canvas }) => {
      await expect(canvas.getByText(/"Triage BERR-44\."/)).toBeVisible();
   },
};

/** The runtime's own event stream, each row collapsed to its data until it is clicked open. */
export const EventStream: Story = {
   render: () => <EventStreamView exchange={exchange} />,
   play: async ({ canvas, userEvent }) => {
      await expect(canvas.getByText('task.completed')).toBeVisible();
      const row = canvas.getByText('task.started').closest('tr')!;
      await expect(row.querySelector('pre')).toBeNull();
      await userEvent.click(row);
      await expect(row.querySelector('pre')).not.toBeNull();
   },
};

/** A completion's answer: the model's own reply, and the terminal event it ended on. */
export const SucceededResponse: Story = {
   play: async ({ canvas }) => {
      await expect(
         await canvas.findByText('Set to high priority, no project yet.', { exact: false })
      ).toBeVisible();
      await expect(canvas.getByText('Body (task.completed)')).toBeVisible();
      await expect(canvas.getByText(/Triaged BERR-44 to high priority\./)).toBeVisible();
   },
};

/** The runtime never answered: the error is shown in place of headers and a reply. */
export const NoAnswer: Story = {
   args: { exchange: { ...exchange, response: { error: 'The request timed out after 30s.' } } },
   play: async ({ canvas }) => {
      await expect(await canvas.findByText('The runtime never answered')).toBeVisible();
      await expect(canvas.getByText('The request timed out after 30s.')).toBeVisible();
   },
};

/** A call made before exchanges were recorded: only its prompt and answer survive. */
export const NotRecorded: Story = {
   args: { exchange: null },
   play: async ({ canvas }) => {
      await expect(
         await canvas.findByText(
            'Not recorded. Calls made before request logging was added keep only their prompt and answer.'
         )
      ).toBeVisible();
   },
};
