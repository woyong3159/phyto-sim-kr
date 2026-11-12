import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// base를 상대 경로('./')로 두어 GitHub Pages·Cloudflare Pages·Netlify 어디에 올려도 동작한다.
export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      // 'prompt': 새 버전이 있으면 사용자에게 "새 버전 적용" 안내를 띄운다(자동 교체 금지).
      registerType: 'prompt',
      includeAssets: ['icons/favicon.svg', 'icons/apple-touch-icon-180.png'],
      manifest: {
        name: 'PHYTO-SIM KR',
        short_name: 'PHYTO-SIM',
        description: '대한민국 시설재배 작물 생육 시뮬레이터',
        lang: 'ko',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#0f1a14',
        theme_color: '#0f1a14',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,json,webmanifest}'],
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.0.0'),
    __SINGLE_FILE__: 'false',
  },
});
