import { zodResolver } from '@hookform/resolvers/zod';
import type { FieldValues, Resolver } from 'react-hook-form';
import type { z } from 'zod';

/**
 * `zodResolver` for a Zod 4 object schema used with `useForm`.
 *
 * `@hookform/resolvers` types the Zod 4 overload against its own `Zod4Type`
 * brand; a plain `z.ZodType<Values>` from `zod` is structurally fine at
 * runtime but fails the nominal check, so the cast stays here.
 */
export function zodFormResolver<Values extends FieldValues>(
   schema: z.ZodType<Values>
): Resolver<Values> {
   return zodResolver(schema as never) as Resolver<Values>;
}
