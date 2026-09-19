import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { DetailSectionLabel } from './detail-section-label';

const meta = {
   component: DetailSectionLabel,
   tags: ['ai-generated', 'needs-work'],
   args: { children: 'tasks' },
} satisfies Meta<typeof DetailSectionLabel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Tasks: Story = {};
export const Updates: Story = { args: { children: 'updates' } };
