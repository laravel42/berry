'use client';

import { Check, Globe } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
   Command,
   CommandGroup,
   CommandInput,
   CommandItem,
   CommandList,
} from '@/components/ui/command';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { describeAutopilotFailure, previewCron } from '@/lib/autopilots';
import {
   DEFAULT_SCHEDULE,
   countdown,
   fromCron,
   knownTimezones,
   localTimezone,
   toCron,
   weekdayNames,
   type VisualSchedule,
} from '@/lib/cron-schedule';
import { cn } from '@/lib/utils';

interface Props {
   /** The expression being edited; the editor never changes it on its own. */
   expression: string;
   timezone: string;
   onChange: (next: { expression: string; timezone: string }) => void;
}

/** The preview is a promise about the future; thirty seconds is close enough. */
const TICK_MS = 30_000;

const HOUR_STEPS = [1, 2, 3, 4, 6, 8, 12];
const MINUTE_STEPS = [5, 10, 15, 20, 30];

const PRESET_LABEL = {
   weekdayMorning: 'presetWeekdayMorning',
   daily: 'presetDaily',
   hourly: 'presetHourly',
   quarter: 'presetQuarter',
} as const;

const PRESETS: Array<{ id: keyof typeof PRESET_LABEL; schedule: VisualSchedule }> = [
   {
      id: 'weekdayMorning',
      schedule: {
         mode: 'time',
         hour: 9,
         minute: 0,
         every: 1,
         window: null,
         days: { kind: 'weekdays', days: [1, 2, 3, 4, 5] },
      },
   },
   {
      id: 'daily',
      schedule: {
         mode: 'time',
         hour: 9,
         minute: 0,
         every: 1,
         window: null,
         days: { kind: 'every' },
      },
   },
   {
      id: 'hourly',
      schedule: {
         mode: 'everyHours',
         hour: 9,
         minute: 0,
         every: 1,
         window: null,
         days: { kind: 'every' },
      },
   },
   {
      id: 'quarter',
      schedule: {
         mode: 'everyMinutes',
         hour: 9,
         minute: 0,
         every: 15,
         window: null,
         days: { kind: 'every' },
      },
   },
];

function clock(hour: number, minute: number): string {
   return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function readClock(value: string, fallback: { hour: number; minute: number }) {
   const match = /^(\d{2}):(\d{2})/.exec(value);
   if (!match) return fallback;
   const hour = Number(match[1]);
   const minute = Number(match[2]);
   if (hour > 23 || minute > 59) return fallback;
   return { hour, minute };
}

function sameDays(days: number[], expected: number[]): boolean {
   return days.length === expected.length && expected.every((day) => days.includes(day));
}

/**
 * The sentence for a schedule ("Weekdays at 9:00 AM"), shared by the editor
 * and the autopilot list so both say the same thing.
 */
export function useScheduleSummary(): (schedule: VisualSchedule) => string {
   const t = useTranslations('areas.autopilots.schedule');
   const locale = useLocale();

   return useMemo(() => {
      const days = weekdayNames(locale);
      const hourName = (hour: number) =>
         new Intl.DateTimeFormat(locale, { hour: 'numeric' }).format(new Date(2000, 0, 1, hour));
      const timeName = (hour: number, minute: number) =>
         new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(
            new Date(2000, 0, 1, hour, minute)
         );
      const dayPhrase = (selection: VisualSchedule['days']): string => {
         if (selection.kind === 'every') return t('namedEveryDay');
         if (selection.kind === 'monthDay') return t('namedMonthDay', { day: selection.day });
         if (sameDays(selection.days, [1, 2, 3, 4, 5])) return t('namedWeekdays');
         if (sameDays(selection.days, [0, 6])) return t('namedWeekends');
         return [...selection.days]
            .sort((left, right) => left - right)
            .map((day) => days[day] ?? '')
            .filter((label) => label !== '')
            .join(', ');
      };
      const lead = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

      return (schedule: VisualSchedule) => {
         const when = dayPhrase(schedule.days);
         if (schedule.mode === 'time') {
            return t('summaryTime', {
               days: lead(when),
               time: timeName(schedule.hour, schedule.minute),
            });
         }
         const interval =
            schedule.mode === 'everyHours'
               ? t('intervalHours', { count: schedule.every })
               : t('intervalMinutes', { count: schedule.every });
         const base =
            schedule.days.kind === 'every'
               ? t('summaryRepeat', { interval })
               : t('summaryRepeatDays', { interval, days: when });
         if (!schedule.window) return base;
         return t('summaryWindow', {
            summary: base,
            from: hourName(schedule.window.from),
            to: hourName(schedule.window.to),
         });
      };
   }, [locale, t]);
}

/** A cron expression in words, or the expression itself when it is more than the controls draw. */
export function useDescribeCron(): (expression: string) => string {
   const describe = useScheduleSummary();
   return useMemo(
      () => (expression: string) => {
         const visual = fromCron(expression);
         return visual ? describe(visual) : expression;
      },
      [describe]
   );
}

/**
 * Says when an autopilot runs, in the words people use.
 *
 * Underneath it is still a five-field cron, and that field is one toggle away —
 * but an expression the visual controls cannot draw faithfully locks them
 * rather than being rounded to the nearest thing they can show. Rounding would
 * quietly change when someone's agent runs.
 */
export default function ScheduleEditor({ expression, timezone, onChange }: Props) {
   const t = useTranslations('areas.autopilots.schedule');
   const locale = useLocale();
   const [raw, setRaw] = useState(false);
   const [preview, setPreview] = useState<string[]>([]);
   const [problem, setProblem] = useState<string | null>(null);
   const [now, setNow] = useState(() => Date.now());

   const visual = useMemo(() => fromCron(expression), [expression]);
   const locked = visual === null;
   const schedule = visual ?? DEFAULT_SCHEDULE;
   const days = weekdayNames(locale);
   const zones = useMemo(knownTimezones, []);
   const describe = useScheduleSummary();

   useEffect(() => {
      const timer = setTimeout(() => {
         void previewCron(expression, timezone, 5)
            .then((times) => {
               setPreview(times);
               setProblem(null);
            })
            .catch((failure: unknown) => {
               setPreview([]);
               setProblem(describeAutopilotFailure(failure));
            });
      }, 300);
      return () => clearTimeout(timer);
   }, [expression, timezone]);

   // The countdowns are only true for a moment, so they are re-read on a timer
   // rather than left to go stale on the screen.
   useEffect(() => {
      const timer = setInterval(() => setNow(Date.now()), TICK_MS);
      return () => clearInterval(timer);
   }, []);

   const set = (patch: Partial<VisualSchedule>) =>
      onChange({ expression: toCron({ ...schedule, ...patch }), timezone });

   const apply = (next: VisualSchedule) => onChange({ expression: toCron(next), timezone });

   const number = (value: string, min: number, max: number, fallback: number) => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return fallback;
      return Math.min(max, Math.max(min, Math.round(parsed)));
   };

   const hourName = (hour: number) =>
      new Intl.DateTimeFormat(locale, { hour: 'numeric' }).format(new Date(2000, 0, 1, hour));

   const summary = describe(schedule);

   return (
      <div className="flex flex-col gap-3">
         <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium">{t('title')}</span>
            <label className="flex items-center gap-2">
               <Switch
                  checked={raw || locked}
                  disabled={locked}
                  onCheckedChange={setRaw}
                  aria-label={t('rawToggle')}
               />
               <span className="text-muted-foreground">{t('rawToggle')}</span>
            </label>
         </div>

         {locked ? (
            <p className="rounded-md border border-dashed p-2 text-muted-foreground" role="status">
               {t('rawLocked')}
            </p>
         ) : null}

         {raw || locked ? (
            <div className="grid gap-1.5">
               <Label htmlFor="cron-expression">{t('expression')}</Label>
               <Input
                  id="cron-expression"
                  className="font-mono"
                  value={expression}
                  placeholder="0 9 * * 1-5"
                  onChange={(event) => onChange({ expression: event.target.value, timezone })}
               />
               <p className="text-muted-foreground">{t('expressionHint')}</p>
            </div>
         ) : (
            <div className="flex flex-col gap-3">
               <p className="font-medium">{summary}</p>
               <div className="flex flex-wrap items-center gap-1">
                  {PRESETS.map((preset) => {
                     const chosen = toCron(schedule) === toCron(preset.schedule);
                     return (
                        <Button
                           key={preset.id}
                           type="button"
                           size="xs"
                           variant={chosen ? 'secondary' : 'ghost'}
                           aria-pressed={chosen}
                           onClick={() => apply(preset.schedule)}
                        >
                           {t(PRESET_LABEL[preset.id])}
                        </Button>
                     );
                  })}
               </div>
               <div className="flex flex-wrap items-center gap-1">
                  {(['time', 'everyHours', 'everyMinutes'] as const).map((mode) => (
                     <Button
                        key={mode}
                        type="button"
                        size="xs"
                        variant={schedule.mode === mode ? 'secondary' : 'ghost'}
                        onClick={() => set({ mode })}
                     >
                        {t(`mode_${mode}`)}
                     </Button>
                  ))}
               </div>

               {schedule.mode === 'time' ? (
                  <label className="grid w-36 gap-1.5">
                     <span className="text-muted-foreground">{t('time')}</span>
                     <Input
                        type="time"
                        className="h-[30px]"
                        value={clock(schedule.hour, schedule.minute)}
                        onChange={(event) => set(readClock(event.target.value, schedule))}
                     />
                  </label>
               ) : (
                  <div className="flex flex-col gap-2">
                     <div className="flex flex-wrap items-center gap-1">
                        {(schedule.mode === 'everyHours' ? HOUR_STEPS : MINUTE_STEPS).map(
                           (step) => (
                              <Button
                                 key={step}
                                 type="button"
                                 size="xs"
                                 variant={schedule.every === step ? 'secondary' : 'ghost'}
                                 onClick={() => set({ every: step })}
                              >
                                 {schedule.mode === 'everyHours'
                                    ? t('intervalHours', { count: step })
                                    : t('intervalMinutes', { count: step })}
                              </Button>
                           )
                        )}
                     </div>
                     <label className="flex items-center gap-2">
                        <Switch
                           checked={schedule.window !== null}
                           onCheckedChange={(on) =>
                              set({ window: on ? { from: 9, to: 17 } : null })
                           }
                           aria-label={t('window')}
                        />
                        <span className="text-muted-foreground">{t('window')}</span>
                     </label>
                     {schedule.window ? (
                        <div className="flex flex-wrap items-end gap-2">
                           {(['from', 'to'] as const).map((edge) => (
                              <label key={edge} className="grid gap-1.5">
                                 <span className="text-muted-foreground">{t(edge)}</span>
                                 <select
                                    className="h-[30px] rounded-[7px] border bg-card px-2 text-foreground"
                                    value={schedule.window?.[edge] ?? (edge === 'from' ? 9 : 17)}
                                    onChange={(event) =>
                                       set({
                                          window: {
                                             from: schedule.window?.from ?? 9,
                                             to: schedule.window?.to ?? 17,
                                             [edge]: number(event.target.value, 0, 23, 0),
                                          },
                                       })
                                    }
                                 >
                                    {Array.from({ length: 24 }, (_, hour) => (
                                       <option key={hour} value={hour}>
                                          {hourName(hour)}
                                       </option>
                                    ))}
                                 </select>
                              </label>
                           ))}
                        </div>
                     ) : null}
                  </div>
               )}

               <div className="flex flex-col gap-2">
                  <span className="text-muted-foreground">{t('days')}</span>
                  <div className="flex flex-wrap items-center gap-1">
                     {(['every', 'weekdays', 'monthDay'] as const).map((kind) => (
                        <Button
                           key={kind}
                           type="button"
                           size="xs"
                           variant={schedule.days.kind === kind ? 'secondary' : 'ghost'}
                           onClick={() =>
                              set({
                                 days:
                                    kind === 'every'
                                       ? { kind: 'every' }
                                       : kind === 'weekdays'
                                         ? { kind: 'weekdays', days: [1, 2, 3, 4, 5] }
                                         : { kind: 'monthDay', day: 1 },
                              })
                           }
                        >
                           {t(`days_${kind}`)}
                        </Button>
                     ))}
                  </div>
                  {schedule.days.kind === 'weekdays' ? (
                     <div className="flex flex-wrap gap-1">
                        {days.map((label, index) => {
                           const chosen =
                              schedule.days.kind === 'weekdays' &&
                              schedule.days.days.includes(index);
                           return (
                              <Button
                                 key={label}
                                 type="button"
                                 size="xxs"
                                 variant={chosen ? 'secondary' : 'ghost'}
                                 className={cn('min-w-10', chosen && 'font-medium')}
                                 onClick={() => {
                                    if (schedule.days.kind !== 'weekdays') return;
                                    const next = chosen
                                       ? schedule.days.days.filter((day) => day !== index)
                                       : [...schedule.days.days, index];
                                    set({
                                       days:
                                          next.length === 0
                                             ? { kind: 'every' }
                                             : { kind: 'weekdays', days: next },
                                    });
                                 }}
                              >
                                 {label}
                              </Button>
                           );
                        })}
                     </div>
                  ) : null}
                  {schedule.days.kind === 'monthDay' ? (
                     <label className="grid w-28 gap-1.5">
                        <span className="text-muted-foreground">{t('dayOfMonth')}</span>
                        <Input
                           className="h-7"
                           type="number"
                           min={1}
                           max={31}
                           value={schedule.days.day}
                           onChange={(event) =>
                              set({
                                 days: {
                                    kind: 'monthDay',
                                    day: number(
                                       event.target.value,
                                       1,
                                       31,
                                       schedule.days.kind === 'monthDay' ? schedule.days.day : 1
                                    ),
                                 },
                              })
                           }
                        />
                     </label>
                  ) : null}
               </div>
            </div>
         )}

         <div className="grid gap-1.5">
            <span className="text-muted-foreground">{t('timezone')}</span>
            <Popover>
               <PopoverTrigger asChild>
                  <Button type="button" size="xs" variant="outline" className="w-fit">
                     <Globe className="mr-1 size-4" />
                     {timezone}
                  </Button>
               </PopoverTrigger>
               <PopoverContent className="w-72 p-0" align="start">
                  <Command>
                     <CommandInput placeholder={t('searchZones')} />
                     <CommandList>
                        <CommandGroup>
                           <CommandItem
                              value={localTimezone()}
                              onSelect={() => onChange({ expression, timezone: localTimezone() })}
                              className="justify-between"
                           >
                              {localTimezone()}
                              {timezone === localTimezone() ? <Check className="size-4" /> : null}
                           </CommandItem>
                           {zones.map((zone) => (
                              <CommandItem
                                 key={zone}
                                 value={zone}
                                 onSelect={() => onChange({ expression, timezone: zone })}
                                 className="justify-between"
                              >
                                 {zone}
                                 {timezone === zone ? <Check className="size-4" /> : null}
                              </CommandItem>
                           ))}
                        </CommandGroup>
                     </CommandList>
                  </Command>
               </PopoverContent>
            </Popover>
         </div>

         <div className="rounded-md border p-3">
            <p className="font-medium">{t('preview')}</p>
            {problem ? (
               <p className="text-destructive" role="alert">
                  {problem}
               </p>
            ) : preview.length === 0 ? (
               <p className="text-muted-foreground">{t('previewEmpty')}</p>
            ) : (
               <ul className="mt-1 flex flex-col gap-0.5">
                  {preview.map((time) => {
                     const left = countdown(time, now);
                     return (
                        <li key={time} className="flex justify-between gap-3">
                           <span>{new Date(time).toLocaleString()}</span>
                           <span className="text-muted-foreground">
                              {t('inTime', { hours: left.hours, minutes: left.minutes })}
                           </span>
                        </li>
                     );
                  })}
               </ul>
            )}
         </div>
      </div>
   );
}
