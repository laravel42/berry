import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { CircleDot, FolderKanban, Plus, Settings } from 'lucide-react';
import { expect, fn, within } from 'storybook/test';
import {
   Command,
   CommandDialog,
   CommandEmpty,
   CommandGroup,
   CommandInput,
   CommandItem,
   CommandList,
   CommandSeparator,
   CommandShortcut,
} from './command';

const onCreate = fn();

function Items() {
   return (
      <>
         <CommandInput placeholder="Type a command or search…" />
         <CommandList>
            <CommandEmpty>No results.</CommandEmpty>
            <CommandGroup heading="Tasks">
               <CommandItem onSelect={onCreate}>
                  <Plus />
                  Create task
                  <CommandShortcut>C</CommandShortcut>
               </CommandItem>
               <CommandItem>
                  <CircleDot />
                  BERR-42 Persist project health
               </CommandItem>
            </CommandGroup>
            <CommandSeparator />
            <CommandGroup heading="Go to">
               <CommandItem>
                  <FolderKanban />
                  Projects
               </CommandItem>
               <CommandItem>
                  <Settings />
                  Settings
               </CommandItem>
            </CommandGroup>
         </CommandList>
      </>
   );
}

const meta = {
   component: Command,
   tags: ['ai-generated', 'needs-work'],
   render: (args) => (
      <Command {...args} className="w-[420px] border">
         <Items />
      </Command>
   ),
} satisfies Meta<typeof Command>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Inline: Story = {
   play: async ({ canvas, userEvent }) => {
      onCreate.mockClear();
      await userEvent.type(canvas.getByRole('combobox'), 'proj');
      // cmdk filters as you type: "Projects" and the BERR-42 title match, Settings does not.
      await expect(canvas.queryByRole('option', { name: /settings/i })).toBeNull();
      await expect(canvas.getByRole('option', { name: /projects/i })).toBeVisible();
   },
};

export const NoResults: Story = {
   play: async ({ canvas, userEvent }) => {
      await userEvent.type(canvas.getByRole('combobox'), 'zzzz');
      await expect(canvas.getByText('No results.')).toBeVisible();
   },
};

export const SelectWithKeyboard: Story = {
   play: async ({ canvas, userEvent }) => {
      onCreate.mockClear();
      await userEvent.click(canvas.getByRole('combobox'));
      // The first item is highlighted by default; Enter runs it.
      await userEvent.keyboard('{Enter}');
      await expect(onCreate).toHaveBeenCalledTimes(1);
   },
};

export const Dialog: Story = {
   render: () => (
      <CommandDialog open>
         <Items />
      </CommandDialog>
   ),
   play: async ({ canvasElement }) => {
      const body = within(canvasElement.ownerDocument.body);
      // The title is visually hidden but still names the dialog.
      await expect(await body.findByRole('dialog', { name: 'Command Palette' })).toBeVisible();
   },
};
