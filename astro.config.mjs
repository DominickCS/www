// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  site: 'https://www.dominickcs.com',
  markdown: {
    shikiConfig: {
      theme: 'catppuccin-frappe',
      wrap: true,
    }
  }
});
