import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { http, HttpResponse } from 'msw';
import { expect, within } from 'storybook/test';
import { IssueAttachments } from './issue-attachments';
import {
   attachment,
   attachmentDownloadHandler,
   backendAgent,
   emptyPage,
   maya,
} from '../stories-fixtures';

const files = [
   attachment('att-health-before', 'health-chip-before.png', 'image/png', 184_220),
   attachment('att-spec', 'health-api-spec.pdf', 'application/pdf', 2_480_113, maya),
   attachment('att-log', 'migration-061.log', 'text/plain', 4_210, backendAgent),
];

const list = (nodes: typeof files) =>
   http.get('*/api/v1/issues/:ref/attachments', () =>
      HttpResponse.json({ nodes, pageInfo: emptyPage })
   );

const meta = {
   component: IssueAttachments,
   tags: ['ai-generated', 'needs-work'],
   args: { issueRef: 'BERR-42' },
   decorators: [
      (Story) => (
         <div className="w-[720px]">
            <Story />
         </div>
      ),
   ],
   beforeEach: ({ msw }) => {
      msw.use(list(files), attachmentDownloadHandler);
   },
} satisfies Meta<typeof IssueAttachments>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ThreeFiles: Story = {
   play: async ({ canvas }) => {
      await expect(await canvas.findByText('Files (3)')).toBeInTheDocument();
      await expect(canvas.getByText('2.4 MB')).toBeInTheDocument();
      // An agent's file says it was produced, not uploaded.
      await expect(canvas.getByTitle('Produced by Backend Engineer')).toBeInTheDocument();
   },
};

export const NoFiles: Story = {
   beforeEach: ({ msw }) => {
      msw.use(list([]));
   },
   play: async ({ canvas }) => {
      await expect(await canvas.findByText('No files yet.')).toBeInTheDocument();
   },
};

export const OpenPreview: Story = {
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(await canvas.findByRole('button', { name: 'health-chip-before.png' }));
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByRole('dialog')).toBeVisible();
   },
};

export const UploadFails: Story = {
   beforeEach: ({ msw }) => {
      msw.use(
         http.post('*/api/v1/issues/:ref/attachments', () =>
            HttpResponse.json(
               {
                  error: {
                     code: 'FILE_TOO_LARGE',
                     message: 'The file is larger than 25 MB.',
                     details: null,
                  },
               },
               { status: 413 }
            )
         )
      );
   },
   play: async ({ canvas, canvasElement, userEvent }) => {
      await canvas.findByText('Files (3)');
      const picker = canvasElement.querySelector<HTMLInputElement>('input[type="file"]')!;
      await userEvent.upload(picker, new File(['x'], 'recording.mov', { type: 'video/quicktime' }));
      await expect(await canvas.findByText('The file is larger than 25 MB.')).toBeInTheDocument();
   },
};
