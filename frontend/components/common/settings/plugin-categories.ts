import {
   BarChart3,
   CalendarClock,
   CircleDashed,
   Code2,
   FolderOpen,
   Handshake,
   KanbanSquare,
   Megaphone,
   MessagesSquare,
   Palette,
   Plane,
   Search,
   ShoppingBag,
   type LucideIcon,
} from 'lucide-react';

/** The groups of the Connect catalog. A plugin no group names lands in `other`. */
export type PluginCategory =
   | 'communication'
   | 'meetings'
   | 'work'
   | 'files'
   | 'design'
   | 'data'
   | 'engineering'
   | 'sales'
   | 'marketing'
   | 'commerce'
   | 'research'
   | 'travel'
   | 'other';

export const PLUGIN_CATEGORY_LABEL: Record<PluginCategory, string> = {
   communication: 'Mail and chat',
   meetings: 'Meetings and calendar',
   work: 'Projects and tasks',
   files: 'Files and documents',
   design: 'Design and media',
   data: 'Data and analytics',
   engineering: 'Engineering and hosting',
   sales: 'Sales and CRM',
   marketing: 'Marketing and websites',
   commerce: 'Commerce and payments',
   research: 'Research and the web',
   travel: 'Travel and events',
   other: 'Other',
};

export const PLUGIN_CATEGORY_ICON: Record<PluginCategory, LucideIcon> = {
   communication: MessagesSquare,
   meetings: CalendarClock,
   work: KanbanSquare,
   files: FolderOpen,
   design: Palette,
   data: BarChart3,
   engineering: Code2,
   sales: Handshake,
   marketing: Megaphone,
   commerce: ShoppingBag,
   research: Search,
   travel: Plane,
   other: CircleDashed,
};

/**
 * Each category's own colour, as an OKLCH hue: the header bar takes a wash of
 * it and the icon the colour itself. Twelve hues 30° apart, dealt so that
 * groups next to each other in label order sit far apart on the wheel. Other
 * stays grey.
 */
const PLUGIN_CATEGORY_HUE: Record<PluginCategory, number | null> = {
   commerce: 70,
   data: 250,
   design: 340,
   engineering: 130,
   files: 40,
   communication: 220,
   marketing: 10,
   meetings: 160,
   work: 280,
   research: 100,
   sales: 310,
   travel: 190,
   other: null,
};

/** The category's colour, the same in both themes; the bar mixes it with the surface. */
export function pluginCategoryColor(category: PluginCategory): string {
   const hue = PLUGIN_CATEGORY_HUE[category];
   return hue === null ? 'var(--status-neutral)' : `oklch(0.68 0.15 ${hue})`;
}

/** The group each plugin that ships with Berry is listed under, by its key. */
const PLUGIN_CATEGORY: Record<string, PluginCategory> = {
   'gmail': 'communication',
   'google-contacts': 'communication',
   'hostinger-mail': 'communication',
   'outlook-email': 'communication',
   'slack': 'communication',
   'superhuman-mail': 'communication',
   'teams': 'communication',

   'calendly': 'meetings',
   'fireflies': 'meetings',
   'google-calendar': 'meetings',
   'granola': 'meetings',
   'otter': 'meetings',
   'outlook-calendar': 'meetings',
   'plaud': 'meetings',
   'zoom': 'meetings',

   'airtable': 'work',
   'asana': 'work',
   'atlassian': 'work',
   'linear': 'work',
   'monday': 'work',
   'notion': 'work',
   'todoist': 'work',
   'trello': 'work',

   'box': 'files',
   'docusign': 'files',
   'dropbox': 'files',
   'google-drive': 'files',

   'adobe': 'design',
   'canva': 'design',
   'descript': 'design',
   'figma': 'design',
   'gamma': 'design',
   'heygen': 'design',
   'higgsfield': 'design',
   'lovable': 'design',
   'magicpath': 'design',
   'mobbin': 'design',
   'runway': 'design',
   'tldraw': 'design',

   'amplitude': 'data',
   'aws-data-analytics': 'data',
   'bigquery': 'data',
   'clickhouse': 'data',
   'databricks': 'data',
   'dbt': 'data',
   'deepnote': 'data',
   'hex': 'data',
   'metabase': 'data',
   'mixpanel': 'data',
   'motherduck': 'data',
   'omni': 'data',
   'posthog': 'data',
   'power-bi': 'data',
   'snowflake': 'data',
   'statsig': 'data',
   'windsor': 'data',

   'context7': 'engineering',
   'datadog': 'engineering',
   'neon': 'engineering',
   'openai-docs': 'engineering',
   'quicknode': 'engineering',
   'railway': 'engineering',
   'render': 'engineering',
   'supabase': 'engineering',
   'vercel': 'engineering',

   'apollo': 'sales',
   'attio': 'sales',
   'clay': 'sales',
   'close': 'sales',
   'g2': 'sales',
   'hg-insights': 'sales',
   'hubspot': 'sales',
   'outreach': 'sales',
   'zoho-crm': 'sales',

   'ahrefs': 'marketing',
   'customerio': 'marketing',
   'klaviyo': 'marketing',
   'metricool': 'marketing',
   'similarweb': 'marketing',
   'vidiq': 'marketing',
   'webflow': 'marketing',
   'wix': 'marketing',
   'wordpress': 'marketing',

   'cafe24': 'commerce',
   'shop': 'commerce',
   'shopify': 'commerce',
   'stripe': 'commerce',

   'firecrawl': 'research',
   'scite': 'research',
   'tinyfish': 'research',

   'booking': 'travel',
   'fever': 'travel',
   'lastminute': 'travel',
   'tripadvisor': 'travel',
   'tripsy': 'travel',
};

/**
 * Plugins for a source control host. Repositories connect under Settings →
 * Source control, so Connect does not offer a second way in.
 */
const SOURCE_CONTROL_PLUGINS: ReadonlySet<string> = new Set(['github', 'gitlab']);

export function isSourceControlPlugin(key: string): boolean {
   return SOURCE_CONTROL_PLUGINS.has(key);
}

export function pluginCategory(key: string): PluginCategory {
   return PLUGIN_CATEGORY[key] ?? 'other';
}

/**
 * One group per category that has a plugin, in label order with Other last.
 * Each group keeps the order the items arrived in.
 */
export function groupByPluginCategory<T>(
   items: readonly T[],
   keyOf: (item: T) => string
): { category: PluginCategory; items: T[] }[] {
   const buckets = new Map<PluginCategory, T[]>();
   for (const item of items) {
      const category = pluginCategory(keyOf(item));
      const current = buckets.get(category);
      if (current) current.push(item);
      else buckets.set(category, [item]);
   }
   return [...buckets.entries()]
      .sort(([left], [right]) => {
         if (left === 'other') return 1;
         if (right === 'other') return -1;
         return PLUGIN_CATEGORY_LABEL[left].localeCompare(PLUGIN_CATEGORY_LABEL[right]);
      })
      .map(([category, grouped]) => ({ category, items: grouped }));
}
