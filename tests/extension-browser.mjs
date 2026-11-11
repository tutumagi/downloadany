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
  server = createServer(async (request, response) => {
    try {
      const path = new URL(request.url, 'http://127.0.0.1').pathname;
      if (path === '/') {
        response.writeHead(200, { 'content-type': 'text/html', 'set-cookie': ['demo', '1'].join('=') + '; Path=/; SameSite=Lax' });
        response.end('<iframe src="/frame"></iframe><script>fetch("/media.m3u8").then(() => document.title = "sources loaded")</script>');
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
    channel: 'chromium', headless: true, acceptDownloads: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
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
  console.log('Chromium extension: active page detection, DASH fallback, HLS MP4 save and playable audio/video verified.');
} finally {
  await context?.close();
  if (server?.listening) await new Promise((resolve) => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
