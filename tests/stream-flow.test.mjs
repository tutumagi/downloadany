import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

test('locally routes known replay links, without accepting lookalike hosts', async () => {
  const { playbackTarget, shouldRouteLocally } = await import('../src/stream-flow.ts');
  const url = 'http://xuexi861.com/a/local-fixture';
  assert.deepEqual(playbackTarget(url), { url, origin: 'https://interactive.gaotu100.com' });
  assert.equal(shouldRouteLocally(url), true);
  assert.equal(shouldRouteLocally('https://interactive.gaotu100.com/gaotu-live-student/gtlive/playback.html?demo=1'), true);
  assert.equal(shouldRouteLocally('https://xuexi861.com.evil.test/a/local-fixture'), false);
  assert.equal(shouldRouteLocally('https://media.example/video.mp4'), false);
});

test('only approved web origins may request a launch', async () => {
  const { trustedWebOrigin, playbackTarget, extractPlaybackUrl } = await import('../src/stream-flow.ts');
  assert.equal(trustedWebOrigin('http://127.0.0.1:8787'), true);
  assert.equal(trustedWebOrigin('https://download.tutudev.com'), true);
  for (const url of ['http://127.0.0.1:9999', 'https://download.tutudev.com.evil.test', 'https://anything.workers.dev']) {
    assert.equal(trustedWebOrigin(url), false);
  }
  assert.equal(playbackTarget('javascript:alert(1)'), undefined);
  assert.equal(playbackTarget('https://user@media.example/video'), undefined);
  assert.equal(playbackTarget('https://www.youtube.com/video.m3u8'), undefined);
  assert.equal(playbackTarget('https://cdn.bilivideo.com/video.mpd'), undefined);
  assert.equal(extractPlaybackUrl('https://one.test https://two.test'), undefined);
  assert.equal(extractPlaybackUrl('这是链接 https://one.test/?ref=a%2Fb，打开即可'), 'https://one.test/?ref=a%2Fb');
});

test('a direct playlist keeps its URL and goes directly to the local manager', async () => {
  const { playbackTarget, shouldRouteLocally } = await import('../src/stream-flow.ts');
  const url = 'https://media.example/video.m3u8?example=1';
  assert.deepEqual(playbackTarget(url), { url, origin: 'https://media.example', direct: 'hls' });
  assert.equal(shouldRouteLocally(url), true);
});

test('the deployed preview is trusted at each bridge layer without opening other workers.dev origins', async () => {
  const { trustedWebOrigin, WORKERS_PREVIEW_ORIGIN: preview } = await import('../src/stream-flow.ts');
  const manifest = JSON.parse(await readFile(new URL('../extension/public/manifest.json', import.meta.url), 'utf8'));
  const bridge = await readFile(new URL('../extension/public/web-bridge.js', import.meta.url), 'utf8');
  const matches = manifest.content_scripts.find((script) => script.js.includes('web-bridge.js')).matches;
  assert.deepEqual(matches.filter((entry) => entry.includes('workers.dev')), [preview + '/*']);
  for (const [origin, trusted] of [[preview, true], ['https://other.tufei-fly.workers.dev', false],
    [preview + '.example', false], [preview.replace('https:', 'http:'), false]]) {
    let listening = false;
    const window = { addEventListener(event) { listening ||= event === 'message'; } };
    window.top = window;
    runInNewContext(bridge, { window, location: { origin } });
    assert.equal(listening, trusted, origin);
    assert.equal(trustedWebOrigin(origin), trusted, origin);
  }
});
