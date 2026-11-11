import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const origin = new URL(process.env.APP_URL ?? 'http://127.0.0.1:8787').origin;
const browser = await chromium.launch({ channel: 'msedge' });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, acceptDownloads: true });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { async writeText(value) { window.testClipboard = value; } },
    });
  });
  const page = await context.newPage();
  const configResponse = await context.request.get(origin + '/install-config.json');
  assert.equal(configResponse.status(), 200);
  const config = await configResponse.json();
  const { owner, repository, tag, asset } = config.beta;
  const zipUrl = 'https://github.com/' + owner + '/' + repository + '/releases/download/' + tag + '/' + asset;
  await page.goto(origin);
  await page.getByRole('navigation', { name: '主导航' }).getByRole('link', { name: '安装扩展' }).click();
  await page.getByRole('heading', { name: '安装 DownloadAny 扩展' }).waitFor({ timeout: 7000 });
  const zip = page.getByRole('link', { name: '下载扩展 ZIP' });
  assert.equal(await zip.getAttribute('href'), zipUrl);
  const stores = [
    { key: 'edge', name: '从 Edge Add-ons 安装', fixture: 'https://microsoftedge.microsoft.com/addons/detail/example/abcdefghijklmnopabcdefghijklmnop' },
    { key: 'chrome', name: '从 Chrome Web Store 安装', fixture: 'https://chromewebstore.google.com/detail/example/abcdefghijklmnopabcdefghijklmnop' },
  ];
  for (const { key, name } of stores) {
    const link = page.getByRole('link', { name });
    if (config.stores[key]) assert.equal(await link.getAttribute('href'), config.stores[key]);
    else assert.equal(await link.count(), 0);
  }
  const pendingStores = page.getByText('待上架', { exact: true }).filter({ visible: true });
  assert.equal(await pendingStores.count(), stores.filter(({ key }) => !config.stores[key]).length);
  assert.equal(await page.getByRole('button', { name: /复制 Edge 扩展管理地址/ }).count(), 1);
  assert.equal(await page.getByRole('button', { name: /复制 Chrome 扩展管理地址/ }).count(), 1);
  await page.getByRole('button', { name: '复制 Edge 扩展管理地址' }).click();
  await page.getByText('已复制 edge://extensions', { exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.testClipboard), 'edge://extensions');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
  if (process.env.VERIFY_BETA_DOWNLOAD === '1') {
    const saved = page.waitForEvent('download');
    await zip.click();
    const file = await saved;
    assert.equal(file.suggestedFilename(), asset);
    assert.equal(await file.failure(), null);
  }

  const installUrl = page.url();
  for (const { key, name, fixture } of stores) {
    await page.route(origin + '/install-config.json', (route) => route.fulfill({
      json: { ...config, stores: { edge: null, chrome: null, [key]: fixture } },
    }), { times: 1 });
    await page.goto(installUrl);
    assert.equal(await page.getByRole('link', { name }).getAttribute('href'), fixture);
    assert.equal(await pendingStores.count(), 1);
    assert.equal(await zip.getAttribute('href'), zipUrl, 'Store availability keeps the developer-mode ZIP visible');
  }

  await page.goto(origin);
  await page.getByRole('textbox', { name: '视频网址' }).fill('https://example.com/sample.m3u8');
  await page.getByRole('button', { name: '解析视频' }).click();
  const installPrompt = page.getByRole('link', { name: '查看扩展安装步骤' });
  await installPrompt.waitFor({ timeout: 7000 });
  await installPrompt.click();
  await page.getByRole('heading', { name: '安装 DownloadAny 扩展' }).waitFor();
  console.log('Microsoft Edge: beta ZIP, mobile layout, optional stores, and missing-extension entry verified.');
} finally {
  await browser.close();
}
