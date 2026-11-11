import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const app = process.env.APP_URL ?? 'http://127.0.0.1:8787';
const browser = await chromium.launch({ channel: 'chrome' });
try {
  const page = await browser.newPage({ acceptDownloads: true, viewport: { width: 1280, height: 900 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(app);
  await page.getByRole('textbox', { name: '视频网址' }).waitFor({ timeout: 4000 });

  if (process.env.SCREENSHOT_PATH) await page.screenshot({ path: process.env.SCREENSHOT_PATH, fullPage: true });

  const inspect = (url) => page.request.post(app + '/api/v1/inspect', { data: { url } });
  let result = await inspect(app + '/demo/signal.mp4');
  assert.equal(result.status(), 200, await result.text());
  assert.equal((await result.json()).videos[0].delivery, 'attachment');
  result = await inspect(app + '/demo/clips.html');
  assert.equal(result.status(), 200, await result.text());
  const parsed = await result.json();
  assert.deepEqual(parsed.videos.map(({ filename, delivery }) => [filename, delivery]), [
    ['signal.mp4', 'attachment'], ['orbit.mp4', 'browser'],
  ]);
  result = await inspect('http://127.0.0.1:9999/private');
  assert.equal((await result.json()).error, 'source_not_allowed');

  await page.getByRole('button', { name: '试试 MP4 直链' }).click();
  await page.getByRole('heading', { name: '找到 1 个视频' }).waitFor();
  let saved = page.waitForEvent('download');
  await page.getByRole('link', { name: '下载' }).click();
  let download = await saved;
  assert.equal(download.suggestedFilename(), 'signal.mp4');
  assert.deepEqual(await readFile(await download.path()), await readFile('public/demo/signal.mp4'));

  await page.getByRole('button', { name: '试试视频网页' }).click();
  await page.getByRole('heading', { name: '找到 2 个视频' }).waitFor();
  assert.equal(await page.getByRole('listitem').count(), 2);
  saved = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载', exact: true }).click();
  download = await saved;
  assert.equal(download.suggestedFilename(), 'orbit.mp4');
  assert.deepEqual(await readFile(await download.path()), await readFile('public/demo/orbit.mp4'));

  // Exercise the browser's actual cross-origin Blob path without using a third-party service.
  const fixtureUrl = 'https://video-fixture.example/orbit.mp4';
  const fixture = await readFile('public/demo/orbit.mp4');
  await page.route(fixtureUrl, (route) => route.fulfill({
    headers: { 'access-control-allow-origin': app, 'content-type': 'video/mp4' }, body: fixture,
  }));
  await page.route(app + '/api/v1/inspect', (route) => route.fulfill({
    json: { hostname: 'video-fixture.example', limited: false, videos: [
      { title: '跨域示例', filename: 'orbit.mp4', url: fixtureUrl, delivery: 'browser', size: fixture.length },
    ] },
  }), { times: 1 });
  await page.getByRole('textbox', { name: '视频网址' }).fill(fixtureUrl);
  await page.getByRole('button', { name: '解析视频' }).click();
  await page.getByText('跨域示例').waitFor();
  saved = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载', exact: true }).click();
  download = await saved;
  assert.deepEqual(await readFile(await download.path()), fixture);

  await page.getByRole('textbox', { name: '视频网址' }).fill('https://youtu.be/example');
  await page.getByRole('button', { name: '解析视频' }).click();
  await page.getByRole('status').filter({ hasText: 'YouTube 暂未开放' }).waitFor();
  assert.equal(await page.getByRole('listitem').count(), 0);

  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
  await page.getByRole('button', { name: '试试视频网页' }).click();
  await page.getByRole('heading', { name: '找到 2 个视频' }).waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
  if (process.env.MOBILE_SCREENSHOT_PATH) await page.screenshot({ path: process.env.MOBILE_SCREENSHOT_PATH, fullPage: true });
  assert.deepEqual(errors, []);
  console.log('Browser passed: actual MP4 saves (attachment, same-origin Blob, cross-origin Blob), multi-video results, disabled platform, mobile width.');
} finally {
  await browser.close();
}
