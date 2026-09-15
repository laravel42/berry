/**
 * One template for the projects table.
 *
 * The header row and every project row read these, so a column that moves,
 * widens or drops out at a breakpoint does so in both at once. A header label
 * and a plain value cell pad by `PROJECT_CELL_PAD`; a cell holding a control
 * does not, because the control's own `px-2` puts its content at the same 8px,
 * so a header label sits over the value it names.
 */
export const PROJECT_COLUMN = {
   health: 'hidden w-[120px] shrink-0 sm:block',
   priority: 'hidden w-[70px] shrink-0 md:block',
   lead: 'hidden w-[130px] shrink-0 xl:block',
   targetDate: 'hidden w-[110px] shrink-0 xl:block',
   issues: 'hidden w-[60px] shrink-0 xl:block',
   status: 'w-[90px] shrink-0',
} as const;

export const PROJECT_CELL_PAD = 'pl-2';

/** The checkbox slot: a size-4 box and its gap, reserved in the header as well. */
export const PROJECT_SELECT_SLOT = 'mr-2 flex w-4 shrink-0 items-center';

/** The row's hover actions (pin, menu): two size-8 buttons, reserved in the header too. */
export const PROJECT_ACTIONS_SLOT = 'ml-1 flex w-16 shrink-0 items-center justify-end';
