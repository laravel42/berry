import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useState } from 'react';
import { expect, fn, within } from 'storybook/test';
import { EDITOR_AI_PRESETS, EditorAiBar } from './editor-ai-bar';

type BarProps = Parameters<typeof EditorAiBar>[0];

/** The prompt is controlled by the editor that hosts the bar. */
function Controlled(props: BarProps) {
   const [prompt, setPrompt] = useState(props.prompt);
   return <EditorAiBar {...props} prompt={prompt} onPromptChange={setPrompt} />;
}

const meta = {
   component: EditorAiBar,
   tags: ['ai-generated', 'needs-work'],
   args: {
      prompt: '',
      onPromptChange: fn(),
      onPreset: fn(),
      onSubmit: fn(),
      pending: false,
   },
   // The bar floats at the bottom of the editor it belongs to.
   decorators: [
      (Story) => (
         <div className="relative h-40 w-[560px] rounded-md border">
            <Story />
         </div>
      ),
   ],
} satisfies Meta<typeof EditorAiBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Idle: Story = {
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('button', { name: 'Send' })).toBeDisabled();
   },
};

/** Presets sit behind the sparkles so the bar stays one pill. */
export const PickAPreset: Story = {
   play: async ({ args, canvas, canvasElement, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'AI presets' }));
      const menu = within(canvasElement.ownerDocument.body);
      await userEvent.click(await menu.findByRole('menuitem', { name: 'Make shorter' }));
      await expect(args.onPreset).toHaveBeenCalledWith(
         EDITOR_AI_PRESETS.find((preset) => preset.id === 'shorter')?.instruction
      );
   },
};

/** Typed prompt: Enter submits. */
export const AskSomething: Story = {
   render: (args) => <Controlled {...args} />,
   play: async ({ args, canvas, userEvent }) => {
      await userEvent.type(
         canvas.getByRole('textbox', { name: 'Ask AI' }),
         'Turn this into a checklist{Enter}'
      );
      await expect(args.onSubmit).toHaveBeenCalledTimes(1);
   },
};

export const Working: Story = {
   args: { prompt: 'Turn this into a checklist', pending: true },
   play: async ({ canvas }) => {
      await expect(canvas.getByRole('button', { name: 'Working' })).toBeDisabled();
      await expect(canvas.getByRole('textbox', { name: 'Ask AI' })).toBeDisabled();
   },
};
