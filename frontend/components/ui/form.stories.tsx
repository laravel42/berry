import type { Meta, StoryObj } from '@storybook/nextjs-vite';
import { useForm } from 'react-hook-form';
import { expect, fn } from 'storybook/test';
import { z } from 'zod';
import { zodFormResolver } from '@/lib/zod-resolver';
import { Button } from './button';
import {
   Form,
   FormControl,
   FormDescription,
   FormField,
   FormItem,
   FormLabel,
   FormMessage,
} from './form';
import { Input } from './input';

const schema = z.object({
   name: z.string().min(1, 'Workspace name is required').max(100),
});
type Values = z.infer<typeof schema>;

/** One field wired through react-hook-form, the way onboarding builds its forms. */
function WorkspaceNameForm({
   defaultName = '',
   onSubmit,
}: {
   defaultName?: string;
   onSubmit: (values: Values) => void;
}) {
   const form = useForm<Values>({
      resolver: zodFormResolver(schema),
      defaultValues: { name: defaultName },
   });
   return (
      <Form {...form}>
         <form onSubmit={form.handleSubmit(onSubmit)} className="grid w-[320px] gap-4" noValidate>
            <FormField
               control={form.control}
               name="name"
               render={({ field }) => (
                  <FormItem>
                     <FormLabel>Workspace name</FormLabel>
                     <FormControl>
                        <Input placeholder="Acme" autoComplete="off" {...field} />
                     </FormControl>
                     <FormDescription>Shown in the switcher and on invitations.</FormDescription>
                     <FormMessage />
                  </FormItem>
               )}
            />
            <Button type="submit">Save</Button>
         </form>
      </Form>
   );
}

const meta = {
   component: WorkspaceNameForm,
   tags: ['ai-generated', 'needs-work'],
   args: { onSubmit: fn() },
} satisfies Meta<typeof WorkspaceNameForm>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {
   play: async ({ args, canvas, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Save' }));
      // The schema's message lands under the field and the control is marked invalid.
      await expect(await canvas.findByText('Workspace name is required')).toBeVisible();
      const input = canvas.getByRole('textbox', { name: 'Workspace name' });
      await expect(input).toHaveAttribute('aria-invalid', 'true');
      await expect(args.onSubmit).not.toHaveBeenCalled();
   },
};

export const Valid: Story = {
   args: { defaultName: 'Acme Engineering' },
   play: async ({ args, canvas, userEvent }) => {
      await userEvent.click(canvas.getByRole('button', { name: 'Save' }));
      await expect(args.onSubmit).toHaveBeenCalled();
      await expect(args.onSubmit.mock.calls[0]?.[0]).toEqual({ name: 'Acme Engineering' });
   },
};
