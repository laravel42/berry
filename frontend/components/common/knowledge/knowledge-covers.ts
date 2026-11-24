/**
 * The built-in page covers: gradients and flat colours, drawn by the browser
 * rather than stored as files. The server keeps only the name (`preset:<name>`),
 * so the set can change here without a migration; a name no longer listed
 * draws nothing.
 */
export interface CoverPreset {
   name: string;
   label: string;
   background: string;
}

export const COVER_PRESETS: CoverPreset[] = [
   {
      name: 'berry',
      label: 'Berry',
      background: 'linear-gradient(135deg, #b84355 0%, #5b1d3a 100%)',
   },
   { name: 'dusk', label: 'Dusk', background: 'linear-gradient(135deg, #3b2667 0%, #bc78ec 100%)' },
   {
      name: 'ocean',
      label: 'Ocean',
      background: 'linear-gradient(135deg, #0f3443 0%, #34e89e 100%)',
   },
   { name: 'sky', label: 'Sky', background: 'linear-gradient(135deg, #1e3c72 0%, #2a8bd8 100%)' },
   {
      name: 'sunrise',
      label: 'Sunrise',
      background: 'linear-gradient(135deg, #f7971e 0%, #e0645a 100%)',
   },
   {
      name: 'forest',
      label: 'Forest',
      background: 'linear-gradient(135deg, #134e3a 0%, #6b9e4a 100%)',
   },
   {
      name: 'ember',
      label: 'Ember',
      background: 'linear-gradient(135deg, #2b1a14 0%, #c2410c 100%)',
   },
   {
      name: 'slate',
      label: 'Slate',
      background: 'linear-gradient(135deg, #232526 0%, #545a63 100%)',
   },
   { name: 'sand', label: 'Sand', background: '#c8b08a' },
   { name: 'rose', label: 'Rose', background: '#d48a9a' },
   { name: 'mint', label: 'Mint', background: '#8cc7a8' },
   { name: 'ink', label: 'Ink', background: '#2a2a33' },
];

export function coverPreset(name: string): CoverPreset | undefined {
   return COVER_PRESETS.find((preset) => preset.name === name);
}
