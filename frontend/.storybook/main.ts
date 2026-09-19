import type { StorybookConfig } from '@storybook/nextjs-vite';

const config: StorybookConfig = {
   stories: ['../components/**/*.mdx', '../components/**/*.stories.@(ts|tsx)'],
   addons: [
      '@chromatic-com/storybook',
      '@storybook/addon-vitest',
      '@storybook/addon-a11y',
      '@storybook/addon-docs',
      '@storybook/addon-mcp',
      'msw-storybook-addon',
   ],
   framework: '@storybook/nextjs-vite',
   staticDirs: ['../public'],
};
export default config;
