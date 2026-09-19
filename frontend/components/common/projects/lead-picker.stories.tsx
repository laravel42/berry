import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useState } from 'react';
import { expect, fn, within } from 'storybook/test';
import { PickerChipButton } from '@/components/common/pickers/option-picker';
import type { User } from '@/data/users';
import { andrea, frontendAgent, maya, storyMembers, tomas } from './stories-fixtures';
import { LeadAvatarButton, LeadPicker, leadCandidates } from './lead-picker';

const meta = {
   component: LeadPicker,
   args: {
      lead: andrea,
      candidates: leadCandidates(storyMembers, andrea),
      onChange: fn(),
      children: <LeadAvatarButton lead={andrea} />,
   },
   render: function Render(args) {
      const [lead, setLead] = useState<User | undefined>(args.lead);
      return (
         <LeadPicker
            {...args}
            lead={lead}
            onChange={(next) => {
               setLead(next);
               args.onChange(next);
            }}
         >
            {lead ? (
               <LeadAvatarButton lead={lead} />
            ) : (
               <PickerChipButton>Project lead</PickerChipButton>
            )}
         </LeadPicker>
      );
   },
} satisfies Meta<typeof LeadPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The detail sidebar: avatar with a presence dot. */
export const Sidebar: Story = {};

/** A board card: a small avatar and nothing else. */
export const Compact: Story = {
   render: (args) => (
      <LeadPicker {...args} lead={maya}>
         <LeadAvatarButton lead={maya} size="sm" />
      </LeadPicker>
   ),
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('button', { name: `Lead: ${maya.name}` })).toHaveClass(
         'size-4'
      );
   },
};

/** Agents lead nothing, so the roster lists people only. */
export const PeopleOnly: Story = {
   play: async ({ args, canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: `Lead: ${andrea.name}` }));
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByRole('option', { name: new RegExp(maya.name) })).toBeVisible();
      await expect(
         body.queryByRole('option', { name: new RegExp(frontendAgent.name) })
      ).not.toBeInTheDocument();
      await userEvent.click(body.getByRole('option', { name: new RegExp(maya.name) }));
      await expect(args.onChange).toHaveBeenCalledWith(maya);
      await expect(canvas.getByRole('button', { name: `Lead: ${maya.name}` })).toBeVisible();
   },
};

/** With no roster loaded yet, the lead is the only choice. */
export const RosterNotLoaded: Story = {
   args: { lead: tomas, candidates: leadCandidates([], tomas) },
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: `Lead: ${tomas.name}` }));
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findAllByRole('option')).toHaveLength(1);
   },
};

/** Create dialog: nothing is preselected; who leads is a decision, not a default. */
export const Unchosen: Story = {
   args: { lead: undefined, candidates: leadCandidates(storyMembers, undefined) },
   play: async ({ args, canvas, canvasElement, userEvent }) => {
      await expect(canvas.getByRole('combobox')).toHaveTextContent('Project lead');
      await userEvent.click(canvas.getByRole('combobox'));
      const body = within(canvasElement.ownerDocument.body);
      await userEvent.click(await body.findByRole('option', { name: new RegExp(maya.name) }));
      await expect(args.onChange).toHaveBeenCalledWith(maya);
   },
};
