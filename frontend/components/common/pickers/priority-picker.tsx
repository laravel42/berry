'use client';

import { priorities, type Priority } from '@/data/priorities';
import { cn } from '@/lib/utils';
import { useTranslations } from 'next-intl';
import {
   OptionPicker,
   PickerChipButton,
   PickerIconButton,
   PickerRowButton,
   PickerRowIcon,
} from './option-picker';

interface PriorityPickerProps {
   priority: Priority;
   onChange: (priority: Priority) => void;
   /**
    * `icon`: the tier glyph alone on a 28px ghost square, for rows, cards and
    * property panels. `chip`: glyph and name on a secondary chip, for the
    * property row of a create dialog. `row`: glyph and name across the whole
    * row, for the project sidebar.
    */
   variant: 'icon' | 'chip' | 'row';
   /** How many tasks sit at a priority, shown after each option. Omit for no counts. */
   countFor?: (priorityId: string) => number;
}

const PRIORITY_OPTIONS = priorities.map((item) => ({
   value: item.id,
   label: item.name,
   icon: <item.icon className="size-4" />,
}));

/** Choose a priority tier. The glyph colours itself by tier (see `data/priorities.tsx`). */
export function PriorityPicker({ priority, onChange, variant, countFor }: PriorityPickerProps) {
   const t = useTranslations('issueLists');

   const choose = (id: string) => {
      const next = priorities.find((item) => item.id === id);
      if (next) onChange(next);
   };

   const label = t('row.priority', { current: priority.name });

   return (
      <OptionPicker
         options={PRIORITY_OPTIONS}
         value={priority.id}
         onValueChange={choose}
         emptyLabel="No priority found."
         countFor={countFor}
      >
         {variant === 'icon' ? (
            <PickerIconButton aria-label={label} title={label}>
               <priority.icon className="size-4" />
            </PickerIconButton>
         ) : variant === 'row' ? (
            <PickerRowButton aria-label={label} title={label}>
               <PickerRowIcon>
                  <priority.icon />
               </PickerRowIcon>
               <span className="truncate">{priority.name}</span>
            </PickerRowButton>
         ) : (
            <PickerChipButton
               className={cn(priority.id === 'no-priority' && 'text-muted-foreground')}
            >
               <priority.icon className="size-4" />
               <span>{priority.name}</span>
            </PickerChipButton>
         )}
      </OptionPicker>
   );
}
