'use client';

import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import type { PluginConfigField, PluginConfigValue } from '@/lib/plugins';
import { SettingsCard, SettingsRow, SelectMenu } from './shared';

/** The settings a plugin declares, as form rows. Shared by install and detail. */
export function PluginConfigForm({
   fields,
   value,
   onChange,
   disabled,
}: {
   fields: PluginConfigField[];
   value: Record<string, PluginConfigValue>;
   onChange: (next: Record<string, PluginConfigValue>) => void;
   disabled?: boolean;
}) {
   if (fields.length === 0) return null;
   const set = (key: string, next: PluginConfigValue) => onChange({ ...value, [key]: next });
   return (
      <SettingsCard>
         {fields.map((field) => {
            const title = field.name ?? field.label;
            const selected = value[field.key];
            return (
               <SettingsRow
                  key={field.key}
                  title={field.required ? `${title} *` : title}
                  description={field.name ? field.label : undefined}
                  trailing={
                     field.type === 'boolean' ? (
                        <Switch
                           variant="settings"
                           checked={selected === true}
                           disabled={disabled}
                           onCheckedChange={(checked) => set(field.key, checked)}
                        />
                     ) : field.type === 'array' && field.options ? (
                        <SelectMenu
                           options={field.options}
                           value={typeof selected === 'string' ? selected : ''}
                           placeholder="Select"
                           aria-label={title}
                           disabled={disabled}
                           onChange={(next) => set(field.key, next)}
                        />
                     ) : (
                        <Input
                           variant="settings"
                           className="h-8 w-56"
                           disabled={disabled}
                           type={field.type === 'number' ? 'number' : 'text'}
                           value={String(selected ?? '')}
                           onChange={(event) =>
                              set(
                                 field.key,
                                 field.type === 'number'
                                    ? Number(event.target.value)
                                    : event.target.value
                              )
                           }
                        />
                     )
                  }
               />
            );
         })}
      </SettingsCard>
   );
}
