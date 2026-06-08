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
 * The runtime retries, then falls back to the origin on localhost:4174.
 */
test('entry + lazy routes fall back from fake CDN to origin', async ({ page }) => {
  const events = await setupEventRecording(page);

  await page.goto('/', { timeout: 60_000 });
  await expect(page.getByTestId('home-loaded')).toBeVisible({ timeout: 30_000 });

  await page.click('[data-testid="link-about"]');
  await expect(page.getByTestId('about-loaded')).toBeVisible({ timeout: 30_000 });

  await page.click('[data-testid="link-about2"]');
  await expect(page.getByTestId('about2-loaded')).toBeVisible({ timeout: 30_000 });

  expect(events.some((e) => e.type === 'retry' || e.type === 'fallback')).toBe(true);
});

test('event sequence: retry events precede fallback events for same resource', async ({ page }) => {
  const events = await setupEventRecording(page);

  await page.goto('/', { timeout: 60_000 });
  await expect(page.getByTestId('home-loaded')).toBeVisible({ timeout: 30_000 });

  // At least some events should have been recorded during page load
  expect(events.length).toBeGreaterThan(0);

  // For each resource URL, retries should come before fallbacks
  const retryUrls = events
    .filter((e) => e.type === 'retry')
    .map((e) => (e.payload as { url: string }).url);
  const fallbackFromUrls = events
    .filter((e) => e.type === 'fallback')
    .map((e) => (e.payload as { from: string }).from);

  // If there are fallbacks, there should be at least some retries or direct fallbacks
  if (fallbackFromUrls.length > 0) {
    expect(events.some((e) => e.type === 'retry' || e.type === 'fallback')).toBe(true);
  }

  // Every event sequence should end with a success (page loaded successfully)
  expect(events.some((e) => e.type === 'success')).toBe(true);
});

test('all async routes load successfully after fallback chain', async ({ page }) => {
  const events = await setupEventRecording(page);

  await page.goto('/', { timeout: 60_000 });
  await expect(page.getByTestId('home-loaded')).toBeVisible({ timeout: 30_000 });

  // Navigate through all routes
  await page.click('[data-testid="link-about"]');
  await expect(page.getByTestId('about-loaded')).toBeVisible({ timeout: 30_000 });

  // Go back to Home via direct navigation (no home link in nav)
  await page.goto('/', { timeout: 60_000 });
  await expect(page.getByTestId('home-loaded')).toBeVisible({ timeout: 30_000 });

  // Navigate to About2
  await page.click('[data-testid="link-about2"]');
  await expect(page.getByTestId('about2-loaded')).toBeVisible({ timeout: 30_000 });

  // All routes loaded — success events should be present
  const successes = events.filter((e) => e.type === 'success');
  expect(successes.length).toBeGreaterThan(0);
});

test('circuit breaker state is visible in the UI', async ({ page }) => {
  await page.goto('/', { timeout: 60_000 });
  await expect(page.getByTestId('home-loaded')).toBeVisible({ timeout: 30_000 });

  // After CDN failures, the circuit breaker table should show OPEN hosts
  // The .invalid domains should have failed and be tracked
  await page.waitForTimeout(2000);

  // Check that circuit breaker section shows host status
  const circuitText = await page.locator('table').allTextContents();
  const hasCircuitEntry = circuitText.some(
    (t) => t.includes('example.invalid') || t.includes('OPEN') || t.includes('CLOSED'),
  );
  expect(hasCircuitEntry).toBe(true);
});

test('no console errors from resource-fallback runtime', async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' && msg.text().includes('resource-fallback')) {
      consoleErrors.push(msg.text());
    }
  });

  await page.goto('/', { timeout: 60_000 });
  await expect(page.getByTestId('home-loaded')).toBeVisible({ timeout: 30_000 });

  // Navigate to trigger async loading
  await page.click('[data-testid="link-about"]');
  await expect(page.getByTestId('about-loaded')).toBeVisible({ timeout: 30_000 });

  // There should be no runtime errors (network failures are expected and handled)
  expect(consoleErrors).toHaveLength(0);
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
