import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';
import { Figure, Panel, PageStatement, SectionLabel } from './page-parts';

const meta = {
   component: PageStatement,
   tags: ['ai-generated'],
   args: { label: 'Projects', figure: '12', line: 'open projects' },
} satisfies Meta<typeof PageStatement>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The page's name, its one figure and the sentence saying what it counts. */
export const WithFigure: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('heading', { level: 1, name: 'Projects' })).toBeVisible();
      await expect(canvas.getByText('12')).toBeVisible();
      await expect(canvas.getByText('open projects')).toBeVisible();
   },
};

/** `figure` left undefined while data is loading, so the page never claims zero. */
export const WithoutFigureWhileLoading: Story = {
   args: { figure: undefined, line: undefined, sub: undefined },
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('heading', { level: 1, name: 'Projects' })).toBeVisible();
      await expect(canvas.queryByText('0')).toBeNull();
   },
};

/** `heading="h2"` for a page that already has its own `<h1>` above it, as every Settings page does. */
export const AsSecondaryHeading: Story = {
   args: { heading: 'h2' },
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('heading', { level: 2, name: 'Projects' })).toBeVisible();
   },
};

/** `SectionLabel`: small capitals naming a group, a column, or a side-panel heading. */
export const AsSectionLabel: Story = {
   render: () => <SectionLabel as="h2">Recent activity</SectionLabel>,
   play: async ({ canvas }) => {
      await expect(
         canvas.getByRole('heading', { level: 2, name: 'Recent activity' })
      ).toBeVisible();
   },
};

/** `Panel`: one subject, under its name, on a detail page. */
export const AsPanel: Story = {
   render: () => (
      <Panel title="Details" hint="3 fields">
         <p>Created by Andrea Lunelio on 2026-08-01.</p>
      </Panel>
   ),
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('heading', { name: 'Details' })).toBeVisible();
      await expect(canvas.getByText('3 fields')).toBeVisible();
      await expect(canvas.getByText('Created by Andrea Lunelio on 2026-08-01.')).toBeVisible();
   },
};

/** `Figure`: a number in the display face, never a `text-*` size utility. */
export const AsFigure: Story = {
   render: () => <Figure size="hero">$482.10</Figure>,
   play: async ({ canvas }) => {
      const figure = canvas.getByText('$482.10');
      await expect(figure).toHaveAttribute('data-figure', 'hero');
   },
};
