import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';

import { RuntimeProviderBadge } from './runtime-provider-badge';

const meta = {
   component: RuntimeProviderBadge,
   tags: ['ai-generated'],
   args: { runtimeId: 'kiro', label: 'Kiro' },
} satisfies Meta<typeof RuntimeProviderBadge>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The runtime's mark beside its label, framed like Settings → Integrations. */
export const WithLabel: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.getByText('Kiro')).toBeVisible();
   },
};

/** No label: a framed icon-only badge, sized up for a header. */
export const IconOnlyFramed: Story = {
   args: { label: undefined, size: 'md', runtimeId: 'anthropic', title: 'Claude' },
   play: async ({ canvas, canvasElement }) => {
      await expect(canvas.getByTitle('Claude')).toBeInTheDocument();
      await expect(canvasElement.querySelector('svg')).not.toBeNull();
   },
};

/** `bare` is just the mark, for a control that already supplies its own chrome. */
export const Bare: Story = {
   args: { label: undefined, bare: true, runtimeId: 'openai' },
   play: async ({ canvasElement }) => {
      await expect(canvasElement.querySelector('svg')).not.toBeNull();
      await expect(canvasElement.querySelector('.size-9, .size-5')).toBeNull();
   },
};

/** A runtime id no logo covers falls back to a plain CPU mark rather than nothing. */
export const UnknownRuntimeFallsBack: Story = {
   args: { label: undefined, runtimeId: 'some-future-runtime' },
   play: async ({ canvasElement }) => {
      await expect(canvasElement.querySelector('svg')).not.toBeNull();
   },
};
