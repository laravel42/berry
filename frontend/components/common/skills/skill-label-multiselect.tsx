'use client';

import { colorForSkillLabel } from '@/lib/skill-labels';
import { X } from 'lucide-react';
import { useTranslations } from 'next-intl';

interface SkillLabelMultiselectProps {
   value: string[];
   onChange: (labels: string[]) => void;
   disabled?: boolean;
}

/**
 * Skill labels as chips. Adding is done from the detail header; chips here
 * only show what is set and let an editor remove one.
 */
export function SkillLabelMultiselect({
   value,
   onChange,
   disabled = false,
}: SkillLabelMultiselectProps) {
   const t = useTranslations('areas.skills');

   const remove = (label: string) => {
      onChange(value.filter((entry) => entry !== label));
   };

   return (
      <div className="flex shrink-0 flex-col gap-1.5">
         <span className="text-muted-foreground">{t('detail.labels')}</span>
         {value.length === 0 ? (
            <p className="text-muted-foreground">{t('detail.noLabels')}</p>
         ) : (
            <div className="flex flex-wrap items-center gap-1">
               {value.map((label) => {
                  const color = colorForSkillLabel(label);
                  return (
                     <button
                        key={label}
                        type="button"
                        disabled={disabled}
                        onClick={() => remove(label)}
                        title={label}
                        className="inline-flex min-w-0 items-center gap-1 rounded-full border px-2 py-0.5 disabled:opacity-60"
                        style={{
                           backgroundColor: `${color}26`,
                           borderColor: color,
                           color,
                        }}
                     >
                        <span className="max-w-[140px] truncate">{label}</span>
                        {disabled ? null : <X className="size-3 shrink-0" />}
                     </button>
                  );
               })}
            </div>
         )}
      </div>
   );
}
