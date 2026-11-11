import test from 'node:test';
import assert from 'node:assert/strict';

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
