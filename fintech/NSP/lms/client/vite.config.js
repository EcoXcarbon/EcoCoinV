import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // Served from nsp.ppmc.pk/lms/, so assets and the service worker are
  // scoped there rather than at the domain root, which NSP itself owns.
  base: '/lms/',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      base: '/lms/',
      scope: '/lms/',
      includeAssets: ['icon-192.svg', 'icon-512.svg', 'manifest.json'],
      manifest: false, // use existing manifest.json
      workbox: {
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        // Do NOT precache index.html — otherwise the SW serves a stale app shell
        // one deploy behind. Navigations go NetworkFirst instead (always latest online).
        globPatterns: ['**/*.{js,css,png,svg,ico,woff2}'],
        navigateFallback: null,
        // API calls (/api/*) are deliberately NOT registered as a workbox route.
        // An unmatched request bypasses the SW and uses the browser's native
        // fetch — so a flaky moment can never surface as "ServiceWorker
        // intercepted the request and encountered an unexpected error", which
        // was rejecting the app's data loads and locking learners out of the
        // training journey. Never cache /api; always hit the network directly.
        navigateFallbackDenylist: [/^\/lms\/api\//],
        runtimeCaching: [
          {
            urlPattern: ({ request }) => request.mode === 'navigate',
            handler: 'NetworkFirst',
            options: { cacheName: 'html-shell', networkTimeoutSeconds: 4, expiration: { maxEntries: 4 } },
          },
          {
            urlPattern: /\.(?:woff2?|ttf|eot)$/,
            handler: 'CacheFirst',
            options: { cacheName: 'font-cache', expiration: { maxEntries: 20, maxAgeSeconds: 31536000 } },
          },
          {
            urlPattern: /\.(?:png|jpg|jpeg|svg|gif|webp)$/,
            handler: 'CacheFirst',
            options: { cacheName: 'image-cache', expiration: { maxEntries: 60, maxAgeSeconds: 2592000 } },
          },
        ],
      },
    }),
  ],
  server: {
    port: 5173,
    proxy: {
      '/lms/api': { target: 'http://localhost:5010', rewrite: p => p.replace(/^\/lms/, '') },
      '/lms/uploads': { target: 'http://localhost:5010', rewrite: p => p.replace(/^\/lms/, '') },
    },
  },
});
