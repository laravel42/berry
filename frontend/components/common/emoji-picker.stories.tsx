import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useRef, useState } from 'react';
import { expect, waitFor, within } from 'storybook/test';

import { EmojiInsertButton, EmojiPicker, EmojiPickerPopover } from './emoji-picker';

const meta = {
   component: EmojiPicker,
   tags: ['ai-generated'],
   args: { onSelect: () => undefined },
} satisfies Meta<typeof EmojiPicker>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The whole catalogue, loaded on first open and painted from the theme tokens. */
export const Catalogue: Story = {
   play: async ({ canvasElement }) => {
      await waitFor(() => expect(canvasElement.querySelector('em-emoji-picker')).not.toBeNull());
      const picker = canvasElement.querySelector<HTMLElement>('em-emoji-picker')!;
      await expect(picker.style.getPropertyValue('--rgb-accent')).toMatch(/^\d+, \d+, \d+$/);
   },
};

/** A quick row first; More opens the catalogue in its place. */
export const QuickRowThenMore: Story = {
   render: () => (
      <EmojiPickerPopover quick={['👍', '🎉', '❤️']} onSelect={() => undefined}>
         <button type="button">React</button>
      </EmojiPickerPopover>
   ),
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'React' }));
      const body = within(canvasElement.ownerDocument.body);
      await expect(await body.findByRole('button', { name: '🎉' })).toBeVisible();
      await userEvent.click(body.getByRole('button', { name: 'More emoji' }));
      await waitFor(() =>
         expect(canvasElement.ownerDocument.querySelector('em-emoji-picker')).not.toBeNull()
      );
   },
};

function MessageBox() {
   const [value, setValue] = useState('Ship it');
   const box = useRef<HTMLTextAreaElement>(null);
   return (
      <div className="flex items-end gap-2">
         <EmojiInsertButton textareaRef={box} value={value} onChange={setValue} side="top" />
         <textarea
            ref={box}
            aria-label="Message"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            className="min-h-(--field-h) flex-1 resize-none rounded-md border px-2 py-1"
         />
      </div>
   );
}

/** The message box's button: the catalogue opens over the box. */
export const InAMessageBox: Story = {
   render: () => <MessageBox />,
   play: async ({ canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Insert emoji' }));
      await waitFor(() =>
         expect(canvasElement.ownerDocument.querySelector('em-emoji-picker')).not.toBeNull()
      );
   },
};
