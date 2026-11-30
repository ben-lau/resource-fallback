import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { serveDocs } from './docs-server.mjs';

const require = createRequire(new URL('../examples/vite-vue/package.json', import.meta.url));
const { chromium, expect } = require('@playwright/test');
const output = fileURLToPath(new URL('../test-results/docs/', import.meta.url));
await mkdir(output, { recursive: true });
const server = await serveDocs();
const systemChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const executablePath =
  process.env.DOCS_BROWSER_PATH ||
  (existsSync(chromium.executablePath())
    ? undefined
    : existsSync(systemChrome)
      ? systemChrome
      : undefined);
let browser;
const report = { pages: [], searches: [], interactions: [], failures: [] };

try {
  browser = await chromium.launch({ executablePath });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], {
    origin: new URL(server.url).origin,
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => report.failures.push(error.message));

  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
    for (const route of [
      '',
      'guide/configuration',
      'guide/url-preview',
      'reference/',
      'api/types',
      'experience/case-studies',
      'en/guide/url-preview',
    ]) {
      const response = await page.goto(server.url + route);
      expect(response.status(), route).toBe(200);
      await page.evaluate(() => document.fonts.ready);
      if (route.includes('url-preview'))
        await expect(page.locator('.rf-tool-primary')).toBeEnabled();
      const dimensions = await page.evaluate(() => ({
        width: innerWidth,
        overflow: document.documentElement.scrollWidth - innerWidth,
        height: document.documentElement.scrollHeight,
        outline: document.querySelectorAll('.VPDocAsideOutline a').length,
      }));
      expect(dimensions.overflow, `${route} at ${width}`).toBeLessThanOrEqual(1);
      if (route === 'experience/case-studies') expect(dimensions.outline).toBe(10);
      if (route === 'api/types') {
        await expect(page.getByRole('link', { name: '在 GitHub 上编辑此页' })).toHaveAttribute(
          'href',
          'https://github.com/ben-lau/resource-fallback/edit/main/packages/core/src/types.ts',
        );
      }
      if (route === 'guide/configuration' && width === 390) {
        const cells = await page
          .locator('.rf-option-table tbody tr')
          .first()
          .locator('td')
          .evaluateAll((elements) =>
            elements.map((element) => {
              const bounds = element.getBoundingClientRect();
              return {
                x: bounds.x,
                right: bounds.right,
                width: bounds.width,
                label: element.getAttribute('data-label'),
              };
            }),
          );
        expect(cells).toHaveLength(4);
        for (const cell of cells) {
          expect(cell.x).toBeGreaterThanOrEqual(0);
          expect(cell.right).toBeLessThanOrEqual(width);
        }
        expect(cells[3].label).toBe('说明');
      }
      const name = `${route.replaceAll('/', '-') || 'home'}-${width}`;
      await page.screenshot({ path: join(output, name + '.png') });
      report.pages.push({ route, ...dimensions });
    }
  }

  await page.setViewportSize({ width: 1440, height: 900 });
  for (const locale of ['', 'en/']) {
    await page.goto(server.url + locale);
    await page.locator('.VPNavBarSearch button').click();
    const queries = locale
      ? [
          ['rf:error', '/en/guide/runtime-events#rf-error'],
          ['hooks', '/en/guide/configuration#hooks-and-serialization-limits'],
          ['timeout', '/en/guide/configuration#timeouts'],
        ]
      : [
          ['rf:error', '/guide/runtime-events#rf-error'],
          ['hooks', '/guide/configuration#hooks-与序列化限制'],
          ['超时', '/guide/configuration#timeouts'],
          ['熔断', '/guide/configuration'],
          ['白屏', '/guide/troubleshooting#entry-failure'],
          ['回源', '/guide/url-preview'],
          ['图片', '/guide/coverage'],
        ];
    for (const [query, expected] of queries) {
      await page.getByRole('searchbox').fill(query);
      // VitePress debounces queries; do not accept the preceding query's results.
      await page.waitForTimeout(250);
      const results = page.locator('.VPLocalSearchBox .results a');
      try {
        await expect
          .poll(
            async () =>
              (
                await results.evaluateAll((links) =>
                  links.slice(0, 3).map((link) => decodeURIComponent(link.getAttribute('href'))),
                )
              ).some((href) => href.includes(expected)),
            { timeout: 5000, message: `${locale}${query}: expected ${expected} in top three` },
          )
          .toBe(true);
      } catch (error) {
        report.failures.push(`${locale || 'zh'} search ${query}: ${error.message}`);
      }
      report.searches.push({
        locale: locale || 'zh',
        query,
        expected,
        hits: await results.evaluateAll((links) =>
          links
            .slice(0, 3)
            .map((link) => ({ href: link.getAttribute('href'), text: link.textContent })),
        ),
      });
    }
    await page.getByRole('searchbox').press('Escape');
    await expect(page.locator('.VPLocalSearchBox')).toHaveCount(0);
  }

  await page.goto(server.url + 'guide/url-preview');
  await expect(page.getByRole('button', { name: '预览请求地址' })).toBeEnabled();
  await page.getByLabel('首次资源 URL').fill('https://cdn1.example.com/app/assets/main.js?v=2');
  await page.getByLabel('首次资源 URL').press('Enter');
  await expect(page.locator('.rf-url-chain li').last()).toContainText(
    'https://app.example.com/app/assets/main.js?v=2',
  );
  await page.getByLabel('回退前缀，每行一个').fill('https://backup.example.com/static/\n/another/');
  await page.getByRole('button', { name: '预览请求地址' }).click();
  await expect(page.locator('.rf-url-chain li').nth(1)).toContainText(
    'https://backup.example.com/static/assets/main.js?v=2',
  );
  await expect(page.locator('.rf-url-chain li').last()).toContainText(
    'https://app.example.com/another/assets/main.js?v=2',
  );
  await page.getByLabel('回退前缀，每行一个').fill('/app/\n/app/');
  await page.getByRole('button', { name: '预览请求地址' }).click();
  await expect(page.getByRole('alert')).toContainText('duplicate');
  await page.getByRole('button', { name: '重置示例' }).click();
  await page.getByLabel('首次资源 URL').fill('https://other.example.com/assets/main.js');
  await page.getByRole('button', { name: '预览请求地址' }).click();
  await expect(page.locator('.rf-tool-result')).toContainText('没有匹配');
  await page.getByRole('button', { name: '重置示例' }).click();
  await page.getByText('多条规则（可选 JSON）', { exact: true }).click();
  await page.getByLabel('规则数组', { exact: true }).fill(
    JSON.stringify([
      { base: 'https://cdn1.example.com/', urls: ['/wrong/'] },
      { base: 'https://cdn1.example.com/app/', urls: ['/right/'], retry: { max: 0 } },
    ]),
  );
  await page.getByRole('button', { name: '预览请求地址' }).click();
  await expect(page.locator('.rf-url-chain li').last()).toContainText(
    'https://app.example.com/right/assets/app.js',
  );
  report.interactions.push(
    'URL preview: keyboard submit, query preservation, multiple candidates, validation, reset, no-match, longest-prefix selection',
  );

  await page.goto(server.url);
  for (const [scenario, count, event] of [
    ['backup', 3, 'rf:success'],
    ['origin', 5, 'rf:success'],
    ['none', 6, 'rf:error'],
  ]) {
    await page.locator(`input[value="${scenario}"]`).check();
    await expect(page.locator('.trace-result')).toContainText(event);
    await expect(page.locator('.trace-count')).toHaveText(`(${count})`);
  }
  await page.locator('.trace-log > summary').click();
  await page.locator('.trace-payload > summary').first().click();
  await expect(page.locator('.trace-payload pre').first()).toContainText('"attempt": 1');
  await page.getByRole('button', { name: '复制事件 JSON' }).click();
  await expect(page.getByRole('button', { name: '已复制' })).toBeVisible();
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  expect(JSON.parse(clipboard)).toHaveLength(6);
  await page.evaluate(() =>
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }),
  );
  await page.locator('.trace-log-actions button').click();
  await expect(page.getByRole('status').filter({ hasText: '请展开数据后手动复制' })).toBeVisible();
  report.interactions.push(
    'Replay: three scenarios, event payload, clipboard success and unavailable fallback',
  );

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(server.url + 'experience/case-studies');
  await page.getByRole('link', { name: 'Webpack ownership', exact: true }).click();
  await expect
    .poll(() =>
      page
        .locator('.vp-doc h2')
        .first()
        .evaluate((heading) => heading.getBoundingClientRect().top),
    )
    .toBeLessThanOrEqual(240);
  const headingTop = await page
    .locator('.vp-doc h2')
    .first()
    .evaluate((heading) => heading.getBoundingClientRect().top);
  expect(headingTop).toBeGreaterThanOrEqual(120);
  await page.screenshot({ path: join(output, 'case-anchor-mobile.png') });
  report.interactions.push('Case anchors remain visible below fixed mobile navigation');

  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(server.url + 'guide/url-preview');
  await page.locator('.VPSwitchAppearance').first().click();
  await expect(page.locator('html')).toHaveClass(/dark/);
  await page.screenshot({ path: join(output, 'url-preview-dark.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(server.url + 'guide/configuration');
  await page.screenshot({ path: join(output, 'configuration-dark-mobile.png') });
  await page.locator('.VPNavBarHamburger').click();
  await expect(page.locator('.VPNavScreen')).toBeVisible();
  await page.keyboard.press('Escape');
  report.interactions.push('Dark theme and mobile navigation');

  const reduced = await browser.newContext({
    reducedMotion: 'reduce',
    viewport: { width: 390, height: 844 },
  });
  const reducedPage = await reduced.newPage();
  await reducedPage.goto(server.url);
  await reducedPage.getByRole('button', { name: '播放回退' }).click();
  await expect(reducedPage.locator('.trace-log')).toHaveAttribute('open', '');
  report.interactions.push('Reduced motion reveals event log without animation');
  await reduced.close();
  await context.close();
} catch (error) {
  report.failures.push(error.stack || error.message);
} finally {
  if (browser) await browser.close();
  await server.close();
  await writeFile(join(output, 'report.json'), JSON.stringify(report, null, 2));
}

if (report.failures.length) {
  console.error(report.failures.join('\n'));
  process.exitCode = 1;
} else {
  console.log(
    `Docs browser checks passed: ${report.pages.length} viewport/page combinations, ${report.searches.length} searches, and ${report.interactions.length} interaction groups.`,
  );
}
