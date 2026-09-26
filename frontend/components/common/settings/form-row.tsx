import { cn } from '@/lib/utils';

/**
 * One field of a settings form: its label and a short caption on the left,
 * the control on the right. Rows stack on a narrow screen and are divided by
 * a rule, so a form reads as a list of decisions.
 */
export function FormRow({
   label,
   caption,
   htmlFor,
   children,
   className,
}: {
   label: string;
   caption?: string;
   /** The control's id, so the label focuses it. */
   htmlFor?: string;
   children: React.ReactNode;
   className?: string;
}) {
   return (
      <div
         className={cn(
            'grid grid-cols-1 gap-x-8 gap-y-2 border-t border-border/70 py-4 first:border-t-0 first:pt-0 md:grid-cols-[16rem_minmax(0,1fr)]',
            className
         )}
      >
         <div className="flex min-w-0 flex-col gap-0.5">
            {htmlFor ? (
               <label htmlFor={htmlFor} className="font-medium">
                  {label}
               </label>
            ) : (
               <span className="font-medium">{label}</span>
            )}
            {caption ? <p className="text-muted-foreground">{caption}</p> : null}
         </div>
         <div className="min-w-0">{children}</div>
      </div>
   );
}
