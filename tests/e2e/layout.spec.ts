import { expect, test } from '@playwright/test';

const TABS = ['dashboard', 'env', 'rootzone', 'crop', 'ipm', 'more'] as const;

test('타이틀 화면과 하단 탭바 (iPhone 세로)', async ({ page }, info) => {
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'PHYTO-SIM KR' })).toBeVisible();
  await expect(page.getByTestId('clock')).toBeVisible();

  const vp = page.viewportSize()!;
  // 가로 스크롤(레이아웃 넘침)이 없어야 한다
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);

  // 탭바: 화면 맨 아래에 붙어 있고, 모든 탭의 터치 영역이 44×44pt 이상
  const bar = await page.locator('.tabbar').boundingBox();
  expect(Math.round(bar!.y + bar!.height)).toBe(vp.height);
  for (const id of TABS) {
    const box = await page.locator(`[data-tab="${id}"]`).boundingBox();
    expect(box!.width, `${id} 탭 폭`).toBeGreaterThanOrEqual(44);
    expect(box!.height, `${id} 탭 높이`).toBeGreaterThanOrEqual(44);
    expect(box!.x + box!.width).toBeLessThanOrEqual(vp.width + 0.5);
  }
  // 탭 글자가 잘리지 않는다
  const clipped = await page.locator('.tab span').evaluateAll((els) => els.filter((e) => e.scrollWidth > (e.parentElement as HTMLElement).clientWidth).length);
  expect(clipped).toBe(0);

  await page.screenshot({ path: info.outputPath('title-light.png') });
});

test('모든 탭이 열리고 넘치지 않는다', async ({ page }, info) => {
  await page.goto('./');
  for (const id of TABS) {
    await page.locator(`[data-tab="${id}"]`).tap();
    await expect(page.locator(`[data-screen="${id}"]`)).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, `${id} 화면 가로 넘침`).toBeLessThanOrEqual(0);
    await page.screenshot({ path: info.outputPath(`tab-${id}.png`) });
  }
});

test('다크 모드', async ({ page }, info) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('./');
  await expect(page.getByTestId('clock')).toBeVisible();
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe('rgb(15, 26, 20)');
  await page.screenshot({ path: info.outputPath('title-dark.png') });
});

test('안전 영역(노치·홈 인디케이터)을 반영한다', async ({ page }, info) => {
  // 에뮬레이터는 env(safe-area-inset-*)를 0으로 주므로, 같은 CSS 변수에 실제 아이폰 값(위 47, 아래 34)을 넣어 확인한다.
  await page.goto('./');
  await expect(page.getByTestId('clock')).toBeVisible();
  await page.addStyleTag({ content: ':root{--sat:47px;--sab:34px}' });
  const vp = page.viewportSize()!;
  const hero = await page.locator('.hero').boundingBox();
  expect(hero!.y).toBeGreaterThanOrEqual(47);
  const tab = await page.locator('[data-tab="dashboard"]').boundingBox();
  expect(tab!.y + tab!.height).toBeLessThanOrEqual(vp.height - 34 + 0.5);
  expect(tab!.height).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: info.outputPath('title-safe-area.png') });
});

test('시계가 흐르고, 화면을 닫았다 열면 저장된 시각에서 이어진다', async ({ page }) => {
  await page.goto('./');
  const clock = page.getByTestId('clock');
  await expect(clock).toBeVisible();
  await expect(clock).toContainText('작기 1일차');
  await page.locator('[data-speed="d30"]').tap();
  await expect(clock).not.toContainText('작기 1일차', { timeout: 5000 });
  await page.locator('[data-speed="pause"]').tap();
  await page.waitForTimeout(400);
  const before = await clock.textContent();
  await page.reload();
  await expect(page.getByTestId('clock')).toHaveText(before!);
});

test('오프라인에서도 열린다(서비스 워커)', async ({ page, context }) => {
  await page.goto('./');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect(page.getByText('인터넷 없이 열 수 있습니다')).toBeVisible({ timeout: 10_000 });
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'PHYTO-SIM KR' })).toBeVisible();
  await expect(page.getByTestId('clock')).toBeVisible();
  await context.setOffline(false);
});
