import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http } from 'msw';
import { expect, fn, within } from 'storybook/test';
import {
   runs,
   sseResponse,
   storyHandlers,
   succeededRunEvents,
} from '@/components/common/agents/stories-fixtures';
import { RunTranscriptDialog } from './transcript-dialog';

const meta = {
   component: RunTranscriptDialog,
   tags: ['ai-generated', 'needs-work'],
   args: {
      runId: 'run-9c1d5e77',
      open: true,
      onOpenChange: fn(),
      agentName: 'Frontend Engineer',
   },
   beforeEach: ({ msw }) => {
      msw.use(...storyHandlers);
   },
} satisfies Meta<typeof RunTranscriptDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

/** A finished run: thinking, a read, a command, an edit, and a pull request. */
export const Succeeded: Story = {
   play: async ({ canvasElement }) => {
      const body = within(canvasElement.ownerDocument.body);
      const dialog = within(await body.findByRole('dialog'));
      // The ledger is streamed from MSW and folded into steps.
      // The command is the step's title, and its input again in the code view.
      await expect((await dialog.findAllByText('pnpm lint'))[0]).toBeVisible();
      await expect(await dialog.findByText('Frontend Engineer · succeeded')).toBeVisible();
      await expect(dialog.getByText('6 files changed', { exact: false })).toBeVisible();
   },
};

/** Every row says how long it took; file tools say which file and how big, or how many. */
export const StepDetails: Story = {
   play: async ({ canvasElement }) => {
      const body = within(canvasElement.ownerDocument.body);
      const dialog = within(await body.findByRole('dialog'));
      await expect(await dialog.findByText(/· 12 files/)).toBeVisible();
      await expect(dialog.getByText(/· frontend\/app\/inbox\/page\.tsx · 4\.7 KB/)).toBeVisible();
      await expect(
         dialog.getByText(/· frontend\/components\/inbox\/inbox\.tsx · 812 B/)
      ).toBeVisible();
      // Measured by the runtime when it says so…
      await expect(dialog.getByText('0.3 s')).toBeVisible();
      // …and from the step's own timestamps when it does not: the lint ran 31 s.
      await expect(dialog.getByText('31.0 s')).toBeVisible();
   },
};

export const FilterCommands: Story = {
   play: async ({ canvasElement, userEvent }) => {
      const dialog = within(await within(canvasElement.ownerDocument.body).findByRole('dialog'));
      await dialog.findAllByText('pnpm lint');
      const commands = dialog.getByRole('button', { name: 'Commands', pressed: false });
      await userEvent.click(commands);
      await expect(commands).toHaveAttribute('aria-pressed', 'true');
      await expect(dialog.queryByText('read_file')).toBeNull();
   },
};

export const Search: Story = {
   play: async ({ canvasElement, userEvent }) => {
      const dialog = within(await within(canvasElement.ownerDocument.body).findByRole('dialog'));
      await dialog.findAllByText('pnpm lint');
      await userEvent.type(
         dialog.getByRole('textbox', { name: 'Search the transcript' }),
         'eslint'
      );
      await expect(dialog.getByText('1 of 1')).toBeVisible();
   },
};

/** A run that failed on a test command; the failure code heads the dialog. */
export const Failed: Story = {
   args: { runId: 'run-4e6f0a18', agentName: 'Orchestrator' },
   play: async ({ canvasElement }) => {
      const dialog = within(await within(canvasElement.ownerDocument.body).findByRole('dialog'));
      await expect(
         await dialog.findByText(`RUNTIME_TIMEOUT: ${runs[2]!.failure!.message}`)
      ).toBeVisible();
   },
};

/** Still running: the stream stays open and nothing has settled yet. */
export const Running: Story = {
   args: { runId: 'run-7f3a91c2' },
   beforeEach: ({ msw }) => {
      msw.use(
         http.get('*/api/v1/runs/:id/events', () =>
            sseResponse(succeededRunEvents('run-7f3a91c2').slice(0, 7))
         )
      );
   },
};

export const Empty: Story = {
   beforeEach: ({ msw }) => {
      msw.use(http.get('*/api/v1/runs/:id/events', () => sseResponse([])));
   },
};
