import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useState } from 'react';
import { expect, fn, within } from 'storybook/test';
import { projectCreateStatusOptions } from '@/components/common/projects/create-project/project-status-options';
import { status as allStatus, type Status } from '@/data/status';
import { ISSUE_STATUS_OPTIONS, StatusPicker } from './status-picker';

const issueStatus = (id: string): Status => allStatus.find((entry) => entry.id === id)!;
const projectStatus = (id: string): Status =>
   projectCreateStatusOptions.find((option) => option.status.id === id)!.status;

const meta = {
   component: StatusPicker,
   args: {
      status: issueStatus('in-progress'),
      options: ISSUE_STATUS_OPTIONS,
      onChange: fn(),
      variant: 'icon',
   },
   render: function Render(args) {
      const [value, setValue] = useState(args.status);
      return (
         <StatusPicker
            {...args}
            status={value}
            onChange={(next) => {
               setValue(next);
               args.onChange(next);
            }}
         />
      );
   },
} satisfies Meta<typeof StatusPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const IssueIcon: Story = {
   play: async ({ canvas }) => {
      await expect(
         canvas.getByRole('combobox', { name: 'Change status, current In Progress' })
      ).toHaveAttribute('aria-expanded', 'false');
   },
};

export const IssueChipWithCounts: Story = {
   args: {
      variant: 'chip',
      status: issueStatus('to-do'),
      countFor: (id: string) => (id === 'in-review' ? 1 : 0),
   },
   play: async ({ args, canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('combobox'));
      const body = within(canvasElement.ownerDocument.body);
      const inReview = await body.findByRole('option', { name: /In Review/ });
      await expect(inReview).toHaveTextContent('1');
      await userEvent.click(inReview);
      await expect(args.onChange).toHaveBeenCalledWith(issueStatus('in-review'));
      await expect(canvas.getByRole('combobox')).toHaveTextContent('In Review');
   },
};

/** A project speaks its own words: the chip reads "Planned" for Todo. */
export const ProjectChipPlanned: Story = {
   args: {
      variant: 'chip',
      options: projectCreateStatusOptions,
      status: projectStatus('to-do'),
   },
   play: async ({ args, canvas, canvasElement, userEvent }) => {
      await expect(canvas.getByRole('combobox')).toHaveTextContent('Planned');
      await userEvent.click(canvas.getByRole('combobox'));
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.click(await body.findByRole('option', { name: /Active/ }));
      await expect(args.onChange).toHaveBeenCalledWith(
         expect.objectContaining({ id: 'in-progress' })
      );
      await expect(canvas.getByRole('combobox')).toHaveTextContent('Active');
   },
};

/**
 * The project detail sidebar: an icon named by the status's own name (which
 * the panel prints beside it), a menu in project words.
 */
export const ProjectIcon: Story = {
   args: { options: projectCreateStatusOptions, status: projectStatus('in-progress') },
   play: async ({ args, canvas, canvasElement, userEvent }) => {
      await userEvent.click(
         canvas.getByRole('combobox', { name: 'Change status, current In Progress' })
      );
      const body = within(canvasElement.ownerDocument.body);
      await expect(body.queryByRole('option', { name: /In Review/ })).not.toBeInTheDocument();
      await userEvent.click(await body.findByRole('option', { name: /Completed/ }));
      await expect(args.onChange).toHaveBeenCalledWith(expect.objectContaining({ id: 'done' }));
   },
};

export const ProjectPaused: Story = {
   args: { options: projectCreateStatusOptions, status: projectStatus('paused') },
};
