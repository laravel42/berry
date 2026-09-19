import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';
import { planRecordSchema, type PlanRecord } from '@/lib/plans';
import { usePlanStore } from '@/store/plan-store';
import Header from './header';

/** A plan as `GET /api/v1/plans/{id}` returns it, before any goal is compiled. */
const record = (fields: Record<string, unknown> = {}): PlanRecord =>
   planRecordSchema.parse({
      id: 'plan-1',
      workspaceId: 'ws-1',
      projectId: 'proj-2',
      status: 'draft',
      source: 'prompt',
      sourcePrompt: 'Move approvals and proposals into the inbox, and retire their rail pages.',
      version: 3,
      generation: { status: 'succeeded' },
      validation: { status: 'valid', risk: 'medium', needsAdminActivation: false },
      createdAt: '2026-09-17T09:00:00Z',
      updatedAt: '2026-09-17T09:04:00Z',
      ...fields,
   });

const meta = {
   component: Header,
   tags: ['ai-generated', 'needs-work'],
   args: { planId: 'plan-1' },
   parameters: { layout: 'fullscreen' },
   beforeEach: () => {
      usePlanStore.setState({ records: { 'plan-1': record() } });
   },
} satisfies Meta<typeof Header>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Draft: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.getByText(/^Move approvals and proposals/)).toBeVisible();
      await expect(canvas.queryByRole('button', { name: /new plan/i })).toBeNull();
   },
};

export const Planning: Story = {
   beforeEach: () => {
      usePlanStore.setState({
         records: { 'plan-1': record({ generation: { status: 'running', stage: 'generate' } }) },
      });
   },
};

export const AwaitingApproval: Story = {
   beforeEach: () => {
      usePlanStore.setState({ records: { 'plan-1': record({ status: 'pendingApproval' }) } });
   },
};

export const Loading: Story = {
   beforeEach: () => {
      usePlanStore.setState({ records: {} });
   },
   play: async ({ canvas }) => {
      await expect(canvas.getByText('Loading plan…')).toBeVisible();
   },
};
