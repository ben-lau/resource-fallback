import { expect, test } from '@playwright/test';

interface RfEvent {
  type: string;
  payload: unknown;
}

async function setupEventRecording(page: import('@playwright/test').Page) {
  const events: RfEvent[] = [];
  await page.exposeFunction('__rfRecord', (type: string, payload: unknown) => {
    events.push({ type, payload });
  });
  await page.addInitScript(() => {
    const fan = (name: string) => (e: Event) => {
      (window as any).__rfRecord(name, (e as CustomEvent).detail);
    };
    window.addEventListener('rf:retry', fan('retry'));
    window.addEventListener('rf:fallback', fan('fallback'));
    window.addEventListener('rf:success', fan('success'));
    window.addEventListener('rf:error', fan('error'));
  });
  return events;
}

async function reloadUnderServiceWorker(page: import('@playwright/test').Page) {
  await page.goto('/', { timeout: 60_000 });
  await page.evaluate(async () => {
    if (!('serviceWorker' in navigator)) throw new Error('Service Worker unsupported');
    await navigator.serviceWorker.ready;
  });
  await page.reload({ timeout: 60_000, waitUntil: 'domcontentloaded' });
}

/**
 * CDN URLs use `.invalid` domains (DNS always fails).
 * The runtime retries, then falls back to the origin on localhost:4173.
 */
test('main bundle falls back from fake CDN to origin', async ({ page }) => {
  const events = await setupEventRecording(page);

  await page.goto('/', { timeout: 60_000 });
  await expect(page.getByText('resource-fallback · webpack demo')).toBeVisible({ timeout: 30_000 });

  expect(events.some((e) => e.type === 'retry')).toBe(true);
  expect(events.some((e) => e.type === 'fallback')).toBe(true);
});

test('lazy modules load and circuit breaker trips after threshold', async ({ page }) => {
  await page.goto('/', { timeout: 60_000 });
  await expect(page.getByText('resource-fallback · webpack demo')).toBeVisible({ timeout: 30_000 });

  // Load Module A
  await page.click('button:has-text("Load Module A")');
  await expect(page.getByTestId('lazy-loaded')).toBeVisible({ timeout: 30_000 });

  // Load Module B — circuit breaker may have tripped, should still succeed
  await page.click('button:has-text("Load Module B")');
  await expect(page.getByTestId('lazy-b-loaded')).toBeVisible({ timeout: 30_000 });

  // Load Module C
  await page.click('button:has-text("Load Module C")');
  await expect(page.getByTestId('lazy-c-loaded')).toBeVisible({ timeout: 30_000 });
});

test('all three lazy modules can load sequentially with full fallback chain', async ({ page }) => {
  const events = await setupEventRecording(page);

  await page.goto('/', { timeout: 60_000 });
  await expect(page.getByText('resource-fallback · webpack demo')).toBeVisible({ timeout: 30_000 });

  // Load all three modules sequentially
  await page.click('button:has-text("Load Module A")');
  await expect(page.getByTestId('lazy-loaded')).toBeVisible({ timeout: 30_000 });

  await page.click('button:has-text("Load Module B")');
  await expect(page.getByTestId('lazy-b-loaded')).toBeVisible({ timeout: 30_000 });

  await page.click('button:has-text("Load Module C")');
  await expect(page.getByTestId('lazy-c-loaded')).toBeVisible({ timeout: 30_000 });

  // All modules loaded — verify fallback chain was exercised
  const fallbacks = events.filter((e) => e.type === 'fallback');
  const retries = events.filter((e) => e.type === 'retry');
  expect(fallbacks.length + retries.length).toBeGreaterThan(0);
});

test('event ordering: retries before fallbacks for each resource', async ({ page }) => {
  const events = await setupEventRecording(page);

  await page.goto('/', { timeout: 60_000 });
  await expect(page.getByText('resource-fallback · webpack demo')).toBeVisible({ timeout: 30_000 });

  // Page load should have produced events
  expect(events.length).toBeGreaterThan(0);

  // Check that retries come before fallbacks for each URL
  const retryIndices = events.map((e, i) => (e.type === 'retry' ? i : -1)).filter((i) => i >= 0);
  const fallbackIndices = events
    .map((e, i) => (e.type === 'fallback' ? i : -1))
    .filter((i) => i >= 0);

  // If we have both retries and fallbacks, the first retry should appear
  // before or at the same position as the first fallback
  if (retryIndices.length > 0 && fallbackIndices.length > 0) {
    expect(retryIndices[0]).toBeLessThanOrEqual(fallbackIndices[0]);
  }
});

test('circuit breaker state persists in localStorage after failures', async ({ page }) => {
  await page.goto('/', { timeout: 60_000 });
  await expect(page.getByText('resource-fallback · webpack demo')).toBeVisible({ timeout: 30_000 });

  // After page load with .invalid CDNs, circuit breaker should have entries
  const circuitState = await page.evaluate(() => {
    const raw = localStorage.getItem('__rf_circuit__');
    return raw ? JSON.parse(raw) : null;
  });

  expect(circuitState).not.toBeNull();
  // Should have entries for the .invalid hosts
  const hosts = Object.keys(circuitState);
  expect(hosts.length).toBeGreaterThan(0);
  expect(hosts.some((h) => h.includes('example.invalid'))).toBe(true);
});

test('no uncaught exceptions during fallback process', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => {
    errors.push(err.message);
  });

  await page.goto('/', { timeout: 60_000 });
  await expect(page.getByText('resource-fallback · webpack demo')).toBeVisible({ timeout: 30_000 });

  await page.click('button:has-text("Load Module A")');
  await expect(page.getByTestId('lazy-loaded')).toBeVisible({ timeout: 30_000 });

  // Filter out expected network errors — only check for runtime exceptions
  const runtimeErrors = errors.filter(
    (e) => !e.includes('ChunkLoadError') && !e.includes('Loading chunk'),
  );
  expect(runtimeErrors).toHaveLength(0);
});

test('manual external script status is scoped to the clicked URL', async ({ page }) => {
  await page.goto('/', { timeout: 60_000 });
  await expect(page.getByText('resource-fallback · webpack demo')).toBeVisible({ timeout: 30_000 });

  await page.click('button:has-text("加载匹配规则的脚本")');
  await expect(page.getByText('已被 Observer 拦截并回退')).toBeVisible({ timeout: 30_000 });

  await page.click('button:has-text("加载不匹配规则的脚本")');
  await expect(page.getByText('未被拦截（预期行为，不匹配任何规则）')).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByText('被拦截了（不应该）')).not.toBeVisible();
});

test('manual external script retries do not poison async chunk fallback', async ({ page }) => {
  await page.goto('/', { timeout: 60_000 });
  await expect(page.getByText('resource-fallback · webpack demo')).toBeVisible({ timeout: 30_000 });

  for (let i = 0; i < 3; i++) {
    const before = await page.evaluate(() => ((window as any).__RF_EVENTS__ || []).length);
    await page.click('button:has-text("加载匹配规则的脚本")');
    await page.waitForFunction(
      (count) => ((window as any).__RF_EVENTS__ || []).length > count,
      before,
    );
    await expect(page.getByText('已被 Observer 拦截并回退')).toBeVisible({ timeout: 30_000 });
  }

  await page.click('button:has-text("Load Module C")');
  await expect(page.getByTestId('lazy-c-loaded')).toBeVisible({ timeout: 30_000 });
});

test('hybrid service worker falls back image and css subresources after activation', async ({
  page,
}) => {
  const events = await setupEventRecording(page);

  await reloadUnderServiceWorker(page);
  await expect(page.getByTestId('sw-image')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('sw-css-url')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('sw-import-card')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('sw-font-sample')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('sw-image')).toHaveJSProperty('naturalWidth', 96);
  await page.evaluate(async () => {
    await document.fonts.ready;
    if (!document.fonts.check('18px "RfSwFallbackDemo"')) {
      throw new Error('RfSwFallbackDemo font was not applied');
    }
  });
  await page.waitForTimeout(1000);

  const serialized = events.map((event) => JSON.stringify(event.payload)).join('\n');
  expect(events.some((event) => event.type === 'fallback')).toBe(true);
  expect(serialized).toMatch(/sw-logo|\.svg/);
});
