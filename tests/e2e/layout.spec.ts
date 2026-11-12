import { expect, test, type Page } from '@playwright/test';

const TABS = ['dashboard', 'env', 'rootzone', 'crop', 'ipm', 'more'] as const;

async function startGame(page: Page, opts: { region?: string; date?: string; seed?: string } = {}) {
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'PHYTO-SIM KR' })).toBeVisible();
  if (opts.region) await page.locator(`[data-region="${opts.region}"]`).tap();
  if (opts.date) await page.getByTestId('start-date').fill(opts.date);
  if (opts.seed) await page.getByTestId('seed').fill(opts.seed);
  await page.getByTestId('start-game').tap();
  await page.getByTestId('confirm-start').tap();
  await expect(page.getByTestId('clock')).toBeVisible();
}

const noOverflow = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

test('첫 화면: 타이틀 + 지역 선택 + 하단 탭바 (iPhone 세로)', async ({ page }, info) => {
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'PHYTO-SIM KR' })).toBeVisible();
  await expect(page.getByTestId('region-card')).toBeVisible();
  expect(await page.locator('[data-region]').count()).toBeGreaterThanOrEqual(25);
  const vp = page.viewportSize()!;
  await noOverflow(page);

  const bar = await page.locator('.tabbar').boundingBox();
  expect(Math.round(bar!.y + bar!.height)).toBe(vp.height);
  for (const id of TABS) {
    const box = await page.locator(`[data-tab="${id}"]`).boundingBox();
    expect(box!.width, `${id} 탭 폭`).toBeGreaterThanOrEqual(44);
    expect(box!.height, `${id} 탭 높이`).toBeGreaterThanOrEqual(44);
  }
  // 지역 버튼 터치 영역
  for (const box of await page.locator('[data-region]').evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((r) => ({ w: r.width, h: r.height })))) {
    expect(box.w).toBeGreaterThanOrEqual(44);
    expect(box.h).toBeGreaterThanOrEqual(44);
  }
  await page.screenshot({ path: info.outputPath('01-title.png') });
  await page.locator('[data-region="daegwallyeong"]').tap();
  await expect(page.getByTestId('region-card')).toContainText('대관령');
  await page.getByTestId('region-card').scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath('02-region-card.png') });
});

test('새 작기 → 시간바·외기 카드 → 턴 버튼 → 30일 그래프', async ({ page }, info) => {
  await startGame(page, { region: 'buyeo', date: '2026-06-01', seed: 'e2e-1' });
  const clock = page.getByTestId('clock');
  await expect(clock).toContainText('2026.06.01');
  await expect(clock).toContainText('00:00');
  await expect(page.getByTestId('outdoor-card')).toBeVisible();
  await noOverflow(page);

  // 시간바 버튼 터치 영역
  for (const sel of ['[data-speed]', '[data-turn]']) {
    for (const r of await page.locator(sel).evaluateAll((els) => els.map((e) => e.getBoundingClientRect()).map((b) => ({ w: b.width, h: b.height })))) {
      expect(r.w, sel).toBeGreaterThanOrEqual(44);
      expect(r.h, sel).toBeGreaterThanOrEqual(44);
    }
  }
  expect(await page.locator('[data-speed]').count()).toBe(6);

  await page.locator('[data-turn="1"]').tap();
  await expect(clock).toContainText('01:00');
  await page.locator('[data-turn="24"]').tap();
  await expect(clock).toContainText('2026.06.02');
  for (let i = 0; i < 5; i++) {
    await page.locator('[data-turn="168"]').tap();
    await expect(page.locator('[data-turn="168"]')).toBeEnabled();
    // 자동 일시정지가 뜨면 닫고 계속
    if (await page.getByTestId('pause-banner').isVisible()) await page.getByTestId('pause-banner').getByRole('button').tap();
  }
  await page.locator('[data-turn="1"]').tap();
  await page.waitForTimeout(300);
  for (let i = 0; i < 12; i++) await page.locator('[data-turn="1"]').tap().then(() => page.waitForTimeout(60));
  await page.screenshot({ path: info.outputPath('03-dashboard.png') });

  await page.locator('[data-tab="env"]').tap();
  await expect(page.getByTestId('chart-temp')).toBeVisible();
  await expect(page.getByTestId('chart-temp').locator('svg').first()).toBeVisible();
  await noOverflow(page);
  await page.screenshot({ path: info.outputPath('04-env-30days.png'), fullPage: false });

  await page.locator('[data-tab="more"]').tap();
  await noOverflow(page);
  await page.screenshot({ path: info.outputPath('05-more.png') });
});

test('배속 6종이 동작하고, 화면을 닫았다 열면 저장된 시각에서 이어진다', async ({ page }) => {
  await startGame(page, { seed: 'e2e-2', date: '2026-03-01' });
  const clock = page.getByTestId('clock');
  // 30일/초로 한 달 이상 진행. 도중에 사건으로 자동 일시정지하면 확인하고 다시 달린다.
  for (let i = 0; i < 40 && (await clock.textContent())!.includes('2026.03'); i++) {
    if (await page.getByTestId('pause-banner').isVisible()) await page.getByTestId('pause-banner').getByRole('button').tap();
    if ((await page.locator('[data-speed="d30"]').getAttribute('aria-pressed')) !== 'true') await page.locator('[data-speed="d30"]').tap();
    await page.waitForTimeout(200);
  }
  await expect(clock).not.toContainText('2026.03');
  await page.locator('[data-speed="pause"]').tap();
  await page.waitForTimeout(500);
  const before = await clock.textContent();
  const temp = await page.getByTestId('temp-now').textContent();
  await page.reload();
  await expect(page.getByTestId('clock')).toHaveText(before!);
  // 다시 계산한 외기가 저장 전과 같다(결정론)
  await expect(page.getByTestId('temp-now')).toHaveText(temp!);
  // 그래프용 일 기록도 남아 있다
  await page.locator('[data-tab="env"]').tap();
  await expect(page.getByTestId('chart-temp')).toBeVisible();
});

test('같은 지역·시작일·seed → 같은 날씨, seed가 다르면 다른 날씨', async ({ page }) => {
  const run = async (seed: string) => {
    await page.locator('[data-tab="more"]').tap();
    await page.getByTestId('new-game').tap();
    await page.locator('[data-region="daegu"]').tap();
    await page.getByTestId('start-date').fill('2026-07-10');
    await page.getByTestId('seed').fill(seed);
    await page.getByTestId('start-game').tap();
    await page.getByTestId('confirm-start').tap();
    await page.locator('[data-tab="dashboard"]').tap();
    await expect(page.getByTestId('clock')).toContainText('2026.07.10');
    for (let i = 0; i < 2; i++) {
      await page.locator('[data-turn="168"]').tap();
      await expect(page.locator('[data-turn="168"]')).toBeEnabled();
      if (await page.getByTestId('pause-banner').isVisible()) await page.getByTestId('pause-banner').getByRole('button').tap();
    }
    await page.waitForTimeout(300);
    return `${await page.getByTestId('clock').textContent()} | ${await page.getByTestId('outdoor-card').textContent()}`;
  };
  await startGame(page, { seed: 'first' });
  const a = await run('twin');
  const b = await run('twin');
  const c = await run('different');
  expect(a).toBe(b);
  expect(a).not.toBe(c);
});

test('사건이 생기면 자동 일시정지하고, 종류별로 끌 수 있다', async ({ page }, info) => {
  // 대관령 1월: 한파가 며칠 안에 온다
  await startGame(page, { region: 'daegwallyeong', date: '2026-01-05', seed: 'e2e-cold' });
  const banner = page.getByTestId('pause-banner');
  await page.locator('[data-speed="d7"]').tap();
  await expect(banner).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('[data-speed="pause"]')).toHaveAttribute('aria-pressed', 'true');
  await page.screenshot({ path: info.outputPath('06-auto-pause.png') });
  const stoppedAt = await page.getByTestId('clock').textContent();
  await page.waitForTimeout(400);
  expect(await page.getByTestId('clock').textContent()).toBe(stoppedAt);
  await banner.getByRole('button').tap();
  await expect(banner).toBeHidden();

  // 전부 끄면 멈추지 않는다
  await page.locator('[data-tab="more"]').tap();
  for (const sw of await page.locator('[data-autopause]').all()) {
    await sw.tap();
    await expect(sw).toHaveAttribute('aria-checked', 'false');
  }
  await page.locator('[data-speed="d30"]').tap();
  await page.waitForTimeout(4000);
  await expect(banner).toBeHidden();
  await expect(page.locator('[data-speed="d30"]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-speed="pause"]').tap();
});

test('모든 탭이 열리고 넘치지 않는다 + 다크 모드', async ({ page }, info) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await startGame(page, { seed: 'e2e-dark', date: '2026-08-01' });
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(15, 26, 20)');
  for (let i = 0; i < 5; i++) {
    await page.locator('[data-turn="168"]').tap();
    await expect(page.locator('[data-turn="168"]')).toBeEnabled();
    if (await page.getByTestId('pause-banner').isVisible()) await page.getByTestId('pause-banner').getByRole('button').tap();
  }
  for (const id of TABS) {
    await page.locator(`[data-tab="${id}"]`).tap();
    await expect(page.locator(`[data-screen="${id}"]`)).toBeVisible();
    await noOverflow(page);
  }
  await page.locator('[data-tab="dashboard"]').tap();
  await page.screenshot({ path: info.outputPath('07-dark-dashboard.png') });
  await page.locator('[data-tab="env"]').tap();
  await page.screenshot({ path: info.outputPath('08-dark-env.png') });
});

test('안전 영역(노치·홈 인디케이터)을 반영한다', async ({ page }, info) => {
  // 에뮬레이터는 env(safe-area-inset-*)를 0으로 주므로, 같은 CSS 변수에 실제 아이폰 값(위 47, 아래 34)을 넣어 확인한다.
  await startGame(page, { seed: 'e2e-safe', date: '2026-05-01' });
  await page.addStyleTag({ content: ':root{--sat:47px;--sab:34px}' });
  const vp = page.viewportSize()!;
  const date = await page.locator('.timebar-date').boundingBox();
  expect(date!.y).toBeGreaterThanOrEqual(47);
  const tab = await page.locator('[data-tab="dashboard"]').boundingBox();
  expect(tab!.y + tab!.height).toBeLessThanOrEqual(vp.height - 34 + 0.5);
  expect(tab!.height).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: info.outputPath('09-safe-area.png') });
});

test('오프라인에서도 열리고 이어진다(서비스 워커)', async ({ page, context }) => {
  await startGame(page, { seed: 'e2e-off' });
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.locator('[data-tab="more"]').tap();
  await expect(page.getByText('인터넷 없이 열 수 있습니다')).toBeVisible({ timeout: 10_000 });
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('clock')).toBeVisible();
  await page.locator('[data-turn="24"]').tap();
  await expect(page.getByTestId('outdoor-card')).toBeVisible();
  await context.setOffline(false);
});
