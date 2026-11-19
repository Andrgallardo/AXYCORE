import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import fs from 'fs';
import path from 'path';
import { defineConfig } from 'vite';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        includeAssets: ['favicon.ico'],
        manifest: {
          id: '/',
          name: 'AxyCore — Inteligencia Financiera y Crédito V2',
          short_name: 'AxyCore',
          description: 'Plataforma SaaS Multiempresa, administración central y control de licencias.',
          theme_color: '#040C1E',
          background_color: '#040C1E',
          display: 'standalone',
          start_url: '/',
          scope: '/',
          icons: [
            {
              src: '/assets/aistudio/image_aea21874.png',
              sizes: '192x192',
              type: 'image/png',
              purpose: 'any',
            },
            {
              src: '/assets/aistudio/image_aea21874.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'any',
            },
          ],
        },
        devOptions: {
          enabled: false,
          type: 'module',
        },
        workbox: {
          maximumFileSizeToCacheInBytes: 16 * 1024 * 1024,
        },
      }),
      {
        name: 'disable-vite-hmr-ws',
        transform(code: string, id: string) {
          if (id.includes('vite/dist/client/client.mjs')) {
            return code
              .replace(
                'transport.connect(createHMRHandler(handleMessage));',
                '/* HMR WebSocket disabled in AI Studio preview */'
              )
              .replace(
                'reject(/* @__PURE__ */ new Error("WebSocket closed without opened."));',
                'resolve();'
              );
          }
          return undefined;
        },
      },
      // Copies src/assets into dist/ so root-relative URLs like
      // "/src/assets/images/..." (e.g. generate_image output) still resolve
      // in production builds. Do not remove.
      {
        name: 'copy-unbundled-src-assets',
        apply: 'build',
        closeBundle(error?: Error): void {
          if (error) {
            return;
          }
          const distDir = path.resolve(__dirname, 'dist');
          const srcAssets = path.resolve(__dirname, 'src/assets');
          const distAssets = path.resolve(distDir, 'src/assets');
          if (fs.existsSync(distDir) && fs.existsSync(srcAssets)) {
            fs.cpSync(srcAssets, distAssets, {recursive: true, force: true});
          }
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio preview environment.
      hmr: false,
      watch: null,
    },
  };
});
