import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { expect } from 'storybook/test';

import { FileKindMark } from './file-kind-mark';

const meta = {
   component: FileKindMark,
   tags: ['ai-generated'],
   args: { name: 'review-detail.tsx' },
} satisfies Meta<typeof FileKindMark>;

export default meta;
type Story = StoryObj<typeof meta>;

/** `.tsx` reads TS, same as a plain `.ts` file. */
export const TypeScriptReact: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.getByText('TS')).toBeVisible();
   },
};

export const Json: Story = {
   args: { name: 'tsconfig.json' },
   play: async ({ canvas }) => {
      await expect(canvas.getByText('{}')).toBeVisible();
   },
};

export const Markdown: Story = {
   args: { name: 'README.md' },
   play: async ({ canvas }) => {
      await expect(canvas.getByText('MD')).toBeVisible();
   },
};

/** An extension the switch does not name falls back to its first three letters. */
export const UnknownExtensionFallsBackToLetters: Story = {
   args: { name: 'migration.sql' },
   play: async ({ canvas }) => {
      await expect(canvas.getByText('SQL')).toBeVisible();
   },
};

/** No extension at all: nothing to mark, so it renders nothing. */
export const NoExtension: Story = {
   args: { name: 'Dockerfile' },
   play: async ({ canvasElement }) => {
      await expect(canvasElement.querySelector('span')).toBeNull();
   },
};
