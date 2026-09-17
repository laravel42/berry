'use client';

import { Plus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';

import { SettingsSection } from '@/components/common/settings/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface StringListRepeaterProps {
   value: string[];
   onChange: (next: string[]) => void;
   disabled?: boolean;
   title: string;
   description?: string;
   addLabel?: string;
   emptyLabel?: string;
   placeholder?: string;
}

/**
 * String list with the Capabilities → Skills surface: section title, secondary
 * add control on the right, bordered rows edited inline.
 */
export function StringListRepeater({
   value,
   onChange,
   disabled = false,
   title,
   description,
   addLabel,
   emptyLabel,
   placeholder,
}: StringListRepeaterProps) {
   const t = useTranslations('organization.roleTab');
   const focusRef = useRef<HTMLInputElement>(null);
   const [focusLast, setFocusLast] = useState(false);

   useEffect(() => {
      if (!focusLast) return;
      focusRef.current?.focus();
      setFocusLast(false);
   }, [focusLast, value.length]);

   const add = () => {
      onChange([...value, '']);
      setFocusLast(true);
   };

   return (
      <SettingsSection
         panel
         title={title}
         description={description}
         action={
            disabled ? null : (
               <Button type="button" size="xs" variant="secondary" onClick={add}>
                  <Plus className="size-4" />
                  {addLabel ?? t('addItem')}
               </Button>
            )
         }
      >
         {value.length === 0 ? (
            <p className="text-muted-foreground">{emptyLabel ?? t('noneSelected')}</p>
         ) : (
            <ul className="flex flex-col rounded-md border border-border">
               {value.map((item, index) => (
                  <li
                     key={index}
                     className="flex items-center gap-2 border-b border-border px-3 py-1.5 last:border-b-0"
                  >
                     <Input
                        ref={index === value.length - 1 ? focusRef : undefined}
                        disabled={disabled}
                        value={item}
                        placeholder={placeholder ?? t('listItemPlaceholder')}
                        className="h-8 border-0 bg-transparent px-0 shadow-none focus-visible:ring-0"
                        onChange={(event) =>
                           onChange(
                              value.map((entry, at) => (at === index ? event.target.value : entry))
                           )
                        }
                     />
                     {disabled ? null : (
                        <Button
                           type="button"
                           size="xs"
                           variant="ghost"
                           className="shrink-0"
                           aria-label={t('removeItem')}
                           onClick={() => onChange(value.filter((_, at) => at !== index))}
                        >
                           <Trash2 className="size-4" />
                        </Button>
                     )}
                  </li>
               ))}
            </ul>
         )}
      </SettingsSection>
   );
}
