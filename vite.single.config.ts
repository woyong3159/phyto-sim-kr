import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { fileURLToPath } from 'node:url';

// 보조 산출물: PC 오프라인 백업용 단일 HTML 파일. 서비스 워커 없이 동작한다.
export default defineConfig({
  base: './',
  plugins: [react(), viteSingleFile()],
  resolve: {
    alias: {
      'virtual:pwa-register': fileURLToPath(new URL('./src/pwa/register-stub.ts', import.meta.url)),
    },
  },
  build: { outDir: 'dist-single', emptyOutDir: true },
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.0.0'),
    __SINGLE_FILE__: 'true',
  },
});
