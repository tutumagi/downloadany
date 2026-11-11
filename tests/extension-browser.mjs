import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';
import { createFixture, probe } from './hls-fixture.mjs';

const directory = await mkdtemp(join(tmpdir(), 'downloadany-extension-'));
const source = join(directory, 'source');
const extension = join(directory, 'extension');
const profile = join(directory, 'profile');
let context;
let server;
try {
  createFixture(source);
  await cp(resolve('dist-extension'), extension, { recursive: true });
  const manifest = JSON.parse(await readFile(join(extension, 'manifest.json'), 'utf8'));
  // Playwright cannot click browser chrome. Only this isolated test copy receives loopback access.
  manifest.host_permissions = ['http://127.0.0.1/*'];
  await writeFile(join(extension, 'manifest.json'), JSON.stringify(manifest));
  await writeFile(join(extension, 'harness.html'), '<!doctype html><title>Extension test</title>');

  const credentials = [];
  const progressiveFile = await readFile(resolve('public/demo/orbit.mp4'));
  server = createServer(async (request, response) => {
    try {
      const path = new URL(request.url, 'http://127.0.0.1').pathname;
      if (path === '/runtime-mp4') {
        response.writeHead(200, { 'content-type': 'text/html' });
        response.end('<video preload="metadata"></video><script>setTimeout(() => document.querySelector("video").src="/runtime.mp4", 250)</script>');
        return;
      }
      if (path === '/runtime.mp4') {
        response.writeHead(200, { 'content-type': 'video/mp4', 'content-length': progressiveFile.length, 'access-control-allow-origin': '*' });
        response.end(progressiveFile);
        return;
      }
      if (path === '/' || path === '/hls-page' || path === '/dash-then-hls') {
        response.writeHead(200, { 'content-type': 'text/html', 'set-cookie': ['demo', '1'].join('=') + '; Path=/; SameSite=Lax' });
        if (path === '/dash-then-hls') {
          response.end('<script>fetch("/video.mpd"); setTimeout(() => fetch("/media.m3u8"), 3500)</script>');
          return;
        }
        response.end((path === '/' ? '<iframe src="/frame"></iframe>' : '')
          + '<script>fetch("/media.m3u8").then(() => document.title = "sources loaded")</script>');
        return;
      }
      credentials.push(Boolean(request.headers.cookie || request.headers.authorization));
      if (path === '/frame') {
        response.writeHead(200, { 'content-type': 'text/html' });
        response.end('<script>fetch("/video.mpd").then(() => document.title = "frame source loaded")</script>');
        return;
      }
      if (path === '/video.mpd') {
        response.writeHead(200, { 'content-type': 'application/dash+xml', 'access-control-allow-origin': '*' });
        response.end('<MPD/>');
        return;
      }
      if (path !== '/media.m3u8' && !/^\/part-\d+\.ts$/.test(path)) {
        response.writeHead(404).end();
        return;
      }
      const type = path.endsWith('.m3u8') ? 'application/vnd.apple.mpegurl' : 'video/mp2t';
      response.writeHead(200, { 'content-type': type, 'access-control-allow-origin': '*' });
      response.end(await readFile(join(source, path.slice(1))));
    } catch {
      response.end();
    }
  });
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
  const fixture = 'http://127.0.0.1:' + server.address().port + '/';
  context = await chromium.launchPersistentContext(profile, {
    channel: 'msedge', headless: true, acceptDownloads: true,
    args: ['--disable-extensions-except=' + extension, '--load-extension=' + extension],
  });
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker', { timeout: 12000 });
  const extensionId = new URL(worker.url()).hostname;
  const tab = await context.newPage();
  await tab.goto(fixture);
  await tab.waitForFunction(() => document.title === 'sources loaded'
    && document.querySelector('iframe').contentDocument.title === 'frame source loaded');
  assert.ok(credentials.some(Boolean), 'the playback tab has a session cookie');
  const scanStart = credentials.length;
  const harness = await context.newPage();
  await harness.goto('chrome-extension://' + extensionId + '/harness.html');
  const wrongOrigin = await harness.evaluate(async (url) => {
    const { readCandidates } = await import(chrome.runtime.getURL('background.js'));
    const tab = (await chrome.tabs.query({})).find((candidate) => candidate.url === url);
    return readCandidates(tab.id, 'https://unapproved.example');
  }, fixture);
  assert.deepEqual(wrongOrigin, [], 'permission for the tab host does not authorize a different expected origin');
  const expiredCleared = await harness.evaluate(async () => {
    const { expireTemporaryFiles } = await import(chrome.runtime.getURL('background.js'));
    const dir = await (await navigator.storage.getDirectory()).getDirectoryHandle('downloadany-temp', { create: true });
    const old = '1-' + crypto.randomUUID() + '.mp4';
    const current = Date.now() + '-' + crypto.randomUUID() + '.mp4';
    await dir.getFileHandle(old, { create: true });
    await dir.getFileHandle(current, { create: true });
    await expireTemporaryFiles();
    const exists = async (name) => Boolean(await dir.getFileHandle(name).catch(() => undefined));
    const cleared = !(await exists(old)) && await exists(current);
    await dir.removeEntry(current);
    return cleared;
  });
  assert.equal(expiredCleared, true, 'stale OPFS files are removed without touching current files');
  const managerEvent = context.waitForEvent('page', { timeout: 10000 });
  await harness.evaluate(async (url) => {
    const { scanAndOpen } = await import(chrome.runtime.getURL('background.js'));
    const [tab] = (await chrome.tabs.query({})).filter((tab) => tab.url === url);
    await scanAndOpen(tab);
  }, fixture);
  const manager = await managerEvent;
  await manager.getByRole('status').filter({ hasText: '找到 2 个分片来源' }).waitFor();
  await manager.getByText('检测到 DASH 分片', { exact: false }).waitFor();
  await manager.getByRole('button', { name: '生成 MP4' }).click();
  const save = manager.getByRole('link', { name: '保存 MP4' });
  await save.waitFor({ timeout: 20000 });
  const saved = manager.waitForEvent('download', { timeout: 15000 });
  await save.click();
  const download = await saved;
  assert.match(download.suggestedFilename(), /^DownloadAny-[12]\.mp4$/);
  const output = probe(await download.path());
  assert.deepEqual(output.streams.map((stream) => stream.codec_type).sort(), ['audio', 'video']);
  assert.ok(Number(output.format.duration) > 4.9);
  assert.ok(credentials.length > scanStart);
  assert.ok(credentials.slice(scanStart).every((value) => !value), 'extension fetches do not replay credentials');
  console.log('Edge extension: active page detection, DASH fallback, HLS MP4 save and playable audio/video verified.');

  // Serve the actual web build at its approved local origin without touching the user's running dev server.
  const webOrigin = 'http://127.0.0.1:8787';
  let inspectCount = 0;
  await context.route(webOrigin + '/**', async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname === '/api/v1/inspect') {
      inspectCount++;
      return route.fulfill({ status: 422, json: { error: 'no_video', retryable: false } });
    }
    if (pathname === '/api/v1/sources') return route.fulfill({ json: { hosts: [] } });
    const name = pathname === '/' ? 'index.html' : pathname.slice(1);
    const types = { html: 'text/html', js: 'text/javascript', css: 'text/css', svg: 'image/svg+xml' };
    try {
      await route.fulfill({ contentType: types[name.split('.').at(-1)], body: await readFile(resolve('dist', name)) });
    } catch { await route.fulfill({ status: 404 }); }
  });
  const web = await context.newPage();
  await web.goto(webOrigin);
  await web.getByRole('textbox', { name: '视频网址' }).fill(fixture + 'hls-page');
  await web.getByRole('button', { name: '解析视频' }).click();
  const launch = web.getByRole('button', { name: '在播放页识别', exact: false });
  await launch.waitFor();
  const nextManager = () => context.waitForEvent('page', {
    // Edge can emit the page event before the extension page commits its navigation.
    predicate: (page) => page.waitForURL((url) => url.protocol === 'chrome-extension:'
      && url.hostname === extensionId && url.pathname === '/manager.html', { timeout: 4000 })
      .then(() => true, () => false),
    timeout: 12000,
  });
  const next = nextManager();
  const linkedDownload = next.then((page) => page.waitForEvent('download', { timeout: 25000 }));
  await launch.click();
  const linkedManager = await next;
  await web.getByRole('status').filter({ hasText: '已打开下载面板' }).waitFor();
  const linkedSave = linkedManager.getByRole('link', { name: '保存 MP4' });
  await linkedSave.waitFor({ timeout: 25000 });
  const linkedOutput = probe(await (await linkedDownload).path());
  assert.deepEqual(linkedOutput.streams.map((stream) => stream.codec_type).sort(), ['audio', 'video']);
  assert.ok(Number(linkedOutput.format.duration) > 4.9);
  assert.equal(inspectCount, 1);
  console.log('Website bridge: fallback click opened the player, detected HLS, generated and saved MP4 automatically.');

  const localLaunch = nextManager();
  await web.getByRole('textbox', { name: '视频网址' }).fill(fixture + 'media.m3u8');
  await web.getByRole('button', { name: '解析视频' }).click();
  await (await localLaunch).getByRole('link', { name: '保存 MP4' }).waitFor({ timeout: 25000 });
  assert.equal(inspectCount, 1, 'direct HLS never goes through the web Worker');

  const knownLaunch = nextManager();
  await web.getByRole('textbox', { name: '视频网址' }).fill('http://xuexi861.com/a/local-fixture');
  await web.getByRole('button', { name: '解析视频' }).click();
  const replayManager = await knownLaunch;
  await replayManager.getByRole('button', { name: '允许并打开播放页' }).waitFor();
  assert.equal(inspectCount, 1, 'the known replay never goes through the web Worker');

  await web.getByRole('textbox', { name: '视频网址' }).fill(fixture + 'dash-then-hls');
  await web.getByRole('button', { name: '解析视频' }).click();
  await launch.waitFor();
  const delayed = nextManager();
  await launch.click();
  const delayedManager = await delayed;
  await delayedManager.getByRole('status').filter({ hasText: '已发现 DASH，正在继续' }).waitFor();
  await delayedManager.getByRole('status').filter({ hasText: '找到 2 个分片来源' }).waitFor();
  await delayedManager.getByRole('button', { name: '生成 MP4' }).waitFor();
  assert.equal(await delayedManager.getByRole('link', { name: '保存 MP4' }).count(), 0);

  await web.getByRole('textbox', { name: '视频网址' }).fill(fixture + 'runtime-mp4');
  await web.getByRole('button', { name: '解析视频' }).click();
  await launch.waitFor();
  const progressiveManager = nextManager();
  const savedProgressive = progressiveManager.then((page) => page.waitForEvent('download', { timeout: 25000 }));
  await launch.click();
  await (await progressiveManager).getByRole('status').filter({ hasText: '找到 1 个视频来源' }).waitFor();
  assert.deepEqual(await readFile(await (await savedProgressive).path()), progressiveFile);
  console.log('Edge website bridge: a playback-only native MP4 was identified and saved byte-for-byte.');
} finally {
  await context?.close();
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
