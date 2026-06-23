// @ts-check
import { defineConfig, fontProviders } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  site: 'https://www.dominickcs.com',
  markdown: {
    shikiConfig: {
      theme: 'catppuccin-frappe',
      wrap: true,
    }
  },
  fonts: [{
    provider: fontProviders.local(),
    name: "Inconsolata",
    cssVariable: "--font-inconsolata",
    options: {
      variants: [{
        src: ['./src/assets/fonts/Inconsolata.ttf'],
        weight: '200 900',
        style: 'normal',
      }]
    }
  }]
});
