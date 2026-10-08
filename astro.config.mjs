import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

export default defineConfig({
  site: 'https://tulumdao.com',
  trailingSlash: 'always',
  integrations: [sitemap()],
  markdown: {
    shikiConfig: { themes: { light: 'github-light-high-contrast', dark: 'github-dark-dimmed' } },
  },
  build: { inlineStylesheets: 'always' },
});
