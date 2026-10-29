'use client';

import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { loadPlugins, type PluginInstallation } from '@/lib/plugins';
import { Plug } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

/**
 * Installed plugins for a new task an agent will run.
 *
 * The choice is written into the description as `[@Name](mention://plugin/<id>)`,
 * which is what a run reads to attach that plugin's tools. The field itself
 * does not offer typing `@`.
 */
export function CreatePluginSelect({
   workspaceId,
   value,
   onChange,
}: {
   workspaceId: string;
   value: string[];
   onChange: (ids: string[]) => void;
}) {
   const t = useTranslations('issueDetail.create');
   const [plugins, setPlugins] = useState<PluginInstallation[] | null>(null);

   useEffect(() => {
      if (!workspaceId) return;
      let cancelled = false;
      void loadPlugins(workspaceId)
         .then((found) => {
            if (!cancelled) setPlugins(found.filter((plugin) => plugin.enabled));
         })
         .catch(() => {
            if (!cancelled) setPlugins([]);
         });
      return () => {
         cancelled = true;
      };
   }, [workspaceId]);

   const selected = new Set(value);
   const names = (plugins ?? [])
      .filter((plugin) => selected.has(plugin.id))
      .map((plugin) => plugin.name);
   const label =
      names.length === 0
         ? t('plugins')
         : names.length === 1
           ? names[0]
           : t('pluginsCount', { count: names.length });

   const toggle = (id: string) => {
      onChange(selected.has(id) ? value.filter((entry) => entry !== id) : [...value, id]);
   };

   return (
      <Popover>
         <PopoverTrigger asChild>
            <Button type="button" variant="secondary" size="xs" aria-label={t('pluginsList')}>
               <Plug className="size-3.5" />
               {label}
            </Button>
         </PopoverTrigger>
         <PopoverContent align="start" className="w-64 p-1">
            {plugins === null ? (
               <p className="px-2 py-1.5 text-muted-foreground">{t('pluginsLoading')}</p>
            ) : plugins.length === 0 ? (
               <p className="px-2 py-1.5 text-muted-foreground">{t('pluginsEmpty')}</p>
            ) : (
               <ul role="listbox" aria-label={t('pluginsList')} aria-multiselectable="true">
                  {plugins.map((plugin) => {
                     const on = selected.has(plugin.id);
                     return (
                        <li key={plugin.id} role="option" aria-selected={on}>
                           <label className="flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 hover:bg-accent">
                              <Checkbox
                                 checked={on}
                                 onCheckedChange={() => toggle(plugin.id)}
                                 aria-label={plugin.name}
                              />
                              <span className="min-w-0 flex-1 truncate">{plugin.name}</span>
                           </label>
                        </li>
                     );
                  })}
               </ul>
            )}
         </PopoverContent>
      </Popover>
   );
}

/** Description plus one mention link per chosen plugin the text does not already name. */
export function descriptionWithPlugins(
   description: string,
   plugins: PluginInstallation[],
   ids: string[]
): string {
   const body = description.trim();
   const chosen = new Set(ids);
   const links = plugins
      .filter((plugin) => chosen.has(plugin.id) && !body.includes(`mention://plugin/${plugin.id}`))
      .map((plugin) => {
         const name = plugin.name.replace(/[\]\n]/g, '').slice(0, 100);
         return `[@${name}](mention://plugin/${plugin.id})`;
      });
   if (links.length === 0) return body;
   return body ? `${body}\n\n${links.join(' ')}` : links.join(' ');
}
