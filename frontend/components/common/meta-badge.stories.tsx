import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { Cpu } from 'lucide-react';
import { expect } from 'storybook/test';

import { MetaBadge } from './meta-badge';

const meta = {
   component: MetaBadge,
   tags: ['ai-generated'],
   args: {
      icon: <Cpu className="size-3.5" aria-hidden />,
      children: 'claude-sonnet-5',
      title: 'anthropic · claude-sonnet-5',
   },
} satisfies Meta<typeof MetaBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Icon and label together, with the title as the hover tooltip. */
export const Default: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.getByText('claude-sonnet-5')).toBeVisible();
      await expect(canvas.getByTitle('anthropic · claude-sonnet-5')).toBeInTheDocument();
   },
};

/** No icon: the chip still renders, just the label. */
export const NoIcon: Story = {
   args: { icon: undefined, children: 'bedrock', title: undefined },
   play: async ({ canvas }) => {
      await expect(canvas.getByText('bedrock')).toBeVisible();
   },
};

/** `truncate={false}` keeps the label at its natural width instead of clipping. */
export const NoTruncate: Story = {
   args: { truncate: false, children: 'eu-west builder (unreachable)' },
   render: (args) => (
      <div className="w-32">
         <MetaBadge {...args} />
      </div>
   ),
   play: async ({ canvas }) => {
      await expect(canvas.getByText('eu-west builder (unreachable)')).toHaveClass(
         'whitespace-nowrap'
      );
   },
};

/** Default truncation clips a long label inside a narrow container. */
export const Truncates: Story = {
   args: { children: 'us.anthropic.claude-haiku-4-5-20251001-v1:0' },
   render: (args) => (
      <div className="w-32">
         <MetaBadge {...args} />
      </div>
   ),
   play: async ({ canvas }) => {
      await expect(canvas.getByText('us.anthropic.claude-haiku-4-5-20251001-v1:0')).toHaveClass(
         'truncate'
      );
   },
};
