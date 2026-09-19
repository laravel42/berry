import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect, fn, within } from 'storybook/test';
import { ImageViewer, type ViewerImage } from './image-viewer';
import { screenshotSvg } from '../stories-fixtures';

const dataUrl = (label: string) =>
   `data:image/svg+xml;charset=utf-8,${encodeURIComponent(screenshotSvg(label))}`;

const images: ViewerImage[] = [
   { id: 'img-1', name: 'health-chip-before.png', url: dataUrl('Before') },
   { id: 'img-2', name: 'health-chip-after.png', url: dataUrl('After') },
   { id: 'img-3', name: 'reload-keeps-health.png', url: dataUrl('After reload') },
];

const meta = {
   component: ImageViewer,
   tags: ['ai-generated', 'needs-work'],
   args: { images, startAt: 0, open: true, onOpenChange: fn() },
} satisfies Meta<typeof ImageViewer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const FirstOfThree: Story = {
   play: async ({ canvasElement, userEvent }) => {
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByText(/health-chip-before\.png · 1 of 3/)).toBeVisible();
      await userEvent.click(body.getByRole('button', { name: 'Next image' }));
      await expect(body.getByText(/health-chip-after\.png · 2 of 3/)).toBeVisible();
      // The arrows wrap around rather than stopping at the ends.
      await userEvent.click(body.getByRole('button', { name: 'Previous image' }));
      await userEvent.click(body.getByRole('button', { name: 'Previous image' }));
      await expect(body.getByText(/reload-keeps-health\.png · 3 of 3/)).toBeVisible();
   },
};

export const OpenedOnTheLast: Story = { args: { startAt: 2 } };

export const KeyboardSteps: Story = {
   play: async ({ canvasElement, userEvent }) => {
      const body = within(canvasElement.ownerDocument.body);
      await body.findByText(/1 of 3/);
      await userEvent.keyboard('{ArrowRight}');
      await expect(body.getByRole('img', { name: 'health-chip-after.png' })).toBeVisible();
   },
};

export const SingleImage: Story = {
   args: { images: images.slice(0, 1) },
   play: async ({ canvasElement }) => {
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByRole('button', { name: 'Next image' })).toBeDisabled();
   },
};

export const Closed: Story = { args: { open: false } };
