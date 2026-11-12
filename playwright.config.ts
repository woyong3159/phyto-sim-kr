import { defineConfig, devices } from '@playwright/test';

// 기준: 헌법 5-1 — WebKit 엔진 + iPhone 기기 에뮬레이션.
// WebKit을 내려받을 수 없는 환경에서는 PW_FALLBACK_CHROME=1 로 같은 iPhone 화면 크기를
// Chrome 엔진으로 대신 확인한다(레이아웃 확인용 대체 수단. 정식 검증은 WebKit).
const useChrome = process.env.PW_FALLBACK_CHROME === '1';
const iphone = devices['iPhone 14'];

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'test-results',
  snapshotDir: 'tests/e2e/__screenshots__',
  timeout: 30_000,
  reporter: [['list']],
  use: { baseURL: 'http://localhost:4173' },
  webServer: {
    command: 'npm run preview',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    useChrome
      ? {
          name: 'iphone-chrome-fallback',
          use: {
            viewport: iphone.viewport,
            deviceScaleFactor: iphone.deviceScaleFactor,
            isMobile: true,
            hasTouch: true,
            userAgent: iphone.userAgent,
            browserName: 'chromium',
            channel: 'chrome',
          },
        }
      : { name: 'iphone-webkit', use: { ...iphone } },
  ],
});
