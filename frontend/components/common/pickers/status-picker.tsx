'use client';

import { status as issueStatuses, type Status } from '@/data/status';
import { OptionPicker, PickerChipButton, PickerIconButton } from './option-picker';

/** A status and the word this surface uses for it (a project says "Planned" for Todo). */
export interface StatusOption {
   status: Status;
   label: string;
}

/** Every task status, named as the task list names it. */
export const ISSUE_STATUS_OPTIONS: readonly StatusOption[] = issueStatuses.map((status) => ({
   status,
   label: status.name,
}));

interface StatusPickerProps {
   status: Status;
   /** The statuses on offer: `ISSUE_STATUS_OPTIONS` or `projectCreateStatusOptions`. */
   options: readonly StatusOption[];
   onChange: (status: Status) => void;
   /**
    * `icon`: the status mark alone on a 28px ghost square, for rows and
    * property panels. `chip`: mark and label on a secondary chip, for the
    * property row of a create dialog.
    */
   variant: 'icon' | 'chip';
   /** How many tasks are in a status, shown after each option. Omit for no counts. */
   countFor?: (statusId: string) => number;
}

/** Choose a status from a fixed workflow list. */
export function StatusPicker({ status, options, onChange, variant, countFor }: StatusPickerProps) {
   // The chip shows this surface's word ("Planned"); the icon's accessible
   // name uses the status's own name, which is what panels print beside it.
   const chipLabel = options.find((option) => option.status.id === status.id)?.label ?? status.name;

   const choose = (id: string) => {
      const next = options.find((option) => option.status.id === id);
      if (next) onChange(next.status);
   };

   return (
      <OptionPicker
         options={options.map((option) => ({
            value: option.status.id,
            label: option.label,
            icon: <option.status.icon />,
         }))}
         value={status.id}
         onValueChange={choose}
         emptyLabel="No status found."
         countFor={countFor}
      >
         {variant === 'icon' ? (
            <PickerIconButton aria-label={`Change status, current ${status.name}`}>
               <status.icon />
            </PickerIconButton>
         ) : (
            <PickerChipButton>
               <status.icon />
               <span>{chipLabel}</span>
            </PickerChipButton>
         )}
      </OptionPicker>
   );
}
