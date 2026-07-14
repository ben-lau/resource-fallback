import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import legacy from '@vitejs/plugin-legacy';
import resourceFallback from '@resource-fallback/vite-plugin';

export default defineConfig({
  base: 'http://cdn-primary.example.invalid/',
  build: {
    assetsInlineLimit: 0,
  },
  plugins: [
    vue(),
    legacy({
      targets: ['defaults', 'not IE 11'],
    }),
    resourceFallback({
      rules: [
        {
          base: 'http://cdn-primary.example.invalid/',
          urls: [
            'http://cdn-secondary.example.invalid/',
            'http://cdn-backup.example.invalid/',
            '/',
          ],
          retry: { max: 1, baseDelay: 300, maxDelay: 1000, jitter: false },
          circuit: { threshold: 2, cooldown: 15_000, storageTtl: 60_000 },
        },
      ],
      debug: true,
      serviceWorker: { fallbackOnOpaque: true },
    }),
  ],
});
