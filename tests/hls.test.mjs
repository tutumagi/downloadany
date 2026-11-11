import test from 'node:test';
import assert from 'node:assert/strict';

const origin = 'https://media.example';
const master = origin + '/master.m3u8';
const media = origin + '/sub/media.m3u8';
const end = '#EXT-X-ENDLIST';

test('resolves a muxed master and retains explicitly supplied media queries', async () => {
  const { parsePlaylist } = await import('../extension/hls.ts');
  assert.deepEqual(parsePlaylist('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1234\nsub/media.m3u8?sig=here', master), {
    kind: 'master', variant: media + '?sig=here',
  });
  const playlist = '#EXTM3U\n#EXTINF:2,\nclip.ts?ref=a%2Fb\n#EXTINF:2,\nclip2.ts\n' + end;
  assert.deepEqual(parsePlaylist(playlist, media + '?manifest=only'), {
    kind: 'media', segments: [origin + '/sub/clip.ts?ref=a%2Fb', origin + '/sub/clip2.ts'],
  });
});

test('rejects encryption, live playback and a split audio rendition before opening any segment', async () => {
  const { prepareHls } = await import('../extension/hls.ts');
  for (const [playlist, code] of [
    ['#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key"\n#EXTINF:2,\nclip.ts\n' + end, 'encrypted'],
    ['#EXTM3U\n#EXTINF:2,\nclip.ts', 'live'],
    ['#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1,AUDIO="audio"\nsub/media.m3u8', 'unsupported'],
    ['#EXTM3U\n#EXT-X-SKIP:SKIPPED-SEGMENTS=8\n#EXTINF:2,\nlast.ts\n' + end, 'unsupported'],
  ]) {
    const requests = [];
    await assert.rejects(prepareHls(master, {
      fetcher: async (url) => { requests.push(url); return new Response(playlist); },
    }), { code });
    assert.deepEqual(requests, [master]);
  }
});

test('allows in-band master audio but rejects externally separated audio', async () => {
  const { parsePlaylist } = await import('../extension/hls.ts');
  const playlist = '#EXTM3U\n#EXT-X-MEDIA:TYPE=AUDIO,GROUP-ID="sound",NAME="Main",DEFAULT=YES'
    + '\n#EXT-X-STREAM-INF:BANDWIDTH=1234,AUDIO="sound",CODECS="avc1.4d001f,mp4a.40.2"\nsub/media.m3u8';
  assert.deepEqual(parsePlaylist(playlist, master), { kind: 'master', variant: media });
  assert.throws(() => parsePlaylist(playlist.replace('DEFAULT=YES', 'DEFAULT=YES,URI="audio.m3u8"'), master), {
    code: 'unsupported',
  });
});

test('does not follow cross-origin manifest resources or fetch credentials', async () => {
  const { prepareHls } = await import('../extension/hls.ts');
  await assert.rejects(prepareHls(master, {
    fetcher: async (url, init) => {
      assert.equal(url, master);
      assert.equal(init.credentials, 'omit');
      assert.equal(init.redirect, 'error');
      assert.equal(init.referrerPolicy, 'no-referrer');
      return new Response('#EXTM3U\n#EXTINF:2,\nhttps://other.example/clip.ts\n' + end);
    },
  }), { code: 'cross_origin' });
});

test('accepts a repeated identical initialization map without adding a second init', async () => {
  const { parsePlaylist } = await import('../extension/hls.ts');
  const playlist = '#EXTM3U\n#EXT-X-MAP:URI="init.mp4"\n#EXTINF:2,\nfirst.m4s\n'
    + '#EXT-X-MAP:URI="./init.mp4"\n#EXTINF:2,\nlast.m4s\n' + end;
  assert.deepEqual(parsePlaylist(playlist, master), {
    kind: 'media', init: origin + '/init.mp4', segments: [origin + '/first.m4s', origin + '/last.m4s'],
  });
});

test('detects signed HLS and DASH candidates but ignores blob URLs and segments', async () => {
  const { candidatesFrom } = await import('../extension/detect.ts');
  const result = candidatesFrom([
    { url: origin + '/sub/video.m3u8?token=testing' },
    { url: origin + '/play', type: 'application/dash+xml' },
    { url: origin + '/sub/clip.ts' },
    { url: 'blob:https://example.com/sample' },
    { url: origin + '/sub/video.m3u8?token=testing' },
  ]);
  assert.deepEqual(result, [
    { url: origin + '/sub/video.m3u8?token=testing', kind: 'hls' },
    { url: origin + '/play', kind: 'dash' },
  ]);
});
